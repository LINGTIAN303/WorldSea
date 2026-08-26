//! Supervisor Pattern — 监督者编排模式，详细见 docs/details/注释/agent-runtime/supervisor.md

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tracing::{debug, info, warn};

use agent_kernel::agent::{AgentLoop, AgentLoopConfig};
use agent_kernel::backend::{NodeBackendAccessor, PromptCallOptions};
use agent_kernel::event::OrchestratorEvent;
use agent_kernel::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use agent_kernel::sub_agent_pool::SubAgentPool;
use agent_kernel::tool::ToolBus;
use agent_kernel::types::{MessageRole, OrchestratorMessage};

// ─── 子 Agent 规格 ────────────────────────────────────────────

/// 子 Agent 规格 — 已上移底座 `agent_kernel::sub_agent_pool::SubAgentSpec`
///
/// （matrix §7 待决 7：共享池下沉，SubAgentManager 与 SupervisorNode 共用类型），
/// 此处 pub re-export 保持对外路径 `supervisor::SubAgentSpec` 兼容。
pub use agent_kernel::sub_agent_pool::SubAgentSpec;

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

impl From<agent_kernel::backend::BackendError> for AssignmentError {
    fn from(e: agent_kernel::backend::BackendError) -> Self {
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

/// 轮询分配策略，详细见 docs/details/注释/agent-runtime/supervisor.md
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

/// 负载均衡分配策略，详细见 docs/details/注释/agent-runtime/supervisor.md
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
    /// 最大协调轮次（防止无限循环，默认 5），详细见 docs/details/注释/agent-runtime/supervisor.md
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

/// SupervisorNode — 监督者节点，详细见 docs/details/注释/agent-runtime/supervisor.md
pub struct SupervisorNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 子 Agent 规格（按声明顺序，LLM 策略会展示给 LLM）
    specs: Vec<SubAgentSpec>,
    /// 子 Agent 实例池（共享底层 SubAgentPool，matrix §7 待决 7；持有 backend/tool_bus）
    pool: SubAgentPool,
    /// 任务分配策略
    strategy: Arc<dyn AssignmentStrategy>,
    /// 配置
    config: SupervisorConfig,
}

impl SupervisorNode {
    /// 创建新的 Supervisor 节点，详细见 docs/details/注释/agent-runtime/supervisor.md
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
            pool: SubAgentPool::new(
                backend,
                tool_bus,
                config.agent_loop_config.max_iterations,
            ),
            strategy,
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

    /// 获取或创建子 Agent 实例（懒加载，经共享 SubAgentPool）
    ///
    /// 以共享 `agent_loop_config` 为基础配置（规格覆盖 system_prompt / max_iterations），
    /// 规格变更时池内自动重建 + 上下文迁移；规格指定白名单时自动工具隔离。
    async fn get_or_create_agent(&self, spec: &SubAgentSpec) -> Arc<AgentLoop> {
        self.pool
            .get_or_create(spec, self.config.agent_loop_config.clone())
            .await
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
        self.pool.clear().await;
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

#[cfg(test)]
#[path = "supervisor_tests.rs"]
mod tests;
