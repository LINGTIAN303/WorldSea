//! # Supervisor Pattern — 监督者编排模式
//!
//! 实现 Supervisor Pattern：中央协调者（Supervisor）接收用户任务，
//! 通过 LLM 决策将任务分配给最合适的子 Agent（SubAgent）执行，
//! 汇总子 Agent 结果后返回给用户。
//!
//! ## 架构
//! ```text
//! 用户输入
//!    ↓
//! SupervisorNode.execute
//!    ├─ 1. AssignmentStrategy.assign(task, specs, backend) → AssignmentResult
//!    ├─ 2. 从池中获取/创建子 AgentLoop
//!    ├─ 3. agent.run(task_description) → String
//!    ├─ 4. 收集子 Agent 输出 → state.messages
//!    └─ 5. 返回 NodeResult（Continue/Done）
//! ```
//!
//! ## 关键设计
//! - **共享 backend**：所有子 Agent 使用同一个 `NodeBackendAccessor`（父 Orchestrator 的）
//! - **共享 ToolBus**：所有子 Agent 共用父 `ToolBus`（FrontendToolBridge）
//! - **独立 system_prompt**：每个子 Agent 用自己的 system_prompt 实现专长
//! - **LLM 决策分配**：默认 `LlmAssignmentStrategy`，可注入自定义策略
//! - **Lazy 初始化**：子 Agent 实例在首次调用时创建并缓存，避免预先创建未使用的 Agent
//!
//! ## 与 TS 版的差异
//! - Rust 版 SupervisorNode 直接持有 `Arc<AgentLoop>` 池，TS 版通过 AgentRegistry 间接管理
//! - 阶段 1.2 不转发子 Agent 流式事件到父 Orchestrator（前端通过 SupervisorEvent 摘要了解进度）
//! - 阶段 1.3 可扩展为通过 LLM 生成 summary（当前用简单拼接）

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::agent::{AgentLoop, AgentLoopConfig};
use crate::backend::{NodeBackendAccessor, PromptCallOptions};
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::tool::ToolBus;
use crate::types::{MessageRole, OrchestratorMessage};

// ─── 子 Agent 规格 ────────────────────────────────────────────

/// 子 Agent 规格 — 描述一个可调用的专长子 Agent
///
/// 由用户在创建 SupervisorNode 时提供，定义子 Agent 的能力与配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubAgentSpec {
    /// 子 Agent 唯一 ID（用于 `AssignmentResult.sub_agent_id` 引用）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 能力描述（供 LLM 选择时参考，应清晰描述专长）
    pub description: String,
    /// 系统提示词（定义子 Agent 的专长与行为边界）
    pub system_prompt: String,
    /// 工具白名单（None=继承 ToolBus 中所有工具）
    ///
    /// 注意：阶段 1.2 的 ToolBus 不支持按白名单筛选，此字段仅作元数据记录。
    /// 实际工具隔离需在 ToolBus 层实现（阶段 1.4 扩展）。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tools_whitelist: Option<Vec<String>>,
    /// 子 Agent 最大迭代次数（None=用 `AgentLoopConfig` 默认值）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_iterations: Option<u32>,
}

// ─── 任务分配结果 ────────────────────────────────────────────

/// 任务分配结果 — `AssignmentStrategy::assign` 的返回值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssignmentResult {
    /// 被选中的子 Agent ID
    pub sub_agent_id: String,
    /// 经 Supervisor 改写的子任务描述（传给子 Agent 的 `run`）
    pub task_description: String,
    /// LLM 决策的推理过程（可选，用于可解释性与调试）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reasoning: Option<String>,
}

// ─── 任务分配策略 ────────────────────────────────────────────

/// 任务分配策略 trait
///
/// 默认实现：`LlmAssignmentStrategy`（基于 LLM 决策）
/// 可注入自定义实现：基于规则、基于负载均衡、基于历史成功率等。
#[async_trait]
pub trait AssignmentStrategy: Send + Sync {
    /// 根据任务和候选子 Agent，决定分配给哪个子 Agent
    ///
    /// # 参数
    /// - `task`：用户原始任务
    /// - `candidates`：候选子 Agent 规格
    /// - `backend`：LLM 后端访问器（用于 LLM 决策策略）
    async fn assign(
        &self,
        task: &str,
        candidates: &[SubAgentSpec],
        backend: &dyn NodeBackendAccessor,
    ) -> Result<AssignmentResult, AssignmentError>;
}

/// 任务分配错误
#[derive(Debug, thiserror::Error)]
pub enum AssignmentError {
    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("无可用子 Agent")]
    NoCandidates,

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for AssignmentError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

// ─── LLM 决策策略 ────────────────────────────────────────────

/// 提示词模板 — 可定制 `LlmAssignmentStrategy` 的 system/user 提示词
#[derive(Debug, Clone)]
pub struct AssignmentPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板（支持 `{task}` 和 `{agents}` 占位符）
    pub user_template: String,
}

impl Default for AssignmentPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个任务协调者（Supervisor），负责将用户任务分配给最合适的子 Agent。\
                    请根据子 Agent 的能力描述选择最合适的一个，并改写任务描述使其更精确。\
                    必须输出合法 JSON 格式，不要包含其他文本。".into(),
            user_template: r#"任务：{task}

可用子 Agent：
{agents}

请输出 JSON（仅 JSON，不要其他文本）：
{{
  "sub_agent_id": "<子Agent ID>",
  "task_description": "<改写后的子任务描述>",
  "reasoning": "<选择理由（一句话）>"
}}"#
                .into(),
        }
    }
}

/// LLM 决策的任务分配策略（默认实现）
///
/// 通过调用 LLM 让其根据子 Agent 的能力描述选择最合适的一个，
/// 并改写任务描述使其更精确地匹配选中子 Agent 的专长。
pub struct LlmAssignmentStrategy {
    /// 提示词模板
    pub prompt_template: AssignmentPromptTemplate,
}

impl Default for LlmAssignmentStrategy {
    fn default() -> Self {
        Self {
            prompt_template: AssignmentPromptTemplate::default(),
        }
    }
}

