//! # Stream — stream_simple 与 get_model 函数
//!
//! 对应 TS 版 `pi-ai` 的核心导出函数：
//! - `streamSimple(config, messages, options)` → 异步推流 [`StreamEvent`]
//! - `getModel(config)` → [`ModelInfo`]
//!
//! ## 设计差异
//! TS 版用 `AsyncIterable<StreamEvent>`，Rust 版用 `tokio::sync::mpsc::Receiver<StreamEvent>`。
//! 调用方通过 `while let Some(event) = receiver.recv().await { ... }` 消费事件。
//!
//! ## 事件映射
//! | genai 事件             | StreamEvent              |
//! |-----------------------|--------------------------|
//! | `Start`               | `StreamStart`            |
//! | `Chunk(text)`         | `Delta`                  |
//! | `ReasoningChunk(text)`| `ReasoningDelta`         |
//! | `ToolCallChunk(...)`  | `ToolCallDelta`（聚合）   |
//! | `End(usage)`          | `Usage` + `StreamEnd`    |

use std::collections::HashMap;

use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatStreamEvent, MessageContent, ToolCall, ToolResponse};
use genai::Client;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use super::config::ProviderConfig;
use super::error::LlmError;
use super::manifest::find_manifest;
use super::model::{ModelInfo, ModelInput};
use crate::backend::PromptCallOptions;
use crate::types::{MessageRole, OrchestratorMessage};

/// 流式事件 — 对应 TS 版 `StreamEvent` 的 12 种事件
#[derive(Debug, Clone)]
pub enum StreamEvent {
    /// 流开始
    StreamStart { model: String },
    /// 文本增量
    Delta { text: String },
    /// 思考（reasoning）增量
    ReasoningDelta { text: String },
    /// 工具调用开始
    ToolCallStart {
        tool_call_id: String,
        name: String,
    },
    /// 工具调用参数增量
    ToolCallDelta {
        tool_call_id: String,
        args_delta: String,
    },
    /// 工具调用结束
    ToolCallEnd {
        tool_call_id: String,
        args: serde_json::Value,
    },
    /// 工具调用聚合完成（流结束时一次性推送所有工具调用，供 AgentLoop 消费）
    ///
    /// 与 ToolCallStart/Delta/End 的区别：
    /// - `ToolCallStart/Delta/End`：流式过程中按 call_id 推送增量事件（用于 UI 实时展示）
    /// - `ToolCallsAggregated`：流结束后一次性推送完整工具调用列表（用于 AgentLoop 执行）
    ToolCallsAggregated {
        tool_calls: Vec<crate::types::ToolCall>,
    },
    /// 流结束（最终文本）
    StreamEnd { full_text: String },
    /// 用量统计
    Usage {
        input_tokens: u32,
        output_tokens: u32,
        reasoning_tokens: Option<u32>,
    },
    /// 停止原因
    Stop { reason: String },
    /// 错误
    Error { message: String },
    /// 调用被中止
    Aborted,
    /// 流完全结束（与 StreamEnd 区分：Complete 在 Usage/Stop 之后发送）
    Complete,
}

/// stream_simple — 对应 TS 版 `streamSimple`
///
/// # 参数
/// - `config`：Provider 配置
/// - `messages`：消息历史
/// - `options`：调用选项
///
/// # 返回
/// `mpsc::Receiver<StreamEvent>` — 调用方异步消费事件
///
/// # 错误处理
/// 内部错误通过 `StreamEvent::Error` 推送，随后推送 `StreamEvent::Complete` 关闭流。
pub fn stream_simple(
    config: ProviderConfig,
    messages: Vec<OrchestratorMessage>,
    options: PromptCallOptions,
) -> mpsc::Receiver<StreamEvent> {
    let (tx, rx) = mpsc::channel(64);

    tokio::spawn(async move {
        let result = run_stream(config, messages, options, tx.clone()).await;
        if let Err(e) = result {
            warn!("stream_simple 内部错误: {e}");
            let _ = tx.send(StreamEvent::Error { message: e.to_string() }).await;
        }
        // 最终发送 Complete 事件，通知消费者流结束
        let _ = tx.send(StreamEvent::Complete).await;
    });

    rx
}

