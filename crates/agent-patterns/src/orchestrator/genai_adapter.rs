//! M5 通信层：agent-kernel Backend → orchestrator LlmHandle 适配器（设计 §8）
//!
//! 分层验收标准（设计 8.4）：**换 Provider 上层零改动**——上层节点只认
//! `LlmHandle`；kernel 的 GenaiBackend（Provider 矩阵/工具 schema/流式归一/降级）
//! 全部留在 kernel 侧，本适配器只做「一次 LLM 调用」的形态转换。
//!
//! 工具面说明（2026-09-02 步骤工具化）：`complete` 单轮补全与 `decide` 强制决策
//! 之外，`react_step` 走真实工具循环——把工具定义集（ToolSpecSet）翻译成 kernel
//! `ToolDefinition` 列表传入 `PromptCallOptions.tools`（不强制 tool_choice），
//! 模型可自由「调工具」或「直接给出最终答案」，适配器据 `tool_calls` 归一为
//! `ReactStep`（行动 / 最终答案二择一）。

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
            .prompt(
                prompt,
                Some(agent_kernel::backend::PromptCallOptions {
                    // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
                    purpose: Some("orchestrator_complete".into()),
                    ..Default::default()
                }),
            )
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

    /// 结构化决策调用：携带决策工具 + 强制 tool_choice，取 tool_call 参数返回。
    /// silent=true（决策不泄漏为对话流正文段）；参数经 genai 捕获已解析为 Value。
    async fn decide(
        &self,
        req: &Request,
        tool: agent_kernel::tool::ToolDefinition,
    ) -> Result<serde_json::Value, LlmError> {
        let prompt = if req.system.is_empty() {
            req.user.clone()
        } else {
            format!("{}\n\n{}", req.system, req.user)
        };
        let resp = self
            .backend
            .prompt(
                prompt,
                Some(agent_kernel::backend::PromptCallOptions {
                    tools: vec![tool.clone()],
                    force_tool: Some(tool.name.clone()),
                    silent: true,
                    temperature: req.temperature,
                    max_tokens: req.max_tokens,
                    // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
                    purpose: Some("orchestrator_decide".into()),
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| LlmError::Fatal(format!("kernel backend 决策调用错误：{e}")))?;
        let tc = resp
            .tool_calls
            .into_iter()
            .next()
            .ok_or_else(|| LlmError::Fatal("强制决策工具调用未返回 tool_call".into()))?;
        Ok(tc.args)
    }

    /// 真实工具循环单步（2026-09-02 步骤工具化）：携带轨迹 + 工具集请求下一步
    ///
    /// - 工具定义：ToolSpecSet → 翻译为 kernel ToolDefinition 列表（tools 非空才传参）
    /// - 模型决策：可发起工具调用（→ `ReactStep.action`），或给出最终答案
    ///   （→ `ReactStep.final_answer`）；两者皆无为异常步（调用方按 Fatal 处理）
    /// - 思想：模型若给出正文即作为本轮思考（写入轨迹供推理链复盘）
    async fn react_step(
        &self,
        trace: &[crate::orchestrator::tools::TraceEntry],
        tools: &crate::orchestrator::tools::ToolSpecSet,
    ) -> Result<crate::orchestrator::tools::ReactStep, LlmError> {
        use std::fmt::Write as _;

        // 组装轨迹回顾文本（Thought / ActObs 逐条，附序号便于模型对齐上下文）
        let mut trace_text = String::new();
        for (i, entry) in trace.iter().enumerate() {
            match entry {
                crate::orchestrator::tools::TraceEntry::Thought { text } => {
                    let _ = writeln!(trace_text, "[{i}] 思考：{text}");
                }
                crate::orchestrator::tools::TraceEntry::ActObs { call, observation } => {
                    let _ = writeln!(
                        trace_text,
                        "[{i}] 行动：{}({}) → {}",
                        call.name,
                        call.arguments,
                        observation.content
                    );
                }
            }
        }
        let user = if trace_text.trim().is_empty() {
            "你是任务的执行者，需要真实完成当前目标。规则：\n1. 若目标需要任何实际信息（读文件、查目录、执行命令、检索等），必须先调用相应工具获取，禁止凭空编造。\n2. 只有在已掌握足够信息、可直接给出结论时，才不调用工具直接输出最终答案。\n\n请完成当前目标。".to_string()
        } else {
            format!("你是任务的执行者，需要真实完成当前目标。规则：\n1. 若仍需更多信息（读文件、查目录、执行命令、检索等），必须先调用工具，禁止凭空编造。\n2. 若轨迹已包含足够信息可直接得出结论，则直接输出最终答案。\n\n以上是此前推理轨迹：\n{trace_text}\n\n请继续推进当前目标。")
        };
        let tool_defs: Vec<agent_kernel::tool::ToolDefinition> = tools
            .specs
            .iter()
            .map(|s| agent_kernel::tool::ToolDefinition {
                name: s.name.clone(),
                description: s.description.clone(),
                parameters: s.parameters.clone(),
            })
            .collect();
        let resp = self
            .backend
            .prompt(
                user,
                Some(agent_kernel::backend::PromptCallOptions {
                    tools: tool_defs.clone(),
                    silent: true,
                    // 阶段 3 · ④ 扩展：旁路入账标签（D13 旁路全收）
                    purpose: Some("orchestrator_react_step".into()),
                    ..Default::default()
                }),
            )
            .await
            .map_err(|e| LlmError::Fatal(format!("kernel backend react_step 调用错误：{e}")))?;
        let usage = Usage {
            input_tokens: resp.input_tokens.unwrap_or(0) as u64,
            output_tokens: resp.output_tokens.unwrap_or(0) as u64,
            llm_calls: 1,
        };
        // 模型决策归一：优先行动（工具调用），否则正文即最终答案
        if let Some(tc) = resp.tool_calls.into_iter().next() {
            Ok(crate::orchestrator::tools::ReactStep {
                thought: if resp.text.trim().is_empty() { None } else { Some(resp.text) },
                action: Some(crate::orchestrator::tools::ToolCall::new(
                    tc.id,
                    tc.name,
                    tc.args,
                )),
                final_answer: None,
                usage,
            })
        } else {
            Ok(crate::orchestrator::tools::ReactStep {
                thought: None,
                action: None,
                final_answer: Some(resp.text),
                usage,
            })
        }
    }
}
