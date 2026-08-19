use std::time::{SystemTime, UNIX_EPOCH};

use tracing::{debug, info, warn};

use crate::event::{AgentEvent, OrchestratorEvent};
use crate::tool::ToolError;
use crate::tool_hook::ToolHookAction;
use crate::types::{MessageRole, OrchestratorMessage, PlanItem, PlanItemStatus, ToolCall};

use super::{AgentError, AgentLoop};

impl AgentLoop {
    /// A4 Plan-Exec：解析状态字符串 → `PlanItemStatus`（非法返回 `None`）
    fn parse_plan_status(s: &str) -> Option<PlanItemStatus> {
        match s {
            "pending" => Some(PlanItemStatus::Pending),
            "in_progress" => Some(PlanItemStatus::InProgress),
            "completed" => Some(PlanItemStatus::Completed),
            "skipped" => Some(PlanItemStatus::Skipped),
            "failed" => Some(PlanItemStatus::Failed),
            _ => None,
        }
    }

    /// A4 Plan-Exec：计划工具结果回调
    ///
    /// 在 `plan_create`/`plan_update` 工具成功返回后调用，把规范化结果写入
    /// `AgentState.plan` 并广播 `PlanCreated`/`PlanStepUpdate` 事件，使前端
    /// `usePlanStore` 与 plan 状态保持同步，同时供持久化层随会话保存。
    pub(super) async fn apply_plan_result(&self, tool_name: &str, result: &serde_json::Value) {
        if tool_name == "plan_create" {
            let items = result
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let items: Vec<PlanItem> = items
                .into_iter()
                .filter_map(|v| serde_json::from_value(v).ok())
                .collect();
            if items.is_empty() {
                return;
            }
            self.state.lock().await.plan = Some(items.clone());
            self.broadcast(OrchestratorEvent::PlanCreated { items }).await;
        } else if tool_name == "plan_update" {
            let item_id = result
                .get("item_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let status = result
                .get("status")
                .and_then(|v| v.as_str())
                .and_then(Self::parse_plan_status);
            if let (Some(item_id), Some(status)) = (item_id, status) {
                {
                    let mut state = self.state.lock().await;
                    if let Some(plan) = &mut state.plan {
                        if let Some(item) = plan.iter_mut().find(|i| i.id == item_id) {
                            item.status = status;
                        }
                    }
                }
                self.broadcast(OrchestratorEvent::PlanStepUpdate {
                    step_id: item_id,
                    status,
                    output: None,
                })
                .await;
            }
        } else if tool_name == "plan_replan" {
            // Replanner：保留失败步骤及其之前的已完成进度，仅替换其后的待执行步骤
            let failed_item_id = result
                .get("failed_item_id")
                .and_then(|v| v.as_str())
                .map(String::from);
            let new_steps = result
                .get("new_steps")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let new_steps: Vec<PlanItem> = new_steps
                .into_iter()
                .filter_map(|v| {
                    let title = v
                        .get("title")
                        .and_then(|t| t.as_str())
                        .map(|s| s.trim())
                        .filter(|s| !s.is_empty())?;
                    Some(PlanItem {
                        id: String::new(), // 在下方统一生成
                        title: title.to_string(),
                        description: v
                            .get("description")
                            .and_then(|d| d.as_str())
                            .map(|d| d.to_string()),
                        status: PlanItemStatus::Pending,
                        order: 0, // 在下方统一重排
                        output: None,
                    })
                })
                .collect();
            if let (Some(failed_item_id), false) = (failed_item_id, new_steps.is_empty()) {
                let ts = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                let mut state = self.state.lock().await;
                let Some(plan) = &mut state.plan else { return };
                let Some(fail_idx) = plan.iter().position(|i| i.id == failed_item_id) else {
                    return;
                };
                // 保留含失败项在内的前缀，丢弃其后待执行步骤
                let mut new_plan: Vec<PlanItem> = plan[..=fail_idx].to_vec();
                for (idx, mut step) in new_steps.into_iter().enumerate() {
                    let order = fail_idx as i32 + 1 + idx as i32;
                    step.id = format!("plan-item-{ts}-{order}-rev");
                    step.order = order;
                    new_plan.push(step);
                }
                state.plan = Some(new_plan.clone());
                drop(state);
                self.broadcast(OrchestratorEvent::PlanReplanned { items: new_plan })
                    .await;
            }
        }
    }

    /// 执行单个工具调用，含超时/重试（批次4），详细见 docs/details/注释/agent-runtime/agent.md
    async fn execute_tool_with_retry(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let config = self.config_snapshot();
        let max_retries = config.tool_max_retries;
        let base_delay = config.tool_retry_base_delay;
        let timeout = config.tool_timeout;
        // B2 场景工具门控：启用场景时用 WhitelistToolBus 包装，非白名单工具
        // 执行返回 NotFound 被拦截（与可见性过滤一致，避免绕过场景工具约束）。
        let bus = self.effective_tool_bus(&config);

        // A6 工具生命周期钩子：pre 阶段（可改 args / 拒绝）
        // 多个钩子按注册顺序依次执行，后一个通过 Allow(new_args) 覆盖前一个。
        let mut effective_args = args.clone();
        for hook in &self.tool_hooks {
            match hook.on_pre_use(name, &effective_args) {
                ToolHookAction::Allow(new_args) => effective_args = new_args,
                ToolHookAction::Deny(reason) => {
                    let err = ToolError::Execution(reason);
                    // 拒绝：跑全部 on_error 钩子记录，再返回（视为工具失败）
                    for h in &self.tool_hooks {
                        h.on_error(name, &effective_args, &err);
                    }
                    return Err(err);
                }
            }
        }

        let mut attempt: u32 = 0;
        loop {
            // 取消检查（每次重试前）
            if self.long_task_manager.is_cancel_requested() {
                info!("execute_tool_with_retry: 检测到取消请求，停止重试");
                return Err(ToolError::Aborted);
            }

            // 执行调用（含超时）
            let call_result = if let Some(t) = timeout {
                match tokio::time::timeout(t, bus.call_tool(name, effective_args.clone())).await {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("工具 {} 执行超时（{:?}，attempt {}）", name, t, attempt + 1);
                        Err(ToolError::Timeout)
                    }
                }
            } else {
                bus.call_tool(name, effective_args.clone()).await
            };

            match call_result {
                Ok(v) => {
                    // A6：post 阶段（观测结果，不阻断）
                    for h in &self.tool_hooks {
                        h.on_post_use(name, &effective_args, &v);
                    }
                    return Ok(v);
                }
                Err(e) => {
                    if attempt >= max_retries {
                        // A6：on_error 阶段（记录错误，不阻断流程）
                        for h in &self.tool_hooks {
                            h.on_error(name, &effective_args, &e);
                        }
                        // Loop Engineering 批次5：广播重试耗尽事件
                        self.emit_loop_retry_exhausted(max_retries, &e.to_string())
                            .await;
                        return Err(e);
                    }
                    let delay = base_delay * 2u32.pow(attempt);
                    warn!(
                        "工具 {} 执行失败（attempt {}/{}），{:?} 后重试：{}",
                        name,
                        attempt + 1,
                        max_retries,
                        delay,
                        e
                    );
                    // Loop Engineering 批次5：广播正在重试事件（attempt 从 1 计）
                    self.emit_loop_retrying(
                        attempt + 1,
                        max_retries,
                        delay.as_millis() as u64,
                        &e.to_string(),
                    )
                    .await;
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
            }
        }
    }

    /// 执行工具调用（串行/并行），详细见 docs/details/注释/agent-runtime/agent.md
    pub(super) async fn execute_tool_calls(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let config_snapshot = self.config_snapshot();
        // A5 HITL：若任一工具需确认，强制走串行（确认需逐次暂停等待，不适合并行）
        let any_needs_confirm = config_snapshot
            .confirmation_policy
            .as_ref()
            .map(|p| tool_calls.iter().any(|t| p.needs_confirmation(&t.name, &t.args)))
            .unwrap_or(false);
        if config_snapshot.parallel_tool_calls && tool_calls.len() > 1 && !any_needs_confirm {
            self.execute_tool_calls_parallel(tool_calls).await
        } else {
            self.execute_tool_calls_serial(tool_calls).await
        }
    }

    /// A5 HITL：若命中确认策略，则发起确认并等待用户回传
    ///
    /// 返回 `Some(denied_value)` 表示用户拒绝/超时（作为工具结果返回，不执行工具）；
    /// 返回 `None` 表示放行或未命中策略（可继续执行）。
    async fn maybe_require_confirmation(
        &self,
        name: &str,
        args: &serde_json::Value,
    ) -> Option<serde_json::Value> {
        let config = self.config_snapshot();
        let broker = self.confirmation_broker.as_ref()?;
        let policy = config.confirmation_policy.as_ref()?;
        if !policy.needs_confirmation(name, args) {
            return None;
        }
        let approved = broker
            .request(&self.broadcaster, name, args.clone())
            .await
            .unwrap_or(false);
        if approved {
            None
        } else {
            Some(serde_json::json!({
                "error": format!("用户拒绝了工具调用 \"{name}\""),
                "tool": name,
            }))
        }
    }

    /// 串行执行工具调用
    ///
    /// # Loop Engineering 批次4 集成
    /// 通过 [`execute_tool_with_retry`] 包裹每个工具调用：
    /// - 超时：`tool_timeout` 限制单次工具执行时长
    /// - 重试：`tool_max_retries` 控制失败重试次数（默认 0=不重试）
    /// - 取消：每次重试前检查 `cancel_flag`
    async fn execute_tool_calls_serial(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let mut results = Vec::with_capacity(tool_calls.len());

        for tc in tool_calls {
            // 广播 ToolCallStart
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;

            debug!("执行工具: {} (call_id={})", tc.name, tc.id);

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            // A5 HITL：命中确认策略则先暂停征询用户，拒绝/超时按工具失败返回
            let tool_result = match self.maybe_require_confirmation(&tc.name, &tc.args).await {
                Some(denied) => Ok(denied),
                None => self.execute_tool_with_retry(&tc.name, tc.args.clone()).await,
            };

            let result_value = match tool_result {
                Ok(v) => v,
                Err(e) => {
                    warn!("工具 {} 执行失败: {}", tc.name, e);
                    serde_json::json!({
                        "error": e.to_string(),
                        "tool": tc.name,
                    })
                }
            };

            // 广播 ToolCallEnd
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: tc.id.clone(),
                result: result_value.clone(),
            }))
            .await;