/// 内部流式执行逻辑
async fn run_stream(
    config: ProviderConfig,
    messages: Vec<OrchestratorMessage>,
    options: PromptCallOptions,
    tx: mpsc::Sender<StreamEvent>,
) -> Result<(), LlmError> {
    // 1. 校验 API Key
    if !matches!(config, ProviderConfig::Local { .. }) {
        let api_key = config.api_key();
        if api_key.is_empty() {
            return Err(LlmError::MissingApiKey(config.provider_id().to_string()));
        }
    }

    // 2. 解析 ServiceTarget
    let provider_id = config.provider_id().to_string();
    let model_id = config.model_id().to_string();
    let service_target = if matches!(config, ProviderConfig::Cloud { .. }) {
        if find_manifest(&provider_id).is_none() {
            return Err(LlmError::ProviderNotFound(provider_id.clone()));
        }
        format!("{provider_id}::{model_id}")
    } else {
        format!("{provider_id}::{model_id}")
    };

    // 3. 构建 ChatRequest + ChatOptions
    let (chat_req, chat_opts) = build_chat_request(&messages, &options)?;

    // 4. 推送 StreamStart
    let _ = tx
        .send(StreamEvent::StreamStart {
            model: model_id.clone(),
        })
        .await;

    // 5. 执行流式调用
    use futures_util::StreamExt;
    let client = Client::default();
    // exec_chat_stream 第三参数为 Option<&ChatOptions>
    let stream_resp = client
        .exec_chat_stream(&service_target, chat_req, Some(&chat_opts))
        .await
        .map_err(LlmError::from)?;
    let mut stream = stream_resp.stream;

    let mut full_text = String::new();
    let mut reasoning_text = String::new();
    let mut final_usage: Option<genai::chat::Usage> = None;
    let mut final_stop_reason: Option<genai::chat::StopReason> = None;
    // 工具调用聚合状态机：call_id -> ToolCall
    // genai 0.7 的 ToolCallChunk 每次携带一个完整 ToolCall（非增量），
    // 但同一个 call_id 可能多次出现（不同字段分批到达），故用 HashMap 去重合并。
    let mut pending_tool_calls: HashMap<String, ToolCall> = HashMap::new();

    while let Some(event_result) = stream.next().await {
        let event = event_result.map_err(LlmError::from)?;
        match event {
            ChatStreamEvent::Start => {
                debug!("stream_simple: genai Start");
            }
            ChatStreamEvent::Chunk(chunk) => {
                // genai 0.7 StreamChunk.content 直接是 String
                let text = chunk.content;
                full_text.push_str(&text);
                let _ = tx
                    .send(StreamEvent::Delta {
                        text: text.clone(),
                    })
                    .await;
            }
            ChatStreamEvent::ReasoningChunk(chunk) => {
                let text = chunk.content;
                reasoning_text.push_str(&text);
                let _ = tx
                    .send(StreamEvent::ReasoningDelta {
                        text: text.clone(),
                    })
                    .await;
            }
            ChatStreamEvent::ThoughtSignatureChunk(_) => {
                // 暂不处理
            }
            ChatStreamEvent::ToolCallChunk(tool_chunk) => {
                // genai 0.7 ToolChunk { tool_call: ToolCall }
                // ToolCall 含 call_id / fn_name / fn_arguments / thought_signatures
                // 每次到达的 ToolCall 通常是完整的（非增量），但保险起见用 HashMap 合并
                let tc = tool_chunk.tool_call;
                let call_id = tc.call_id.clone();
                let is_new = !pending_tool_calls.contains_key(&call_id);
                if is_new {
                    // 首次见到该 call_id：推送 ToolCallStart
                    let _ = tx
                        .send(StreamEvent::ToolCallStart {
                            tool_call_id: call_id.clone(),
                            name: tc.fn_name.clone(),
                        })
                        .await;
                } else {
                    // 后续 chunk：推送 ToolCallDelta（保留事件类型，便于未来支持增量 Provider）
                    let _ = tx
                        .send(StreamEvent::ToolCallDelta {
                            tool_call_id: call_id.clone(),
                            args_delta: String::new(),
                        })
                        .await;
                }
                // 覆盖式更新（后到的 chunk 字段更完整）
                pending_tool_calls.insert(call_id, tc);
            }
            ChatStreamEvent::End(end) => {
                // 先通过 captured_tool_calls(&self) 获取权威工具调用列表（不消费 end）
                // 优先使用 StreamEnd 的 captured_content，回退到循环中累积的 pending_tool_calls
                let final_tool_calls: Vec<ToolCall> = end
                    .captured_tool_calls()
                    .map(|v| v.into_iter().cloned().collect())
                    .unwrap_or_else(|| pending_tool_calls.values().cloned().collect());

                // 推送 ToolCallEnd 事件（携带完整 args）
                for tc in &final_tool_calls {
                    let _ = tx
                        .send(StreamEvent::ToolCallEnd {
                            tool_call_id: tc.call_id.clone(),
                            args: tc.fn_arguments.clone(),
                        })
                        .await;
                }

                // 推送 ToolCallsAggregated 事件（供 AgentLoop 一次性消费）
                if !final_tool_calls.is_empty() {
                    let aggregated: Vec<crate::types::ToolCall> = final_tool_calls
                        .iter()
                        .map(|tc| crate::types::ToolCall {
                            id: tc.call_id.clone(),
                            name: tc.fn_name.clone(),
                            args: tc.fn_arguments.clone(),
                        })
                        .collect();
                    let _ = tx
                        .send(StreamEvent::ToolCallsAggregated {
                            tool_calls: aggregated,
                        })
                        .await;
                }

                // 再 clone 出 captured_usage 和 captured_stop_reason，
                // 最后调用 captured_into_first_text()（后者会消费 end）
                let captured_usage = end.captured_usage.clone();
                let captured_stop_reason = end.captured_stop_reason.clone();
                if let Some(captured) = end.captured_into_first_text() {
                    if full_text.is_empty() {
                        full_text = captured;
                    }
                }
                final_usage = captured_usage;
                final_stop_reason = captured_stop_reason;
                debug!(
                    "stream_simple: genai End, stop_reason={:?}, usage={:?}, tool_calls={}",
                    final_stop_reason,
                    final_usage,
                    final_tool_calls.len()
                );
            }
        }
    }

    // 6. 推送 Usage 事件
    if let Some(usage) = final_usage {
        // genai 0.7 Usage 字段：prompt_tokens / completion_tokens / completion_tokens_details.reasoning_tokens
        let reasoning_tokens = usage
            .completion_tokens_details
            .as_ref()
            .and_then(|d| d.reasoning_tokens);
        let _ = tx
            .send(StreamEvent::Usage {
                input_tokens: usage.prompt_tokens.unwrap_or(0) as u32,
                output_tokens: usage.completion_tokens.unwrap_or(0) as u32,
                reasoning_tokens: reasoning_tokens.map(|v| v as u32),
            })
            .await;
    }

    // 7. 推送 Stop 事件
    if let Some(reason) = final_stop_reason {
        // genai 0.7 StopReason 变体：Completed/MaxTokens/ToolCall/ContentFilter/StopSequence/Other
        // 每个变体都带 String 参数
        let reason_str = match reason {
            genai::chat::StopReason::Completed(_) => "end_turn",
            genai::chat::StopReason::ToolCall(_) => "tool_calls",
            genai::chat::StopReason::MaxTokens(_) => "max_tokens",
            genai::chat::StopReason::StopSequence(_) => "stop_sequence",
            genai::chat::StopReason::ContentFilter(_) => "content_filter",
            genai::chat::StopReason::Other(_) => "other",
        };
        let _ = tx.send(StreamEvent::Stop { reason: reason_str.to_string() }).await;
    }

    // 8. 推送 StreamEnd
    let _ = tx.send(StreamEvent::StreamEnd { full_text }).await;

    Ok(())
}

