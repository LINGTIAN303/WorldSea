use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::event::{AgentEvent, EventBroadcaster, OrchestratorEvent};
use crate::tool::ToolError;
use crate::tool_context::ToolStreamSink;
use crate::tool_hook::ToolHookAction;
use crate::types::{MessageRole, OrchestratorMessage, PlanItem, PlanItemStatus, ToolCall};

use super::{AgentError, AgentLoop};

/// 工具流式输出接收器（2026-09-02）
///
/// 捕获会话 broadcaster + 当前工具调用 ID；同步推 `ToolCallDelta` / `FileChange`
/// 事件（只进流通道，不进入 LLM 消息上下文）。`try_read` 失败（锁竞争/已释放）
/// 时静默丢弃——流式事件属增强展示，droppable。
struct AgentToolStream {
    broadcaster: Arc<RwLock<EventBroadcaster>>,
    tool_call_id: String,
}

impl ToolStreamSink for AgentToolStream {
    fn delta(&self, text: String) {
        let Ok(guard) = self.broadcaster.try_read() else {
            return;
        };
        guard.broadcast(&OrchestratorEvent::ToolCallDelta {
            tool_call_id: self.tool_call_id.clone(),
            delta: text,
        });
    }

    fn file_change(&self, path: String, kind: String, hunks: serde_json::Value) {
        let Ok(guard) = self.broadcaster.try_read() else {
            return;
        };
        guard.broadcast(&OrchestratorEvent::FileChange {
            tool_call_id: self.tool_call_id.clone(),
            path,
            kind,
            hunks,
        });
    }
}

/// H1 修复（P1.5，2026-08-30）：工具结果统一裁剪——单个字符串值超限截断，
/// 防止 terminal 大输出 / 大文件读取把消息历史与 LLM 上下文撑爆。
/// 此前截断只靠各工具源头自律，terminal/读文件类无兜底。
pub(super) const TOOL_RESULT_STR_LIMIT: usize = 12_000;

/// A1 己1③（2026-09-11）：截断由「只保头部」改为「保头 + 保尾」。
///
/// 依据：工具输出的结论 / 报错 / 统计 / 文件末尾通常落在尾部，只保头部会把最有
/// 价值的部分丢掉；而截断发生在**入库前**（见下方调用点），被丢掉的内容此后
/// 任何存储里都不存在、无从回溯。头部保留占比略高（起始上下文需完整）。
const TOOL_RESULT_HEAD_PARTS: usize = 3;
const TOOL_RESULT_TAIL_PARTS: usize = 2;

