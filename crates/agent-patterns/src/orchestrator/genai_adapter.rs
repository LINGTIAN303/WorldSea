//! M5 通信层：agent-kernel Backend → orchestrator LlmHandle 适配器（设计 §8）
//!
//! 分层验收标准（设计 8.4）：**换 Provider 上层零改动**——上层节点只认
//! `LlmHandle`；kernel 的 GenaiBackend（Provider 矩阵/工具 schema/流式归一/降级）
//! 全部留在 kernel 侧，本适配器只做「一次 LLM 调用」的形态转换。
//!
//! 边界说明：kernel `Backend::prompt` 的工具调用协议（PromptResponse.tool_calls）
//! 属 Tool Use 循环的职责面——本适配器 M5 面只映射 `complete`（单轮补全）；
//! propose_tool_call / react_step 维持默认 Fatal（其节点面在 M2 已由骨架节点自持）。

use std::sync::Arc;


use crate::orchestrator::error::LlmError;
use crate::orchestrator::handles::{LlmHandle, Request, Response};
use crate::orchestrator::types::Usage;

/// kernel Backend 的 LlmHandle 适配器（设计 §8.5 `GenaiAdapter` 的落点）。
///
/// `Backend` 为 agent-kernel 的 LLM 通信契约（Provider 差异/流式/重试/降级/计量
/// 全在其后），本结构对其只做「请求/响应形态转换 + 用量口径统一」。
pub struct KernelBackendLlm {
    backend: Arc<dyn agent_kernel::backend::NodeBackendAccessor>,
}

impl KernelBackendLlm {
    pub fn new(backend: Arc<dyn agent_kernel::backend::NodeBackendAccessor>) -> Self {
        Self { backend }
    }
}

#[async_trait::async_trait]
impl LlmHandle for KernelBackendLlm {
    /// 单轮补全：system+user 拼接为 kernel prompt（kernel 的 system 槽位在
    /// PromptCallOptions，M5 面以文本拼接最简透传；系统槽位精确映射随
    /// PromptCallOptions 对接扩展）
    async fn complete(&self, req: &Request) -> Result<Response, LlmError> {
        let prompt = if req.system.is_empty() {
            req.user.clone()
        } else {
            format!("{}\n\n{}", req.system, req.user)
        };
        let resp = self
            .backend
            .prompt(prompt, None)
            .await
            .map_err(|e| LlmError::Fatal(format!("kernel backend 错误：{e}")))?;
        Ok(Response {
            text: resp.text,
            usage: Usage {
                input_tokens: resp.input_tokens.unwrap_or(0) as u64,
                output_tokens: resp.output_tokens.unwrap_or(0) as u64,
                llm_calls: 1,
            },
        })
    }
}
