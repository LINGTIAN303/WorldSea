//! Tauri 命令层：Agent 主链路薄包装 + Deep Phase 事件转发，详细见 docs/details/注释/tauri/commands.md

use agent_commands::{
    AgentCommandService, LongTaskRepository, LoopControlCheckResult, LoopControlEntry,
    LoopControlRegistry, LoopControlRegistryError, LoopControlStatus, SecurityLevel,
    SendMessageParams, SubAgentInstanceInfo, TerminalService, UpdateModelParams,
};
use agent_runtime::agent::prompt_sections::PromptSection;
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::event::{AgentEvent, OrchestratorEvent};
use agent_runtime::event_bus::{Listener, ListenerOutcome};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::long_task::{LongTaskRecord, LongTaskStatus};
use agent_runtime::loop_control::LoopControlConfig;
use agent_runtime::sub_agent_pool::SubAgentSpec;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, State};
use serde_json::json;

/// [HTTP-BRIDGE] 事件双路发射：桌面 IPC（app.emit）+ 全局广播 hub（浏览器 SSE 订阅）。
/// 桌面行为不变（原 emit 保留），仅额外 publish 一份到 hub。移除时删除本函数并还原各调用点。
fn emit_dual(app: &AppHandle, name: &str, payload: serde_json::Value) -> Result<(), tauri::Error> {
    let r = app.emit(name, payload.clone());
    crate::http_bridge::events::publish(name, payload);
    r
}

/// 转发 AgentLoop 事件到 Tauri 前端事件系统
///
/// 当 AgentLoop 广播 `DeepPhaseChanged` 事件时，通过 Tauri 事件系统
/// `agent:event:deep_phase_changed` 发送到前端。
struct TauriAgentEventEmitter {
    app: AppHandle,
    session_id: String,
    /// A1 全链路事件流可观测：trace 事件全局序号（每会话递增，前端据此还原时序）
    trace_seq: AtomicU64,
    /// R6 第二部分：本会话动作段事件缓冲（`{seq, action, ...payload}` 事件序），
    /// AgentEnd 时经命令层收口到最后一条 assistant 消息的 meta.action_events（零迁移持久化）
    action_events: StdMutex<Vec<serde_json::Value>>,
    /// 动作段事件序号（独立于 trace_seq；回源重建 order 依据）
    action_seq: AtomicU64,
}

impl TauriAgentEventEmitter {
    /// A1 全链路事件流可观测：把非高频事件映射为 `(类型, 摘要)`，供 trace 通道投递
    ///
    /// 过滤掉高频流式增量 `StreamDelta`（避免 trace 消息爆炸），其余阶段事件全部纳入，
    /// 使前端能按序还原「一次对话一条可追踪链」（AgentStart → … → AgentEnd）。
    /// R6 第一部分：动作段事件 → 流通道 payload（`agent:event:stream:{sid}` 的
    /// `type: "action_event"` 消息）。七类动作段的统一转发映射（subagent/phase/
    /// router/reflection/confirm/**a2ui**，2026-09-17 补 a2ui 臂）——前端 turnModel
    /// 据此驱动 ActionSegment（a2ui 例外：D1 裁定不进过程层，仅作持久化载体供画布回源）；
    /// 持久化载体为第二部分。
    /// 已知限制：字段为 camelCase 明细快照，phase/router 类不含完整枚举序列化。
    fn action_event_payload(event: &OrchestratorEvent) -> Option<(&'static str, serde_json::Value)> {
        match event {
            OrchestratorEvent::SubAgentStarted { sub_agent_id, sub_agent_name, task_description, .. } => {
                Some((
                    "subagent",
                    serde_json::json!({ "phase": "start", "subAgentId": sub_agent_id, "name": sub_agent_name, "task": task_description }),
                ))
            }
            OrchestratorEvent::SubAgentCompleted { sub_agent_id, sub_agent_name, output_chars, duration_ms, .. } => {
                Some((
                    "subagent",
                    serde_json::json!({ "phase": "completed", "subAgentId": sub_agent_id, "name": sub_agent_name, "outputChars": output_chars, "durationMs": duration_ms }),
                ))
            }
            OrchestratorEvent::SubAgentError { sub_agent_id, sub_agent_name, .. } => {
                Some(("subagent", serde_json::json!({ "phase": "error", "subAgentId": sub_agent_id, "name": sub_agent_name })))
            }
            OrchestratorEvent::TracePipeStarted { run_id, pipeline, reason } => {
                Some(("phase", serde_json::json!({ "event": "pipe_started", "runId": run_id, "pipeline": pipeline, "reason": reason })))
            }
            OrchestratorEvent::TracePhaseEntered { run_id, phase, reason } => {
                Some(("phase", serde_json::json!({ "event": "entered", "runId": run_id, "phase": phase, "reason": reason })))
            }
            OrchestratorEvent::TracePhaseResult { run_id, phase, status, summary, .. } => {
                Some((
                    "phase",
                    // `event` 为 pipe 子阶段标识（R6 第三部分配对依据）——phase 键专留给阶段名，
                    // 避免 json! 重复键覆盖（原实现 "phase":"entered" 与 "phase":阶段名 互相覆盖致子阶段丢失）
                    serde_json::json!({ "event": "result", "runId": run_id, "phase": phase, "status": format!("{status:?}"), "summary": summary }),
                ))
            }
            OrchestratorEvent::TracePipeFinished { run_id, status, .. } => {
                Some(("phase", serde_json::json!({ "event": "pipe_finished", "runId": run_id, "status": format!("{status:?}") })))
            }
            OrchestratorEvent::RouterDecisionMade { target_name, .. } => {
                Some(("router", serde_json::json!({ "phase": "decision", "target": target_name })))
            }
            OrchestratorEvent::ReflectionResult { result } => {
                Some(("reflection", serde_json::json!({ "result": result })))
            }
            OrchestratorEvent::ConfirmationRequested { confirm_id, tool_name, .. } => {
                Some(("confirm", serde_json::json!({ "phase": "requested", "confirmId": confirm_id, "tool": tool_name })))
            }
            OrchestratorEvent::ConfirmationResolved { confirm_id, outcome } => {
                Some(("confirm", serde_json::json!({ "phase": "resolved", "confirmId": confirm_id, "outcome": outcome })))
            }
            // A2UI 画布回源（2026-09-17）：a2ui 作第七类入缓冲/持久化（AgentEnd 收口 →
            // `meta.action_events`），供前端 `collectA2UIActionEvents` 重放重建画布。
            // D1 裁定「不进过程层」：前端 `actionEventToTurnEvents` 不建段（default → []）。
            OrchestratorEvent::A2UIEvent { surface_id, message, .. } => {
                Some(("a2ui", serde_json::json!({ "surfaceId": surface_id, "message": message })))
            }
            _ => None,
        }
    }

    /// A5 收尾（2026-09-17）：重试事件 → 流通道 payload（`type: "llm_retry"`）
    ///
    /// `LoopEngRetrying` 由 LLM 调用重试（`agent/llm.rs`）与工具执行重试（`agent/tools.rs`）
    /// 两处发射——主对话此前只能经 loop-control 专用通道看到（还需存在 loop task），
    /// 普通会话中退避等待期零反馈。本臂把「正在重试（第 n/m 次 + 最终等待毫秒）」
    /// 推给流通道，前端据此显示重试状态行。
    /// 仅转发 `LoopEngRetrying`：重试耗尽后紧跟终态 `Error`（现有错误行已覆盖）。
    fn llm_retry_payload(event: &OrchestratorEvent) -> Option<serde_json::Value> {
        match event {
            OrchestratorEvent::LoopEngRetrying {
                attempt,
                max_retries,
                backoff_ms,
                error,
                ..
            } => Some(serde_json::json!({
                "type": "llm_retry",
                "attempt": attempt,
                "maxRetries": max_retries,
                "backoffMs": backoff_ms,
                "error": error,
            })),
            _ => None,
        }
    }

