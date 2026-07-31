//! # Agent 事件 Payload — 前端友好的扁平化事件结构
//!
//! 将 `agent_runtime::OrchestratorEvent`（Rust 枚举）转换为
//! `AgentEventPayload`（ tagged union JSON），通过 Tauri `ipc::Channel` 推送到前端。
//!
//! ## 设计原则
//! - **前端契约对齐**：序列化结果匹配 `bridge-types.ts` 的 `AgentEvent` 联合类型
//! - **tag = "type"**：使用 serde 内部标签模式，序列化为 `{"type": "stream_delta", ...}`
//! - **camelCase**：字段命名与前端的 camelCase 一致（如 `toolCallId` 而非 `tool_call_id`）
//! - **扁平化**：避免 Rust 枚举嵌套序列化（如 `{"Agent": {"StreamDelta": {...}}}`）
//!
//! ## 与前端 AgentEvent 的映射
//! | Rust AgentEventPayload              | TS AgentEvent            |
//! |-------------------------------------|--------------------------|
//! | `AgentStart`                        | `agent_start`            |
//! | `AgentEnd`                          | `agent_end`              |
//! | `StreamStart`                       | `message_start`          |
//! | `StreamDelta`                       | `message_update`         |
//! | `StreamEnd`                         | `message_end`            |
//! | `ToolCallStart`                     | `tool_execution_start`   |
//! | `ToolCallEnd`                       | `tool_execution_end`     |
//! | `Error`                             | `error`                  |
//! | `A2UI` (P2 新增)                   | `a2ui`                  |
//! | `BlockAppend` (P2 新增)            | `block_append`           |
//!
//! 阶段 1.5 暂不映射的事件（前端 TS 版独有）：
//! - `turn_end` / `usage` / `tool_execution_update`
//! 这些事件在 Rust AgentLoop 中尚未产生，后续按需补充。

use agent_runtime::a2ui::A2UIMessage;
use agent_runtime::event::{AgentEvent, OrchestratorEvent};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Payload 结构 ────────────────────────────────────────

/// 工具调用信息（前端 `toolCall` 字段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallInfo {
    pub id: String,
    pub name: String,
    pub args: serde_json::Value,
}

/// Token 用量信息（前端 `UsageData`）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u32>,
}