/// 递归裁剪工具结果中的超长字符串（保留结构：Object/Array 遍历，`__meta` 元数据键不截）。
/// 截断在 UTF-8 字符边界进行，中段省略并标注省略字节数（首尾均保留）。
pub(super) fn clamp_tool_result(value: &mut Value) {
    match value {
        Value::String(s) => {
            if s.len() <= TOOL_RESULT_STR_LIMIT {
                return;
            }
            // 首尾预算：头部 3/5、尾部 2/5（头部含起始上下文，尾部含结论）
            let head_budget = TOOL_RESULT_STR_LIMIT * TOOL_RESULT_HEAD_PARTS
                / (TOOL_RESULT_HEAD_PARTS + TOOL_RESULT_TAIL_PARTS);
            let tail_budget = TOOL_RESULT_STR_LIMIT - head_budget;

            // 按字符边界切分（避免劈开多字节字符）
            let mut head_end = head_budget;
            while head_end > 0 && !s.is_char_boundary(head_end) {
                head_end -= 1;
            }
            let mut tail_start = s.len() - tail_budget;
            while tail_start < s.len() && !s.is_char_boundary(tail_start) {
                tail_start += 1;
            }
            let omitted = tail_start - head_end;
            *s = format!(
                "{}\n…[已截断，省略 {} 字节]…\n{}",
                &s[..head_end],
                omitted,
                &s[tail_start..]
            );
        }
        Value::Array(arr) => arr.iter_mut().for_each(clamp_tool_result),
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if k != "__meta" {
                    clamp_tool_result(v);
                }
            }
        }
        _ => {}
    }
}

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
        tool_call_id: &str,
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

        // 构造本会话的工具上下文（workdir 来自 AgentLoop 持有字段）
        // 读锁短临界区：取出后立即释放，不跨 await 持有
        let workdir = self.workdir.read().map(|g| g.clone()).unwrap_or(None);
        let workspace_id = self.workspace_id.read().map(|g| g.clone()).unwrap_or(None);
        let self_tool_ctx = crate::tool_context::ToolContext {
            workdir,
            project_id: None,
            workspace_id,
            // 逐工具调用注入流式 sink（bash/powershell 增量输出、文件变更 diff）
            tool_stream: Some(Arc::new(AgentToolStream {
                broadcaster: Arc::clone(&self.broadcaster),
                tool_call_id: tool_call_id.to_string(),
            })),
        };

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
                match tokio::time::timeout(t, bus.call_tool_with_ctx(name, &self_tool_ctx, effective_args.clone())).await {
                    Ok(r) => r,
                    Err(_elapsed) => {
                        warn!("工具 {} 执行超时（{:?}，attempt {}）", name, t, attempt + 1);
                        Err(ToolError::Timeout)
                    }
                }
            } else {
                bus.call_tool_with_ctx(name, &self_tool_ctx, effective_args.clone()).await
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
        // 构造本会话的工具上下文（workdir 来自 AgentLoop 持有字段）
        // 读锁短临界区：取出后立即释放，不跨 await 持有
        let workdir = self.workdir.read().map(|g| g.clone()).unwrap_or(None);
        let workspace_id = self.workspace_id.read().map(|g| g.clone()).unwrap_or(None);
        let self_tool_ctx = crate::tool_context::ToolContext {
            workdir,
            project_id: None,
            workspace_id,
            tool_stream: None,
        };
        // A5 HITL：若任一工具需确认（策略命中 / 敏感目录拒绝 / 越界确认），强制走串行
        // 确认需逐次暂停等待；敏感目录拒绝/越界确认若走并行会被绕过，故一并纳入。
        let any_needs_confirm = tool_calls.iter().any(|t| {
            // agent-tmp 全权免确认：命中分区临时区的工具不进入确认预检（放行可并行）
            if crate::confirmation::should_bypass_confirmation(&t.name, &t.args, &self_tool_ctx) {
                return false;
            }
            // v2 规则引擎（2026-09-03 P0）：用户锁命中 / Plan 档写命令 → 强制串行
            let rule_locked =
                crate::confirmation::rule_engine_verdict(&t.name, &t.args, &self_tool_ctx).is_err();
            let plan_block = config_snapshot
                .confirmation_policy
                .as_ref()
                .map(|p| {
                    p.security_level == crate::permission_rules::SecurityLevel::Plan
                        && (crate::confirmation::is_write_tool(&t.name)
                            || crate::confirmation::is_command_tool(&t.name))
                })
                .unwrap_or(false);
            if rule_locked || plan_block {
                return true;
            }
            let guard = crate::confirmation::guard_fs_path(&t.name, &t.args, &self_tool_ctx, false);
            let needs_guard = matches!(
                guard,
                crate::confirmation::PathGuard::Deny(_) | crate::confirmation::PathGuard::Confirm
            );
            let needs_policy = config_snapshot
                .confirmation_policy
                .as_ref()
                .map(|p| p.needs_confirmation(&t.name, &t.args))
                .unwrap_or(false);
            needs_guard || needs_policy
        });
        if config_snapshot.parallel_tool_calls && tool_calls.len() > 1 && !any_needs_confirm {
            self.execute_tool_calls_parallel(tool_calls).await
        } else {
            self.execute_tool_calls_serial(tool_calls).await
        }
    }

    /// A5 HITL：若命中确认策略，则发起确认并等待用户回传
    ///
    /// 返回 `Some(denied_value)` 表示用户拒绝/超时/敏感目录拒绝（作为工具结果返回，不执行工具）；
    /// 返回 `None` 表示放行或未命中策略（可继续执行）。
    ///
    /// # Phase 5 动态路径判定
    /// 在 `policy.needs_confirmation` 判定基础上，用 [`ToolContext`](crate::tool_context::ToolContext)
    /// 对 FS 工具做额外裁决：
    /// - 命中敏感目录（`~/.ssh`、`~/.gnupg`、`/etc`、`/usr`、`/bin`、`/sbin`）：
    ///   默认直接拒绝；若 `policy.allow_sensitive_with_confirm` 开启 → 转为需确认（经确认放行）。
    /// - 写/搜索类工具（`write_file`/`edit_file`/`search_files`）解析后越出 workdir
    ///   → 强制确认（对齐「工作区之外需授权」）。
    async fn maybe_require_confirmation(
        &self,
        name: &str,
        args: &serde_json::Value,
        ctx: &crate::tool_context::ToolContext,
    ) -> Option<serde_json::Value> {
        let config = self.config_snapshot();
        // 敏感目录开关已删除（2026-09-03 v2：五档统一硬 Deny，锁为预置维度）
        let guard = crate::confirmation::guard_fs_path(name, args, ctx, false);
        // 0) 敏感目录守卫：命中即拒绝（安全底线，内置预置锁）
        if let crate::confirmation::PathGuard::Deny(reason) = guard {
            return Some(serde_json::json!({
                "error": reason,
                "tool": name,
            }));
        }
        // 0.5) v2 规则引擎裁决（用户锁 > 白名单 > 档位）：
        //      命中用户锁 → 拒绝；命中白名单 → 直接放行（跳过档位确认）
        match crate::confirmation::rule_engine_verdict(name, args, ctx) {
            Err(msg) => {
                return Some(serde_json::json!({
                    "error": msg,
                    "tool": name,
                }))
            }
            Ok(true) => return None,
            Ok(false) => {}
        }
        // 0.6) Plan 只读档：写/命令操作直接拒绝（锁不依赖确认流程）
        if let Some(policy) = &config.confirmation_policy {
            if policy.security_level == crate::permission_rules::SecurityLevel::Plan
                && (crate::confirmation::is_write_tool(name)
                    || crate::confirmation::is_command_tool(name))
            {
                return Some(serde_json::json!({
                    "error": "Plan 只读档：写/命令操作已禁用",
                    "tool": name,
                }));
            }
        }
        // 0.7) agent-tmp 全权免确认：写/搜索工具解析落 workdir/agent-tmp 子树 → 直接放行。
        // 敏感目录 Deny 与用户锁已在上方拦截（agent-tmp 与二者互斥），此处仅剩隐式白名单语义。
        if crate::confirmation::should_bypass_confirmation(name, args, ctx) {
            return None;
        }
        // 未启用确认（无 broker / 无 policy）→ 放行（敏感目录已在上面拦截，
        // 越界写入由 FS 工具执行时的 `ensure_within_workdir` 兜底拒绝）
        let broker = self.confirmation_broker.as_ref()?;
        let policy = config.confirmation_policy.as_ref()?;
        // 策略判定（三级裁决 + 危险命令模式）
        let mut needs = policy.needs_confirmation(name, args);
        // 动态路径守卫：写/搜索类越出 workdir，或开启确认开关后命中敏感目录 → 强制确认
        if !needs && guard == crate::confirmation::PathGuard::Confirm {
            needs = true;
        }
        if !needs {
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

        // 构造本会话的工具上下文（workdir 来自 AgentLoop 持有字段）
        // 读锁短临界区：取出后立即释放，不跨 await 持有
        let workdir = self.workdir.read().map(|g| g.clone()).unwrap_or(None);
        let workspace_id = self.workspace_id.read().map(|g| g.clone()).unwrap_or(None);
        let self_tool_ctx = crate::tool_context::ToolContext {
            workdir,
            project_id: None,
            workspace_id,
            tool_stream: None,
        };

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
            // H7 P0.5：计时起点含确认等待（用户视角该步骤总耗时）
            let exec_started = std::time::Instant::now();
            let tool_result = match self
                .maybe_require_confirmation(&tc.name, &tc.args, &self_tool_ctx)
                .await
            {
                Some(denied) => Ok(denied),
                None => self.execute_tool_with_retry(&tc.id, &tc.name, tc.args.clone()).await,
            };

            let duration_ms = exec_started.elapsed().as_millis() as u64;
            let (status, error, mut result_value) = match tool_result {
                Ok(v) => ("success", None, v),
                Err(e) => {
                    warn!("工具 {} 执行失败: {}", tc.name, e);
                    (
                        "failed",
                        Some(e.to_string()),
                        serde_json::json!({
                            "error": e.to_string(),
                            "tool": tc.name,
                        }),
                    )
                }
            };

            // H1 修复（P1.5）：统一裁剪超长字符串（广播与入历史看到一致内容）
            clamp_tool_result(&mut result_value);

            // 广播 ToolCallEnd（status/duration_ms/error 顶层权威——H7 P0.5）
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: tc.id.clone(),
                result: result_value.clone(),
                status: status.to_string(),
                duration_ms,
                error,
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
        // 元组末三位为 H7 P0.5 执行耗时/成败/错误摘要（task 内计时，含重试）
        let mut join_set: tokio::task::JoinSet<
            (usize, String, String, serde_json::Value, u64, String, Option<String>),
        > = tokio::task::JoinSet::new();

        // 构造本会话的工具上下文（workdir 来自 AgentLoop 持有字段），并行时 clone 进每个 task
        // 读锁短临界区：取出后立即释放，不跨 await 持有
        let workdir = self.workdir.read().map(|g| g.clone()).unwrap_or(None);
        let workspace_id = self.workspace_id.read().map(|g| g.clone()).unwrap_or(None);
        let self_tool_ctx = crate::tool_context::ToolContext {
            workdir,
            project_id: None,
            workspace_id,
            tool_stream: None,
        };

        for (idx, tc) in tool_calls.into_iter().enumerate() {
            let tool_bus = bus.clone();
            // 并行：每个 task 注入独立 sink（tool_call_id 不同，流事件归位到各自工具段）
            let mut ctx = self_tool_ctx.clone();
            ctx.tool_stream = Some(Arc::new(AgentToolStream {
                broadcaster: Arc::clone(&self.broadcaster),
                tool_call_id: tc.id.clone(),
            }));
            let call_id = tc.id.clone();
            let tool_name = tc.name.clone();
            let args = tc.args.clone();

            // Loop Engineering 批次5：记录工具调用计数（供速率限制 tool_calls 维度）
            if self.loop_control_enabled() {
                self.loop_controller.rate_limiter.inc_tool_calls();
            }

            join_set.spawn(async move {
                debug!("并行执行工具: {} (call_id={})", tool_name, call_id);
                // H7 P0.5：task 内计时（覆盖重试；Start 广播在 spawn 前统一进行，不计入）
                let exec_started = std::time::Instant::now();
                let (result_value, status, error) =
                    match tool_bus.call_tool_with_ctx(&tool_name, &ctx, args).await {
                        Ok(v) => (v, "success", None),
                        Err(e) => {
                            warn!("工具 {} 并行执行失败: {}", tool_name, e);
                            let msg = e.to_string();
                            (
                                serde_json::json!({
                                    "error": msg.clone(),
                                    "tool": tool_name,
                                }),
                                "failed",
                                Some(msg),
                            )
                        }
                    };
                let duration_ms = exec_started.elapsed().as_millis() as u64;
                (idx, call_id, tool_name, result_value, duration_ms, status.to_string(), error)
            });
        }

        // 3. 收集所有结果
        let mut indexed_results: Vec<(usize, String, String, serde_json::Value, u64, String, Option<String>)> =
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
                        0,
                        "failed".to_string(),
                        Some(format!("task panic: {join_err}")),
                    ));
                }
            }
        }

        // 4. 按原索引排序，保证 toolResult 顺序与 tool_calls 一致
        indexed_results.sort_by_key(|r| r.0);

        // 5. 按顺序广播 ToolCallEnd 并构造 toolResult 消息
        let mut results = Vec::with_capacity(indexed_results.len());
        for (_, call_id, tool_name, mut result_value, duration_ms, status, error) in indexed_results {
            // H1 修复（P1.5）：统一裁剪超长字符串（与串行路径一致）
            clamp_tool_result(&mut result_value);

            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: call_id.clone(),
                result: result_value.clone(),
                status,
                duration_ms,
                error,
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