    /// R6 第一部分：动作段事件注入流通道（与 AgentEvent 十变体同通道，
    /// payload type="action_event"——前端按 action 字段驱动对应动作段）
    fn emit_stream_action(&self, action: &str, payload: serde_json::Value) {
        let event_name = format!("agent:event:stream:{}", self.session_id);
        let mut wrapped = serde_json::json!({ "type": "action_event", "action": action });
        if let (Some(obj), Some(extra)) = (wrapped.as_object_mut(), payload.as_object()) {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
        if let Err(err) = emit_dual(&self.app, &event_name, wrapped) {
            tracing::warn!("Failed to emit action event to stream: {}", err);
        }
    }

    /// R6 第二部分：缓冲动作段收口——取出本会话累积的事件，经命令层
    /// `flush_action_events` 持久化到最后一条 assistant 消息的 meta.action_events
    /// （EventListener 回调为同步，异步持久化走 tauri async runtime）
    fn flush_buffered_action_events(&self) {
        let events = {
            let Ok(mut buf) = self.action_events.lock() else {
                return;
            };
            std::mem::take(&mut *buf)
        };
        if events.is_empty() {
            return;
        }
        let app = self.app.clone();
        let session_id = self.session_id.clone();
        tauri::async_runtime::spawn(async move {
            let svc = app.state::<AgentCommandService>();
            svc.flush_action_events(&session_id, events).await;
        });
    }

    fn trace_summary(event: &OrchestratorEvent) -> Option<(&'static str, String)> {
        match event {
            OrchestratorEvent::Agent(AgentEvent::AgentStart { model }) => {
                Some(("agent_start", format!("Agent 启动（模型 {model}）")))
            }
            OrchestratorEvent::Agent(AgentEvent::UserMessage { content, .. }) => {
                Some(("user_message", format!("收到用户消息（{} 字）", content.chars().count())))
            }
            OrchestratorEvent::Agent(AgentEvent::StreamStart { model }) => {
                Some(("stream_start", format!("开始流式响应（模型 {model}）")))
            }
            OrchestratorEvent::Agent(AgentEvent::StreamEnd { .. }) => {
                Some(("stream_end", "流式响应结束".to_string()))
            }
            OrchestratorEvent::Agent(AgentEvent::ToolCallStart { name, .. }) => {
                Some(("tool_call_start", format!("调用工具 {name}")))
            }
            OrchestratorEvent::Agent(AgentEvent::ToolCallEnd { duration_ms, .. }) => {
                // H7 P0.5：trace 摘要携带耗时（活动日志可读性）
                Some((
                    "tool_call_end",
                    format!("工具执行完成（{}ms）", duration_ms),
                ))
            }
            OrchestratorEvent::Agent(AgentEvent::Error { message, code, .. }) => {
                // A5 后续：活动日志带稳定错误码（有则附）；message 仍含用户引导语
                match code {
                    Some(code) => Some(("error", format!("执行出错（{code}）：{message}"))),
                    None => Some(("error", format!("执行出错：{message}"))),
                }
            }
            OrchestratorEvent::Agent(AgentEvent::AgentEnd) => {
                Some(("agent_end", "Agent 执行结束".to_string()))
            }
            OrchestratorEvent::RouterDecisionMade { target_name, .. } => {
                Some(("router_decision", format!("路由决策 → {target_name}")))
            }
            OrchestratorEvent::PlanCreated { items } => {
                Some(("plan_created", format!("创建任务计划（{n} 步）", n = items.len())))
            }
            OrchestratorEvent::PlanStepUpdate { step_id, status, .. } => {
                Some(("plan_step_update", format!("计划步骤 {step_id} → {status:?}")))
            }
            OrchestratorEvent::PlanReplanned { items } => {
                Some(("plan_replanned", format!("重规划任务计划（{n} 步）", n = items.len())))
            }
            OrchestratorEvent::SubAgentStarted { sub_agent_name, .. } => {
                Some(("sub_agent_start", format!("子 Agent 启动：{sub_agent_name}")))
            }
            OrchestratorEvent::SubAgentCompleted { sub_agent_name, .. } => {
                Some(("sub_agent_completed", format!("子 Agent 完成：{sub_agent_name}")))
            }
            OrchestratorEvent::SubAgentError { sub_agent_name, .. } => {
                Some(("sub_agent_error", format!("子 Agent 失败：{sub_agent_name}")))
            }
            OrchestratorEvent::ConfirmationRequested { tool_name, .. } => {
                Some(("confirmation_requested", format!("请求确认工具 {tool_name}")))
            }
            // 阶段 3 · 压缩事件化（A2 补齐③）：压缩事务以活动日志可见、可审计
            OrchestratorEvent::ContextCompactStarted {
                trigger,
                before_tokens,
                tier,
            } => Some((
                "context_compact_start",
                format!(
                    "上下文压缩开始（{}，占用 {} token，阶梯层 {}）",
                    compact_trigger_label(trigger),
                    before_tokens,
                    tier
                ),
            )),
            OrchestratorEvent::ContextCompactFinished {
                trigger,
                mode,
                before_tokens,
                after_tokens,
                saved_tokens,
                folded_groups,
                dropped_messages,
                ..
            } => Some((
                "context_compact_end",
                format!(
                    "上下文压缩完成（{}，{}）：{} → {} token（释放 {}）",
                    compact_trigger_label(trigger),
                    match mode.as_str() {
                        "folded" => format!("折叠 {folded_groups} 组"),
                        "dropped" => format!("删除 {dropped_messages} 条"),
                        _ => "无可压内容".to_string(),
                    },
                    before_tokens,
                    after_tokens,
                    saved_tokens,
                ),
            )),
            OrchestratorEvent::ContextCompactFailed {
                trigger,
                stage,
                error,
            } => Some((
                "context_compact_error",
                format!(
                    "上下文压缩失败（{}，阶段 {}）：{error}",
                    compact_trigger_label(trigger),
                    stage
                ),
            )),
            // 阶段 2 · A3：取消收口（已交付文本终结 + 中断锚点）以活动日志可见
            OrchestratorEvent::AgentInterrupted {
                reason,
                iteration,
                delivered_chars,
            } => Some((
                "agent_interrupted",
                format!(
                    "本轮被中断（{}，第 {} 轮）：已交付 {} 字",
                    match reason.as_str() {
                        "user_abort" => "用户中断",
                        "cooperative_cancel" => "协作式取消",
                        other => other,
                    },
                    iteration,
                    delivered_chars
                ),
            )),
            // 其余事件（含高频 StreamDelta、A2UI 等）不纳入 trace 通道
            _ => None,
        }
    }

    /// A1：向 trace 通道投递事件（若该事件有 trace 摘要）
    fn emit_trace(&self, event: &OrchestratorEvent) {
        let Some((etype, summary)) = Self::trace_summary(event) else {
            return;
        };
        let seq = self.trace_seq.fetch_add(1, Ordering::SeqCst);
        let trace_name = format!("agent:event:trace:{}", self.session_id);
        if let Err(err) = emit_dual(&self.app, 
            &trace_name,
            serde_json::json!({
                "seq": seq,
                "type": etype,
                "summary": summary,
            }),
        ) {
            tracing::warn!("Failed to emit trace event to frontend: {}", err);
        }
    }
}

/// 编排实时事件（ToT/GoT 思维树）→ `agent:event:orch:{session_id}`
///
/// payload 采用 `{ kind, payload }` 双层结构：`kind` 为事件类别
/// （node_created / node_scored / branch_explored / aggregated / goal_reached / terminated），
/// `payload` 为该事件视角的 camelCase 明细，前端据此逐类更新实时思维树。
fn emit_orch(emitter: &TauriAgentEventEmitter, kind: &str, payload: serde_json::Value) {
    let event_name = format!("agent:event:orch:{}", emitter.session_id);
    if let Err(err) = emit_dual(&emitter.app, &event_name, serde_json::json!({ "kind": kind, "payload": payload })) {
        tracing::warn!("Failed to emit orchestration event ({kind}) to frontend: {err}");
    }
}

/// Supervisor 委派实时事件 → `agent:event:orch_supervisor:{session_id}`
///
/// payload 与 emit_orch 同构 `{ kind, payload }`；kind ∈
/// task_assigned / sub_agent_started / sub_agent_completed。
fn emit_orch_supervisor(emitter: &TauriAgentEventEmitter, kind: &str, payload: serde_json::Value) {
    let event_name = format!("agent:event:orch_supervisor:{}", emitter.session_id);
    if let Err(err) = emit_dual(&emitter.app, &event_name, serde_json::json!({ "kind": kind, "payload": payload })) {
        tracing::warn!("Failed to emit supervisor event ({kind}) to frontend: {err}");
    }
}

/// 压缩触发源标签（`auto`/`manual` → 活动日志展示文案）
fn compact_trigger_label(trigger: &str) -> &'static str {
    match trigger {
        "manual" => "手动 /compact",
        _ => "自动预算",
    }
}