impl LlmAssignmentStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: AssignmentPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 格式化候选子 Agent 列表
    fn format_candidates(candidates: &[SubAgentSpec]) -> String {
        candidates
            .iter()
            .map(|s| {
                format!(
                    "- id: {}\n  name: {}\n  description: {}",
                    s.id, s.name, s.description
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, task: &str, candidates: &[SubAgentSpec]) -> String {
        self.prompt_template
            .user_template
            .replace("{task}", task)
            .replace("{agents}", &Self::format_candidates(candidates))
    }

    /// 解析 LLM 输出的 JSON（容错处理 ```json 包裹）
    fn parse_response(text: &str) -> Result<AssignmentResult, AssignmentError> {
        let trimmed = text.trim();
        let json_str = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .map(|s| s.trim())
            .unwrap_or(trimmed);

        let result: AssignmentResult = serde_json::from_str(json_str).map_err(|e| {
            AssignmentError::Parse(format!("JSON 解析失败: {} (input: {})", e, json_str))
        })?;
        Ok(result)
    }
}

#[async_trait]
impl AssignmentStrategy for LlmAssignmentStrategy {
    async fn assign(
        &self,
        task: &str,
        candidates: &[SubAgentSpec],
        backend: &dyn NodeBackendAccessor,
    ) -> Result<AssignmentResult, AssignmentError> {
        if candidates.is_empty() {
            return Err(AssignmentError::NoCandidates);
        }

        // 单一候选直接返回（避免不必要的 LLM 调用）
        if candidates.len() == 1 {
            debug!(
                "Supervisor: 唯一候选子 Agent {}，直接分配",
                candidates[0].id
            );
            return Ok(AssignmentResult {
                sub_agent_id: candidates[0].id.clone(),
                task_description: task.to_string(),
                reasoning: Some("唯一候选子 Agent，直接分配".into()),
            });
        }

        // 构造调用选项（覆盖 system_prompt，禁用工具调用）
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()), // 任务分配不需要工具
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(task, candidates);

        // 调用 LLM
        debug!("Supervisor: 调用 LLM 进行任务分配，task 长度: {}", task.len());
        let response = backend.prompt(user_prompt, Some(options)).await?;
        info!(
            "Supervisor: LLM 返回响应，长度: {}",
            response.text.len()
        );

        // 解析响应
        let result = Self::parse_response(&response.text)?;

        // 校验返回的 sub_agent_id 存在
        if !candidates.iter().any(|c| c.id == result.sub_agent_id) {
            return Err(AssignmentError::Parse(format!(
                "LLM 返回的 sub_agent_id '{}' 不在候选列表中",
                result.sub_agent_id
            )));
        }

        Ok(result)
    }
}

// ─── 轮询分配策略（RoundRobin）────────────────────────────────────

/// 轮询分配策略 — 按顺序循环选择子 Agent
///
/// 不调用 LLM，纯本地决策。适用于：
/// - 子 Agent 能力相近，无需 LLM 判断
/// - 需要均衡分配任务量（简单轮询）
/// - 低延迟场景（避免 LLM 调用开销）
///
/// ## 行为
/// - 第 1 次 assign → candidates[0]
/// - 第 2 次 assign → candidates[1]
/// - ...
/// - 第 N 次 assign → candidates[(N-1) % len]
///
/// ## 线程安全
/// 内部使用 `AtomicUsize` 计数器，可安全跨线程共享。
pub struct RoundRobinAssignmentStrategy {
    /// 当前计数器（每次 assign 递增）
    counter: AtomicUsize,
}

impl Default for RoundRobinAssignmentStrategy {
    fn default() -> Self {
        Self::new()
    }
}

impl RoundRobinAssignmentStrategy {
    pub fn new() -> Self {
        Self {
            counter: AtomicUsize::new(0),
        }
    }

    /// 使用指定初始偏移创建（主要用于测试）
    pub fn with_offset(offset: usize) -> Self {
        Self {
            counter: AtomicUsize::new(offset),
        }
    }
}

#[async_trait]
impl AssignmentStrategy for RoundRobinAssignmentStrategy {
    async fn assign(
        &self,
        task: &str,
        candidates: &[SubAgentSpec],
        _backend: &dyn NodeBackendAccessor,
    ) -> Result<AssignmentResult, AssignmentError> {
        if candidates.is_empty() {
            return Err(AssignmentError::NoCandidates);
        }

        let idx = self.counter.fetch_add(1, Ordering::Relaxed) % candidates.len();
        let chosen = &candidates[idx];

        debug!(
            "Supervisor RoundRobin: 选中 candidates[{}]={} (counter before)",
            idx, chosen.id
        );

        Ok(AssignmentResult {
            sub_agent_id: chosen.id.clone(),
            task_description: task.to_string(),
            reasoning: Some(format!(
                "轮询策略：第 {} 次分配，选中 candidates[{}]={}",
                idx + 1,
                idx,
                chosen.id
            )),
        })
    }
}

// ─── 负载均衡分配策略（LoadBased）────────────────────────────────

/// 负载均衡分配策略 — 选择累计分配次数最少的子 Agent
///
/// 不调用 LLM，纯本地决策。适用于：
/// - 子 Agent 处理能力不同（部分 Agent 处理慢，应少分配）
/// - 长期运行场景（需要均衡各子 Agent 的总任务量）
///
/// ## 负载语义
/// 本策略跟踪的是"累计分配次数"（非实时并发数），因为
/// `AssignmentStrategy::assign` 无法感知子 Agent 何时完成执行。
/// 适用于"任务量均衡"语义；如需"实时并发均衡"，需在 SupervisorNode
/// 层集成并发计数（阶段 2.x 扩展）。
///
/// ## 平局处理
/// 多个候选负载相同时，选择 ID 字典序最小的（保证确定性，便于测试）。
///
/// ## 线程安全
/// 内部使用 `Mutex<HashMap<String, u64>>` 跟踪计数，可安全跨线程共享。
pub struct LoadBasedAssignmentStrategy {
    /// 每个子 Agent 的累计分配次数
    counts: Mutex<HashMap<String, u64>>,
}

impl Default for LoadBasedAssignmentStrategy {
    fn default() -> Self {
        Self::new()
    }
}

impl LoadBasedAssignmentStrategy {
    pub fn new() -> Self {
        Self {
            counts: Mutex::new(HashMap::new()),
        }
    }

    /// 获取指定子 Agent 的当前累计分配次数（主要用于测试）
    pub fn count_of(&self, sub_agent_id: &str) -> u64 {
        let counts = self.counts.lock().unwrap();
        counts.get(sub_agent_id).copied().unwrap_or(0)
    }
}

#[async_trait]
impl AssignmentStrategy for LoadBasedAssignmentStrategy {
    async fn assign(
        &self,
        task: &str,
        candidates: &[SubAgentSpec],
        _backend: &dyn NodeBackendAccessor,
    ) -> Result<AssignmentResult, AssignmentError> {
        if candidates.is_empty() {
            return Err(AssignmentError::NoCandidates);
        }

        // 单一候选直接返回（避免不必要的锁操作）
        if candidates.len() == 1 {
            let mut counts = self.counts.lock().unwrap();
            *counts.entry(candidates[0].id.clone()).or_insert(0) += 1;
            return Ok(AssignmentResult {
                sub_agent_id: candidates[0].id.clone(),
                task_description: task.to_string(),
                reasoning: Some("负载均衡策略：唯一候选，直接分配".into()),
            });
        }

        // 选择累计次数最少的（平局选 ID 字典序最小）
        let mut counts = self.counts.lock().unwrap();
        let chosen = candidates
            .iter()
            .min_by_key(|c| {
                let count = counts.get(&c.id).copied().unwrap_or(0);
                (count, c.id.clone()) // (累计次数, ID) — 平局时 ID 字典序最小
            })
            .expect("candidates 非空（已检查）");

        let chosen_count = counts.get(&chosen.id).copied().unwrap_or(0);
        *counts.entry(chosen.id.clone()).or_insert(0) += 1;

        debug!(
            "Supervisor LoadBased: 选中 {} (当前累计分配次数: {} → {})",
            chosen.id, chosen_count, chosen_count + 1
        );

        Ok(AssignmentResult {
            sub_agent_id: chosen.id.clone(),
            task_description: task.to_string(),
            reasoning: Some(format!(
                "负载均衡策略：选中 {}（累计分配次数: {} → {}）",
                chosen.id, chosen_count, chosen_count + 1
            )),
        })
    }
}

// ─── Supervisor 配置 ────────────────────────────────────────────

/// Supervisor 配置
#[derive(Debug, Clone)]
pub struct SupervisorConfig {
    /// 最大协调轮次（防止无限循环，默认 5）
    ///
    /// 每轮包含：任务分配 + 子 Agent 执行 + 结果收集。
    /// - `max_rounds = 1`：单轮模式（阶段 1.2 行为，assign + run 一次即返回）
    /// - `max_rounds > 1`：多轮协调模式，每轮基于上一轮子 Agent 输出继续推进任务，
    ///   直到达成 `max_rounds`、外部中断或子 Agent 输出包含 `[TASK_COMPLETE]` 标记
    ///
    /// ## 多轮语义
    /// 多轮模式适用于需要多个子 Agent 接力完成的复杂任务：
    /// - 轮 1：coder 编写代码 → 输出代码
    /// - 轮 2：reviewer 审查代码 → 输出审查意见 + [TASK_COMPLETE]
    /// - 轮 3：coder 修复问题 → 输出最终代码 + [TASK_COMPLETE]
    ///
    /// 每轮的 `task` 由 Supervisor 改写：拼接原任务 + 上一轮输出 + 继续指令。
    pub max_rounds: u32,
    /// 是否在最后汇总子 Agent 输出（生成 summary 字段）
    pub require_summary: bool,
    /// 子 Agent 共享的 AgentLoop 配置
    ///
    /// 注意：`system_prompt` 和 `max_iterations` 会被 `SubAgentSpec` 的对应字段覆盖。
    pub agent_loop_config: AgentLoopConfig,
}

impl Default for SupervisorConfig {
    fn default() -> Self {
        Self {
            // 默认单轮模式（向后兼容阶段 1.2 行为）
            // 多轮协调需显式设置 max_rounds > 1
            max_rounds: 1,
            require_summary: true,
            agent_loop_config: AgentLoopConfig::default(),
        }
    }
}

// ─── SupervisorNode ────────────────────────────────────────────

/// 单轮协调结果（内部用于多轮汇总）
///
/// 每轮执行完成后收集，最终用于生成 summary。
#[derive(Debug, Clone)]
struct RoundOutput {
    /// 子 Agent 名称
    sub_agent_name: String,
    /// 子 Agent 输出内容
    output: String,
    /// 本轮执行耗时（毫秒）
    duration_ms: u64,
}

/// SupervisorNode — 监督者节点
///
/// 在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
/// 1. 接收当前任务（从 `state.input` 或上一节点输出）
/// 2. 通过 `AssignmentStrategy` 选择子 Agent
/// 3. 调用子 Agent 的 `AgentLoop::run`
/// 4. 收集子 Agent 输出，写入 `state.messages`
/// 5. 返回 `Continue`（让 Orchestrator 按边查找下一节点）或 `Done`
///
/// # 使用示例
/// ```rust,ignore
/// use agent_runtime::supervisor::{SupervisorNode, SubAgentSpec, SupervisorConfig};
///
/// let specs = vec![
///     SubAgentSpec {
///         id: "coder".into(),
///         name: "代码专家".into(),
///         description: "处理代码编写、调试、重构任务".into(),
///         system_prompt: "你是一个专业的代码工程师".into(),
///         tools_whitelist: None,
///         max_iterations: Some(20),
///     },
///     SubAgentSpec {
///         id: "writer".into(),
///         name: "文档专家".into(),
///         description: "处理文档撰写、翻译、润色任务".into(),
///         system_prompt: "你是一个专业的技术文档工程师".into(),
///         tools_whitelist: None,
///         max_iterations: Some(15),
///     },
/// ];
///
/// let node = SupervisorNode::with_default_strategy(
///     "supervisor",
///     "任务监督者",
///     specs,
///     backend,
///     tool_bus,
///     SupervisorConfig::default(),
/// );
/// ```
pub struct SupervisorNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 子 Agent 规格（按声明顺序，LLM 策略会展示给 LLM）
    specs: Vec<SubAgentSpec>,
    /// 子 Agent 实例池（lazy 初始化：首次调用时创建并缓存）
    agents: Arc<RwLock<HashMap<String, Arc<AgentLoop>>>>,
    /// 任务分配策略
    strategy: Arc<dyn AssignmentStrategy>,
    /// 共享 LLM 后端
    backend: Arc<dyn NodeBackendAccessor>,
    /// 共享工具总线
    tool_bus: Arc<dyn ToolBus>,
    /// 配置
    config: SupervisorConfig,
}

