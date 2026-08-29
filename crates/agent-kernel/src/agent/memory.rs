use std::sync::Arc;

use crate::backend::PromptCallOptions;
use crate::scenario::ScenarioContext;
use crate::tool::{ToolBus, WhitelistToolBus};

use super::{AgentLoop, AgentLoopConfig};

/// 系统基础工具（始终可用，不随场景裁剪）
///
/// 对应 `agent-commands` 注册的 terminal/subagent 工具名。世界构建场景启用时，
/// 白名单 = 本基础集 ∪ 场景 tool_ids，从而裁剪掉终端细节管理工具（shell_session_* 等）。
const SYSTEM_BASE_TOOLS: &[&str] = &[
    "execute_command",
    "delegate_to_sub_agent",
    "list_sub_agents",
    // A4 Plan-Exec：计划创建/状态推进/失败重规划（通用能力，任何场景可用）
    "plan_create",
    "plan_update",
    "plan_replan",
    // H3 Skills 点火（P1，2026-08-30）：技能元工具三件，跨场景通用（progressive disclosure）
    "load_skill",
    "load_skill_reference",
    "load_skill_asset",
];

/// 世界构建场景注入的实体类型（对应 WorldSmith 实体类型规范，见 typeMappingRegistry.ts）
///
/// 供 `entity_provider.entity_summary` 拉取项目核心实体的紧凑摘要，注入场景 system prompt。
const WORLDBUILD_CONTEXT_TYPES: &[&str] = &[
    "character",
    "region",
    "organization",
    "event",
    "concept",
    "species",
    "magic",
];

impl AgentLoop {
    /// B2 场景工具门控：返回「生效」的工具总线。
    ///
    /// 启用场景时，用 `WhitelistToolBus` 包装底层总线，白名单 = 系统基础工具 ∪ 场景 tool_ids。
    /// 使**可见性（list_all）与执行（call_tool）**都被裁剪——非白名单工具对 LLM 不可见、且执行返回
    /// `ToolError::NotFound` 被拦截（B2「只暴露当前场景工具 + 通用工具」）。无场景时返回原总线（向后兼容）。
    pub(super) fn effective_tool_bus(&self, config: &AgentLoopConfig) -> Arc<dyn ToolBus> {
        if let Some(scenario) = &config.scenario {
            let mut allowed: Vec<String> =
                SYSTEM_BASE_TOOLS.iter().map(|s| s.to_string()).collect();
            allowed.extend(scenario.tool_ids());
            Arc::new(WhitelistToolBus::new(self.tool_bus.clone(), allowed))
        } else {
            self.tool_bus.clone()
        }
    }

    /// 构建 PromptCallOptions
    ///
    /// 阶段 1.4：从 `tool_bus.list_all()` 拉取工具定义并填入 `tools` 字段，
    /// 让 LLM 能看到完整工具列表（含 JSON Schema）以触发 tool_calls。
    ///
    /// 每轮循环都重新拉取，确保动态注册的工具（如 MCP 工具）能被 LLM 调用。
    ///
    /// 阶段 3（记忆闭环）：若 `run` 开头已计算记忆注入文本（`memory_context`），
    /// 则拼入 `system_prompt_override`（记忆位于系统提示之后）。
    ///
    /// B1（多场景）：若配置了 `config.scenario`，用场景 `build_system_prompt` 作为
    /// system prompt 主体（身份 + 上下文），静态 `system_prompt` 与记忆文本依次追加。
    /// 无场景时保持原「静态 system_prompt + 记忆」逻辑（向后兼容）。
    pub(super) async fn build_prompt_options(&self, config: &AgentLoopConfig) -> PromptCallOptions {
        // B1/B2：启用场景时用 effective_tool_bus（WhitelistToolBus）过滤工具视图，
        // 白名单 = 系统基础工具 ∪ 场景 tool_ids，仅暴露场景工具 + 通用工具。
        let tools = self.effective_tool_bus(config).list_all().await;
        let memory_ctx = self
            .memory_context
            .read()
            .map(|g| g.clone())
            .unwrap_or(None);

        // B1：场景 prompt（身份/上下文）作为 system prompt 主体
        let scenario_prompt = if let Some(scenario) = &config.scenario {
            let query_text = self.last_user_text.read().ok().map(|g| g.clone());
            // 实体上下文注入：经 entity_provider 拉取项目实体摘要（空则 None，不阻断主流程）
            let entity_summary = if let Some(provider) = &config.entity_provider {
                let s = provider.entity_summary(&WORLDBUILD_CONTEXT_TYPES, 8).await;
                if s.trim().is_empty() {
                    None
                } else {
                    Some(s)
                }
            } else {
                None
            };
            Some(
                scenario
                    .build_system_prompt(&ScenarioContext::new(None, query_text, entity_summary))
                    .await,
            )
        } else {
            None
        };

        let system_prompt_override = match (
            scenario_prompt,
            config.system_prompt.clone(),
            memory_ctx,
        ) {
            (Some(scen), Some(static_p), Some(mem)) => {
                Some(format!("{scen}\n\n{static_p}\n\n{mem}"))
            }
            (Some(scen), Some(static_p), None) => Some(format!("{scen}\n\n{static_p}")),
            (Some(scen), None, Some(mem)) => Some(format!("{scen}\n\n{mem}")),
            (Some(scen), None, None) => Some(scen),
            (None, Some(base), Some(mem)) => Some(format!("{base}\n\n{mem}")),
            (None, base, mem) => base.or(mem),
        };

        // A3：追加管线路由指引（本轮经 RouterNode 决策的管线，指导 Agent 处理方式）
        let mut system_prompt_override = system_prompt_override;
        if let Ok(guard) = self.pipeline_context.read() {
            if let Some(pipeline_ctx) = guard.as_ref() {
                system_prompt_override = Some(match system_prompt_override {
                    Some(s) => format!("{s}\n\n{pipeline_ctx}"),
                    None => pipeline_ctx.clone(),
                });
            }
        }

        PromptCallOptions {
            system_prompt_override,
            tools_override: None,
            tools,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            top_p: config.top_p,
            top_k: config.top_k,
            thinking_mode: config.thinking_mode,
            thinking_level: config.thinking_level,
            images: Vec::new(),
        }
    }
}