impl Listener for TauriAgentEventEmitter {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        // R6 第一部分：六类动作段事件（subagent/a2ui/phase/router/reflection/confirm）
        // 注入流通道（此前仅 trace/orch 专用通道，行段模型拿不到——回源即失的转发缺口）
        if let Some((action, payload)) = Self::action_event_payload(event) {
            // R6 第二部分：同事件缓冲留档（AgentEnd 收口持久化到 meta.action_events）
            let seq = self.action_seq.fetch_add(1, Ordering::SeqCst);
            let mut entry = serde_json::json!({ "seq": seq, "action": action });
            if let (Some(obj), Some(extra)) = (entry.as_object_mut(), payload.as_object()) {
                for (k, v) in extra {
                    obj.insert(k.clone(), v.clone());
                }
            }
            if let Ok(mut buf) = self.action_events.lock() {
                buf.push(entry);
            }
            self.emit_stream_action(action, payload);
        }
        // 总步骤预算警示（total_steps 80%/95%/100%）：直推流通道供横幅展示
        //（独立消息不持久化——横幅由前端状态驱动，非动作段语义）
        if let OrchestratorEvent::StepBudgetWarning {
            task_id: _,
            used,
            limit,
            percent,
        } = event
        {
            let event_name = format!("agent:event:stream:{}", self.session_id);
            let payload = serde_json::json!({
                "type": "step_budget_warning",
                "used": used,
                "limit": limit,
                "percent": percent,
            });
            if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                tracing::warn!("Failed to emit step_budget_warning: {}", err);
            }
        }
        // A5 收尾（2026-09-17）：重试状态直推流通道——退避等待期前端显示状态行
        //（llm_retry；不持久化——状态型事件，恢复/终态即消散）
        if let Some(payload) = Self::llm_retry_payload(event) {
            let event_name = format!("agent:event:stream:{}", self.session_id);
            if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                tracing::warn!("Failed to emit llm_retry: {}", err);
            }
        }
        // 2026-09-02 系统工具流式事件：直推流通道（实时渲染，不持久化）
        // - ToolCallDelta：bash/powershell 增量输出 → type=tool_delta
        // - FileChange：write/edit/edit_diff 绿红 diff → type=file_change（含路径渲染）
        if let OrchestratorEvent::ToolCallDelta { tool_call_id, delta } = event {
            let event_name = format!("agent:event:stream:{}", self.session_id);
            let payload = serde_json::json!({
                "type": "tool_delta",
                "tool_call_id": tool_call_id,
                "delta": delta,
            });
            if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                tracing::warn!("Failed to emit tool_delta: {}", err);
            }
        }
        if let OrchestratorEvent::FileChange {
            tool_call_id,
            path,
            kind,
            hunks,
        } = event
        {
            let event_name = format!("agent:event:stream:{}", self.session_id);
            let payload = serde_json::json!({
                "type": "file_change",
                "tool_call_id": tool_call_id,
                "path": path,
                "kind": kind,
                "hunks": hunks,
            });
            if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                tracing::warn!("Failed to emit file_change: {}", err);
            }
        }
        // R6 第二部分：Agent 轮结束 → 缓冲动作段收口持久化（meta.action_events）
        if let OrchestratorEvent::Agent(AgentEvent::AgentEnd) = event {
            self.flush_buffered_action_events();
        }
        // A1 全链路事件流可观测：非高频事件按序投递到 trace 通道（保留原分散通道）
        self.emit_trace(event);
        match event {
            // ── 统一轨迹事件族 orchestration_trace（B7/D23，M1-RK1）──
            // 投递到 `agent:event:trace:{sid}` 通道，前端 useOrchestrationTrace 按 run_id 聚合。
            OrchestratorEvent::TracePipeStarted {
                run_id,
                pipeline,
                reason,
            } => {
                let event_name = format!("agent:event:orchestration_trace:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "pipe_started",
                    "runId": run_id,
                    "pipeline": pipeline,
                    "reason": reason,
                })) {
                    tracing::warn!("Failed to emit TracePipeStarted: {}", err);
                }
            }
            OrchestratorEvent::TracePhaseEntered {
                run_id,
                phase,
                reason,
            } => {
                let event_name = format!("agent:event:orchestration_trace:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "phase_entered",
                    "runId": run_id,
                    "phase": phase,
                    "reason": reason,
                })) {
                    tracing::warn!("Failed to emit TracePhaseEntered: {}", err);
                }
            }
            OrchestratorEvent::TracePhaseResult {
                run_id,
                phase,
                status,
                summary,
                artifact_id,
            } => {
                let event_name = format!("agent:event:orchestration_trace:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "phase_result",
                    "runId": run_id,
                    "phase": phase,
                    "status": status,
                    "summary": summary,
                    "artifactId": artifact_id,
                })) {
                    tracing::warn!("Failed to emit TracePhaseResult: {}", err);
                }
            }
            OrchestratorEvent::TracePipeFinished {
                run_id,
                status,
                reason,
                final_message,
            } => {
                let event_name = format!("agent:event:orchestration_trace:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "pipe_finished",
                    "runId": run_id,
                    "status": status,
                    "reason": reason,
                    "finalMessage": final_message,
                })) {
                    tracing::warn!("Failed to emit TracePipeFinished: {}", err);
                }
            }
            OrchestratorEvent::A2UIEvent {
                surface_id,
                message,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:a2ui:{session_id}`
                // payload: { surfaceId, message }（message 序列化为 camelCase，null 变体自动跳过）
                let event_name = format!("agent:event:a2ui:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, 
                    &event_name,
                    serde_json::json!({
                        "surfaceId": surface_id,
                        "message": message,
                    }),
                ) {
                    tracing::warn!(
                        "Failed to emit A2UI event to frontend: {}",
                        err
                    );
                }
            }
            OrchestratorEvent::SubAgentStarted {
                sub_agent_id,
                sub_agent_name,
                task_description,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, taskDescription }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "start",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "taskDescription": task_description,
                })) {
                    tracing::warn!("Failed to emit SubAgentStarted event to frontend: {}", err);
                }
                // 同步转发到 Supervisor 委派通道（缺省 live 事件），供「委派」面板实时编排日志
                emit_orch_supervisor(self, "sub_agent_started", json!({
                    "subAgentId": sub_agent_id, "subAgentName": sub_agent_name,
                }));
            }
            OrchestratorEvent::SubAgentCompleted {
                sub_agent_id,
                sub_agent_name,
                output_chars,
                duration_ms,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, outputChars, durationMs }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "completed",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "outputChars": output_chars,
                    "durationMs": duration_ms,
                })) {
                    tracing::warn!("Failed to emit SubAgentCompleted event to frontend: {}", err);
                }
                // 同步转发到 Supervisor 委派通道，供「委派」面板实时编排日志
                emit_orch_supervisor(self, "sub_agent_completed", json!({
                    "subAgentId": sub_agent_id,
                    "outputChars": output_chars,
                    "durationMs": duration_ms,
                }));
            }
            OrchestratorEvent::SubAgentError {
                sub_agent_id,
                sub_agent_name,
                error,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:subagent:{session_id}`
                // payload: { type, subAgentId, subAgentName, error }
                let event_name = format!("agent:event:subagent:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "error",
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "error": error,
                })) {
                    tracing::warn!("Failed to emit SubAgentError event to frontend: {}", err);
                }
            }
            OrchestratorEvent::ConfirmationRequested {
                confirm_id,
                tool_name,
                args,
            } => {
                // 转发到前端：事件名 `agent:confirm:{session_id}`
                // payload: { confirmId, toolName, args }
                let event_name = format!("agent:confirm:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "confirmId": confirm_id,
                    "toolName": tool_name,
                    "args": args,
                })) {
                    tracing::warn!("Failed to emit ConfirmationRequested event to frontend: {}", err);
                }
            }
            OrchestratorEvent::ConfirmationResolved { confirm_id, outcome } => {
                // 转发到前端：事件名 `agent:confirm:{session_id}`
                // payload: { type: "resolved", confirmId, outcome }（D8 四值；
                // 供前端清理进行中的确认弹窗）
                let event_name = format!("agent:confirm:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "resolved",
                    "confirmId": confirm_id,
                    "outcome": outcome,
                })) {
                    tracing::warn!("Failed to emit ConfirmationResolved event to frontend: {}", err);
                }
            }
            // Q1 提问（2026-09-20）：模型主动提问 → 前端提问面板
            OrchestratorEvent::AskRequested { ask_id, questions } => {
                // 转发到前端：事件名 `agent:ask:{session_id}`
                // payload: { askId, questions }（questions 为 camelCase 批次：
                // [{id, question, header?, options?, multiSelect?}]）
                let event_name = format!("agent:ask:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "askId": ask_id,
                    "questions": questions,
                })) {
                    tracing::warn!("Failed to emit AskRequested event to frontend: {}", err);
                }
            }
            OrchestratorEvent::AskResolved { ask_id, outcome } => {
                // 转发到前端：事件名 `agent:ask:{session_id}`
                // payload: { type: "resolved", askId, outcome }（answered / denied / cancelled；
                // 供前端清理进行中的提问面板——含随轮取消路径）
                let event_name = format!("agent:ask:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "resolved",
                    "askId": ask_id,
                    "outcome": outcome.kind(),
                })) {
                    tracing::warn!("Failed to emit AskResolved event to frontend: {}", err);
                }
            }
            // 流式响应事件（打字机效果）
            //
            // 转发 `StreamStart` / `StreamDelta` / `StreamEnd` / `Error` / `AgentEnd`
            // 到前端通道 `agent:event:stream:{session_id}`，前端据此实现打字机效果。
            // payload: { type, model | delta | fullText | message }
            OrchestratorEvent::Agent(agent_event) => {
                let payload = match agent_event {
                    AgentEvent::StreamStart { model } => {
                        serde_json::json!({ "type": "start", "model": model })
                    }
                    AgentEvent::StreamDelta { delta } => {
                        serde_json::json!({ "type": "delta", "delta": delta })
                    }
                    AgentEvent::ReasoningDelta { delta } => {
                        serde_json::json!({ "type": "reasoning", "delta": delta })
                    }
                    AgentEvent::StreamEnd { full_text } => {
                        serde_json::json!({ "type": "end", "fullText": full_text })
                    }
                    AgentEvent::Error {
                        message,
                        code,
                        retryable,
                        retry_after_ms,
                    } => {
                        // A5 后续：结构化字段加性透传（前端可渐进消费；老前端只读 message 不受影响）
                        let mut payload = serde_json::json!({
                            "type": "error",
                            "message": message,
                        });
                        if let Some(code) = code {
                            payload["code"] = serde_json::Value::String(code.to_string());
                        }
                        if let Some(retryable) = retryable {
                            payload["retryable"] = serde_json::Value::Bool(*retryable);
                        }
                        if let Some(ms) = retry_after_ms {
                            payload["retryAfterMs"] = serde_json::Value::from(*ms);
                        }
                        payload
                    }
                    AgentEvent::AgentEnd => serde_json::json!({ "type": "agent_end" }),
                    // 工具调用事件：转发到流通道，由前端 turnModel 驱动 ActionSegment
                    // 注意 genai_backend 与 tools.rs 都会广播 ToolCallStart/End（call_id 相同，结果不同）。
                    // 前端按 toolCallId 幂等覆盖：先到的 args 会被后到的真实执行结果覆盖。
                    AgentEvent::ToolCallStart {
                        tool_call_id,
                        name,
                        args,
                    } => serde_json::json!({
                        "type": "tool_call_start",
                        "toolCallId": tool_call_id,
                        "name": name,
                        "args": args,
                    }),
                    AgentEvent::ToolCallEnd {
                        tool_call_id,
                        result,
                        status,
                        duration_ms,
                        error,
                    } => {
                        // H7 P0.5：透传顶层权威 status/durationMs/error（前端回退解析保留）
                        let mut payload = serde_json::json!({
                            "type": "tool_call_end",
                            "toolCallId": tool_call_id,
                            "result": result,
                            "status": status,
                            "durationMs": duration_ms,
                        });
                        if let Some(err) = error {
                            payload["error"] = serde_json::Value::String(err.to_string());
                        }
                        payload
                    }
                    // 其他基础 Agent 事件（UserMessage 等）暂不在此通道转发
                    _ => return ListenerOutcome::Continue,
                };
                let event_name = format!("agent:event:stream:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                    tracing::warn!("Failed to emit Stream event to frontend: {}", err);
                }
            }
            // ── A4 Plan-Exec 计划事件：已迁至独立监听器 `PlanEventEmitter`（首迁示范，见 06-事件总线设计草案 §五）──
            // ReflectionResult 专用通道已废弃（D7 裁定：前端零监听；评审结果仍经动作段通道下发）
            // ─── 编排 4 模式 UI 下沉：ToT/GoT 思维树实时事件 → `agent:event:orch:{session_id}` ───
            OrchestratorEvent::ThoughtNodeCreated {
                thought_id,
                parent_id,
                depth,
                content_preview,
                ..
            } => {
                emit_orch(self, "node_created", json!({
                    "thoughtId": thought_id, "parentId": parent_id, "depth": depth,
                    "contentPreview": content_preview,
                }));
            }
            OrchestratorEvent::ThoughtNodeScored {
                thought_id,
                score,
                reasoning,
                ..
            } => {
                emit_orch(self, "node_scored", json!({
                    "thoughtId": thought_id, "score": score, "reasoning": reasoning,
                }));
            }
            OrchestratorEvent::ThoughtBranchExplored {
                parent_id,
                child_count,
                depth,
                kept_count,
                ..
            } => {
                emit_orch(self, "branch_explored", json!({
                    "parentId": parent_id, "childCount": child_count,
                    "depth": depth, "keptCount": kept_count,
                }));
            }
            OrchestratorEvent::ThoughtsAggregated {
                aggregated_thought_id,
                source_ids,
                depth,
                content_preview,
                ..
            } => {
                emit_orch(self, "aggregated", json!({
                    "aggregatedThoughtId": aggregated_thought_id, "sourceIds": source_ids,
                    "depth": depth, "contentPreview": content_preview,
                }));
            }
            OrchestratorEvent::ToTGoalReached {
                thought_id,
                depth,
                content,
                score,
                ..
            } => {
                emit_orch(self, "goal_reached", json!({
                    "thoughtId": thought_id, "depth": depth,
                    "content": content, "score": score,
                }));
            }
            OrchestratorEvent::ToTTerminated {
                reason,
                total_nodes,
                max_depth_reached,
                best_thought_id,
                best_score,
                ..
            } => {
                emit_orch(self, "terminated", json!({
                    "reason": reason, "totalNodes": total_nodes,
                    "maxDepthReached": max_depth_reached,
                    "bestThoughtId": best_thought_id, "bestScore": best_score,
                }));
            }
            OrchestratorEvent::SupervisorTaskAssigned {
                sub_agent_id,
                sub_agent_name,
                task_description,
                reasoning,
                ..
            } => {
                emit_orch_supervisor(self, "task_assigned", json!({
                    "subAgentId": sub_agent_id,
                    "subAgentName": sub_agent_name,
                    "taskDescription": task_description,
                    "reasoning": reasoning,
                }));
            }
            // Multi-Agent 专用通道（orch_multi）已废弃（D7 裁定：前端零监听，2026-09-17）
            // 其他事件目前不需要转发到前端
            _ => {}
        }
        ListenerOutcome::Continue
    }
}

/// Plan 事件族专用发射器（首迁示范：从 `TauriAgentEventEmitter` 拆出的独立监听器）
///
/// 覆盖 `PlanCreated` / `PlanStepUpdate` / `PlanReplanned` 三事件 → 三个前端通道；
/// 其余事件忽略。每会话一个实例（经 `ensure_emitter_registered` 与主 emitter 一并订阅）——
/// 两个不同实例各收到一份事件、不触发 `Arc::ptr_eq` 去重；拆分的意义是把 Plan 分支
/// 从主 emitter 的巨型 match 中解放出来（见 06-事件总线设计草案 §五 首迁）。
pub struct PlanEventEmitter {
    app: AppHandle,
    session_id: String,
}