/// 构建 genai ChatRequest + ChatOptions
///
/// genai 0.7.0-beta.14 中 ChatOptions 不挂在 ChatRequest 上，
/// 而是作为 `Client::exec_chat_stream` 的第三参数 `Option<&ChatOptions>` 传入。
fn build_chat_request(
    messages: &[OrchestratorMessage],
    options: &PromptCallOptions,
) -> Result<(ChatRequest, ChatOptions), LlmError> {
    let mut chat_messages: Vec<ChatMessage> = Vec::with_capacity(messages.len() + 1);

    // 系统提示词优先级
    if let Some(sys_override) = &options.system_prompt_override {
        chat_messages.push(ChatMessage::system(sys_override));
    }

    for msg in messages {
        if matches!(msg.role, MessageRole::System) && options.system_prompt_override.is_some() {
            continue;
        }
        chat_messages.push(to_genai_message(msg)?);
    }

    // ChatRequest::new(messages) 是 genai 0.7 的构造函数
    let req = ChatRequest::new(chat_messages);

    let mut chat_opts = ChatOptions::default();
    if let Some(temp) = options.temperature {
        chat_opts = chat_opts.with_temperature(temp.into());
    }
    if let Some(max_tokens) = options.max_tokens {
        chat_opts = chat_opts.with_max_tokens(max_tokens as u32);
    }
    // with_capture_* 是 builder 方法
    chat_opts = chat_opts.with_capture_content(true).with_capture_usage(true);

    Ok((req, chat_opts))
}

