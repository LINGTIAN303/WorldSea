use crate::backend::PromptCallOptions;

use super::{AgentLoop, AgentLoopConfig};

impl AgentLoop {
    /// 构建 PromptCallOptions
    ///
    /// 阶段 1.4：从 `tool_bus.list_all()` 拉取工具定义并填入 `tools` 字段，
    /// 让 LLM 能看到完整工具列表（含 JSON Schema）以触发 tool_calls。
    ///
    /// 每轮循环都重新拉取，确保动态注册的工具（如 MCP 工具）能被 LLM 调用。
    ///
    /// 阶段 3（记忆闭环）：若 `run` 开头已计算记忆注入文本（`memory_context`），
    /// 则拼入 `system_prompt_override`（记忆位于系统提示之后）。
    pub(super) async fn build_prompt_options(&self, config: &AgentLoopConfig) -> PromptCallOptions {
        let tools = self.tool_bus.list_all().await;
        let memory_ctx = self
            .memory_context
            .read()
            .map(|g| g.clone())
            .unwrap_or(None);
        let system_prompt_override = match (config.system_prompt.clone(), memory_ctx) {
            (Some(base), Some(mem)) => Some(format!("{base}\n\n{mem}")),
            (base, mem) => base.or(mem),
        };
        PromptCallOptions {
            system_prompt_override,
            tools_override: None,
            tools,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            thinking_level: config.thinking_level,
            images: Vec::new(),
        }
    }
}