impl Listener for PlanEventEmitter {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        match event {
            OrchestratorEvent::PlanCreated { items } => {
                let event_name = format!("agent:event:plan_created:{}", self.session_id);
                if let Err(err) = emit_dual(
                    &self.app,
                    &event_name,
                    serde_json::json!({ "items": items }),
                ) {
                    tracing::warn!("Failed to emit PlanCreated event to frontend: {}", err);
                }
            }
            OrchestratorEvent::PlanStepUpdate {
                step_id,
                status,
                output,
            } => {
                let event_name = format!("agent:event:plan_update:{}", self.session_id);
                if let Err(err) = emit_dual(
                    &self.app,
                    &event_name,
                    serde_json::json!({
                        "itemId": step_id,
                        "status": status,
                        "output": output,
                    }),
                ) {
                    tracing::warn!("Failed to emit PlanStepUpdate event to frontend: {}", err);
                }
            }
            OrchestratorEvent::PlanReplanned { items } => {
                let event_name = format!("agent:event:plan_replanned:{}", self.session_id);
                if let Err(err) = emit_dual(
                    &self.app,
                    &event_name,
                    serde_json::json!({ "items": items }),
                ) {
                    tracing::warn!("Failed to emit PlanReplanned event to frontend: {}", err);
                }
            }
            // S3-e2 会话分支：专用通道（07 口径——新事件无 turnModel 归约规则者
            // 落独立通道，前端展示随 UX 排期，不并入动作段）
            OrchestratorEvent::ConversationForked { parent_session, child_session, request_seq } => {
                let event_name = format!("agent:event:session_branch:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, json!({
                    "type": "forked",
                    "sessionId": parent_session,
                    "childSessionId": child_session,
                    "requestSeq": request_seq,
                })) {
                    tracing::warn!("Failed to emit ConversationForked event to frontend: {}", err);
                }
            }
            OrchestratorEvent::ConversationRewound { session_id, request_seq, dropped, kept } => {
                let event_name = format!("agent:event:session_branch:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, json!({
                    "type": "rewound",
                    "sessionId": session_id,
                    "requestSeq": request_seq,
                    "dropped": dropped,
                    "kept": kept,
                })) {
                    tracing::warn!("Failed to emit ConversationRewound event to frontend: {}", err);
                }
            }
            OrchestratorEvent::CheckpointCreated { session_id, request_seq, kind } => {
                let event_name = format!("agent:event:session_branch:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, json!({
                    "type": "checkpoint_created",
                    "sessionId": session_id,
                    "requestSeq": request_seq,
                    "kind": kind,
                })) {
                    tracing::warn!("Failed to emit CheckpointCreated event to frontend: {}", err);
                }
            }
            _ => {}
        }
        ListenerOutcome::Continue
    }
}

/// 每会话一个 TauriAgentEventEmitter 的注册表
///
/// `send_message` 每次调用都会 `agent.subscribe`；若每次都新建 emitter，
/// 即使 `EventBroadcaster` 已去重（不同实例指针不同），仍会造成事件多播。
/// 这里按 `session_id` 复用同一个 emitter，保证每个会话只订阅一次。
static EMITTER_REGISTRY: OnceLock<StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>>> =
    OnceLock::new();

fn emitter_registry() -> &'static StdMutex<HashMap<String, Arc<TauriAgentEventEmitter>>> {
    EMITTER_REGISTRY.get_or_init(|| StdMutex::new(HashMap::new()))
}

/// 确保某会话的 AgentLoop 已订阅 TauriAgentEventEmitter（事件桥到前端），幂等（每会话一次）
///
/// 发送链路（`send_message`）与编排链路（`orchestrator_run_plan`）共用：
/// 新建会话但从未发消息时，emitter 尚未注册，编排事件（PlanCreated / ReflectionResult 等）
/// 会桥接不到前端。本函数在此场景下补齐订阅。
///
/// 注意：`emitter_registry` 的 MutexGuard 不能跨 await 持有（future 非 Send），
/// 先判断是否需要注册（guard 随即释放），再 await subscribe，最后重新加锁插入。
async fn ensure_emitter_registered(
    app: &AppHandle,
    agent: &Arc<agent_runtime::agent::AgentLoop>,
    session_id: &str,
) {
    let needs_register = {
        let registry = emitter_registry().lock().unwrap();
        !registry.contains_key(session_id)
    };
    if needs_register {
        let emitter = Arc::new(TauriAgentEventEmitter {
            app: app.clone(),
            session_id: session_id.to_string(),
            trace_seq: AtomicU64::new(0),
            action_events: StdMutex::new(Vec::new()),
            action_seq: AtomicU64::new(0),
        });
        agent.subscribe(emitter.clone()).await;
        // 首迁：Plan 事件族独立监听器（3 key 精确订阅；与主 emitter 同生命周期，
        // 幂等由上述注册表状态保证）
        let plan_emitter = Arc::new(PlanEventEmitter {
            app: app.clone(),
            session_id: session_id.to_string(),
        });
        for key in [
            agent_runtime::event::keys::PLAN_CREATED,
            agent_runtime::event::keys::PLAN_STEP_UPDATE,
            agent_runtime::event::keys::PLAN_REPLANNED,
        ] {
            agent.subscribe_key(key, plan_emitter.clone()).await;
        }
        let mut registry = emitter_registry().lock().unwrap();
        registry.entry(session_id.to_string()).or_insert(emitter);
    }
}

/// 新建会话
///
/// # 参数
/// - `system_prompt`：系统提示词
/// - `provider_config`：Provider 配置（可选，缺省用默认 Cloud 占位，
///   随后可调用 `set_provider_config` 写入真实配置）
/// - `workdir`：会话绑定的工作区根目录（可选，None=不限定；Phase 3 接入本地文件系统）
/// - `entity_storage_root`：实体读取根目录（方案A 2026-09-03；None=回退 workdir）；默认项目传 `~/.WorldSea/worlddata`（工作台实体真实落点），
///   普通项目不填默认和 workdir 同源（`{dirPath}/entities`），和写入侧 FileStorageBackend 同源一致，
///   否则 Rust 文件版 entity_list/entity_get 扫错目录（空白），模型创建实体后读不到。
/// - `project_id`：会话归属项目 id（可选，None=未归属；任务29/D1 锚点，弱引用前端 ProjectManager）
#[tauri::command]
pub async fn new_session(
    state: State<'_, AgentCommandService>,
    system_prompt: Option<String>,
    prompt_sections: Option<Vec<PromptSection>>,
    provider_config: Option<ProviderConfig>,
    scenario_id: Option<String>,
    workdir: Option<String>,
    entity_storage_root: Option<String>,
    project_id: Option<String>,
) -> Result<agent_commands::SessionInfo, String> {
    state
        .new_session(
            system_prompt,
            prompt_sections.unwrap_or_default(),
            provider_config,
            scenario_id,
            workdir.map(std::path::PathBuf::from),
            entity_storage_root.map(std::path::PathBuf::from),
            project_id,
        )
        .await
        .map_err(|e| e.to_string())
}

/// 列出可用场景（B1 场景选择器）
#[tauri::command]
pub async fn list_scenarios(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::ScenarioInfo>, String> {
    Ok(state.list_scenarios().await)
}

/// 模式注册表（C0-15 契约发现 / M1-8）：前端据此渲染命令菜单（A1 `/`），不再按模式写死
#[tauri::command]
pub fn list_patterns() -> Vec<agent_commands::PatternRegistryEntry> {
    agent_commands::list_patterns()
        .into_iter()
        .cloned()
        .collect()
}

/// 会话列表（默认只返回单聊会话，群聊参与者会话不在此列）
#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::SessionInfo>, String> {
    state
        .list_sessions(Some(agent_commands::SessionKind::Chat))
        .await
        .map_err(|e| e.to_string())
}

/// 按 run_id 查 run 实体（B22 / FIX-1）
#[tauri::command]
pub async fn get_run(
    state: State<'_, AgentCommandService>,
    run_id: String,
) -> Result<Option<agent_commands::OrchestrationRun>, String> {
    Ok(state.get_run(&run_id).await)
}

/// 按 artifact_id 取物全文（D23 物权威 / FIX-1）
#[tauri::command]
pub async fn get_artifact(
    state: State<'_, AgentCommandService>,
    artifact_id: String,
) -> Result<Option<agent_runtime::types::HandoverArtifact>, String> {
    Ok(state.get_artifact(&artifact_id).await)
}

