//! Tauri 命令层：Agent 主链路薄包装 + Deep Phase 事件转发，详细见 docs/details/注释/tauri/commands.md

use agent_commands::{
    AgentCommandService, LongTaskRepository, LoopControlCheckResult, LoopControlEntry,
    LoopControlRegistry, LoopControlRegistryError, LoopControlStatus, SecurityLevel,
    SendMessageParams, SubAgentInstanceInfo, TerminalService, UpdateModelParams,
};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::event::{OrchestratorEvent, EventListener, AgentEvent};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::long_task::{LongTaskRecord, LongTaskStatus};
use agent_runtime::loop_control::LoopControlConfig;
use agent_runtime::supervisor::SubAgentSpec;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::{AppHandle, Emitter, State};
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
}

impl TauriAgentEventEmitter {
    /// A1 全链路事件流可观测：把非高频事件映射为 `(类型, 摘要)`，供 trace 通道投递
    ///
    /// 过滤掉高频流式增量 `StreamDelta`（避免 trace 消息爆炸），其余阶段事件全部纳入，
    /// 使前端能按序还原「一次对话一条可追踪链」（AgentStart → … → AgentEnd）。
    /// R6 第一部分：动作段事件 → 流通道 payload（`agent:event:stream:{sid}` 的
    /// `type: "action_event"` 消息）。六类动作段的统一转发映射——前端 turnModel
    /// 据此驱动 ActionSegment（第三部分接入消费）；持久化载体为第二部分。
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
                Some(("phase", serde_json::json!({ "phase": "pipe_started", "runId": run_id, "pipeline": pipeline, "reason": reason })))
            }
            OrchestratorEvent::TracePhaseEntered { run_id, phase, reason } => {
                Some(("phase", serde_json::json!({ "phase": "entered", "runId": run_id, "phase": phase, "reason": reason })))
            }
            OrchestratorEvent::TracePhaseResult { run_id, phase, status, summary, .. } => {
                Some((
                    "phase",
                    serde_json::json!({ "phase": "result", "runId": run_id, "phase": phase, "status": format!("{status:?}"), "summary": summary }),
                ))
            }
            OrchestratorEvent::TracePipeFinished { run_id, status, .. } => {
                Some(("phase", serde_json::json!({ "phase": "pipe_finished", "runId": run_id, "status": format!("{status:?}") })))
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
            OrchestratorEvent::ConfirmationResolved { confirm_id, approved } => {
                Some(("confirm", serde_json::json!({ "phase": "resolved", "confirmId": confirm_id, "approved": approved })))
            }
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
            OrchestratorEvent::Agent(AgentEvent::Error { message }) => {
                Some(("error", format!("执行出错：{message}")))
            }
            OrchestratorEvent::Agent(AgentEvent::AgentEnd) => {
                Some(("agent_end", "Agent 执行结束".to_string()))
            }
            OrchestratorEvent::DeepPhaseChanged { phase_label, .. } => {
                Some(("phase_changed", format!("进入阶段：{phase_label}")))
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

/// Multi-Agent 实时事件 → `agent:event:orch_multi:{session_id}`
///
/// payload 同构 `{ kind, payload }`；kind ∈
/// round_started / message_sent / blackboard_updated / round_completed / converged。
fn emit_orch_multi(emitter: &TauriAgentEventEmitter, kind: &str, payload: serde_json::Value) {
    let event_name = format!("agent:event:orch_multi:{}", emitter.session_id);
    if let Err(err) = emit_dual(&emitter.app, &event_name, serde_json::json!({ "kind": kind, "payload": payload })) {
        tracing::warn!("Failed to emit multi-agent event ({kind}) to frontend: {err}");
    }
}

impl EventListener for TauriAgentEventEmitter {
    fn on_event(&self, event: &OrchestratorEvent) {
        // R6 第一部分：六类动作段事件（subagent/a2ui/phase/router/reflection/confirm）
        // 注入流通道（此前仅 trace/orch 专用通道，行段模型拿不到——回源即失的转发缺口）
        if let Some((action, payload)) = Self::action_event_payload(event) {
            self.emit_stream_action(action, payload);
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
            OrchestratorEvent::DeepPhaseChanged {
                phase_label,
                phase_index,
                trigger_tool,
                tool_status,
                phase_completed,
                ..
            } => {
                // 转发到前端：事件名 `agent:event:deep_phase_changed:{session_id}`
                // payload: { phaseLabel, phaseIndex, triggerTool, toolStatus, phaseCompleted }
                let event_name = format!("agent:event:deep_phase_changed:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, 
                    &event_name,
                    serde_json::json!({
                        "phaseLabel": phase_label,
                        "phaseIndex": phase_index,
                        "triggerTool": trigger_tool,
                        "toolStatus": tool_status,
                        "phaseCompleted": phase_completed,
                    }),
                ) {
                    tracing::warn!(
                        "Failed to emit DeepPhaseChanged event to frontend: {}",
                        err
                    );
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
            OrchestratorEvent::ConfirmationResolved { confirm_id, approved } => {
                // 转发到前端：事件名 `agent:confirm:{session_id}`
                // payload: { confirmId, approved }（供前端清理进行中的确认弹窗）
                let event_name = format!("agent:confirm:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, serde_json::json!({
                    "type": "resolved",
                    "confirmId": confirm_id,
                    "approved": approved,
                })) {
                    tracing::warn!("Failed to emit ConfirmationResolved event to frontend: {}", err);
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
                    AgentEvent::Error { message } => {
                        serde_json::json!({ "type": "error", "message": message })
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
                    // R6 第一部分：A2UI 归 AgentEvent——注入流通道动作段消息
                    AgentEvent::A2UI { surface_id, .. } => serde_json::json!({
                        "type": "action_event",
                        "action": "a2ui",
                        "phase": "update",
                        "surfaceId": surface_id,
                    }),
                    // 其他基础 Agent 事件（UserMessage 等）暂不在此通道转发
                    _ => return,
                };
                let event_name = format!("agent:event:stream:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, &event_name, payload) {
                    tracing::warn!("Failed to emit Stream event to frontend: {}", err);
                }
            }
            // ── A4 Plan-Exec 计划事件 ──
            // 转发 `PlanCreated` / `PlanStepUpdate` 到前端通道
            // `agent:event:plan_created:{session_id}` / `agent:event:plan_update:{session_id}`，
            // 前端 `useAgentEvents` 据此更新 `usePlanStore`，驱动 PlanPanel 展示。
            OrchestratorEvent::PlanCreated { items } => {
                let event_name = format!("agent:event:plan_created:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, 
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
                if let Err(err) = emit_dual(&self.app, 
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
            // A4 Replanner：计划重规划后整体刷新前端
            OrchestratorEvent::PlanReplanned { items } => {
                let event_name = format!("agent:event:plan_replanned:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, 
                    &event_name,
                    serde_json::json!({ "items": items }),
                ) {
                    tracing::warn!("Failed to emit PlanReplanned event to frontend: {}", err);
                }
            }
            // Reflection/Self-Refine 评审结果：转发到 `agent:event:reflection:{session_id}`，
            // 前端据此展示评分/问题/建议（与 A4 计划事件同一转发模式）
            OrchestratorEvent::ReflectionResult { result } => {
                let event_name = format!("agent:event:reflection:{}", self.session_id);
                if let Err(err) = emit_dual(&self.app, 
                    &event_name,
                    serde_json::json!({ "result": result }),
                ) {
                    tracing::warn!("Failed to emit ReflectionResult event to frontend: {}", err);
                }
            }
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
            // ─── Multi-Agent 实时事件 → `agent:event:orch_multi:{session_id}` ───
            OrchestratorEvent::MultiAgentRoundStarted {
                round, agent_count, ..
            } => {
                emit_orch_multi(self, "round_started", json!({
                    "round": round, "agentCount": agent_count,
                }));
            }
            OrchestratorEvent::MultiAgentMessageSent {
                from,
                to,
                message_type,
                content_preview,
                ..
            } => {
                emit_orch_multi(self, "message_sent", json!({
                    "from": from, "to": to,
                    "messageType": message_type,
                    "contentPreview": content_preview,
                }));
            }
            OrchestratorEvent::MultiAgentBlackboardUpdated { key, by, .. } => {
                emit_orch_multi(self, "blackboard_updated", json!({
                    "key": key, "by": by,
                }));
            }
            OrchestratorEvent::MultiAgentRoundCompleted { round, outputs, .. } => {
                emit_orch_multi(self, "round_completed", json!({
                    "round": round, "outputs": outputs,
                }));
            }
            OrchestratorEvent::MultiAgentConverged { reason, final_result, .. } => {
                emit_orch_multi(self, "converged", json!({
                    "reason": reason, "finalResult": final_result,
                }));
            }
            // 其他事件目前不需要转发到前端
            _ => {}
        }
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
        });
        agent.subscribe(emitter.clone()).await;
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
/// - `project_id`：会话归属项目 id（可选，None=未归属；任务29/D1 锚点，弱引用前端 ProjectManager）
#[tauri::command]
pub async fn new_session(
    state: State<'_, AgentCommandService>,
    system_prompt: Option<String>,
    provider_config: Option<ProviderConfig>,
    scenario_id: Option<String>,
    workdir: Option<String>,
    project_id: Option<String>,
) -> Result<agent_commands::SessionInfo, String> {
    state
        .new_session(
            system_prompt,
            provider_config,
            scenario_id,
            workdir.map(std::path::PathBuf::from),
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

/// 列出全部目录实体（目录空间选择器 / 会话树分组用）
#[tauri::command]
pub async fn cmd_list_workdirs(
    state: State<'_, AgentCommandService>,
) -> Result<Vec<agent_commands::WorkdirRecord>, String> {
    state.list_workdirs().await.map_err(|e| e.to_string())
}

/// 保存/覆盖一个目录实体（按 path 去重，返回 upsert 后的记录）
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

/// 运行 Plan-and-Execute 编排图（3/4/5 编排模式命令入口）
///
/// - `options.refine = false`：链路 Plan → Execute（计划生成 → 逐步执行）
/// - `options.refine = true`：链路 Plan → Execute → Reflection ⇄ Refine（自我评审迭代优化）
///
/// 复用会话的 LLM 后端；编排进度（PlanCreated / PlanStepUpdate / ReflectionResult）
/// 经会话事件通道转发到前端 `agent:event:trace:{session_id}`。
#[tauri::command]
pub async fn orchestrator_run_plan(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    input: String,
    options: Option<agent_commands::PlanExecuteOptions>,
) -> Result<agent_runtime::orchestrator::OrchestratorResult, String> {
    // 与 send_message 同路：确保 emitter 已订阅，使编排事件（PlanCreated/ReflectionResult）
    // 能桥接前端（新建会话未发消息时也能收到）
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    state
        .run_plan_execute(&session_id, input, options.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

/// 运行 ToT（Tree of Thoughts）编排图；思维树进度经会话事件通道转发前端
#[tauri::command]
pub async fn orchestrator_run_tot(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    input: String,
    options: Option<agent_commands::ToTExecuteOptions>,
) -> Result<agent_runtime::orchestrator::OrchestratorResult, String> {
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    state
        .run_tot(&session_id, input, options.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

/// 运行 GoT（Graph of Thoughts）编排图
#[tauri::command]
pub async fn orchestrator_run_got(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    input: String,
    options: Option<agent_commands::GoTExecuteOptions>,
) -> Result<agent_runtime::orchestrator::OrchestratorResult, String> {
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    state
        .run_got(&session_id, input, options.unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

/// 运行 Supervisor 编排图（子 Agent 委派协调）
#[tauri::command]
pub async fn orchestrator_run_supervisor(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    input: String,
    options: agent_commands::SupervisorExecuteOptions,
) -> Result<agent_runtime::orchestrator::OrchestratorResult, String> {
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    state
        .run_supervisor(&session_id, input, options)
        .await
        .map_err(|e| e.to_string())
}

/// 运行 Multi-Agent 协作编排图（N 个 Agent 共享黑板协作）
#[tauri::command]
pub async fn orchestrator_run_multi(
    app: AppHandle,
    state: State<'_, AgentCommandService>,
    session_id: String,
    input: String,
    options: agent_commands::MultiAgentExecuteOptions,
) -> Result<agent_runtime::orchestrator::OrchestratorResult, String> {
    if let Ok(agent) = state.get_agent(&session_id).await {
        ensure_emitter_registered(&app, &agent, &session_id).await;
    }
    state
        .run_multi(&session_id, input, options)
        .await
        .map_err(|e| e.to_string())
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

/// 解析 HITL 工具确认（A5）：前端 `agent:confirm:{session_id}` 弹窗后回传
///
/// `approved=true` 放行工具执行，`false` 拒绝（工具按失败返回给 LLM）。
#[tauri::command]
pub async fn cmd_agent_confirm(
    state: State<'_, AgentCommandService>,
    session_id: String,
    confirm_id: String,
    approved: bool,
) -> Result<bool, String> {
    state
        .resolve_confirmation(&session_id, &confirm_id, approved)
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

/// A7：设置会话安全级别（运行时切换确认策略）
///
/// `level`：`off` / `dangerous_only`(默认) / `moderate_and_dangerous`。
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

/// 解析安全级别字符串 → `SecurityLevel`（非法返回错误，供前端开关映射）
fn parse_security_level(s: &str) -> Result<SecurityLevel, String> {
    match s.to_lowercase().as_str() {
        "off" => Ok(SecurityLevel::Off),
        "dangerous_only" => Ok(SecurityLevel::DangerousOnly),
        "moderate_and_dangerous" => Ok(SecurityLevel::ModerateAndDangerous),
        _ => Err(format!("未知安全级别: {s}")),
    }
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

impl EventListener for LoopControlTauriEventListener {
    fn on_event(&self, event: &OrchestratorEvent) {
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
            _ => return,
        };

        let event_name = format!("loop_control:event:{task_id}");
        if let Err(err) = emit_dual(&self.app, &event_name, payload) {
            tracing::warn!("Failed to emit loop_control event to frontend: {}", err);
        }
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