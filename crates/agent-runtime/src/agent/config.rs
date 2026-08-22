use std::sync::Arc;
use std::time::Duration;

use crate::confirmation::ConfirmationPolicy;
use crate::loop_control::LoopControlConfig;
use crate::scenario::{Scenario, ScenarioEntityProvider};

// ─── 配置与状态 ────────────────────────────────────────────

/// AgentLoop 配置
#[derive(Debug, Clone)]
pub struct AgentLoopConfig {
    /// 最大迭代次数（防止无限循环，默认 25）
    pub max_iterations: u32,
    /// 系统提示词（每次 prompt 都会附加）
    pub system_prompt: Option<String>,
    /// 温度（None=使用 Provider 默认）
    pub temperature: Option<f32>,
    /// 最大 token
    pub max_tokens: Option<u32>,
    /// 是否并行执行工具调用（阶段 1.3 恒为 false，阶段 1.4 启用）
    pub parallel_tool_calls: bool,
    /// 思考级别（DeepSeek/Anthropic reasoning）
    pub thinking_level: Option<crate::backend::ThinkingLevel>,

    // ─── Loop Engineering 批次4：通用循环控制 ───
    /// LLM 调用失败时的最大重试次数（默认 3，0=不重试）
    ///
    /// 采用指数退避策略：delay = `llm_retry_base_delay * 2^attempt`
    /// 适用场景：网络抖动、429 Too Many Requests、5xx 服务器错误
    /// 不适用场景：认证失败、参数错误（这些重试也无用，但当前实现不区分错误类型）
    pub llm_max_retries: u32,
    /// LLM 重试基础延迟（指数退避基数，默认 1s）
    pub llm_retry_base_delay: Duration,
    /// 单次 LLM 调用超时（None=不限时，默认 5min）
    ///
    /// 注意：超时只针对单次 LLM 调用，不针对整个任务。
    /// 超时后会触发重试（若 `llm_max_retries > 0`），不会强制终止整个 Agent 任务。
    pub llm_timeout: Option<Duration>,

    /// 工具执行失败时的最大重试次数（默认 0，工具自身负责重试）
    ///
    /// 默认不重试，因为工具可能有副作用（如写文件、发请求），
    /// 重复执行可能导致数据不一致。需要重试的工具应在 ToolBus 层自行实现。
    pub tool_max_retries: u32,
    /// 工具重试基础延迟（默认 1s）
    pub tool_retry_base_delay: Duration,
    /// 单次工具执行超时（None=不限时）
    ///
    /// 超时后工具执行被视为失败，错误信息推入 toolResult 消息让 LLM 处理。
    pub tool_timeout: Option<Duration>,

    /// LLM 调用之间的最小间隔（限流，None=不限制）
    ///
    /// 用于避免触发 Provider 的速率限制（如 DeepSeek 60次/分钟）。
    /// 在每次 LLM 调用前检查距上次调用的间隔，不足则 sleep。
    /// 注意：重试时也受限流约束（避免雪崩）。
    pub min_interval_between_calls: Option<Duration>,

    // ─── Loop Engineering 批次5：内建循环控制器 ───
    /// 内建 LoopController 配置（`None`=禁用内建自动控制），详细见 docs/details/注释/agent-runtime/agent.md
    pub loop_control: Option<LoopControlConfig>,

    // ─── B1 多场景插件（MVP） ───
    /// 场景插件（`None`=不启用场景，保持静态 `system_prompt` 行为）
    ///
    /// 启用后：
    /// - `build_prompt_options` 用场景 `build_system_prompt` 构建/追加到 system prompt
    /// - 工具视图按「系统基础工具 ∪ 场景 tool_ids」裁剪（WhitelistToolBus）
    pub scenario: Option<Arc<dyn Scenario>>,

    // ─── B1 场景上下文注入 ─────────────────────────────
    /// 场景实体访问器（`None`=不注入实体摘要）
    ///
    /// 启用后 `build_prompt_options` 在构建场景 prompt 前经此访问器拉取
    /// 当前项目实体摘要，填入 `ScenarioContext.entity_summary`，供场景
    /// `build_system_prompt` 拼入 system prompt（让 Agent 首轮即感知项目已有设定）。
    pub entity_provider: Option<Arc<dyn ScenarioEntityProvider>>,

    // ─── A5 HITL 权限确认 ─────────────────────────────
    /// 确认策略（`None`=不启用 HITL 确认）
    ///
    /// 启用后，AgentLoop 在 `execute_tool_calls` 中对命中策略的工具调用发起
    /// 确认（经 `ConfirmationBroker` 广播事件 + 等待前端回传），危险操作需用户确认。
    pub confirmation_policy: Option<ConfirmationPolicy>,

    /// 会话绑定的工作区根目录（`None`=不限定工作区）
    ///
    /// 供 `AgentLoop` 构造 [`crate::tool_context::ToolContext`] 并注入到工具执行
    /// （`call_tool_with_ctx`），使 FS 类工具能基于该目录解析相对路径。
    /// 对齐前端 `ProjectManager.dirPath` / `IToolContext.projectInfo.dirPath` 概念。
    pub workdir: Option<std::path::PathBuf>,
}

impl Default for AgentLoopConfig {
    fn default() -> Self {
        Self {
            max_iterations: 25,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            parallel_tool_calls: false,
            thinking_level: None,
            // 批次4 默认值：保守策略
            llm_max_retries: 3,
            llm_retry_base_delay: Duration::from_secs(1),
            llm_timeout: Some(Duration::from_secs(300)), // 5min
            tool_max_retries: 0,
            tool_retry_base_delay: Duration::from_secs(1),
            tool_timeout: None, // 工具默认不限时（可能执行长任务如文件扫描）
            min_interval_between_calls: None,
            // 批次5：默认启用内建 LoopController（宽松配置）
            loop_control: Some(LoopControlConfig::default()),
            // B1：默认不启用场景（保持静态 system_prompt 行为）
            scenario: None,
            // B1 场景上下文注入：默认不注入实体摘要
            entity_provider: None,
            // A5 HITL：默认不启用确认（无 broker 时策略不生效）
            confirmation_policy: None,
            // 工作区：默认不限定（None=相对路径原样返回）
            workdir: None,
        }
    }
}