/// 按会话列 run（B11 隔离；M2 迹线兜底）
#[tauri::command]
pub async fn list_session_runs(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<agent_commands::OrchestrationRun>, String> {
    Ok(state.list_session_runs(&session_id).await)
}

/// 删除会话
#[tauri::command]
pub async fn delete_session(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.delete_session(&session_id).await.map_err(|e| e.to_string())
}

/// 重命名会话标题
#[tauri::command]
pub async fn update_session_title(
    state: State<'_, AgentCommandService>,
    session_id: String,
    title: String,
) -> Result<(), String> {
    state
        .update_session_title(&session_id, &title)
        .await
        .map_err(|e| e.to_string())
}

/// 生成会话标题（Phase 5：LLM 异步生成，异步不阻塞前端口令调用方）
///
/// 由前端在「首条消息 + 首条回复」到位后调用：Rust 调轻量模型生成 ≤60 字符标题，
/// 更新会话标题后经 `agent:session_title_updated` 事件推前端刷新 Sidebar。
/// 返回实际生效的标题（生成失败返回「新会话」占位，不报错阻断）。
#[tauri::command]
pub async fn cmd_agent_generate_title(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    first_message: String,
    first_reply: String,
) -> Result<String, String> {
    // 确保会话事件桥已订阅（标题更新事件仍走统一前端通道；未发消息时补订阅）
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    let title = state
        .generate_session_title(&session_id, &first_message, &first_reply)
        .await
        .map_err(|e| e.to_string())?;
    // 广播标题更新事件（含 sessionId + title），前端据此更新 Sidebar 条目标题
    if let Err(err) = emit_dual(&app, "agent:session_title_updated", serde_json::json!({
        "sessionId": session_id,
        "title": title,
    })) {
        tracing::warn!("Failed to emit session title updated event to frontend: {err}");
    }
    Ok(title)
}

/// 更新会话绑定的工作区根目录（目录选择器切换工作区时同步当前会话归属）
#[tauri::command]
pub async fn cmd_update_session_workdir(
    state: State<'_, AgentCommandService>,
    session_id: String,
    workdir: Option<String>,
) -> Result<(), String> {
    state
        .update_session_workdir(&session_id, workdir)
        .await
        .map_err(|e| e.to_string())
}

/// 设置会话固定状态
#[tauri::command]
pub async fn set_session_pinned(
    state: State<'_, AgentCommandService>,
    session_id: String,
    pinned: bool,
) -> Result<(), String> {
    state
        .set_session_pinned(&session_id, pinned)
        .await
        .map_err(|e| e.to_string())
}

/// 创作编排模式步骤执行（tot-search / got-solve 接轨 B 轨引擎）
///
/// 由 agent-runtime 的 `pipeline_run_step` 工具 invoke：复用会话 backend，执行
/// B 轨 `TotNode`/`GotNode` + `DefaultOrchestrator`，同步返回交付文本与用量。
/// 步骤由主 Agent 直接调用、不派生子 Agent。见
/// docs/plans/2026-09-09-编排双轨收口审查与6模块迁移.md §创作编排接轨。
#[tauri::command]
pub async fn cmd_pattern_step_run(
    state: State<'_, AgentCommandService>,
    session_id: String,
    pattern: String,
    params: agent_commands::PatternStepParams,
) -> Result<agent_commands::PatternStepOutput, String> {
    state
        .run_pattern_step(&session_id, pattern, params)
        .await
        .map_err(|e| e.to_string())
}

/// supervisor 编排续跑（resume 入口：从 RunStore 断点快照续跑同一张监督图，2026-09-09 接入）
#[tauri::command]
pub async fn cmd_run_supervisor_resume(
    state: State<'_, AgentCommandService>,
    session_id: String,
    run_id: String,
    options: agent_commands::SupervisorExecuteOptions,
) -> Result<agent_runtime::OrchestratorResult, String> {
    state
        .run_supervisor_resume(&session_id, &run_id, options)
        .await
        .map_err(|e| e.to_string())
}

/// 列出全部目录实体（目录空间选择器 / 会话树分组用）
#[tauri::command]
pub async fn cmd_list_workdirs(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::WorkdirRecord>, String> {
    state.list_workdirs().await.map_err(|e| e.to_string())
}

/// 保存/覆盖一个目录实体（按 path 去重，返回 upsert 后的记录）
///
/// 任务29（WorkdirSelect 目录选择器）写入入口预留——当前前端无调用方，workdirs 表
/// 数据由此命令维护；会话树分组 label 消费 cmd_list_workdirs（表空时走路径基名兜底）。
#[tauri::command]
pub async fn cmd_save_workdir(
    state: State<'_, AgentCommandService>,
    path: String,
    label: String,
) -> Result<agent_commands::WorkdirRecord, String> {
    state.save_workdir(path, label).await.map_err(|e| e.to_string())
}

/// 删除一个目录实体（按 id）
#[tauri::command]
pub async fn cmd_delete_workdir(
    state: State<'_, AgentCommandService>,
    id: String,
) -> Result<(), String> {
    state.delete_workdir(id).await.map_err(|e| e.to_string())
}

/// 列出全部 Workspace 实体（Phase A 实体化：id/root/label/sceneId/createdAt，camelCase）
///
/// 任务29（WorkdirSelect/会话树分组）消费预留；当前 new_session/update_session_workdir
/// 已自动维护实体，前端查询入口由本命令提供。
#[tauri::command]
pub async fn cmd_list_workspaces(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::WorkspaceRecord>, String> {
    state.list_workspaces().await.map_err(|e| e.to_string())
}

/// 创建群聊参与者会话（kind='group' + 写 participantId↔sessionId 映射）
#[tauri::command]
pub async fn create_group_session_participant(
    state: State<'_, AgentCommandService>,
    group_id: String,
    participant_id: String,
    system_prompt: Option<String>,
    provider_config: Option<ProviderConfig>,
) -> Result<agent_commands::GroupParticipantSessionInfo, String> {
    state
        .create_group_session_participant(&group_id, &participant_id, system_prompt, provider_config)
        .await
        .map_err(|e| e.to_string())
}

/// 按群聊 id 查询参与者会话映射（重启后恢复群聊用）
#[tauri::command]
pub async fn list_group_session_participants(
    state: State<'_, AgentCommandService>,
    group_id: String,
) -> Result<Vec<agent_commands::GroupParticipantSessionInfo>, String> {
    state
        .list_group_session_participants(&group_id)
        .await
        .map_err(|e| e.to_string())
}

/// 删除群聊全部参与者会话（级联：逐会话删除 + 清映射行）
#[tauri::command]
pub async fn delete_group_session_participants(
    state: State<'_, AgentCommandService>,
    group_id: String,
) -> Result<(), String> {
    state
        .delete_group_session_participants(&group_id)
        .await
        .map_err(|e| e.to_string())
}

/// 渲染常驻记忆文档 MEMORY.md（A1 乙3①）
///
/// 返回 Markdown 全文；`None` = 无可渲染内容（前端不应产出空文件）。
/// 只产内容不落盘——`MEMORY.md` 属 H5 规则体系，路径知识在前端。
#[tauri::command]
pub async fn memory_md_render(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Option<String>, String> {
    state
        .memory_md_render(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 记忆列表（空查询=全量，按时间排序；支持可选关键词过滤）
#[tauri::command]
pub async fn memory_list(
    state: State<'_, AgentCommandService>,
    session_id: String,
    keyword: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<agent_runtime::memory::MemoryRecallResult>, String> {
    state
        .memory_list(&session_id, keyword, limit)
        .await
        .map_err(|e| e.to_string())
}

/// 记忆检索（关键词）
#[tauri::command]
pub async fn memory_recall(
    state: State<'_, AgentCommandService>,
    session_id: String,
    query: String,
    top_k: Option<u32>,
) -> Result<Vec<agent_runtime::memory::MemoryRecallResult>, String> {
    state
        .memory_recall(&session_id, query, top_k)
        .await
        .map_err(|e| e.to_string())
}

/// 手动触发归档（消费缓冲轮次）
#[tauri::command]
pub async fn memory_archive(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Option<agent_runtime::memory::MemoryArchiveResult>, String> {
    state
        .memory_archive(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 加载记忆块完整内容
#[tauri::command]
pub async fn memory_load_chunk(
    state: State<'_, AgentCommandService>,
    session_id: String,
    hook_id: String,
    chunk_id: String,
) -> Result<Option<agent_runtime::memory::MemoryChunkContent>, String> {
    state
        .memory_load_chunk(&session_id, hook_id, chunk_id)
        .await
        .map_err(|e| e.to_string())
}

/// 获取当前归档边界
#[tauri::command]
pub async fn memory_boundary(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<usize, String> {
    state
        .memory_boundary(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 发送消息（ReAct 循环执行）
#[tauri::command]
pub async fn send_message(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    params: SendMessageParams,
) -> Result<agent_commands::SendMessageResult, String> {
    let agent = state.get_agent(&params.session_id).await.map_err(|e| e.to_string())?;

    // 注册事件转发监听器（每会话仅一次，复用 emitter 避免事件多播）
    ensure_emitter_registered(&app, &agent, &params.session_id).await;

    state.send_message(params).await.map_err(|e| e.to_string())
}

/// 解析 HITL 工具确认（A5；D8 四值 2026-09-17）：前端 `agent:confirm:{session_id}` 弹窗后回传
///
/// `outcome` 取 `approved` / `denied` / `skipped`（三键各自成值；`timeout` 由 kernel 超时产生，
/// 不接受前端回传）。`approved` 放行工具执行，其余按不执行返回给 LLM（文案区分）。
///
/// 相关：提问面板回传见 `cmd_agent_ask_answer`（Q1）；定时唤醒三件套
/// `set_timer`/`list_timers`/`cancel_timer`（批次 C·S1）为纯工具，无独立命令。
#[tauri::command]
pub async fn cmd_agent_confirm(
    state: State<'_, AgentCommandService>,
    session_id: String,
    confirm_id: String,
    outcome: String,
) -> Result<bool, String> {
    let outcome = agent_runtime::confirmation::ConfirmationOutcome::parse(&outcome)?;
    state
        .resolve_confirmation(&session_id, &confirm_id, outcome)
        .await
        .map_err(|e| e.to_string())
}

/// 解析「模型主动提问」的回答（Q1，2026-09-20）：前端 `agent:ask:{session_id}` 面板回传
///
/// `answers = Some([...])`：用户作答（`[{id, selected[], custom?}]`，按提问批次 1:1 组装；
/// 跳过 = 空 `selected` 无 `custom`）；`answers = None`：用户拒绝作答（前端「取消」键，
/// 工具侧按 ASK_DENIED 失败结果回模型）。返回是否成功唤醒等待方
/// （ask_id 已处理 / 已随轮取消时 false）。
///
/// 失败码（工具结果内 `errorCode`）：ASK_DENIED / ASK_CANCELLED / ASK_UNAVAILABLE
/// （见 `crates/agent-commands/src/ask_tools.rs`；提问工具豁免执行前确认）。
/// 超时口径：10 分钟兜底 → 按「跳过」返回（逐题空答案 + `timedOut: true`，非失败结果）。
#[tauri::command]
pub async fn cmd_agent_ask_answer(
    state: State<'_, AgentCommandService>,
    session_id: String,
    ask_id: String,
    answers: Option<Vec<agent_runtime::confirmation::AskAnswer>>,
) -> Result<bool, String> {
    state
        .resolve_ask(&session_id, &ask_id, answers)
        .await
        .map_err(|e| e.to_string())
}

/// A2UI 接线（2026-09-17）：前端桥工具发射画布消息（`ctx.emitA2UI` 的实现端）
///
/// 链路：桥工具（`ui_*` / 实体工具）执行中调用 `ctx.emitA2UI` → 本命令 →
/// `AgentCommandService::emit_a2ui` → 会话事件总线 `OrchestratorEvent::A2UIEvent`
/// → emitter 转发 `agent:event:a2ui:{session_id}` → 前端 `handleA2UIEvent` 更新画布。
/// `message` 为 camelCase A2UI 消息（`createSurface` / `updateComponents` /
/// `updateDataModel` / `deleteSurface` 之一）。会话不存在时报错，前端按尽力而为忽略。
#[tauri::command]
pub async fn cmd_agent_emit_a2ui(
    state: State<'_, AgentCommandService>,
    session_id: String,
    surface_id: String,
    message: serde_json::Value,
) -> Result<(), String> {
    let message: agent_runtime::a2ui::A2UIMessage = serde_json::from_value(message)
        .map_err(|e| format!("A2UI 消息解析失败: {e}"))?;
    state
        .emit_a2ui(&session_id, &surface_id, message)
        .await
        .map_err(|e| e.to_string())
}

/// FrontendToolBridge：前端执行桥工具后回传结果
///
/// Rust `FrontendBridgeTool::execute` 把工具调用转发前端（全局 `agent:tool_call` 事件，
/// 携带 `callId`），前端用 `ALL_TOOLS_MAP` 执行后经本命令按 `callId` 回传结果。
/// `ok=true` 表示执行成功（`result` 为工具返回值）；`ok=false` 表示执行失败
/// （`result` 为错误信息字符串或 `{ "error": "..." }` 对象）。
#[tauri::command]
pub fn cmd_agent_tool_result(
    bridge: State<'_, Arc<crate::frontend_tool_bridge::FrontendToolBridge>>,
    call_id: String,
    ok: bool,
    result: serde_json::Value,
) -> Result<bool, String> {
    Ok(bridge.resolve(&call_id, ok, result))
}

/// 诊断日志命令：前端 `ensureModelKey` 等关键链路把诊断信息打到 Rust tracing，
/// 便于在 tauri:dev 终端定位「API Key 缺失」根因（临时，排障后可移除）
#[tauri::command]
pub fn cmd_diag_log(label: String, payload: serde_json::Value) -> Result<(), String> {
    // 用 warn 级别（tauri dev 默认 RUST_LOG 过滤 info，warn 必显示）
    tracing::warn!("[diag] {label}: {}", payload.to_string());
    Ok(())
}

/// A7：设置会话安全级别（运行时切换确认策略；v2 三档）
///
/// `level`：`plan` / `interact`（默认）/ `autopilot`（兼容旧值 off→autopilot、
/// dangerous_only / moderate_and_dangerous→interact）。
#[tauri::command]
pub async fn cmd_agent_set_security_level(
    state: State<'_, AgentCommandService>,
    session_id: String,
    level: String,
) -> Result<(), String> {
    let parsed = parse_security_level(&level)?;
    state
        .set_security_level(&session_id, parsed)
        .await
        .map_err(|e| e.to_string())
}

/// 诊断：列出指定会话 tool_bus 的全部工具名（MCP 注入链路验证，2026-08-30）
#[tauri::command]
pub async fn cmd_agent_tool_names(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<String>, String> {
    state
        .tool_names(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 技能索引/规则文件中途变更时，前端重建提示段推送到当前会话并写穿持久化（A4 双端收口）
#[tauri::command]
pub async fn cmd_agent_update_prompt_sections(
    state: State<'_, AgentCommandService>,
    session_id: String,
    prompt_sections: Vec<PromptSection>,
) -> Result<(), String> {
    state
        .update_session_prompt_sections(&session_id, prompt_sections)
        .await
        .map_err(|e| e.to_string())
}

/// 解析安全级别字符串 → `SecurityLevel`（未知值归入默认 interact，兼容旧档位）
fn parse_security_level(s: &str) -> Result<SecurityLevel, String> {
    Ok(SecurityLevel::parse(s))
}

// ─── v2 权限规则引擎（方向3 P0，2026-09-03）：白名单 / 上锁名单 CRUD ─────

/// 读取规则全集（allow 命令/路径 + 上锁名单）
#[tauri::command]
pub fn cmd_perm_rules_get() -> Result<serde_json::Value, String> {
    let rules = agent_commands::permission_rules::export_rules();
    serde_json::to_value(&rules).map_err(|e| e.to_string())
}

/// 添加命令白名单（小写子串匹配，命中即放行；受锁覆盖）
#[tauri::command]
pub fn cmd_perm_rule_add_allow_command(pattern: String) -> Result<(), String> {
    let p = pattern.trim().to_ascii_lowercase();
    if p.is_empty() {
        return Err("命令白名单不能为空".into());
    }
    agent_commands::permission_rules::update_rules(|r| {
        if !r.allow_commands.iter().any(|x| x == &p) {
            r.allow_commands.push(p);
        }
    })
}

/// 移除命令白名单
#[tauri::command]
pub fn cmd_perm_rule_remove_allow_command(pattern: String) -> Result<(), String> {
    let p = pattern.trim().to_ascii_lowercase();
    agent_commands::permission_rules::update_rules(|r| {
        r.allow_commands.retain(|x| x != &p);
    })
}

/// 添加路径白名单（归一化为绝对路径；命中即放行写/读，受锁覆盖）
#[tauri::command]
pub fn cmd_perm_rule_add_allow_path(path: String) -> Result<(), String> {
    let norm = agent_commands::permission_rules::normalize_rule_path(&path, None);
    if norm.is_empty() {
        return Err("路径白名单不能为空".into());
    }
    agent_commands::permission_rules::update_rules(|r| {
        if !r.allow_paths.iter().any(|x| x == &norm) {
            r.allow_paths.push(norm);
        }
    })
}

/// 移除路径白名单
#[tauri::command]
pub fn cmd_perm_rule_remove_allow_path(path: String) -> Result<(), String> {
    agent_commands::permission_rules::update_rules(|r| {
        r.allow_paths.retain(|x| x != &path);
    })
}

/// 添加/更新上锁规则（read/command/write 三维；已存在同路径则覆盖）
#[tauri::command]
pub fn cmd_perm_rule_add_lock(
    path: String,
    read_ok: bool,
    command_ok: bool,
    write_ok: bool,
) -> Result<(), String> {
    let norm = agent_commands::permission_rules::normalize_rule_path(&path, None);
    if norm.is_empty() {
        return Err("上锁路径不能为空".into());
    }
    agent_commands::permission_rules::update_rules(|r| {
        r.locks.retain(|l| l.path != norm);
        r.locks.push(agent_commands::permission_rules::LockRule {
            path: norm,
            read_ok,
            command_ok,
            write_ok,
        });
    })
}

/// 移除上锁规则
#[tauri::command]
pub fn cmd_perm_rule_remove_lock(path: String) -> Result<(), String> {
    agent_commands::permission_rules::update_rules(|r| {
        r.locks.retain(|l| l.path != path);
    })
}

/// 中断当前运行
#[tauri::command]
pub async fn abort(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.abort(&session_id).await.map_err(|e| e.to_string())
}

/// 中途引导（steer）
#[tauri::command]
pub async fn steer(
    state: State<'_, AgentCommandService>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    state.steer(&session_id, text).await.map_err(|e| e.to_string())
}

/// 清空历史
#[tauri::command]
pub async fn clear_history(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<(), String> {
    state.clear_history(&session_id).await.map_err(|e| e.to_string())
}

/// 清理上下文窗口（移除前 up_to_index 条消息）
#[tauri::command]
pub async fn trim_context(
    state: State<'_, AgentCommandService>,
    session_id: String,
    up_to_index: usize,
) -> Result<(), String> {
    state
        .trim_context(&session_id, up_to_index)
        .await
        .map_err(|e| e.to_string())
}

// ── S3-e2：会话分支命令面（分叉 / 回滚 / 检查点）────────────────

/// 分叉会话（从请求边界派生；子会话继承父会话 Provider 配置，不自动运行）
///
/// `request_seq` = 请求边界（见 `session_snapshots` 查询面）。失败语义：
/// 会话不存在 / 快照链缺该序号 → 拒绝且零残留（见 `session_fork`）。
#[tauri::command]
pub async fn fork_session(
    state: State<'_, AgentCommandService>,
    session_id: String,
    request_seq: i64,
) -> Result<agent_commands::SessionInfo, String> {
    state
        .fork_session(&session_id, request_seq)
        .await
        .map_err(|e| e.to_string())
}

/// 回滚会话到请求边界（日志不删、可再回退；**运行中拒绝**——先中断再回滚）
#[tauri::command]
pub async fn rewind_session(
    state: State<'_, AgentCommandService>,
    session_id: String,
    request_seq: i64,
) -> Result<(), String> {
    state
        .rewind_session(&session_id, request_seq)
        .await
        .map_err(|e| e.to_string())
}

/// 手动打点检查点（锚点 = 当前请求边界；无请求边界 → 拒绝）。返回检查点 id
#[tauri::command]
pub async fn create_checkpoint(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<String, String> {
    state.create_checkpoint(&session_id).await.map_err(|e| e.to_string())
}

/// 统一检查点视图（S3-e 合并裁定 · 方案 A）：会话锚点 + 活跃任务断点
///
/// `limit <= 0` = 不截断；任务断点在引入会话绑定前不按会话过滤（引用式，快照本体在 long_tasks）。
#[tauri::command]
pub async fn list_checkpoints(
    state: State<'_, AgentCommandService>,
    tasks: State<'_, LongTaskRepository>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<agent_commands::CheckpointRef>, String> {
    state
        .list_checkpoint_refs(&session_id, limit.unwrap_or(0), Some(&tasks))
        .await
        .map_err(|e| e.to_string())
}

/// S4-c：重载会话项目规则（`{workdir}/.worldsea/permissions.json`）——编辑规则文件后调用生效
///
/// 返回是否加载到规则（false = 未声明 / 坏 JSON / 无工作区）。
#[tauri::command]
pub async fn reload_project_rules(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<bool, String> {
    state
        .reload_project_rules(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// S4-b：写入会话级授权（仅本会话内存活；`once=true` 一次性）——只服务 alwaysAsk gate
///
/// 前端「本会话总是允许」按钮随 UX 批接线；此处为命令面先行（机制可测）。
#[tauri::command]
pub async fn grant_session_permission(
    state: State<'_, AgentCommandService>,
    session_id: String,
    grants: Vec<agent_commands::SessionGrant>,
) -> Result<usize, String> {
    state
        .grant_session_permission(&session_id, grants)
        .await
        .map_err(|e| e.to_string())
}

/// 状态快照
#[tauri::command]
pub async fn get_state(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_runtime::AgentStateSnapshot, String> {
    state.get_state(&session_id).await.map_err(|e| e.to_string())
}

/// 消息列表
#[tauri::command]
pub async fn get_messages(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<agent_runtime::OrchestratorMessage>, String> {
    state.get_messages(&session_id).await.map_err(|e| e.to_string())
}

// ── A1 R3：会话日志面板（只读查询，设计文档 §10.3）──────────────

/// 会话日志统计（日志总量 / 活跃视图 / 已移出视图 / 事件数）
#[tauri::command]
pub async fn session_log_stats(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_commands::SessionLogStats, String> {
    state
        .session_log_stats(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 读取不可变日志片段（分页：fromOffset 起始坐标 + limit 条数）
#[tauri::command]
pub async fn load_session_log(
    state: State<'_, AgentCommandService>,
    session_id: String,
    from_offset: i64,
    limit: i64,
) -> Result<Vec<agent_commands::SessionLogEntry>, String> {
    state
        .load_session_log(&session_id, from_offset, limit)
        .await
        .map_err(|e| e.to_string())
}

/// 读取会话事件流片段（检查点：历次同步的类型与规模留痕）
#[tauri::command]
pub async fn load_session_events(
    state: State<'_, AgentCommandService>,
    session_id: String,
    from_seq: i64,
    limit: i64,
) -> Result<Vec<agent_commands::SessionEventRecord>, String> {
    state
        .load_session_events(&session_id, from_seq, limit)
        .await
        .map_err(|e| e.to_string())
}

/// 读取活跃视图坐标集合（面板标记「活跃 / 已移出视图」）
#[tauri::command]
pub async fn load_live_offsets(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<i64>, String> {
    state
        .load_live_offsets(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 按坐标取回外置原文（与 `memory_read_raw` 工具同语义：只收坐标、分段、不返回半截）
#[tauri::command]
pub async fn memory_read_raw(
    state: State<'_, AgentCommandService>,
    content_hash: String,
    from: Option<u64>,
    max_chars: Option<u64>,
) -> Result<agent_commands::RawSlice, String> {
    state
        .read_raw_content(&content_hash, from, max_chars)
        .map_err(|e| e.to_string())
}

// ── 丁1 加急：上下文窗口（面板查询 / 手动压缩）──────────────

/// 手动压缩响应（压缩产出 + 压缩后最新占用，供面板与提示条共用）
#[derive(serde::Serialize)]
pub struct CompactResultDto {
    outcome: agent_runtime::context_budget::CompactOutcome,
    usage: agent_runtime::context_budget::ContextUsage,
}

/// 会话上下文窗口占用快照（面板展示；与自动裁剪同源计量）
#[tauri::command]
pub async fn context_usage(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_runtime::context_budget::ContextUsage, String> {
    state
        .context_usage(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 手动压缩会话上下文「一次到底」（/compact 指令与面板按钮）
///
/// 流式进行中由底座拒绝（错误信息含「流式」）；成功后返回压缩产出与最新占用。
#[tauri::command]
pub async fn compact_context(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<CompactResultDto, String> {
    let outcome = state
        .compact_context(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    let usage = state
        .context_usage(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(CompactResultDto { outcome, usage })
}

/// 是否正在流式输出
#[tauri::command]
pub async fn is_streaming(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<bool, String> {
    state.is_streaming(&session_id).await.map_err(|e| e.to_string())
}

/// 热切换模型
#[tauri::command]
pub async fn update_model(
    state: State<'_, AgentCommandService>,
    params: UpdateModelParams,
) -> Result<(), String> {
    state.update_model(params).await.map_err(|e| e.to_string())
}

/// 更新思考级别（level 为 "off"/"minimal"/"low"/"medium"/"high"/"xhigh"）
#[tauri::command]
pub async fn update_thinking_level(
    state: State<'_, AgentCommandService>,
    session_id: String,
    level: String,
) -> Result<(), String> {
    let parsed = parse_thinking_level(&level)?;
    state
        .update_thinking_level(&session_id, parsed)
        .await
        .map_err(|e| e.to_string())
}

/// 获取 Provider 配置
#[tauri::command]
pub async fn get_provider_config(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_commands::ProviderConfig, String> {
    state.get_provider_config(&session_id).await.map_err(|e| e.to_string())
}

/// 整体写入 Provider 配置（5.4：真实 LLM 后端接入）
///
/// 前端从本地存储读取配置 + API Key 后传入，支持 cloud/local/custom 三种
/// 模式，可跨模式切换，不清空消息历史。
#[tauri::command]
pub async fn set_provider_config(
    state: State<'_, AgentCommandService>,
    session_id: String,
    config: ProviderConfig,
) -> Result<(), String> {
    state
        .set_provider_config(&session_id, config)
        .await
        .map_err(|e| e.to_string())
}

/// 注入备用 API Key 池（A2 多 Key 降级）
#[tauri::command]
pub async fn set_api_key_pool(
    state: State<'_, AgentCommandService>,
    session_id: String,
    keys: Vec<String>,
) -> Result<(), String> {
    state
        .set_api_key_pool(&session_id, keys)
        .await
        .map_err(|e| e.to_string())
}

/// 获取心跳状态（长任务监控）
#[tauri::command]
pub async fn get_heartbeat(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<agent_runtime::long_task::HeartbeatStatus, String> {
    state.get_heartbeat(&session_id).await.map_err(|e| e.to_string())
}

/// 解析思考级别字符串，非法值返回错误
fn parse_thinking_level(level: &str) -> Result<ThinkingLevel, String> {
    match level {
        "off" => Ok(ThinkingLevel::Off),
        "minimal" => Ok(ThinkingLevel::Minimal),
        "low" => Ok(ThinkingLevel::Low),
        "medium" => Ok(ThinkingLevel::Medium),
        "high" => Ok(ThinkingLevel::High),
        "xhigh" => Ok(ThinkingLevel::Xhigh),
        other => Err(format!("未知思考级别: {other}")),
    }
}

// ─── 终端（terminal）命令 ───────────────────────────────────
//
// 直接暴露终端工具给前端，与 Agent 工具总线解耦：
// 前端调用 `terminal_execute_command` / `terminal_*_session` 即可
// 执行命令、管理持久化 Shell 会话，无需经过 AgentLoop。
// 参数为 serde_json::Value，键名与工具参数一致（snake_case）。

/// 单次命令执行
#[tauri::command]
pub async fn terminal_execute_command(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.execute_command(args).await.map_err(|e| e.to_string())
}

/// 检测可用 Shell
#[tauri::command]
pub async fn terminal_detect_shells(
    state: State<'_, TerminalService>,
) -> Result<serde_json::Value, String> {
    state.detect_shells().await.map_err(|e| e.to_string())
}

/// 创建持久化 Shell 会话
#[tauri::command]
pub async fn terminal_create_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.create_session(args).await.map_err(|e| e.to_string())
}

/// 在持久化会话中执行命令
#[tauri::command]
pub async fn terminal_exec_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.exec_session(args).await.map_err(|e| e.to_string())
}

/// 向持久化会话发送交互输入
#[tauri::command]
pub async fn terminal_input_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.input_session(args).await.map_err(|e| e.to_string())
}

/// 销毁持久化会话
#[tauri::command]
pub async fn terminal_destroy_session(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state.destroy_session(args).await.map_err(|e| e.to_string())
}

/// 列出持久化会话
#[tauri::command]
pub async fn terminal_list_sessions(
    state: State<'_, TerminalService>,
) -> Result<serde_json::Value, String> {
    state.list_sessions().await.map_err(|e| e.to_string())
}

/// 增量拉取会话输出（真终端轮询，7.1）
#[tauri::command]
pub async fn terminal_poll_output(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let session_id = args
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 session_id 参数".to_string())?
        .to_string();
    let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    state
        .poll_output(&session_id, offset)
        .await
        .map_err(|e| e.to_string())
}

/// 调整会话终端尺寸（真终端窗口 resize，7.1）
#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, TerminalService>,
    args: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let session_id = args
        .get("session_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "缺少 session_id 参数".to_string())?
        .to_string();
    let cols = args.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u16;
    let rows = args.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u16;
    state
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

// ─── 子 Agent（subagent）命令 ───────────────────────────────────
//
// 暴露子 Agent 规格管理能力给前端：查看/注册/删除规格，
// 使主 Agent 的 `delegate_to_sub_agent` 工具可被用户在桌面端配置。
// `SubAgentSpec` 复用 agent-runtime 类型（已 derive Serialize/Deserialize）。

/// 列出已注册的子 Agent 规格
#[tauri::command]
pub async fn subagent_list_specs(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<SubAgentSpec>, String> {
    Ok(state.list_subagent_specs().await)
}

/// 注册一个子 Agent 规格（同名按 id 覆盖）
#[tauri::command]
pub async fn subagent_register_spec(
    state: State<'_, AgentCommandService>,
    spec: SubAgentSpec,
) -> Result<(), String> {
    agent_commands::validate_subagent_spec(&spec)?;
    state.register_subagent_spec(spec).await;
    Ok(())
}

/// 删除一个子 Agent 规格（按 id）
#[tauri::command]
pub async fn subagent_remove_spec(
    state: State<'_, AgentCommandService>,
    id: String,
) -> Result<bool, String> {
    Ok(state.remove_subagent_spec(&id).await)
}

/// 导出全部子 Agent 规格为 JSON 字符串（备份/跨机迁移）
#[tauri::command]
pub async fn subagent_export_specs(
    state: State<'_, AgentCommandService>,
) -> Result<String, String> {
    state
        .export_subagent_specs()
        .await
        .map_err(|e| e.to_string())
}

/// 从 JSON 字符串导入子 Agent 规格（按 id 覆盖，返回导入条数）
#[tauri::command]
pub async fn subagent_import_specs(
    state: State<'_, AgentCommandService>,
    json: String,
) -> Result<usize, String> {
    state
        .import_subagent_specs(&json)
        .await
        .map_err(|e| e.to_string())
}

/// 列出指定会话子 Agent 实例池中所有活跃实例（含累积消息数/流式状态）
#[tauri::command]
pub async fn subagent_list_instances(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<Vec<SubAgentInstanceInfo>, String> {
    state
        .list_subagent_instances(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// 清空指定会话的单个子 Agent 实例（重置其累积上下文，返回是否成功移除）
#[tauri::command]
pub async fn subagent_clear_instance(
    state: State<'_, AgentCommandService>,
    session_id: String,
    sub_agent_id: String,
) -> Result<bool, String> {
    state
        .clear_subagent_instance(&session_id, &sub_agent_id)
        .await
        .map_err(|e| e.to_string())
}

/// 清空指定会话的全部子 Agent 实例（重置累积上下文，返回清空数量）
#[tauri::command]
pub async fn subagent_clear_instances(
    state: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<usize, String> {
    state
        .clear_subagent_instances(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ─── Loop Control（loop_control）命令 ───────────────────────────────────
//
// 恢复端分离迁移时丢失的命令层（原 src-tauri/src/commands/loop_control.rs）。
// 注册表与检查逻辑在 agent-commands 的 LoopControlRegistry（纯逻辑层），
// 此处做薄包装。前端 composable：useLoopControlRust.ts（11 个命令）。

/// 转发 LoopEng* 事件到前端 `loop_control:event:{task_id}` 通道
///
/// 每个 LoopController 实例在 `cmd_loop_control_create` 时订阅一个本监听器，
/// `cmd_loop_control_check` 检查到非空结果时经条目 broadcaster 广播，这里
/// 转为前端 `RustLoopControlEventPayload`（snake_case 字段）推送到前端。
struct LoopControlTauriEventListener {
    app: AppHandle,
}

impl Listener for LoopControlTauriEventListener {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        // 只处理 Loop Engineering 事件；字段名与前端 RustLoopControlEventPayload 对齐（snake_case）
        let (task_id, payload): (String, serde_json::Value) = match event {
            OrchestratorEvent::LoopEngRateLimitExceeded {
                task_id,
                limit_type,
                current,
                max,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_rate_limit_exceeded",
                    "task_id": task_id,
                    "limit_type": limit_type,
                    "current": current,
                    "max": max,
                }),
            ),
            OrchestratorEvent::LoopEngRetrying {
                task_id,
                attempt,
                max_retries,
                backoff_ms,
                error,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_retrying",
                    "task_id": task_id,
                    "attempt": attempt,
                    "max_retries": max_retries,
                    "backoff_ms": backoff_ms,
                    "error": error,
                }),
            ),
            OrchestratorEvent::LoopEngRetryExhausted {
                task_id,
                total_attempts,
                final_error,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_retry_exhausted",
                    "task_id": task_id,
                    "total_attempts": total_attempts,
                    "final_error": final_error,
                }),
            ),
            OrchestratorEvent::LoopEngSoftTimeoutWarning {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_soft_timeout_warning",
                    "task_id": task_id,
                    "elapsed_secs": elapsed_secs,
                    "threshold_secs": threshold_secs,
                }),
            ),
            OrchestratorEvent::LoopEngSoftTimeoutCritical {
                task_id,
                elapsed_secs,
                threshold_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_soft_timeout_critical",
                    "task_id": task_id,
                    "elapsed_secs": elapsed_secs,
                    "threshold_secs": threshold_secs,
                }),
            ),
            OrchestratorEvent::LoopEngWatchdogIdle {
                task_id,
                last_activity,
                idle_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_watchdog_idle",
                    "task_id": task_id,
                    "last_activity": last_activity,
                    "idle_secs": idle_secs,
                }),
            ),
            OrchestratorEvent::LoopEngWatchdogDead {
                task_id,
                last_activity,
                idle_secs,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_watchdog_dead",
                    "task_id": task_id,
                    "last_activity": last_activity,
                    "idle_secs": idle_secs,
                }),
            ),
            OrchestratorEvent::LoopEngRecovered {
                task_id,
                turn_count,
                recovery_method,
            } => (
                task_id.clone(),
                serde_json::json!({
                    "type": "loop_eng_recovered",
                    "task_id": task_id,
                    "turn_count": turn_count,
                    "recovery_method": recovery_method,
                }),
            ),
            // 其他事件不转发
            _ => return ListenerOutcome::Continue,
        };

        let event_name = format!("loop_control:event:{task_id}");
        if let Err(err) = emit_dual(&self.app, &event_name, payload) {
            tracing::warn!("Failed to emit loop_control event to frontend: {}", err);
        }
        ListenerOutcome::Continue
    }
}

/// 创建 LoopController 实例并注册到 registry，详细见 docs/details/注释/tauri/commands.md
#[tauri::command]
pub async fn cmd_loop_control_create(
    app: AppHandle,
    state: State<'_, Arc<LoopControlRegistry>>,
    service: State<'_, AgentCommandService>,
    task_id: String,
    config: Option<LoopControlConfig>,
    session_id: Option<String>,
) -> Result<(), LoopControlRegistryError> {
    // 绑定会话：复用该会话 AgentLoop 内建 LoopController（共享单实例）
    if let Some(sid) = session_id {
        service
            .register_session_loop_control(task_id.clone(), &sid)
            .await
            .map_err(|e| LoopControlRegistryError::Internal {
                message: e.to_string(),
            })?;
        attach_loop_control_listener(&app, &state, &task_id).await;
        tracing::info!("cmd_loop_control_create: 已绑定会话 {sid} 复用内建控制器 task={task_id}");
        return Ok(());
    }

    // 无会话绑定：独立创建控制器（手动轨）
    let config = config.unwrap_or_default();
    let controller =
        Arc::new(agent_runtime::loop_control::LoopController::new(config.clone()));
    let entry = LoopControlEntry::new(controller, config);
    state.register(task_id.clone(), entry).await?;
    attach_loop_control_listener(&app, &state, &task_id).await;
    tracing::info!("cmd_loop_control_create: 已创建 task={task_id}");
    Ok(())
}

/// 取出已注册条目并订阅 TauriEventListener（把 LoopEng* 事件转发到前端）
async fn attach_loop_control_listener(
    app: &AppHandle,
    state: &State<'_, Arc<LoopControlRegistry>>,
    task_id: &str,
) {
    let entry = match state.get(task_id).await {
        Ok(e) => e,
        Err(_) => return,
    };
    let listener = Arc::new(LoopControlTauriEventListener { app: app.clone() });
    entry.subscribe(listener).await;
}

/// 执行一站式检查并 emit 事件
///
/// 调用 `LoopControlRegistry::check_and_emit`：检查 rate_limit / soft_timeout /
/// watchdog，非空结果广播 LoopEng* 事件（经监听器转发前端）。
#[tauri::command]
pub async fn cmd_loop_control_check(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlCheckResult, LoopControlRegistryError> {
    state.check_and_emit(&task_id).await
}

/// 记录一次轮次（inc_turns），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_turn(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.inc_turns();
    entry.update_activity();
    Ok(())
}

/// 记录一次工具调用（inc_tool_calls），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_tool_call(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.inc_tool_calls();
    entry.update_activity();
    Ok(())
}

/// 记录 token 消耗（add_tokens），同时更新活动时间
#[tauri::command]
pub async fn cmd_loop_control_record_tokens(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
    tokens: u64,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.controller.rate_limiter.add_tokens(tokens);
    entry.update_activity();
    Ok(())
}

/// 更新活动时间（心跳，重置 Watchdog 的 last_activity）
#[tauri::command]
pub async fn cmd_loop_control_update_activity(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.update_activity();
    Ok(())
}

/// 重置计数器（retry 后调用；不重置 started_at）
#[tauri::command]
pub async fn cmd_loop_control_reset_counters(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    entry.reset_counters();
    Ok(())
}

/// 获取任务配置快照
#[tauri::command]
pub async fn cmd_loop_control_get_config(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlConfig, LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    Ok(entry.config.clone())
}

/// 获取状态快照（计数器 + 触发状态）
#[tauri::command]
pub async fn cmd_loop_control_get_status(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<LoopControlStatus, LoopControlRegistryError> {
    let entry = state.get(&task_id).await?;
    Ok(LoopControlStatus::from_entry(&task_id, &entry))
}

/// 销毁 LoopController 实例（从 registry 移除）
#[tauri::command]
pub async fn cmd_loop_control_destroy(
    state: State<'_, Arc<LoopControlRegistry>>,
    task_id: String,
) -> Result<(), LoopControlRegistryError> {
    state.remove(&task_id).await?;
    tracing::info!("cmd_loop_control_destroy: 已销毁 task={task_id}");
    Ok(())
}

/// 列出所有已注册的 task_id
#[tauri::command]
pub async fn cmd_loop_control_list_tasks(
    state: State<'_, Arc<LoopControlRegistry>>,
) -> Result<Vec<String>, LoopControlRegistryError> {
    Ok(state.list().await)
}

// ─── 长任务（long_task）命令 ───────────────────────────────────────────
//
// 恢复端分离迁移时丢失的命令层（原 src-tauri/src/commands/long_task.rs）。
// 持久化在 agent-commands 的 LongTaskRepository（SQLite），此处做薄包装。
// 前端 composable：useLongTaskRust.ts（7 个命令）。

/// 保存或更新长任务（upsert 语义）
///
/// # 参数
/// - `record`: `LongTaskRecord`（含 task_id / status / checkpoint / meta 等完整字段）
///
/// # 调用时机
/// 心跳定时器 CheckpointFlush tick / `start_task` 后首次持久化 /
/// `complete_task` / `fail_task` / `cancel_task` 后写入终态 record。
#[tauri::command]
pub async fn cmd_long_task_save(
    state: State<'_, LongTaskRepository>,
    record: LongTaskRecord,
) -> Result<(), String> {
    state.save(record).await.map_err(|e| e.to_string())
}

/// 加载长任务完整数据（断点恢复用）
///
/// # 错误
/// task_id 不存在时返回 `not_found` 错误（前端 `loadTask` catch 后返回 null）。
#[tauri::command]
pub async fn cmd_long_task_load(
    state: State<'_, LongTaskRepository>,
    task_id: String,
) -> Result<LongTaskRecord, String> {
    state.load(&task_id).await.map_err(|e| e.to_string())
}

/// 列出所有 Running 任务（应用启动恢复用）
#[tauri::command]
pub async fn cmd_long_task_list_running(
    state: State<'_, LongTaskRepository>,
) -> Result<Vec<LongTaskRecord>, String> {
    state.list_running().await.map_err(|e| e.to_string())
}

/// 列出所有长任务（按 started_at DESC 排序，最近的在前）
#[tauri::command]
pub async fn cmd_long_task_list_all(
    state: State<'_, LongTaskRepository>,
) -> Result<Vec<LongTaskRecord>, String> {
    state.list_all().await.map_err(|e| e.to_string())
}

/// 轻量心跳更新（仅写 last_heartbeat_at）
///
/// # 返回
/// - `Ok(true)`: 更新成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
#[tauri::command]
pub async fn cmd_long_task_update_heartbeat(
    state: State<'_, LongTaskRepository>,
    task_id: String,
    last_heartbeat_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, String> {
    state
        .update_heartbeat(&task_id, last_heartbeat_at)
        .await
        .map_err(|e| e.to_string())
}

/// 轻量状态更新（complete/fail/cancel 时调用）
///
/// 仅更新 status + ended_at，不触碰 checkpoint/meta。
#[tauri::command]
pub async fn cmd_long_task_update_status(
    state: State<'_, LongTaskRepository>,
    task_id: String,
    status: LongTaskStatus,
    ended_at: chrono::DateTime<chrono::Utc>,
) -> Result<bool, String> {
    state
        .update_status(&task_id, status, ended_at)
        .await
        .map_err(|e| e.to_string())
}

/// 删除长任务记录
///
/// # 返回
/// - `Ok(true)`: 删除成功
/// - `Ok(false)`: task_id 不存在（幂等，不报错）
#[tauri::command]
pub async fn cmd_long_task_delete(
    state: State<'_, LongTaskRepository>,
    task_id: String,
) -> Result<bool, String> {
    state.delete(&task_id).await.map_err(|e| e.to_string())
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A2UI 持久化契约（2026-09-17）：`A2UIEvent → ("a2ui", { surfaceId, message })`
    ///
    /// 该形状即前后端契约——前端 `collectA2UIActionEvents`（turnModel）按 `surfaceId` +
    /// `message`（camelCase A2UIMessage）从 `meta.action_events` 重放重建画布。
    #[test]
    fn action_event_payload_maps_a2ui_event() {
        let event = OrchestratorEvent::A2UIEvent {
            node_id: "s-1".into(),
            surface_id: "card-1".into(),
            message: agent_runtime::a2ui::A2UIMessage::create_surface(
                "card-1",
                "https://worldsea.app/catalog/v1",
            ),
        };
        let (action, payload) =
            TauriAgentEventEmitter::action_event_payload(&event).expect("A2UIEvent 应映射为动作段");
        assert_eq!(action, "a2ui");
        assert_eq!(payload["surfaceId"], "card-1");
        // message 为 camelCase A2UIMessage（前端 handleA2UIEvent 按变体键判型）
        assert_eq!(payload["message"]["version"], "v0.9");
        assert_eq!(payload["message"]["createSurface"]["surfaceId"], "card-1");
        assert_eq!(
            payload["message"]["createSurface"]["catalogId"],
            "https://worldsea.app/catalog/v1"
        );
    }

    /// 重试反馈契约（2026-09-17）：`LoopEngRetrying → llm_retry` 流 payload（camelCase）
    ///
    /// 前端 `handleStreamEvent` 按此形状驱动重试状态行（第 n/m 次 + 等待毫秒）；
    /// 其他事件不映射（仅重试进行中上报，耗尽的终态走 Error 事件）。
    #[test]
    fn llm_retry_payload_maps_retrying_event() {
        let event = OrchestratorEvent::LoopEngRetrying {
            task_id: "t-1".into(),
            attempt: 2,
            max_retries: 3,
            backoff_ms: 5000,
            error: "429 Too Many Requests".into(),
        };
        let p = TauriAgentEventEmitter::llm_retry_payload(&event).expect("LoopEngRetrying 应映射");
        assert_eq!(p["type"], "llm_retry");
        assert_eq!(p["attempt"], 2);
        assert_eq!(p["maxRetries"], 3);
        assert_eq!(p["backoffMs"], 5000);
        assert_eq!(p["error"], "429 Too Many Requests");
        assert!(
            TauriAgentEventEmitter::llm_retry_payload(&OrchestratorEvent::Agent(AgentEvent::AgentEnd))
                .is_none(),
            "非重试事件不应映射"
        );
    }
}