/// 前端友好的 Agent 事件 Payload
///
/// 通过 `#[serde(tag = "type")]` 序列化为 discriminated union，
/// 匹配前端 `AgentEvent` 联合类型。
///
/// # 示例
/// ```rust,ignore
/// let payload = AgentEventPayload::StreamDelta {
///     message_id: "msg_1".into(),
///     delta: "你好".into(),
/// };
/// let json = serde_json::to_string(&payload).unwrap();
/// // => {"type":"stream_delta","messageId":"msg_1","delta":"你好"}
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEventPayload {
    /// Agent 启动（对应前端 `agent_start`）
    AgentStart {
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    /// Agent 结束（对应前端 `agent_end`）
    AgentEnd {
        session_id: String,
    },
    /// 流式响应开始（对应前端 `message_start`）
    StreamStart {
        session_id: String,
        message_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
    },
    /// 流式增量（对应前端 `message_update`，仅传 delta）
    StreamDelta {
        message_id: String,
        delta: String,
    },
    /// 流式结束（对应前端 `message_end`）
    StreamEnd {
        session_id: String,
        message_id: String,
        full_text: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageInfo>,
    },
    /// 工具调用开始（对应前端 `tool_execution_start`）
    ToolCallStart {
        session_id: String,
        tool_call: ToolCallInfo,
    },
    /// 工具调用结束（对应前端 `tool_execution_end`）
    ToolCallEnd {
        session_id: String,
        tool_call_id: String,
        result: serde_json::Value,
        success: bool,
    },
    /// 错误（对应前端 `error`）
    Error {
        session_id: String,
        message: String,
    },
    /// Deep Mode 阶段切换（对应前端 `deep_phase_changed`）
    ///
    /// 由 `OrchestratorEvent::DeepPhaseChanged` 转换而来。
    /// 前端监听此事件，更新 `deepSegments` 状态以激活 Deep Mode UI。
    ///
    /// # 字段说明
    /// - `session_id`：由 Tauri 端注入（OrchestratorEvent 不携带）
    /// - `phase_index`：-1 表示"其他操作"（未匹配任何阶段）
    DeepPhaseChanged {
        session_id: String,
        phase_label: String,
        phase_index: i8,
        trigger_tool: String,
    },
    /// A2UI 事件（P2 新增，对应前端 `a2ui`）
    ///
    /// 由 `AgentEvent::A2UI` 或 `OrchestratorEvent::A2UIEvent` 转换而来。
    /// 携带目标画布 ID 与 A2UI 消息载荷。
    /// 前端监听此事件，更新 `a2uiSurfaces` 状态，由 `A2UIRenderer.vue` 渲染。
    ///
    /// # 字段说明
    /// - `session_id`：由 Tauri 端注入
    /// - `surface_id`：目标画布 ID（与 message 内的 surface_id 一致，便于前端快速路由）
    /// - `message`：A2UI 消息（含 createSurface / updateComponents / updateDataModel / deleteSurface 变体）
    A2UI {
        session_id: String,
        surface_id: String,
        message: A2UIMessage,
    },
    /// 消息块追加（P2 新增，对应前端 `block_append`）
    ///
    /// 由 AgentLoop 在工具调用产生结构化消息块时触发，
    /// 携带目标消息 ID 与消息块数据。
    /// 前端监听此事件，将 block 追加到对应消息的 blocks 列表。
    ///
    /// # 字段说明
    /// - `session_id`：由 Tauri 端注入
    /// - `message_id`：目标消息 ID
    /// - `block`：消息块数据（TableBlock / ChoiceBlock / EntityCardBlock 等）
    BlockAppend {
        session_id: String,
        message_id: String,
        block: serde_json::Value,
    },
}

// ─── 转换实现 ────────────────────────────────────────────

impl AgentEventPayload {
    /// 从 `OrchestratorEvent` 转换为前端 Payload
    ///
    /// 只处理 `OrchestratorEvent::Agent(_)` 变体，其他编排层事件返回 `None`
    /// （阶段 1.5 的 AgentLoop 只产生基础 Agent 事件）。
    ///
    /// # 参数
    /// - `event`: agent_runtime 的事件
    /// - `session_id`: 当前会话 ID（Rust AgentEvent 不携带 session_id，需外部注入）
    /// - `message_id`: 当前消息 ID（用于 StreamDelta/StreamEnd 关联）
    pub fn from_orchestrator_event(
        event: &OrchestratorEvent,
        session_id: &str,
        message_id: &str,
    ) -> Option<Self> {
        match event {
            OrchestratorEvent::Agent(agent_event) => {
                Self::from_agent_event(agent_event, session_id, message_id)
            }
            // P2 新增：Deep Mode 阶段切换事件转发
            OrchestratorEvent::DeepPhaseChanged {
                phase_label,
                phase_index,
                trigger_tool,
                ..
            } => Some(Self::DeepPhaseChanged {
                session_id: session_id.to_string(),
                phase_label: phase_label.clone(),
                phase_index: *phase_index,
                trigger_tool: trigger_tool.clone(),
            }),
            // P2 新增：A2UI 事件转发（编排层广播）
            OrchestratorEvent::A2UIEvent {
                surface_id,
                message,
                ..
            } => Some(Self::A2UI {
                session_id: session_id.to_string(),
                surface_id: surface_id.clone(),
                message: message.clone(),
            }),
            // 其他编排层扩展事件暂不转发
            _ => None,
        }
    }

    /// 从 `AgentEvent` 转换为前端 Payload
    pub fn from_agent_event(
        event: &AgentEvent,
        session_id: &str,
        message_id: &str,
    ) -> Option<Self> {
        Some(match event {
            AgentEvent::AgentStart { model } => Self::AgentStart {
                session_id: session_id.to_string(),
                model: Some(model.clone()),
            },

            AgentEvent::UserMessage { .. } => {
                // UserMessage 不需要推送给前端（前端自己发出的）
                return None;
            }

            AgentEvent::StreamStart { model } => Self::StreamStart {
                session_id: session_id.to_string(),
                message_id: message_id.to_string(),
                model: Some(model.clone()),
            },

            AgentEvent::StreamDelta { delta } => Self::StreamDelta {
                message_id: message_id.to_string(),
                delta: delta.clone(),
            },

            AgentEvent::StreamEnd { full_text } => Self::StreamEnd {
                session_id: session_id.to_string(),
                message_id: message_id.to_string(),
                full_text: full_text.clone(),
                usage: None, // 阶段 1.5 暂不传 usage（GenaiBackend 未捕获）
            },

            AgentEvent::ToolCallStart {
                tool_call_id,
                name,
                args,
            } => Self::ToolCallStart {
                session_id: session_id.to_string(),
                tool_call: ToolCallInfo {
                    id: tool_call_id.clone(),
                    name: name.clone(),
                    args: args.clone(),
                },
            },

            AgentEvent::ToolCallEnd {
                tool_call_id,
                result,
            } => {
                // 判断成功/失败：result 中含 "error" 字段视为失败
                let success = !result
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| !s.is_empty())
                    .unwrap_or(false);

                Self::ToolCallEnd {
                    session_id: session_id.to_string(),
                    tool_call_id: tool_call_id.clone(),
                    result: result.clone(),
                    success,
                }
            }

            AgentEvent::Error { message } => Self::Error {
                session_id: session_id.to_string(),
                message: message.clone(),
            },

            AgentEvent::AgentEnd => Self::AgentEnd {
                session_id: session_id.to_string(),
            },

            // P2 新增：A2UI 事件（基础 Agent 层）
            AgentEvent::A2UI {
                surface_id,
                message,
            } => Self::A2UI {
                session_id: session_id.to_string(),
                surface_id: surface_id.clone(),
                message: message.clone(),
            },
        })
    }

    /// 生成一个新的 message_id（格式：`msg_{uuid}`）
    #[allow(dead_code)]
    pub fn new_message_id() -> String {
        format!("msg_{}", Uuid::new_v4().simple())
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_delta_should_serialize_to_snake_case_type() {
        let payload = AgentEventPayload::StreamDelta {
            message_id: "msg_1".into(),
            delta: "你好".into(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        // tag = "type", rename_all = "snake_case" for variant
        assert!(json.contains("\"type\":\"stream_delta\""));
        // 字段 camelCase
        assert!(json.contains("\"messageId\":\"msg_1\""));
        assert!(json.contains("\"delta\":\"你好\""));
    }

    #[test]
    fn tool_call_start_should_serialize_tool_call_camel_case() {
        let payload = AgentEventPayload::ToolCallStart {
            session_id: "sess_1".into(),
            tool_call: ToolCallInfo {
                id: "call_1".into(),
                name: "read_file".into(),
                args: serde_json::json!({"path": "/tmp/test.txt"}),
            },
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"tool_call_start\""));
        assert!(json.contains("\"toolCall\":{"));
        assert!(json.contains("\"id\":\"call_1\""));
    }

    #[test]
    fn tool_call_end_with_error_field_should_be_unsuccessful() {
        let payload = AgentEventPayload::from_agent_event(
            &AgentEvent::ToolCallEnd {
                tool_call_id: "call_1".into(),
                result: serde_json::json!({"error": "文件不存在"}),
            },
            "sess_1",
            "msg_1",
        )
        .unwrap();

        match payload {
            AgentEventPayload::ToolCallEnd { success, .. } => {
                assert!(!success, "含 error 字段应判定为失败");
            }
            _ => panic!("应转换为 ToolCallEnd"),
        }
    }

    #[test]
    fn tool_call_end_without_error_should_be_successful() {
        let payload = AgentEventPayload::from_agent_event(
            &AgentEvent::ToolCallEnd {
                tool_call_id: "call_1".into(),
                result: serde_json::json!({"content": "文件内容"}),
            },
            "sess_1",
            "msg_1",
        )
        .unwrap();

        match payload {
            AgentEventPayload::ToolCallEnd { success, .. } => {
                assert!(success, "无 error 字段应判定为成功");
            }
            _ => panic!("应转换为 ToolCallEnd"),
        }
    }

    #[test]
    fn user_message_should_return_none() {
        let payload = AgentEventPayload::from_agent_event(
            &AgentEvent::UserMessage {
                content: "hello".into(),
                images: Vec::new(),
            },
            "sess_1",
            "msg_1",
        );
        assert!(payload.is_none(), "UserMessage 不应推送给前端");
    }

    #[test]
    fn a2ui_payload_should_serialize_with_camel_case() {
        use agent_runtime::a2ui::A2UIMessage;
        let msg = A2UIMessage::create_surface("surf_1", "https://example.com/catalog");
        let payload = AgentEventPayload::A2UI {
            session_id: "sess_1".into(),
            surface_id: "surf_1".into(),
            message: msg,
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("\"type\":\"a2ui\""));
        assert!(json.contains("\"sessionId\":\"sess_1\""));
        assert!(json.contains("\"surfaceId\":\"surf_1\""));
        assert!(json.contains("\"createSurface\":{"));
    }

    #[test]
    fn a2ui_event_from_agent_event_should_convert() {
        use agent_runtime::a2ui::A2UIMessage;
        let event = AgentEvent::A2UI {
            surface_id: "surf_2".into(),
            message: A2UIMessage::delete_surface("surf_2"),
        };
        let payload =
            AgentEventPayload::from_agent_event(&event, "sess_1", "msg_1").unwrap();
        match payload {
            AgentEventPayload::A2UI {
                surface_id,
                message,
                ..
            } => {
                assert_eq!(surface_id, "surf_2");
                assert!(message.delete_surface.is_some());
            }
            _ => panic!("应转换为 A2UI payload"),
        }
    }
}