/// OrchestratorMessage → genai ChatMessage
fn to_genai_message(msg: &OrchestratorMessage) -> Result<ChatMessage, LlmError> {
    match msg.role {
        MessageRole::System => Ok(ChatMessage::system(&msg.content)),
        MessageRole::User => Ok(ChatMessage::user(&msg.content)),
        MessageRole::Assistant => {
            if !msg.tool_calls.is_empty() {
                debug!(
                    "assistant 消息含 {} 个工具调用，stream_simple 仅取 content",
                    msg.tool_calls.len()
                );
            }
            Ok(ChatMessage::assistant(&msg.content))
        }
        MessageRole::ToolResult => {
            // genai 0.7：ChatMessage::tool(impl Into<MessageContent>) + ToolResponse::new(call_id, content)
            let tool_call_id = msg.tool_call_id.clone().unwrap_or_default();
            let tool_resp = ToolResponse::new(tool_call_id, msg.content.clone());
            Ok(ChatMessage::tool(MessageContent::from(tool_resp)))
        }
    }
}

// ─── get_model ────────────────────────────────────────────

/// get_model — 对应 TS 版 `getModel`
///
/// 根据 ProviderConfig 构建 ModelInfo，集成 manifest 的视觉/思考检测能力。
pub fn get_model(config: &ProviderConfig) -> Result<ModelInfo, LlmError> {
    let provider_id = config.provider_id();
    let model_id = config.model_id();
    let api_type = config.infer_api_type();
    let base_url = config.resolve_base_url();

    match config {
        ProviderConfig::Cloud { .. } => {
            // 查找 manifest
            let manifest = find_manifest(provider_id)
                .ok_or_else(|| LlmError::ProviderNotFound(provider_id.to_string()))?;

            // 检测视觉/思考能力
            let reasoning = manifest.supports_thinking(model_id);
            let vision = manifest.supports_vision(model_id);

            // 推断上下文窗口与最大 token
            // 默认值：国内供应商较大，国外较小
            let (context_window, max_tokens) = default_window_for_provider(provider_id, model_id);

            // 输入模态
            let input = if vision {
                vec![ModelInput::Text, ModelInput::Image]
            } else {
                vec![ModelInput::Text]
            };

            // 成本（占位，实际需要从配置表读取）
            let cost = default_cost_for_provider(provider_id);

            Ok(ModelInfo {
                id: model_id.to_string(),
                name: format!("{} {}", manifest.label, model_id),
                api: api_type,
                provider: provider_id.to_string(),
                base_url,
                reasoning,
                input,
                cost,
                context_window,
                max_tokens,
                headers: None,
            })
        }
        ProviderConfig::Local { .. } => {
            // 本地推理：使用默认配置
            Ok(ModelInfo::build_custom(
                provider_id,
                model_id,
                &base_url,
                api_type,
                8_192,    // 本地默认 8K 上下文
                2_048,    // 本地默认 2K 输出
            ))
        }
        ProviderConfig::Custom {
            context_window,
            max_tokens,
            ..
        } => Ok(ModelInfo::build_custom(
            provider_id,
            model_id,
            &base_url,
            api_type,
            *context_window,
            *max_tokens,
        )),
    }
}

