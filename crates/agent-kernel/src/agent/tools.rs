use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::event::{AgentEvent, EventBroadcaster, OrchestratorEvent};
use crate::tool::{tool_failure_payload, ToolError};
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

/// T4（2026-09-18）：工具执行共享依赖束——串行路径直接构造，并行路径克隆进每个 task。
///
/// 全部字段为 `Arc` / 轻量克隆（钩子列表元素即 `Arc`），使串行与并行两条路径
/// 走**同一个执行包装**（超时 / 重试 / 取消检查 / 生命周期钩子 / 重试事件同规）。
/// 详细见 docs/details/注释/agent-runtime/agent.md
#[derive(Clone)]
struct ToolExecShared {
    /// 场景门控后的工具总线（`effective_tool_bus`，场景下为 WhitelistToolBus）
    bus: Arc<dyn crate::tool::ToolBus>,
    /// A6 生命周期钩子（克隆成本 = N 个指针）
    hooks: Vec<Arc<dyn crate::tool_hook::ToolLifecycleHook>>,
    /// 事件广播器（重试 / 重试耗尽事件出口）
    broadcaster: Arc<RwLock<EventBroadcaster>>,
    /// 长任务管理器（取消检查 + 重试事件的 task_id 来源）
    long_task_manager: Arc<crate::long_task::LongTaskManager>,
    /// 重试上限（默认 0 = 不重试）
    max_retries: u32,
    /// 退避基延迟（第 n 次重试等待 = base × 2^n）
    base_delay: std::time::Duration,
    /// 单次执行超时（None = 不限时）
    timeout: Option<std::time::Duration>,
    /// S5：交互协调器（`ToolHookAction::Review` 转人工复核的发起通道；`None` = 无通道）
    interaction_broker: Option<Arc<crate::interaction_broker::InteractionBroker>>,
}

