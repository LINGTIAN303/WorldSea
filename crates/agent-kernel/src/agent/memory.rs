use std::sync::Arc;

use crate::backend::PromptCallOptions;
use crate::scenario::ScenarioContext;
use crate::tool::{ToolBus, WhitelistToolBus};

use super::prompt_sections::{assemble_sections, order, PromptSection};
use super::{AgentLoop, AgentLoopConfig};

/// 系统基础工具（始终可用，不随场景裁剪）
///
/// 对应 `agent-commands` 注册的 terminal/subagent 工具名。世界构建场景启用时，
/// 白名单 = 本基础集 ∪ 场景 tool_ids，从而裁剪掉终端细节管理工具（shell_session_* 等）。
/// 2026-09-02 系统工具集对齐：`execute_command` 已退役 → 换成 `bash`/`powershell`；
/// 补上 fs 系统工具（read_file/write_file/edit_file/edit_diff/grep/find）——
/// 否则场景白名单下模型看不到这些工具（实测：模型只见 shell_session_* 而无法调 bash/edit_diff）。
const SYSTEM_BASE_TOOLS: &[&str] = &[
    // 终端执行（execute_command 退役后由 bash/powershell 取代）
    "bash",
    "powershell",
    // 文件系统（read 分页/grep/find/edit_diff 原子替换，对齐 Claude Code 内置）
    "read_file",
    "write_file",
    "edit_file",
    "edit_diff",
    "grep",
    "find",
    "list_directory",
    "search_files",
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
    // A1 己1①（2026-09-11）：原文取回工具——**任何场景**的工具结果都可能被截断
    // （terminal 大输出、大文件读取…），故取回能力也必须是跨场景的基础能力。
    // 漏加会重现本节注释里记录过的同类问题：白名单下模型看不到该工具，
    // 看到「原文已外置：raw/xxx」却无从取回。
    "memory_read_raw",
    // A2-2（2026-09-12）：工作区文件混合检索——考据资料/代码的「哪份资料讲过 X」
    // 类检索跨场景通用（世界构建/小说/编码都要），与 grep（精确字面）互补。
    "workspace_search",
    // Q1（2026-09-20）：模型主动提问——任何场景都可能需要「向用户确认/补全信息」
    // 才能继续（对齐 dsh `ask_user_question`）；不进本基础集则场景白名单下不可见。
    "ask_user_question",
    // S1（2026-09-20，批次 C）：定时唤醒三件套——「需要等待/稍后继续」跨场景通用
    // （等待后台任务、轮询外部状态、延后提醒）；同 ask 口径进基础集，可见性由场景白名单裁剪。
    "set_timer",
    "list_timers",
    "cancel_timer",
];

/// 世界构建场景注入的实体类型（对应 WorldSea 实体类型规范，见 typeMappingRegistry.ts）
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
            // 2026-09-10 风险点③收口：补齐 project_id / workspace_id 注入——此前恒 None，
            // 场景身份 prompt 的「当前项目 ID」「工作区 ID」段永不触发。
            let ctx = ScenarioContext::new(config.project_id.clone(), query_text, entity_summary)
                .with_workspace_id(config.workspace_id.clone());
            // 场景钩子（2026-09-09 场景底座）：extra_system_prompt_blocks 依次追加
            // 到身份 prompt 之后（如 coding 场景注入工程规范 / 场景级约束）。
            let mut base = scenario.build_system_prompt(&ctx).await;
            for block in scenario.extra_system_prompt_blocks(&ctx) {
                if !block.trim().is_empty() {
                    base.push_str("\n\n");
                    base.push_str(&block);
                }
            }
            Some(base)
        } else {
            None
        };

        // A4 段式组装（2026-09-16 提取融合）：四段改为结构化段（段序见 prompt_sections::order），
        // 拼接顺序与改造前一致：场景 → 静态 → 记忆 → 管线；空段跳过、全空返回 None。
        let mut sections: Vec<PromptSection> = Vec::new();
        if let Some(scen) = scenario_prompt {
            sections.push(PromptSection::new("scenario", order::SCENARIO, scen));
        }
        // A4 双端收口：静态注入带优先用结构化段（TS 12 段 + mcp_note，各自 order）；
        // 为空则回退 legacy 单段（群聊 / 老会话文本）——两条路径组装结果逐字节一致。
        if !config.prompt_sections.is_empty() {
            for sec in &config.prompt_sections {
                sections.push(sec.clone());
            }
        } else if let Some(static_p) = config.system_prompt.clone() {
            sections.push(PromptSection::new("static", order::STATIC, static_p));
        }
        if let Some(mem) = memory_ctx {
            sections.push(PromptSection::new("memory", order::MEMORY, mem));
        }
        // A3：管线路由指引（本轮经 RouterNode 决策的管线，指导 Agent 处理方式）
        if let Ok(guard) = self.pipeline_context.read() {
            if let Some(pipeline_ctx) = guard.as_ref() {
                sections.push(PromptSection::new(
                    "pipeline",
                    order::PIPELINE,
                    pipeline_ctx.clone(),
                ));
            }
        }
        let system_prompt_override = assemble_sections(sections);

        PromptCallOptions {
            system_prompt_override,
            tools_override: None,
            tools,
            force_tool: None,
            temperature: config.temperature,
            max_tokens: config.max_tokens,
            top_p: config.top_p,
            top_k: config.top_k,
            silent: false,
            purpose: None,
            thinking_mode: config.thinking_mode,
            thinking_level: config.thinking_level,
            images: Vec::new(),
        }
    }
}