impl SupervisorNode {
    /// 创建新的 Supervisor 节点
    ///
    /// # 参数
    /// - `id`：节点 ID（在 Orchestrator 中唯一）
    /// - `name`：节点名称（调试/日志用）
    /// - `specs`：子 Agent 规格列表
    /// - `strategy`：任务分配策略
    /// - `backend`：LLM 后端访问器（共享给所有子 Agent）
    /// - `tool_bus`：工具总线（共享给所有子 Agent）
    /// - `config`：Supervisor 配置
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        specs: Vec<SubAgentSpec>,
        strategy: Arc<dyn AssignmentStrategy>,
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        config: SupervisorConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            specs,
            agents: Arc::new(RwLock::new(HashMap::new())),
            strategy,
            backend,
            tool_bus,
            config,
        }
    }

    /// 使用默认 LLM 策略创建（便捷方法）
    pub fn with_default_strategy(
        id: impl Into<String>,
        name: impl Into<String>,
        specs: Vec<SubAgentSpec>,
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        config: SupervisorConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            specs,
            Arc::new(LlmAssignmentStrategy::new()),
            backend,
            tool_bus,
            config,
        )
    }

    /// 获取或创建子 Agent 实例（lazy 初始化）
    ///
    /// 首次调用时创建 AgentLoop 并缓存，后续调用直接返回缓存的实例。
    async fn get_or_create_agent(&self, spec: &SubAgentSpec) -> Arc<AgentLoop> {
        // 先尝试读锁快速路径
        {
            let agents = self.agents.read().await;
            if let Some(agent) = agents.get(&spec.id) {
                return Arc::clone(agent);
            }
        }

        // 写锁创建
        let mut agents = self.agents.write().await;
        // Double-check（防止并发重复创建）
        if let Some(agent) = agents.get(&spec.id) {
            return Arc::clone(agent);
        }

        // 构造子 Agent 配置（在共享配置基础上覆盖 system_prompt 与 max_iterations）
        let mut child_config = self.config.agent_loop_config.clone();
        child_config.system_prompt = Some(spec.system_prompt.clone());
        if let Some(max_iter) = spec.max_iterations {
            child_config.max_iterations = max_iter;
        }

        let agent = Arc::new(
            AgentLoop::new(Arc::clone(&self.backend), Arc::clone(&self.tool_bus))
                .with_config(child_config),
        );

        agents.insert(spec.id.clone(), Arc::clone(&agent));
        info!("Supervisor: 创建子 Agent 实例 id={} name={}", spec.id, spec.name);
        agent
    }

    /// 查找子 Agent 规格
    fn find_spec(&self, sub_agent_id: &str) -> Option<&SubAgentSpec> {
        self.specs.iter().find(|s| s.id == sub_agent_id)
    }

    /// 获取子 Agent 规格列表（只读）
    pub fn specs(&self) -> &[SubAgentSpec] {
        &self.specs
    }

    /// 清空子 Agent 实例池（用于 reset 场景）
    ///
    /// 注意：此方法不会销毁已返回给调用方的 `Arc<AgentLoop>`，
    /// 只清空 SupervisorNode 内部的缓存。
    pub async fn clear_agent_pool(&self) {
        let mut agents = self.agents.write().await;
        agents.clear();
    }
}