/// T4（2026-09-18）：工具执行统一包装（串行 / 并行共用）。
///
/// 职责链：A6 钩子 pre（可改参 / 拒绝）→ 取消检查 → 超时包裹 → 失败按 2^n 退避重试
/// （上限 `max_retries`）→ post / on_error 钩子 → 重试 / 耗尽事件广播。
///
/// 此前上述全套仅串行路径具备（内联在 `execute_tool_with_retry` 中）；并行路径
/// 直调 `call_tool_with_ctx`——工具卡死会挂住整个 turn（无超时），且失败不重试、
/// 钩子被绕过，与串行行为不一致。统一后两条路径等价。
/// 详细见 docs/details/注释/agent-runtime/agent.md
async fn run_tool_with_retry(
    shared: &ToolExecShared,
    name: &str,
    ctx: &crate::tool_context::ToolContext,
    args: serde_json::Value,
) -> Result<serde_json::Value, ToolError> {
    // A6 工具生命周期钩子：pre 阶段（可改 args / 拒绝 / 转人工复核）
    // 多个钩子按注册顺序依次执行，后一个通过 Allow(new_args) 覆盖前一个。
    let mut effective_args = args.clone();
    for hook in &shared.hooks {
        match hook.on_pre_use(name, &effective_args) {
            ToolHookAction::Allow(new_args) => effective_args = new_args,
            ToolHookAction::Deny(reason) => {
                let err = ToolError::Execution(reason);
                // 拒绝：跑全部 on_error 钩子记录，再返回（视为工具失败）
                for h in &shared.hooks {
                    h.on_error(name, &effective_args, &err);
                }
                return Err(err);
            }
            // S5：钩子转人工复核（hookReview 型）——放行则继续（沿原 args）；未获放行
            // 按 fail-closed 收口（拒绝 → HOOK_REVIEW_DENIED；超时/取消 → HOOK_REVIEW_TIMEOUT）。
            // 无确认通道（未注入 broker）时按既有归一化降级放行（对齐「Ask 无通道降级 Allow」）。
            ToolHookAction::Review { reason } => {
                let Some(broker) = &shared.interaction_broker else {
                    continue;
                };
                let outcome = broker
                    .request_hook_review(
                        &shared.broadcaster,
                        hook.hook_name(),
                        name,
                        effective_args.clone(),
                        &reason,
                    )
                    .await;
                if !outcome.is_approved() {
                    let err = match outcome {
                        crate::interaction_broker::HookReviewOutcome::Denied => {
                            ToolError::HookReviewDenied(reason)
                        }
                        _ => ToolError::HookReviewTimeout(reason),
                    };
                    for h in &shared.hooks {
                        h.on_error(name, &effective_args, &err);
                    }
                    return Err(err);
                }
            }
        }
    }

    // C2：工具级超时优先（声明 timeout_ms），回落全局配置（现状默认不限时 ⇒ 行为不变）
    let timeout = shared
        .bus
        .get_descriptor(name)
        .await
        .and_then(|d| d.limits.timeout_ms)
        .map(std::time::Duration::from_millis)
        .or(shared.timeout);
    let mut attempt: u32 = 0;
    loop {
        // 取消检查（每次重试前）
        if shared.long_task_manager.is_cancel_requested() {
            info!("run_tool_with_retry: 检测到取消请求，停止重试");
            return Err(ToolError::Aborted);
        }

        // 执行调用（含超时）
        let call_result = if let Some(t) = timeout {
            match tokio::time::timeout(
                t,
                shared.bus.call_tool_with_ctx(name, ctx, effective_args.clone()),
            )
            .await
            {
                Ok(r) => r,
                Err(_elapsed) => {
                    warn!("工具 {} 执行超时（{:?}，attempt {}）", name, t, attempt + 1);
                    Err(ToolError::Timeout)
                }
            }
        } else {
            shared
                .bus
                .call_tool_with_ctx(name, ctx, effective_args.clone())
                .await
        };

        match call_result {
            Ok(v) => {
                // A6：post 阶段（观测结果，不阻断）
                for h in &shared.hooks {
                    h.on_post_use(name, &effective_args, &v);
                }
                return Ok(v);
            }
            Err(e) => {
                if attempt >= shared.max_retries {
                    // A6：on_error 阶段（记录错误，不阻断流程）
                    for h in &shared.hooks {
                        h.on_error(name, &effective_args, &e);
                    }
                    // Loop Engineering 批次5：广播重试耗尽事件
                    super::loop_control::emit_loop_retry_exhausted_with(
                        &shared.broadcaster,
                        &shared.long_task_manager,
                        shared.max_retries,
                        &e.to_string(),
                    )
                    .await;
                    return Err(e);
                }
                let delay = shared.base_delay * 2u32.pow(attempt);
                warn!(
                    "工具 {} 执行失败（attempt {}/{}），{:?} 后重试：{}",
                    name,
                    attempt + 1,
                    shared.max_retries,
                    delay,
                    e
                );
                // Loop Engineering 批次5：广播正在重试事件（attempt 从 1 计）
                super::loop_control::emit_loop_retrying_with(
                    &shared.broadcaster,
                    &shared.long_task_manager,
                    attempt + 1,
                    shared.max_retries,
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

/// T1：由 [`ToolError`] 构造失败结果（错误码单点映射，见 [`ToolError::error_code`]）。
///
/// 通用载荷构造已迁 [`crate::tool::tool_failure_payload`]（Q1，2026-09-20：跨 crate
/// 复用，保持失败结果单一构造点）；本包装留在 agent 侧，供 `Err(ToolError)` 路径调用。
pub(super) fn tool_failure_from_error(tool: &str, err: &ToolError) -> serde_json::Value {
    tool_failure_payload(tool, err.to_string(), err.error_code())
}

/// H1 修复（P1.5，2026-08-30）：工具结果统一裁剪——单个字符串值超限截断，
/// 防止 terminal 大输出 / 大文件读取把消息历史与 LLM 上下文撑爆。
/// 此前截断只靠各工具源头自律，terminal/读文件类无兜底。
pub(super) const TOOL_RESULT_STR_LIMIT: usize = 12_000;

/// C2 · T-d：大结果 artifact 阈值（字节；= ZCode `maxOutputBytes` 默认 32768 口径，Q4 拍板「32KB 起步」）
///
/// 超过阈值（或工具声明的 `limits.max_output_bytes`）→ 整结果落 artifact（内容寻址，
/// **与原文外置同一存储**），上下文只留摘要 + 引用；取回走既有坐标通道。
pub(super) const ARTIFACT_THRESHOLD_BYTES: usize = 32 * 1024;

/// A1 己1③（2026-09-11）：截断由「只保头部」改为「保头 + 保尾」。
///
/// 依据：工具输出的结论 / 报错 / 统计 / 文件末尾通常落在尾部，只保头部会把最有
/// 价值的部分丢掉；而截断发生在**入库前**（见下方调用点），被丢掉的内容此后
/// 任何存储里都不存在、无从回溯。头部保留占比略高（起始上下文需完整）。
const TOOL_RESULT_HEAD_PARTS: usize = 3;
const TOOL_RESULT_TAIL_PARTS: usize = 2;

/// 递归裁剪工具结果中的超长字符串（保留结构：Object/Array 遍历，`__meta` 元数据键不截）。
/// 截断在 UTF-8 字符边界进行，中段省略并标注省略字节数（首尾均保留）。
///
/// **仅测试用**：生产路径一律走 [`clamp_tool_result_with`]（带外置 sink）。
/// 保留本包装是为了让既有测试少写一个参数，且它们本来就在验证「不外置时的行为」。
#[cfg(test)]
pub(super) fn clamp_tool_result(value: &mut Value) {
    clamp_tool_result_with(value, &crate::raw_context::noop_sink(), None);
}

/// 带**原文外置**的裁剪（A1 己1①）
///
/// 与 [`clamp_tool_result`] 的差别只有一处：在真正截断**之前**，先把完整原文交给
/// `sink` 外置；成功时在截断标注里附上坐标（见 [`crate::raw_context`]）。
///
/// ```text
/// 外置成功：…[已截断，省略 12345 字节；原文已外置：raw/ab12cd34ef567890]…
/// 外置未做：…[已截断，省略 12345 字节]…            ← 与改造前完全一致
/// ```
///
/// **失败不影响功能**：`sink` 返回 `None`（超闸门 / IO 失败 / 未注入）时退回纯截断——
/// 外置是「尽量保住原文」的增强，截断才是防爆兜底，后者永不缺席。
pub(super) fn clamp_tool_result_with(
    value: &mut Value,
    sink: &crate::raw_context::RawContextSink,
    limit: Option<usize>,
) {
    match value {
        Value::String(s) => {
            if s.len() <= limit.unwrap_or(TOOL_RESULT_STR_LIMIT) {
                return;
            }

            // ① 截断前先外置完整原文（此刻 `s` 仍是原文）
            let externalized_hash = sink(s).map(|r| r.content_hash);

            // ② 算切点（只读 `s`，尚未修改）
            //    首尾预算：头部 3/5、尾部 2/5（头部含起始上下文，尾部含结论）
            let head_budget = limit.unwrap_or(TOOL_RESULT_STR_LIMIT) * TOOL_RESULT_HEAD_PARTS
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

            // ③ 构造标注：外置成功则附带坐标（供后续按坐标取回原文）
            let note = match &externalized_hash {
                Some(hash) => format!(
                    "已截断，省略 {omitted} 字节；{}",
                    crate::raw_context::externalized_note(hash)
                ),
                None => format!("已截断，省略 {omitted} 字节"),
            };

            // ④ 落成截断结果
            *s = format!("{}\n…[{note}]…\n{}", &s[..head_end], &s[tail_start..]);
        }
        Value::Array(arr) => arr
            .iter_mut()
            .for_each(|v| clamp_tool_result_with(v, sink, None)),
        Value::Object(map) => {
            for (k, v) in map.iter_mut() {
                if k != "__meta" {
                    clamp_tool_result_with(v, sink, None);
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

    /// C2 元数据族：取工具声明（描述符）——权限 / 限制 / 调度**读声明**的取值口
    ///
    /// 未知工具（未注册 / 不在场景白名单）返回 None，调用方按「无声明」处理
    /// （风险按 Moderate、alwaysAsk=false——对齐既有「未登记默认 Moderate」语义）。
    pub(super) async fn tool_descriptor(&self, name: &str) -> Option<crate::tool::ToolDescriptor> {
        let config = self.config_snapshot();
        self.effective_tool_bus(&config).get_descriptor(name).await
    }

    /// T4（2026-09-18）：构造工具执行共享依赖束（串行直接使用 / 并行克隆进任务）
    fn tool_exec_shared(&self) -> ToolExecShared {
        let config = self.config_snapshot();
        ToolExecShared {
            bus: self.effective_tool_bus(&config),
            hooks: self.tool_hooks.clone(),
            broadcaster: Arc::clone(&self.broadcaster),
            long_task_manager: Arc::clone(&self.long_task_manager),
            max_retries: config.tool_max_retries,
            base_delay: config.tool_retry_base_delay,
            timeout: config.tool_timeout,
            interaction_broker: self.confirmation_broker.clone(),
        }
    }

    /// T4：构造本会话的工具上下文（workdir / workspace_id / project_id 读锁短临界区，取出即释放）。
    ///
    /// `tool_call_id` 非空时注入逐调用流式 sink（bash/powershell 增量输出、文件变更 diff）。
    ///
    /// `pub(super)`：供同级测试模块（`agent::tests`）验证沙箱戳记等契约（E3-1）
    pub(super) fn tool_ctx(&self, tool_call_id: Option<&str>) -> crate::tool_context::ToolContext {
        let workdir = self.workdir.read().map(|g| g.clone()).unwrap_or(None);
        let workspace_id = self.workspace_id.read().map(|g| g.clone()).unwrap_or(None);
        // W2①（2026-09-18）：project_id 贯通（此前恒 None，工具侧看不到项目归属）
        let project_id = self.project_id.read().map(|g| g.clone()).unwrap_or(None);
        // E3-1（2026-09-18，方向 3 沙箱主业）：按当前档位派生沙箱戳记（观测期，不强制）；
        // 无工作区 → None（命令路径已由 W3 fail-safe 拒绝），档位取自确认策略快照
        let sandbox = self.sandbox_spec();
        crate::tool_context::ToolContext {
            workdir,
            project_id,
            workspace_id,
            sandbox,
            tool_stream: tool_call_id.map(|id| {
                Arc::new(AgentToolStream {
                    broadcaster: Arc::clone(&self.broadcaster),
                    tool_call_id: id.to_string(),
                }) as Arc<dyn ToolStreamSink>
            }),
            // Q1（2026-09-20）：子代理标记随 ctx 传播——「仅主会话可用」的工具
            // （ask_user_question）据此 fail loud（ASK_UNAVAILABLE）
            is_sub_agent: self.is_sub_agent,
        }
    }

    /// 执行单个工具调用，含超时/重试（批次4；T4 起与并行路径共用 [`run_tool_with_retry`]），
    /// 详细见 docs/details/注释/agent-runtime/agent.md
    async fn execute_tool_with_retry(
        &self,
        tool_call_id: &str,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let shared = self.tool_exec_shared();
        let ctx = self.tool_ctx(Some(tool_call_id));
        run_tool_with_retry(&shared, name, &ctx, args).await
    }

    /// 执行工具调用（串行/并行），详细见 docs/details/注释/agent-runtime/agent.md
    pub(super) async fn execute_tool_calls(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        let config_snapshot = self.config_snapshot();
        // 构造本会话的工具上下文（T4：统一经 `tool_ctx`；workdir 来自 AgentLoop 持有字段）
        let self_tool_ctx = self.tool_ctx(None);
        // A5 HITL：若任一工具需确认（策略命中 / 敏感目录拒绝 / 越界确认），强制走串行
        // 确认需逐次暂停等待；敏感目录拒绝/越界确认若走并行会被绕过，故一并纳入。
        // C2：预取本批工具声明（声明读取在异步侧；判定仍走 needs_confirmation 单点）
        let mut declared_risks: Vec<Option<crate::tool::ToolDescriptor>> = Vec::new();
        for t in &tool_calls {
            declared_risks.push(self.tool_descriptor(&t.name).await);
        }
        // C2（T-c · Q2 拍板：`concurrent_safe` **只读登记、不改行为**）——声明已进入调度读取路径
        // （上方预取）；放行策略（按声明放开并行）另议，变更须单独反证与走查。
        let declared_concurrent_safe = declared_risks
            .iter()
            .filter(|d| d.as_ref().is_some_and(|d| d.safety.concurrent_safe))
            .count();
        if declared_concurrent_safe > 0 {
            tracing::debug!(
                "C2：本批 {} 个工具声明 concurrent_safe（登记项；未驱动串并行策略）",
                declared_concurrent_safe
            );
        }
        let any_needs_confirm = tool_calls.iter().zip(declared_risks.iter()).any(|(t, declared_risk)| {
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
                .map(|p| {
                    p.needs_confirmation(
                        &t.name,
                        &t.args,
                        declared_risk
                            .as_ref()
                            .map(|d| d.safety.risk_level)
                            .unwrap_or(crate::tool::RiskLevel::Moderate),
                    )
                })
                .unwrap_or(false);
            needs_guard || needs_policy
        });
        if config_snapshot.parallel_tool_calls && tool_calls.len() > 1 && !any_needs_confirm {
            // Q1（2026-09-20）：提问工具强制走串行——一次只弹一个提问面板（同批多个 ask
            // 会互相顶掉前端面板，且人工作答本就是串行语义；同 confirmation 的串行理由）
            if !tool_calls.iter().any(|t| t.name == "ask_user_question") {
                return self.execute_tool_calls_parallel(tool_calls).await;
            }
        }
        self.execute_tool_calls_serial(tool_calls).await
    }

    /// A5 HITL：若命中确认策略，则发起确认并等待用户回传
    ///
    /// 返回 `Some(denied_value)` 表示拒绝（锁 / Plan 守卫 / 用户拒绝 / 超时——作为工具结果返回，
    /// 不执行工具）；返回 `None` 表示放行或未命中策略（可继续执行）。
    ///
    /// **S4-a（2026-09-22）：判定单点化**——本方法只做「来源取证 + 执行」，
    /// 顺序判定统一在 [`crate::permission_machine::decide`]（位次表见 11-S4施工计划 §三）：
    /// 敏感目录守卫（内置锁 / 越界）、用户锁/白名单、Plan 守卫、agent-tmp、档位闸门与
    /// 工具等级（含危险命令动态升级）、路径越界升级、确认通道缺失的 Ask 降级。
    /// 不变量：模式放行分支不得绕过 alwaysAsk；锁不得被名单/档位翻案。
    async fn maybe_require_confirmation(
        &self,
        name: &str,
        args: &serde_json::Value,
        ctx: &crate::tool_context::ToolContext,
    ) -> Option<serde_json::Value> {
        use crate::permission_machine::{decide, Behavior, PermissionCtx, ProjectVerdict};
        let config = self.config_snapshot();
        // ── 来源取证（不判定；判定单点在 `permission_machine::decide`——S4-a）──
        // 敏感目录守卫（内置锁 / 越界位）
        let guard = crate::confirmation::guard_fs_path(name, args, ctx, false);
        let (builtin_lock, path_outside_workdir) = match &guard {
            crate::confirmation::PathGuard::Deny(reason) => (Some(reason.clone()), false),
            crate::confirmation::PathGuard::Confirm => (None, true),
            crate::confirmation::PathGuard::Allow => (None, false),
        };
        // v2 规则引擎（用户锁 / 白名单）
        let (user_lock, user_allow) = match crate::confirmation::rule_engine_verdict(name, args, ctx)
        {
            Err(msg) => (Some(msg), false),
            Ok(true) => (None, true),
            Ok(false) => (None, false),
        };
        let policy = config.confirmation_policy.as_ref();
        // Plan 只读档：写/命令（档位守卫位）
        let plan_forbidden = policy
            .map(|p| {
                p.security_level == crate::permission_rules::SecurityLevel::Plan
                    && (crate::confirmation::is_write_tool(name)
                        || crate::confirmation::is_command_tool(name))
            })
            .unwrap_or(false);
        // agent-tmp 全权免确认（隐式白名单；与敏感目录/用户锁互斥——二者在本位次之前拦截）
        let agent_tmp = crate::confirmation::should_bypass_confirmation(name, args, ctx);
        // 内容主体（会话授权 / 项目规则共用同一归一化主体）
        let subject = crate::confirmation::rule_content_subject(name, args, ctx);
        // C2：工具声明（alwaysAsk / 风险等级来源——S4-b 静态四类名单已删）
        let declared = self.tool_descriptor(name).await;
        let always_ask = declared.as_ref().map(|d| d.safety.always_ask).unwrap_or(false);
        let tool_risk = declared
            .as_ref()
            .map(|d| d.safety.risk_level)
            .unwrap_or(crate::tool::RiskLevel::Moderate);
        // S4-b 会话级授权（仅 alwaysAsk gate 消费——ZD2-3）
        let session_grant = always_ask && self.consume_session_grant(name, subject.as_deref());
        // S4-c：项目规则裁决（deny > ask > allow；位次 4/7/10——Q4-B：deny 先于 alwaysAsk）
        let project = config
            .project_rules
            .as_ref()
            .map(|r| r.verdict(name, subject.as_deref()))
            .unwrap_or(ProjectVerdict::None);
        let decision = decide(&PermissionCtx {
            tool_name: name,
            args,
            policy,
            // 确认通道 = broker 与策略均就绪（缺一即落兜底放行——现行语义）
            confirmation_available: self.confirmation_broker.is_some() && policy.is_some(),
            builtin_lock: builtin_lock.as_deref(),
            user_lock: user_lock.as_deref(),
            user_allow,
            project,
            always_ask,
            tool_risk,
            session_grant,
            plan_forbidden_write_or_command: plan_forbidden,
            agent_tmp,
            path_outside_workdir,
        });
        match decision.behavior {
            Behavior::Allow => None,
            Behavior::Deny => Some(tool_failure_payload(name, decision.reason, "POLICY_DENIED")),
            Behavior::Ask => {
                // 归一化保证：Ask ⇒ confirmation_available ⇒ broker 就绪
                let Some(broker) = self.confirmation_broker.as_ref() else {
                    return None;
                };
                let outcome = broker
                    .request_permission(&self.broadcaster, name, args.clone())
                    .await;
                // D8 四值：拒绝 / 跳过 / 超时不再混同——工具错误消息区分，LLM 可据此采取不同后续
                // T1：结果补判别字段（isError + errorCode，拒绝类码与四值一一对应）
                let (reason, code) = match outcome {
                    crate::confirmation::ConfirmationOutcome::Approved => return None,
                    crate::confirmation::ConfirmationOutcome::Denied => {
                        ("用户拒绝了工具调用", "CONFIRM_DENIED")
                    }
                    crate::confirmation::ConfirmationOutcome::Skipped => {
                        ("用户跳过了工具调用", "CONFIRM_SKIPPED")
                    }
                    crate::confirmation::ConfirmationOutcome::Timeout => (
                        "等待用户确认超时，工具调用未执行",
                        "CONFIRM_TIMEOUT",
                    ),
                };
                Some(tool_failure_payload(
                    name,
                    format!("{reason} \"{name}\""),
                    code,
                ))
            }
        }
    }

    /// 工具结果**广播前同步预处理**（A1 第二阶段迁移：裁剪迁入事件总线）
    ///
    /// 在串行 / 并行两条工具执行路径上，于 `ToolCallEnd` 广播与 toolResult 消息
    /// 构造**之前**以 `waterfall` 分发 [`OrchestratorEvent::ToolResultPreBroadcast`]：
    /// - **链尾内建** = [`clamp_tool_result_with`]（现行裁剪 + 原文外置）——零监听器
    ///   时行为与迁移前逐字节一致
    /// - 监听器可改写 `result`（如按 `tool_name` 定制裁剪策略）
    /// - 不调 `next` 即否决 → **兜底裁剪**（「截断永不缺席」；裁剪幂等：已裁内容
    ///   二次裁剪为 no-op，不会重复外置）
    ///
    /// **红线遵守（05-§2.4）**：① 同步——链内零 await（分发在短读锁临界区内，
    /// 与 A3 输入准入同型）；② 单副本——广播与入历史继续共用同一 `result_value`；
    /// ③ 位置不变——仍在广播前（前端所见 = 入历史所见）。
    /// C2 · T-d：结果体积超阈值 → 落 artifact，返回「摘要 + 引用」信封；未超阈值 / 落盘失败 → None
    ///
    /// 阈值口径：工具声明 `limits.max_output_bytes` 优先，缺省 [`ARTIFACT_THRESHOLD_BYTES`]（32 KiB，字节）。
    /// 落盘复用注入的 `raw_context_sink`（**同一存储**：内容寻址 + 既有取回坐标通道）。
    async fn artifactize_result(
        &self,
        tool_name: &str,
        result: &Value,
    ) -> Option<Value> {
        let threshold = self
            .tool_descriptor(tool_name)
            .await
            .and_then(|d| d.limits.max_output_bytes)
            .unwrap_or(ARTIFACT_THRESHOLD_BYTES);
        let serialized = serde_json::to_string(result).ok()?;
        if serialized.len() <= threshold {
            return None;
        }
        let raw_ref = (self.raw_context_sink)(&serialized)?;
        let preview: String = serialized.chars().take(400).collect();
        Some(serde_json::json!({
            "artifact": format!("raw/{}", raw_ref.content_hash),
            "bytes": raw_ref.byte_len,
            "note": format!(
                "结果过大（{} 字节 > 阈值 {} 字节），已落 artifact，仅保留摘要与引用；全文可按坐标取回。{}",
                raw_ref.byte_len,
                threshold,
                crate::raw_context::externalized_note(&raw_ref.content_hash)
            ),
            "preview": preview,
        }))
    }

    pub(super) async fn preprocess_tool_result(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        result: &mut Value,
    ) {
        // C2 · T-d：超大结果先落 artifact（阈值 = 工具声明 max_output_bytes，缺省 32 KiB）——
        // 上下文只留摘要 + 引用（内容寻址，与原文外置同一存储；落盘失败则退回后续裁剪兜底）
        if let Some(artifact) = self.artifactize_result(tool_name, result).await {
            *result = artifact;
        }
        let mut event = OrchestratorEvent::ToolResultPreBroadcast {
            tool_call_id: tool_call_id.to_string(),
            tool_name: tool_name.to_string(),
            result: std::mem::replace(result, Value::Null),
        };
        let outcome = {
            // 取总线句柄后于**壳锁外**分发（2026-09-17 风险点处置：链内注册/I/O 不阻滞写者）
            let bus = self.event_bus_handle().await;
            bus.waterfall(&mut event, |ev| {
                if let OrchestratorEvent::ToolResultPreBroadcast { result, .. } = ev {
                    clamp_tool_result_with(result, &self.raw_context_sink, None);
                }
                crate::event_bus::Outcome::Ok
            })
        };
        // 取回（可能被监听器改写的）负载——广播与入历史共用此值（单副本）
        if let OrchestratorEvent::ToolResultPreBroadcast {
            result: processed, ..
        } = event
        {
            *result = processed;
        }
        if outcome == crate::event_bus::Outcome::Vetoed {
            // 否决 = 跳过链尾裁剪 → 调用方兜底裁剪（防爆兜底不可被绕过）
            clamp_tool_result_with(result, &self.raw_context_sink, None);
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

        // 构造本会话的工具上下文（T4：统一经 `tool_ctx`；确认预检用，不注入流式 sink）
        let self_tool_ctx = self.tool_ctx(None);

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
                        tool_failure_from_error(&tc.name, &e),
                    )
                }
            };

            // H1 修复（P1.5）+ A1 己1① + 阶段 1 第二段：广播前 waterfall 预处理——
            // 链尾内建 = 统一裁剪超长字符串 + 原文外置（监听器可改写，见 preprocess_tool_result）
            self.preprocess_tool_result(&tc.id, &tc.name, &mut result_value)
                .await;

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
    /// - 工具并发执行（ToolCall* 生命周期事件不在 task 内广播，避免事件交错；
    ///   工具流式 delta 与重试事件属 droppable 增强通道，由 task 内发出）
    /// - `ToolCallEnd` × N（按原索引顺序，结果收集完成后）
    async fn execute_tool_calls_parallel(
        &self,
        tool_calls: Vec<ToolCall>,
    ) -> Result<Vec<OrchestratorMessage>, AgentError> {
        // B2 场景工具门控 + T4：并行与串行共用 `ToolExecShared`（超时/重试/取消/钩子/重试事件同规）
        let shared = self.tool_exec_shared();
        // 1. 按顺序广播所有 ToolCallStart
        for tc in &tool_calls {
            self.broadcast(OrchestratorEvent::Agent(AgentEvent::ToolCallStart {
                tool_call_id: tc.id.clone(),
                name: tc.name.clone(),
                args: tc.args.clone(),
            }))
            .await;
        }

        // 2. 用 JoinSet 并发执行：每个 task 走与串行一致的 `run_tool_with_retry`
        //    （T4：超时 / 重试 / 取消检查 / 钩子 / 重试事件同规），详细见 docs/details/注释/agent-runtime/agent.md
        // 元组末三位为 H7 P0.5 执行耗时/成败/错误摘要（task 内计时，含重试）
        let mut join_set: tokio::task::JoinSet<
            (usize, String, String, serde_json::Value, u64, String, Option<String>),
        > = tokio::task::JoinSet::new();

        for (idx, tc) in tool_calls.into_iter().enumerate() {
            let shared = shared.clone();
            // 并行：每个 task 注入独立 sink（tool_call_id 不同，流事件归位到各自工具段）
            let ctx = self.tool_ctx(Some(&tc.id));
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
                    match run_tool_with_retry(&shared, &tool_name, &ctx, args).await {
                        Ok(v) => (v, "success", None),
                        Err(e) => {
                            warn!("工具 {} 并行执行失败: {}", tool_name, e);
                            let msg = e.to_string();
                            (
                                tool_failure_from_error(&tool_name, &e),
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
                        tool_failure_payload("", format!("task panic: {join_err}"), "TOOL_PANIC"),
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
            // H1 修复（P1.5）+ A1 己1① + 阶段 1 第二段：广播前 waterfall 预处理（与串行路径一致）
            self.preprocess_tool_result(&call_id, &tool_name, &mut result_value)
                .await;

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