            // 构造 toolResult 消息
            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tc.name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(tc.id.clone()),
                meta: None,
            };

            // A4 Plan-Exec：plan 工具结果写入 state.plan 并广播事件（供前端同步 + 持久化）
            self.apply_plan_result(&tc.name, &result_value).await;

            results.push(tool_result_msg);
        }

        Ok(results)
    }

    /// 并行执行工具调用（基于 `tokio::task::JoinSet`）
    ///
    /// 事件广播顺序：
    /// - `ToolCallStart` × N（按原顺序，spawn 前）
    /// - 工具并发执行（每个 task 不广播，避免事件交错）
    /// - `ToolCallEnd` × N（按原索引顺序，结果收集完成后）
    async fn execute_tool_calls_parallel(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        // B2 场景工具门控：并行执行同样走 effective_tool_bus（场景下 WhitelistToolBus）
        let config_snapshot = self.config_snapshot();
        let bus = self.effective_tool_bus(&config_snapshot);
        // 1. 按顺序广播所有 ToolCallStart
        for tc in &tool_calls {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;
        }

        // 2. 用 JoinSet 并发执行（含并行模式重试/超时限制说明），详细见 docs/details/注释/agent-runtime/agent.md
        let mut join_set: tokio::task::JoinSet<
            (usize, String, String, serde_json::Value),
        > = tokio::task::JoinSet::new();

        for (idx, tc) in tool_calls.into_iter().enumerate() {
            let tool_bus = bus.clone();
            let call_id = tc.id.clone();
            let tool_name = tc.name.clone();
            let args = tc.args.clone();

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            join_set.spawn(async move {
                debug!("并行执行工具: {} (call_id={})", tool_name, call_id);
                let result_value = match tool_bus.call_tool(&tool_name, args).await {
                    Ok(v) => v,
                    Err(e) => {
                        warn!("工具 {} 并行执行失败: {}", tool_name, e);
                        serde_json::json!({
                            "error": e.to_string(),
                            "tool": tool_name,
                        })
                    }
                };
                (idx, call_id, tool_name, result_value)
            });
        }

        // 3. 收集所有结果
        let mut indexed_results: Vec<(usize, String, String, serde_json::Value)> =
            Vec::with_capacity(join_set.len());

        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok(item) => indexed_results.push(item),
                Err(join_err) => {
                    // JoinError 意味着 task panic，用占位结果填补
                    warn!("工具并行执行 task panic: {}", join_err);
                    indexed_results.push((
                        0, // 占位索引，排序后会被覆盖或放到最前
                        String::new(),
                        String::new(),
                        serde_json::json!({
                            "error": format!("task panic: {join_err}"),
                        }),
                    ));
                }
            }
        }

        // 4. 按原索引排序，保证 toolResult 顺序与 tool_calls 一致
        indexed_results.sort_by_key(|(idx, _, _, _)| *idx);

        // 5. 按顺序广播 ToolCallEnd 并构造 toolResult 消息
        let mut results = Vec::with_capacity(indexed_results.len());
        for (_, call_id, tool_name, result_value) in indexed_results {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: call_id.clone(),
                result: result_value.clone(),
            }))
            .await;

            let tool_result_msg = OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: serde_json::to_string(&result_value).unwrap_or_else(|_| {
                    format!("{{\"error\":\"结果序列化失败\",\"tool\":\"{}\"}}", tool_name)
                }),
                tool_calls: Vec::new(),
                tool_call_id: Some(call_id),
                meta: None,
            };

            // A4 Plan-Exec：plan 工具结果写入 state.plan 并广播事件（供前端同步 + 持久化）
            self.apply_plan_result(&tool_name, &result_value).await;

            results.push(tool_result_msg);
        }

        Ok(results)
    }
}