/// 默认上下文窗口与最大 token（按 Provider 推断）
fn default_window_for_provider(provider_id: &str, model_id: &str) -> (u32, u32) {
    // 检测是否为长上下文模型
    if model_id.contains("256k") || model_id.contains("1m") {
        return (256_000, 8_192);
    }

    match provider_id {
        // 国内供应商
        "deepseek" => (128_000, 8_192),
        "qwen" => (131_072, 8_192),
        "kimi" => (1_048_576, 8_192),
        "doubao" => (128_000, 4_096),
        "zhipu" => (128_000, 4_096),
        "minimax" => (1_048_576, 4_096),
        "stepfun" => (8_192, 4_096),
        "sensenova" => (8_192, 4_096),
        // 国外供应商
        "openai" => (200_000, 16_384),
        "anthropic" => (200_000, 8_192),
        "google" => (1_048_576, 8_192),
        "groq" => (131_072, 8_192),
        "openrouter" => (200_000, 8_192),
        "xai" => (131_072, 8_192),
        "mistral" => (131_072, 8_192),
        _ => (32_768, 4_096),
    }
}

/// 默认成本（占位值，实际应从配置表读取）
fn default_cost_for_provider(provider_id: &str) -> super::model::ModelCost {
    use super::model::ModelCost;
    match provider_id {
        "openai" => ModelCost {
            input: 2.5,
            output: 10.0,
            cache_read: 1.25,
            cache_write: 0.0,
        },
        "anthropic" => ModelCost {
            input: 3.0,
            output: 15.0,
            cache_read: 0.3,
            cache_write: 3.75,
        },
        "deepseek" => ModelCost {
            input: 0.27,
            output: 1.1,
            cache_read: 0.07,
            cache_write: 0.27,
        },
        _ => ModelCost::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::config::{CustomApiType, LocalApiType};
    use crate::llm::model::ApiType;

    #[test]
    fn get_model_cloud_deepseek() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "sk-test".to_string(),
        };
        let model = get_model(&config).unwrap();
        assert_eq!(model.id, "deepseek-v4-flash");
        assert_eq!(model.provider, "deepseek");
        assert_eq!(model.api, ApiType::OpenaiCompletions);
        assert!(!model.reasoning); // v4-flash 不支持思考
        assert!(!model.supports_vision());
        assert_eq!(model.context_window, 128_000);
    }

    #[test]
    fn get_model_cloud_deepseek_reasoner() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-reasoner".to_string(),
            api_key: "sk-test".to_string(),
        };
        let model = get_model(&config).unwrap();
        assert!(model.reasoning); // deepseek-reasoner 支持思考
    }

    #[test]
    fn get_model_cloud_zhipu_vision() {
        let config = ProviderConfig::Cloud {
            provider: "zhipu".to_string(),
            model_id: "glm-4v".to_string(),
            api_key: "sk-test".to_string(),
        };
        let model = get_model(&config).unwrap();
        assert!(model.supports_vision()); // glm-4v 支持视觉
        assert_eq!(model.input.len(), 2);
        assert!(model.input.contains(&ModelInput::Image));
    }

    #[test]
    fn get_model_cloud_unknown_provider_fails() {
        let config = ProviderConfig::Cloud {
            provider: "nonexistent".to_string(),
            model_id: "model-x".to_string(),
            api_key: "sk-test".to_string(),
        };
        let result = get_model(&config);
        assert!(result.is_err());
    }

    #[test]
    fn get_model_local_ollama() {
        let config = ProviderConfig::Local {
            endpoint: "http://localhost:11434".to_string(),
            api_type: LocalApiType::Ollama,
            model_id: "llama3".to_string(),
        };
        let model = get_model(&config).unwrap();
        assert_eq!(model.id, "llama3");
        assert_eq!(model.provider, "ollama");
        assert_eq!(model.api, ApiType::OpenaiCompletions);
        assert_eq!(model.context_window, 8_192);
        assert_eq!(model.max_tokens, 2_048);
    }

    #[test]
    fn get_model_custom() {
        let config = ProviderConfig::Custom {
            base_url: "https://api.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            api_type: CustomApiType::OpenaiCompatible,
            model_id: "custom-llm".to_string(),
            context_window: 256_000,
            max_tokens: 8_192,
        };
        let model = get_model(&config).unwrap();
        assert_eq!(model.id, "custom-llm");
        assert_eq!(model.context_window, 256_000);
        assert_eq!(model.max_tokens, 8_192);
        assert_eq!(model.api, ApiType::OpenaiCompletions);
    }

    #[test]
    fn default_window_for_long_context_model() {
        let (ctx, _) = default_window_for_provider("kimi", "kimi-k2.6-1m");
        assert_eq!(ctx, 256_000);
    }

    #[test]
    fn default_cost_for_known_providers() {
        let openai_cost = default_cost_for_provider("openai");
        assert!(openai_cost.output > openai_cost.input);

        let deepseek_cost = default_cost_for_provider("deepseek");
        assert!(deepseek_cost.input < openai_cost.input);
    }

    #[tokio::test]
    async fn stream_simple_returns_complete_event_on_api_key_missing() {
        let config = ProviderConfig::Cloud {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string(),
            api_key: "".to_string(), // 空 API Key
        };
        let mut rx = stream_simple(
            config,
            vec![],
            PromptCallOptions::default(),
        );

        // 应该收到 Error 事件，然后 Complete
        let mut got_error = false;
        let mut got_complete = false;
        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::Error { .. } => got_error = true,
                StreamEvent::Complete => {
                    got_complete = true;
                    break;
                }
                _ => {}
            }
        }
        assert!(got_error, "应该收到 Error 事件");
        assert!(got_complete, "应该收到 Complete 事件");
    }

    #[tokio::test]
    async fn stream_simple_unknown_provider_emits_error() {
        let config = ProviderConfig::Cloud {
            provider: "nonexistent".to_string(),
            model_id: "model-x".to_string(),
            api_key: "sk-test".to_string(),
        };
        let mut rx = stream_simple(
            config,
            vec![],
            PromptCallOptions::default(),
        );

        let mut got_error = false;
        while let Some(event) = rx.recv().await {
            if matches!(event, StreamEvent::Error { .. }) {
                got_error = true;
            }
            if matches!(event, StreamEvent::Complete) {
                break;
            }
        }
        assert!(got_error);
    }
}