#[async_trait]
impl OrchestratorNode for SupervisorNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Supervisor
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // ── 1. 读取原始任务 ──
        // 优先用 state.input，否则用最后一条 user 消息
        let original_task = if !ctx.state.input.is_empty() {
            ctx.state.input.clone()
        } else {
            ctx.state
                .messages
                .iter()
                .rev()
                .find(|m| matches!(m.role, MessageRole::User))
                .map(|m| m.content.clone())
                .unwrap_or_default()
        };

        if original_task.is_empty() {
            return NodeResult::error(
                "Supervisor: 任务为空（state.input 与 messages 中均无 user 消息）",
            );
        }

        // ── 2. 中断检查（首次）──
        if ctx.is_aborted() {
            warn!("Supervisor: 中断检查命中（多轮协调开始前）");
            return NodeResult::aborted();
        }

        // ── 3. 多轮协调循环 ──
        // max_rounds=1 时为单轮模式（兼容阶段 1.2 行为）
        // max_rounds>1 时为多轮协调：每轮基于上一轮子 Agent 输出继续推进
        let mut current_task = original_task.clone();
        let mut round_outputs: Vec<RoundOutput> = Vec::new();
        let mut early_complete = false;

        for round in 1..=self.config.max_rounds {
            debug!(
                "Supervisor: 进入轮 {}/{}，task 长度: {}",
                round,
                self.config.max_rounds,
                current_task.len()
            );

            // ─ 3a. 中断检查（轮开始） ─
            if ctx.is_aborted() {
                warn!("Supervisor: 中断检查命中（轮 {} 开始）", round);
                return NodeResult::aborted();
            }

            // ─ 3b. 任务分配 ─
            let assignment = match self
                .strategy
                .assign(&current_task, &self.specs, ctx.backend)
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    let error_msg = format!("Supervisor 任务分配失败（轮 {}）: {}", round, e);
                    ctx.emit(OrchestratorEvent::SupervisorError {
                        node_id: self.id.clone(),
                        stage: "assign".into(),
                        error: error_msg.clone(),
                    });
                    return NodeResult::error(error_msg);
                }
            };

            debug!(
                "Supervisor: 轮 {} 任务已分配给 sub_agent={} (reasoning: {:?})",
                round, assignment.sub_agent_id, assignment.reasoning
            );

            // ─ 3c. 查找子 Agent 规格 ─
            let spec = match self.find_spec(&assignment.sub_agent_id) {
                Some(s) => s,
                None => {
                    let error_msg = format!(
                        "Supervisor: 子 Agent 不存在: {}（specs 中未找到，轮 {}）",
                        assignment.sub_agent_id, round
                    );
                    ctx.emit(OrchestratorEvent::SupervisorError {
                        node_id: self.id.clone(),
                        stage: "spec_lookup".into(),
                        error: error_msg.clone(),
                    });
                    return NodeResult::error(error_msg);
                }
            };

            // ─ 3d. 触发 SupervisorTaskAssigned 事件 ─
            ctx.emit(OrchestratorEvent::SupervisorTaskAssigned {
                node_id: self.id.clone(),
                sub_agent_id: spec.id.clone(),
                sub_agent_name: spec.name.clone(),
                task_description: assignment.task_description.clone(),
                reasoning: assignment.reasoning.clone(),
            });

            // ─ 3e. 获取或创建子 Agent 实例 ─
            let agent = self.get_or_create_agent(spec).await;

            // ─ 3f. 中断检查（子 Agent 执行前） ─
            if ctx.is_aborted() {
                warn!(
                    "Supervisor: 中断检查命中（轮 {} 子 Agent 执行前）",
                    round
                );
                return NodeResult::aborted();
            }

            // ─ 3g. 执行子 Agent ─
            ctx.emit(OrchestratorEvent::SubAgentStarted {
                node_id: self.id.clone(),
                sub_agent_id: spec.id.clone(),
                sub_agent_name: spec.name.clone(),
                task_description: assignment.task_description.clone(),
            });

            let run_start = Instant::now();
            let sub_agent_output =
                match agent.run(assignment.task_description.clone()).await {
                    Ok(text) => text,
                    Err(e) => {
                        let error_msg = format!(
                            "子 Agent '{}' 执行失败（轮 {}）: {}",
                            spec.name, round, e
                        );
                        ctx.emit(OrchestratorEvent::SubAgentError {
                            node_id: self.id.clone(),
                            sub_agent_id: spec.id.clone(),
                            sub_agent_name: spec.name.clone(),
                            error: error_msg.clone(),
                        });
                        return NodeResult::error(error_msg);
                    }
                };
            let duration_ms = run_start.elapsed().as_millis() as u64;

            ctx.emit(OrchestratorEvent::SubAgentCompleted {
                node_id: self.id.clone(),
                sub_agent_id: spec.id.clone(),
                sub_agent_name: spec.name.clone(),
                output_chars: sub_agent_output.len(),
                duration_ms,
            });

            // ─ 3h. 收集输出，写入 state.messages ─
            let mut meta = HashMap::new();
            meta.insert("supervisor_node_id".to_string(), serde_json::json!(self.id));
            meta.insert("sub_agent_id".to_string(), serde_json::json!(spec.id));
            meta.insert("sub_agent_name".to_string(), serde_json::json!(spec.name));
            meta.insert("round".to_string(), serde_json::json!(round));
            meta.insert(
                "max_rounds".to_string(),
                serde_json::json!(self.config.max_rounds),
            );
            if let Some(reasoning) = &assignment.reasoning {
                meta.insert(
                    "assignment_reasoning".to_string(),
                    serde_json::json!(reasoning),
                );
            }

            // 多轮模式下在消息前加轮次前缀，便于前端展示
            let content_prefix = if self.config.max_rounds > 1 {
                format!("[轮 {}/{}] ", round, self.config.max_rounds)
            } else {
                String::new()
            };

            ctx.state.messages.push(OrchestratorMessage {
                role: MessageRole::Assistant,
                content: format!(
                    "{}[Supervisor → {}]: {}\n\n[SubAgent 输出]:\n{}",
                    content_prefix, spec.name, assignment.task_description, sub_agent_output
                ),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: Some(meta),
            });

            round_outputs.push(RoundOutput {
                sub_agent_name: spec.name.clone(),
                output: sub_agent_output.clone(),
                duration_ms,
            });

            // ─ 3i. 检查是否提前完成（子 Agent 输出包含 [TASK_COMPLETE]） ─
            if sub_agent_output.contains("[TASK_COMPLETE]") {
                debug!(
                    "Supervisor: 轮 {} 子 Agent 输出包含 [TASK_COMPLETE]，提前结束多轮协调",
                    round
                );
                early_complete = true;
                break;
            }

            // ─ 3j. 中断检查（子 Agent 执行后） ─
            if ctx.is_aborted() {
                warn!(
                    "Supervisor: 中断检查命中（轮 {} 子 Agent 执行后）",
                    round
                );
                return NodeResult::aborted();
            }

            // ─ 3k. 如果是最后一轮，跳出 ─
            if round >= self.config.max_rounds {
                break;
            }

            // ─ 3l. 构造下一轮的 task（拼接原任务 + 上一轮输出 + 继续指令） ─
            current_task = format!(
                "原任务：{}\n\n上一轮子 Agent '{}' 输出：\n{}\n\n\
                 请基于以上信息继续推进任务。如果已完成，请在输出末尾添加 [TASK_COMPLETE] 标记。",
                original_task, spec.name, sub_agent_output
            );
        }

        // ── 4. 生成 summary ──
        let summary = if self.config.require_summary {
            // 单轮且未提前完成（即 max_rounds=1 的单轮模式）：简洁 summary
            // 多轮或提前完成：详细 summary（包含轮次与完成状态）
            if round_outputs.len() == 1 && !early_complete {
                Some(format!(
                    "Supervisor: 任务已由子 Agent '{}' 处理（输出 {} 字符，耗时 {}ms）",
                    round_outputs[0].sub_agent_name,
                    round_outputs[0].output.len(),
                    round_outputs[0].duration_ms
                ))
            } else {
                let total_chars: usize =
                    round_outputs.iter().map(|r| r.output.len()).sum();
                let total_duration_ms: u64 =
                    round_outputs.iter().map(|r| r.duration_ms).sum();
                let agent_names: Vec<&str> =
                    round_outputs.iter().map(|r| r.sub_agent_name.as_str()).collect();
                let completion_status = if early_complete {
                    "提前完成"
                } else {
                    "达到最大轮次"
                };
                Some(format!(
                    "Supervisor: 多轮协调{}（共 {} 轮，参与子 Agent: [{}]，总输出 {} 字符，总耗时 {}ms）",
                    completion_status,
                    round_outputs.len(),
                    agent_names.join(", "),
                    total_chars,
                    total_duration_ms
                ))
            }
        } else {
            None
        };

        // ── 5. 返回结果 ──
        // Continue=允许 Orchestrator 按边查找下一节点（如 Reflection 节点）
        NodeResult {
            status: NodeStatus::Continue,
            next_node_id: None,
            error: None,
            summary,
        }
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{BackendError, PromptResponse};
    use crate::event::OrchestratorEvent;
    use crate::node::{AbortCheck, EventEmitter};
    use crate::tool::SimpleToolBus;
    use crate::types::OrchestratorState;
    use async_trait::async_trait;
    use std::sync::Mutex;

    // ─── 测试桩：Backend ────────────────────────────────────

    /// 测试用 Backend — 返回预设的固定响应
    struct StubBackend {
        response_text: String,
        prompt_count: Mutex<usize>,
    }

    impl StubBackend {
        fn new(response_text: impl Into<String>) -> Self {
            Self {
                response_text: response_text.into(),
                prompt_count: Mutex::new(0),
            }
        }

        fn prompt_count(&self) -> usize {
            *self.prompt_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for StubBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.prompt_count.lock().unwrap() += 1;
            Ok(PromptResponse::text_only(self.response_text.clone()))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }

        async fn get_messages(&self) -> Vec<crate::types::OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<crate::types::OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用策略 — 固定返回指定的 sub_agent_id
    struct StubStrategy {
        sub_agent_id: String,
    }

    impl StubStrategy {
        fn new(sub_agent_id: impl Into<String>) -> Self {
            Self {
                sub_agent_id: sub_agent_id.into(),
            }
        }
    }

    #[async_trait]
    impl AssignmentStrategy for StubStrategy {
        async fn assign(
            &self,
            task: &str,
            _candidates: &[SubAgentSpec],
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<AssignmentResult, AssignmentError> {
            Ok(AssignmentResult {
                sub_agent_id: self.sub_agent_id.clone(),
                task_description: task.to_string(),
                reasoning: Some("stub strategy".into()),
            })
        }
    }

    // ─── 测试桩：事件/中断 ────────────────────────────────────

    struct NoopEmitter;
    impl EventEmitter for NoopEmitter {
        fn emit(&self, _event: OrchestratorEvent) {}
    }

    struct NoopAbort;
    #[async_trait]
    impl AbortCheck for NoopAbort {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    fn make_specs() -> Vec<SubAgentSpec> {
        vec![
            SubAgentSpec {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码编写、调试、重构任务".into(),
                system_prompt: "你是代码工程师".into(),
                tools_whitelist: None,
                max_iterations: Some(5),
            },
            SubAgentSpec {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档撰写、翻译、润色任务".into(),
                system_prompt: "你是文档工程师".into(),
                tools_whitelist: None,
                max_iterations: Some(5),
            },
        ]
    }

    // ─── 测试：LlmAssignmentStrategy 解析 ────────────────────────────────────

    #[test]
    fn parse_response_should_handle_plain_json() {
        let text = r#"{"sub_agent_id":"coder","task_description":"写一个函数","reasoning":"代码任务"}"#;
        let r = LlmAssignmentStrategy::parse_response(text).unwrap();
        assert_eq!(r.sub_agent_id, "coder");
        assert_eq!(r.task_description, "写一个函数");
        assert_eq!(r.reasoning.as_deref(), Some("代码任务"));
    }

    #[test]
    fn parse_response_should_handle_code_fence() {
        let text = r#"```json
{"sub_agent_id":"writer","task_description":"写文档","reasoning":"文档任务"}
```"#;
        let r = LlmAssignmentStrategy::parse_response(text).unwrap();
        assert_eq!(r.sub_agent_id, "writer");
    }

    #[test]
    fn parse_response_should_fail_on_invalid_json() {
        let text = "not a json";
        let r = LlmAssignmentStrategy::parse_response(text);
        assert!(r.is_err());
    }

    #[test]
    fn format_candidates_should_include_all_fields() {
        let specs = make_specs();
        let s = LlmAssignmentStrategy::format_candidates(&specs);
        assert!(s.contains("coder"));
        assert!(s.contains("代码专家"));
        assert!(s.contains("writer"));
        assert!(s.contains("文档专家"));
    }

    // ─── 测试：策略端到端 ────────────────────────────────────

    #[tokio::test]
    async fn llm_strategy_single_candidate_should_skip_llm_call() {
        let backend = StubBackend::new("should not be called");
        let spec = SubAgentSpec {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一候选".into(),
            system_prompt: "你是唯一".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy
            .assign("任务", &[spec], &backend)
            .await
            .unwrap();
        assert_eq!(r.sub_agent_id, "only");
        assert_eq!(backend.prompt_count(), 0); // 单一候选不应调用 LLM
    }

    #[tokio::test]
    async fn llm_strategy_multi_candidates_should_call_llm() {
        let response = r#"{"sub_agent_id":"coder","task_description":"写函数","reasoning":"代码任务"}"#;
        let backend = StubBackend::new(response);
        let specs = make_specs();
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("写一个函数", &specs, &backend).await.unwrap();
        assert_eq!(r.sub_agent_id, "coder");
        assert_eq!(backend.prompt_count(), 1);
    }

    #[tokio::test]
    async fn llm_strategy_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn llm_strategy_invalid_sub_agent_id_should_error() {
        let response = r#"{"sub_agent_id":"unknown","task_description":"x","reasoning":"y"}"#;
        let backend = StubBackend::new(response);
        let specs = make_specs();
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("任务", &specs, &backend).await;
        assert!(matches!(r, Err(AssignmentError::Parse(_))));
    }

    // ─── 测试：SupervisorNode execute ────────────────────────────────────

    /// 注意：SupervisorNode::execute 会调用 AgentLoop::run，
    /// 而 AgentLoop 会调用 backend.prompt 走 ReAct 循环。
    /// 这里用 StubBackend 返回固定响应，让 AgentLoop 一轮结束（无 tool_calls）。
    #[tokio::test]
    async fn supervisor_execute_should_assign_and_collect_output() {
        // 子 Agent 调用 backend 时返回文本（无 tool_calls，AgentLoop 一轮结束）
        let backend = Arc::new(StubBackend::new("子 Agent 完成的任务输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let strategy = Arc::new(StubStrategy::new("coder"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        // 构造 ctx
        let mut state = OrchestratorState::new("写一个 hello world");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert!(result.summary.is_some());

        // 验证 state.messages 被写入
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(matches!(last.role, MessageRole::Assistant));
        assert!(last.content.contains("[Supervisor → 代码专家]"));
        assert!(last.content.contains("子 Agent 完成的任务输出"));

        // 验证 meta
        let meta = last.meta.as_ref().expect("meta should exist");
        assert_eq!(meta.get("sub_agent_id").and_then(|v| v.as_str()), Some("coder"));
    }

    #[tokio::test]
    async fn supervisor_execute_with_empty_task_should_error() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let node = SupervisorNode::with_default_strategy(
            "sup",
            "监督者",
            make_specs(),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new()); // 空 input
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.unwrap().contains("任务为空"));
    }

    #[tokio::test]
    async fn supervisor_execute_with_invalid_strategy_result_should_error() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 策略返回不存在的 sub_agent_id
        let strategy = Arc::new(StubStrategy::new("non_existent"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.unwrap().contains("子 Agent 不存在"));
    }

    // ─── 测试：lazy 初始化 ────────────────────────────────────

    #[tokio::test]
    async fn agent_pool_should_lazy_init_and_cache() {
        let backend = Arc::new(StubBackend::new("output"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let node = SupervisorNode::with_default_strategy(
            "sup",
            "监督者",
            make_specs(),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let spec = &node.specs()[0];

        // 第一次调用：创建
        let a1 = node.get_or_create_agent(spec).await;
        // 第二次调用：应命中缓存（同一 Arc）
        let a2 = node.get_or_create_agent(spec).await;

        // Arc 指针相等性检查
        assert!(Arc::ptr_eq(&a1, &a2));

        // 池中应只有 1 个实例
        let pool = node.agents.read().await;
        assert_eq!(pool.len(), 1);
    }

    // ─── 测试：事件触发序列 ────────────────────────────────────

    /// 捕获事件发射器 — 把所有 emit 的事件存入 Vec 供断言
    struct CapturingEmitter {
        events: Mutex<Vec<OrchestratorEvent>>,
    }

    impl CapturingEmitter {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        fn events(&self) -> Vec<OrchestratorEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventEmitter for CapturingEmitter {
        fn emit(&self, event: OrchestratorEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    /// 辅助：判断事件是否为 Supervisor 相关事件
    fn is_supervisor_event(event: &OrchestratorEvent) -> bool {
        matches!(
            event,
            OrchestratorEvent::SupervisorTaskAssigned { .. }
                | OrchestratorEvent::SubAgentStarted { .. }
                | OrchestratorEvent::SubAgentCompleted { .. }
                | OrchestratorEvent::SubAgentError { .. }
                | OrchestratorEvent::SupervisorError { .. }
        )
    }

    #[tokio::test]
    async fn execute_should_emit_full_event_sequence_on_success() {
        let backend = Arc::new(StubBackend::new("子 Agent 输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("写一个函数");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);

        let events = emitter.events();
        let sup_events: Vec<_> = events.iter().filter(|e| is_supervisor_event(e)).collect();

        // 应有 3 个事件：SupervisorTaskAssigned → SubAgentStarted → SubAgentCompleted
        assert_eq!(sup_events.len(), 3, "应有 3 个 supervisor 事件");

        // 验证事件类型顺序
        assert!(
            matches!(sup_events[0], OrchestratorEvent::SupervisorTaskAssigned { .. }),
            "第 1 个事件应为 SupervisorTaskAssigned"
        );
        assert!(
            matches!(sup_events[1], OrchestratorEvent::SubAgentStarted { .. }),
            "第 2 个事件应为 SubAgentStarted"
        );
        assert!(
            matches!(sup_events[2], OrchestratorEvent::SubAgentCompleted { .. }),
            "第 3 个事件应为 SubAgentCompleted"
        );

        // 验证 SupervisorTaskAssigned 载荷
        if let OrchestratorEvent::SupervisorTaskAssigned {
            node_id,
            sub_agent_id,
            sub_agent_name,
            task_description,
            reasoning,
        } = &events[0]
        {
            assert_eq!(node_id, "sup");
            assert_eq!(sub_agent_id, "coder");
            assert_eq!(sub_agent_name, "代码专家");
            assert_eq!(task_description, "写一个函数");
            assert!(reasoning.is_some(), "应有 reasoning");
        } else {
            panic!("第 1 个事件类型错误");
        }

        // 验证 SubAgentCompleted 载荷
        if let OrchestratorEvent::SubAgentCompleted {
            output_chars, duration_ms, ..
        } = &events[2]
        {
            assert_eq!(*output_chars, "子 Agent 输出".len());
            assert!(*duration_ms > 0 || *duration_ms == 0, "duration_ms 应为非负数");
        } else {
            panic!("第 3 个事件类型错误");
        }
    }

    #[tokio::test]
    async fn execute_should_emit_supervisor_error_when_spec_not_found() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 策略返回不存在的 sub_agent_id
        let strategy = Arc::new(StubStrategy::new("non_existent"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);

        let events = emitter.events();
        // 应只触发 1 个 SupervisorError 事件（stage="spec_lookup"）
        let sup_errors: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::SupervisorError { .. }))
            .collect();
        assert_eq!(sup_errors.len(), 1);

        if let OrchestratorEvent::SupervisorError { node_id, stage, error } = &events[0] {
            assert_eq!(node_id, "sup");
            assert_eq!(stage, "spec_lookup");
            assert!(error.contains("子 Agent 不存在"));
        } else {
            panic!("应为 SupervisorError 事件");
        }
    }

    // ─── 测试：RoundRobinAssignmentStrategy ────────────────────────────────────

    #[tokio::test]
    async fn round_robin_should_select_in_order() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = RoundRobinAssignmentStrategy::new();

        // 第 1 次：candidates[0] = coder
        let r1 = strategy.assign("任务1", &specs, &backend).await.unwrap();
        assert_eq!(r1.sub_agent_id, "coder");

        // 第 2 次：candidates[1] = writer
        let r2 = strategy.assign("任务2", &specs, &backend).await.unwrap();
        assert_eq!(r2.sub_agent_id, "writer");

        // 第 3 次：循环回 candidates[0] = coder
        let r3 = strategy.assign("任务3", &specs, &backend).await.unwrap();
        assert_eq!(r3.sub_agent_id, "coder");

        // 第 4 次：candidates[1] = writer
        let r4 = strategy.assign("任务4", &specs, &backend).await.unwrap();
        assert_eq!(r4.sub_agent_id, "writer");
    }

    #[tokio::test]
    async fn round_robin_with_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = RoundRobinAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn round_robin_should_keep_task_description_unchanged() {
        let backend = StubBackend::new("");
        let specs = make_specs();
        let strategy = RoundRobinAssignmentStrategy::new();

        let r = strategy.assign("原任务描述", &specs, &backend).await.unwrap();
        assert_eq!(r.task_description, "原任务描述");
        assert!(r.reasoning.is_some());
    }

    // ─── 测试：LoadBasedAssignmentStrategy ────────────────────────────────────

    #[tokio::test]
    async fn load_based_should_select_least_loaded_on_tie_by_id_order() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = LoadBasedAssignmentStrategy::new();

        // 首次：两者负载都是 0，平局选 ID 字典序最小 → "coder"
        let r1 = strategy.assign("任务1", &specs, &backend).await.unwrap();
        assert_eq!(r1.sub_agent_id, "coder");
        assert_eq!(strategy.count_of("coder"), 1);
        assert_eq!(strategy.count_of("writer"), 0);

        // 第二次：coder=1, writer=0，选 writer
        let r2 = strategy.assign("任务2", &specs, &backend).await.unwrap();
        assert_eq!(r2.sub_agent_id, "writer");
        assert_eq!(strategy.count_of("coder"), 1);
        assert_eq!(strategy.count_of("writer"), 1);

        // 第三次：coder=1, writer=1，平局选 ID 字典序最小 → "coder"
        let r3 = strategy.assign("任务3", &specs, &backend).await.unwrap();
        assert_eq!(r3.sub_agent_id, "coder");
        assert_eq!(strategy.count_of("coder"), 2);
        assert_eq!(strategy.count_of("writer"), 1);
    }

    #[tokio::test]
    async fn load_based_with_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = LoadBasedAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn load_based_single_candidate_should_skip_min_lookup() {
        let backend = StubBackend::new("");
        let spec = SubAgentSpec {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一候选".into(),
            system_prompt: "你是唯一".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        let strategy = LoadBasedAssignmentStrategy::new();

        let r = strategy.assign("任务", &[spec], &backend).await.unwrap();
        assert_eq!(r.sub_agent_id, "only");
        assert_eq!(strategy.count_of("only"), 1);
    }

    #[tokio::test]
    async fn load_based_should_balance_over_multiple_assignments() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = LoadBasedAssignmentStrategy::new();

        // 执行 6 次分配，应均衡为 coder=3, writer=3
        for _ in 0..6 {
            strategy.assign("任务", &specs, &backend).await.unwrap();
        }

        assert_eq!(strategy.count_of("coder"), 3);
        assert_eq!(strategy.count_of("writer"), 3);
    }

    // ─── 测试：Supervisor 多轮协调 ────────────────────────────────────

    /// 多轮协调测试：max_rounds=2，子 Agent 输出不包含 [TASK_COMPLETE]，
    /// 应执行 2 轮，每轮都触发完整事件序列。
    #[tokio::test]
    async fn supervisor_multi_round_should_run_all_rounds_without_complete_marker() {
        let backend = Arc::new(StubBackend::new("子 Agent 输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 2,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("写一个函数");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert!(result.summary.is_some());
        // summary 应包含"多轮协调"和"达到最大轮次"
        let summary = result.summary.unwrap();
        assert!(summary.contains("多轮协调"));
        assert!(summary.contains("达到最大轮次"));
        assert!(summary.contains("共 2 轮"));

        // state.messages 应有 2 条（每轮一条）
        let supervisor_msgs: Vec<_> = state
            .messages
            .iter()
            .filter(|m| m.meta.as_ref().and_then(|meta| meta.get("round")).is_some())
            .collect();
        assert_eq!(supervisor_msgs.len(), 2, "应有 2 条轮次消息");

        // 验证 meta 中的 round 字段
        let round1 = supervisor_msgs[0].meta.as_ref().unwrap();
        assert_eq!(round1.get("round").and_then(|v| v.as_u64()), Some(1));
        let round2 = supervisor_msgs[1].meta.as_ref().unwrap();
        assert_eq!(round2.get("round").and_then(|v| v.as_u64()), Some(2));

        // 多轮模式下消息内容应包含轮次前缀
        assert!(supervisor_msgs[0].content.contains("[轮 1/2]"));
        assert!(supervisor_msgs[1].content.contains("[轮 2/2]"));
    }

    /// 多轮协调测试：max_rounds=3，子 Agent 输出包含 [TASK_COMPLETE]，
    /// 应在第一轮后提前结束。
    #[tokio::test]
    async fn supervisor_multi_round_should_early_complete_with_marker() {
        // 子 Agent 输出包含 [TASK_COMPLETE] 标记
        let backend = Arc::new(StubBackend::new("任务已完成 [TASK_COMPLETE]"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 3,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        let summary = result.summary.unwrap();
        // 应只执行 1 轮就提前完成
        assert!(summary.contains("共 1 轮"));
        assert!(summary.contains("提前完成"));

        // state.messages 应只有 1 条
        let supervisor_msgs: Vec<_> = state
            .messages
            .iter()
            .filter(|m| m.meta.as_ref().and_then(|meta| meta.get("round")).is_some())
            .collect();
        assert_eq!(supervisor_msgs.len(), 1);
    }

    /// 单轮模式（max_rounds=1）行为兼容性测试：不应在消息中加轮次前缀
    #[tokio::test]
    async fn supervisor_single_round_should_not_add_round_prefix() {
        let backend = Arc::new(StubBackend::new("输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 1,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);

        // 单轮模式下消息不应包含轮次前缀
        let last = state.messages.last().unwrap();
        assert!(!last.content.contains("[轮"));
        assert!(last.content.contains("[Supervisor → 代码专家]"));
    }
}
