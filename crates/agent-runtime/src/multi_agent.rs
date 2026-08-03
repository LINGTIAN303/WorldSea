//! # Multi-Agent Pattern — 多 Agent 协作模式
//!
//! 实现去中心化的多 Agent 协作：N 个对等 Agent 通过消息传递（mpsc）与
//! 共享黑板（SharedBlackboard）协作完成任务。与 Supervisor（中心化调度）
//! 互补，强调 Agent 间的直接通信与并行协作。
//!
//! ## 架构
//! ```text
//! 用户输入
//!    ↓
//! MultiAgentNode.execute
//!    ├─ 1. 初始化：创建 N 个 AgentLoop + N 个 mpsc 通道 + SharedBlackboard
//!    ├─ 2. 按 topology 构建 sender 网络（mesh/ring/star/pipeline/custom）
//!    ├─ 3. 注入 initial_message 启动首个 Agent
//!    ├─ 4. 循环（最多 max_rounds）：
//!    │     ├─ 4.1 并发（JoinSet）：每个 Agent 从 receiver 取消息 + 执行
//!    │     ├─ 4.2 Agent 可读写 Blackboard + 通过 sender 发消息给 peers
//!    │     ├─ 4.3 等待所有 Agent 完成本轮
//!    │     ├─ 4.4 检查收敛条件（MaxRounds / GoalReached / AllAgentsIdle）
//!    │     └─ 4.5 收敛则跳出
//!    ├─ 5. 从 blackboard.final_result 或 LLM 综合输出
//!    └─ 6. 返回 NodeResult（Done）
//! ```
//!
//! ## 关键设计
//! - **混合通信模型**：mpsc 通道处理 Agent 间定向消息，SharedBlackboard 存储全局共享上下文
//! - **可配置拓扑**：Mesh/Ring/Star/Pipeline/Custom，按场景选择
//! - **共享 backend**：所有子 Agent 使用同一个 `NodeBackendAccessor`
//! - **共享 ToolBus**：所有子 Agent 共用父 `ToolBus`
//! - **独立 system_prompt**：每个 Agent 用自己的 system_prompt 定义角色
//! - **Lazy 初始化**：子 Agent 实例在首次调用时创建并缓存
//!
//! ## 与 Supervisor 的区别
//! - Supervisor：中心化 LLM 决策分配任务（一对多）
//! - Multi-Agent：去中心化对等协作（多对多，Agent 间直接通信）

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use crate::agent::{AgentLoop, AgentLoopConfig};
use crate::backend::{NodeBackendAccessor, PromptCallOptions};
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::tool::ToolBus;
use crate::types::{MessageRole, OrchestratorMessage};

// ─── Agent 角色 ────────────────────────────────────────────

/// Agent 角色枚举（语义化标签，影响默认行为与 UI 展示）
///
/// 角色仅作为元数据标签，不强制约束 Agent 行为（行为由 system_prompt 决定）。
/// 前端可据此渲染不同图标/颜色。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    /// 协调者（负责调度其他 Agent，类似 mini-supervisor）
    Coordinator,
    /// 执行者（具体任务执行）
    Worker,
    /// 评审者（评审其他 Agent 的输出）
    Critic,
    /// 研究者（信息检索与分析）
    Researcher,
    /// 创意者（生成创意方案）
    Creative,
    /// 自定义角色（通过 system_prompt 定义）
    Custom,
}

impl Default for AgentRole {
    fn default() -> Self {
        Self::Worker
    }
}

impl AgentRole {
    /// 转为字符串标识（用于序列化/日志）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Coordinator => "coordinator",
            Self::Worker => "worker",
            Self::Critic => "critic",
            Self::Researcher => "researcher",
            Self::Creative => "creative",
            Self::Custom => "custom",
        }
    }
}

// ─── Agent 规格 ────────────────────────────────────────────

/// Agent 规格 — 描述一个参与协作的 Agent
///
/// 由用户在创建 MultiAgentNode 时提供，定义 Agent 的角色、能力与配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSpec {
    /// Agent 唯一 ID（用于消息路由 `AgentMessage.from/to` 引用）
    pub id: String,
    /// 人类可读名称
    pub name: String,
    /// 角色（语义标签，影响默认行为与 UI 展示）
    #[serde(default)]
    pub role: AgentRole,
    /// 能力描述（供其他 Agent 了解其专长，写入 Blackboard 的 agents 索引）
    pub description: String,
    /// 系统提示词（定义 Agent 的专长与行为边界）
    pub system_prompt: String,
    /// 工具白名单（None=继承 ToolBus 中所有工具）
    ///
    /// 注意：阶段 1.2 的 ToolBus 不支持按白名单筛选，此字段仅作元数据记录。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub tools_whitelist: Option<Vec<String>>,
    /// Agent 最大迭代次数（None=用 `AgentLoopConfig` 默认值）
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max_iterations: Option<u32>,
    /// 初始消息（None=不主动启动，等待其他 Agent 发消息）
    ///
    /// 配置后会作为该 Agent 的首轮输入，用于启动协作链。
    /// 典型用法：Coordinator 配置 initial_message = 用户任务，其他 Agent 留空。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub initial_message: Option<String>,
}

// ─── Agent 间消息 ────────────────────────────────────────────

/// Agent 间消息（通过 mpsc 通道传递）
///
/// 设计：消息驱动 + 状态共享分离
/// - 消息（本类型）：定向通信，触发 Agent 行动
/// - 状态（SharedBlackboard）：全局共享，Agent 可读写
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentMessage {
    /// 任务消息（请求接收方执行某任务）
    Task {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID（broadcast 时为 "all"）
        to: String,
        /// 任务内容
        content: String,
    },
    /// 结果消息（任务执行完成后的响应）
    Result {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID
        to: String,
        /// 结果内容
        content: String,
    },
    /// 广播消息（一对多）
    Broadcast {
        /// 发送方 Agent ID
        from: String,
        /// 广播内容
        content: String,
    },
    /// 查询消息（请求接收方提供信息）
    Query {
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID
        to: String,
        /// 查询内容
        query: String,
    },
    /// 同步信号（用于 Agent 间状态同步）
    Synchronize {
        /// 发送方 Agent ID
        from: String,
    },
}

impl AgentMessage {
    /// 获取消息的发送方 ID
    pub fn from(&self) -> &str {
        match self {
            Self::Task { from, .. } => from,
            Self::Result { from, .. } => from,
            Self::Broadcast { from, .. } => from,
            Self::Query { from, .. } => from,
            Self::Synchronize { from } => from,
        }
    }

    /// 获取消息的接收方 ID（broadcast 返回 "all"）
    pub fn to(&self) -> &str {
        match self {
            Self::Task { to, .. } => to,
            Self::Result { to, .. } => to,
            Self::Broadcast { .. } => "all",
            Self::Query { to, .. } => to,
            Self::Synchronize { .. } => "all",
        }
    }

    /// 获取消息内容（Synchronize 返回空字符串）
    pub fn content(&self) -> &str {
        match self {
            Self::Task { content, .. } => content,
            Self::Result { content, .. } => content,
            Self::Broadcast { content, .. } => content,
            Self::Query { query, .. } => query,
            Self::Synchronize { .. } => "",
        }
    }

    /// 消息类型字符串标识（用于事件 payload）
    pub fn message_type(&self) -> &'static str {
        match self {
            Self::Task { .. } => "task",
            Self::Result { .. } => "result",
            Self::Broadcast { .. } => "broadcast",
            Self::Query { .. } => "query",
            Self::Synchronize { .. } => "synchronize",
        }
    }
}

// ─── 拓扑结构 ────────────────────────────────────────────

/// 拓扑结构枚举 — 控制 Agent 间的可通信关系
///
/// 拓扑决定 `build_sender_network` 生成的 sender 映射：
/// - 每个 Agent 持有 `HashMap<peer_id, mpsc::Sender>`
/// - 发消息时按 peer_id 查找 sender，找不到则丢弃
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Topology {
    /// 全连接（mesh）— 每个 Agent 可向其他所有 Agent 发消息
    ///
    /// 适用：小规模协作（N ≤ 5），消息量随 N² 增长
    Mesh,
    /// 环形（ring）— A→B→C→A，每个 Agent 只能向下一个发消息
    ///
    /// 适用：流水线式协作（分析→设计→实现→评审→分析）
    Ring,
    /// 中心辐射（star）— 中心 Agent 可向所有其他 Agent 发消息，其他 Agent 只能向中心发
    ///
    /// 适用：中心协调者场景（类似 Supervisor 但保持对等通信）
    Star {
        /// 中心 Agent ID
        hub_id: String,
    },
    /// 流水线（pipeline）— A→B→C，单向传递，末端可循环回首端（可选）
    ///
    /// 适用：阶段性处理，每个 Agent 处理一个阶段
    Pipeline,
    /// 自定义拓扑 — 显式声明每个 Agent 的 peers
    ///
    /// 适用：复杂协作图（如：Coordinator 可达所有人，Worker 间互不可达）
    Custom {
        /// peers 映射：agent_id → [可通信的 peer_id 列表]
        peers: HashMap<String, Vec<String>>,
    },
}

impl Default for Topology {
    fn default() -> Self {
        Self::Mesh
    }
}

impl Topology {
    /// 构建发送方网络 — 返回每个 Agent 的 peer sender 映射
    ///
    /// # 参数
    /// - `agent_ids`：所有参与 Agent 的 ID 列表
    /// - `senders`：每个 Agent 的 mpsc::Sender（用于 peers 向其发消息）
    ///
    /// # 返回
    /// - `HashMap<agent_id, HashMap<peer_id, Sender>>`：每个 Agent 持有可通信 peers 的 sender
    fn build_sender_network(
        &self,
        agent_ids: &[String],
        senders: &HashMap<String, mpsc::Sender<AgentMessage>>,
    ) -> HashMap<String, HashMap<String, mpsc::Sender<AgentMessage>>> {
        let mut network: HashMap<String, HashMap<String, mpsc::Sender<AgentMessage>>> =
            HashMap::new();

        match self {
            Self::Mesh => {
                // 全连接：每个 Agent 可向其他所有 Agent 发消息
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    for other in agent_ids {
                        if other != id {
                            if let Some(sender) = senders.get(other) {
                                peers.insert(other.clone(), sender.clone());
                            }
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Ring => {
                // 环形：每个 Agent 只能向下一个 Agent 发消息
                let n = agent_ids.len();
                for (i, id) in agent_ids.iter().enumerate() {
                    let next_id = &agent_ids[(i + 1) % n];
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if let Some(sender) = senders.get(next_id) {
                        peers.insert(next_id.clone(), sender.clone());
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Star { hub_id } => {
                // 星型：中心可向所有其他 Agent 发，其他只能向中心发
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if id == hub_id {
                        // 中心：可向所有其他 Agent 发消息
                        for other in agent_ids {
                            if other != id && other != hub_id {
                                if let Some(sender) = senders.get(other) {
                                    peers.insert(other.clone(), sender.clone());
                                }
                            }
                        }
                    } else {
                        // 非中心：只能向中心发消息
                        if let Some(sender) = senders.get(hub_id) {
                            peers.insert(hub_id.clone(), sender.clone());
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Pipeline => {
                // 流水线：A→B→C，单向传递（末端不循环回首端）
                let n = agent_ids.len();
                for (i, id) in agent_ids.iter().enumerate() {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if i + 1 < n {
                        let next_id = &agent_ids[i + 1];
                        if let Some(sender) = senders.get(next_id) {
                            peers.insert(next_id.clone(), sender.clone());
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
            Self::Custom { peers: custom_peers } => {
                // 自定义：按用户声明的 peers 映射构建
                for id in agent_ids {
                    let mut peers: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
                    if let Some(peer_ids) = custom_peers.get(id) {
                        for peer_id in peer_ids {
                            if let Some(sender) = senders.get(peer_id) {
                                peers.insert(peer_id.clone(), sender.clone());
                            }
                        }
                    }
                    network.insert(id.clone(), peers);
                }
            }
        }

        network
    }
}

// ─── 收敛策略 ────────────────────────────────────────────

/// 收敛策略 — 控制多 Agent 协作何时终止
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConvergenceStrategy {
    /// 达到 max_rounds 即停止
    MaxRounds,
    /// LLM 判断目标达成即停止
    GoalReached,
    /// 所有 Agent 空闲且无消息即停止
    AllAgentsIdle,
    /// 组合策略（任一条件满足即停止）
    Hybrid {
        /// 是否启用目标检查
        goal_check: bool,
        /// 最大轮次（即使未达成目标也停止）
        max_rounds: usize,
    },
}

impl Default for ConvergenceStrategy {
    fn default() -> Self {
        Self::Hybrid {
            goal_check: true,
            max_rounds: 10,
        }
    }
}

/// 收敛原因（用于事件 payload）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConvergenceReason {
    /// 达到最大轮次
    MaxRoundsReached,
    /// LLM 判断目标达成
    GoalReached,
    /// 所有 Agent 空闲且无消息
    AllAgentsIdle,
    /// 外部中断
    Aborted,
}

// ─── 共享黑板 ────────────────────────────────────────────

/// 共享黑板 — 全局共享上下文
///
/// 所有 Agent 通过 `Arc<RwLock<SharedBlackboard>>` 并发读写。
/// 设计为简单 KV 存储，避免与具体业务耦合。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedBlackboard {
    /// 原始任务（用户输入）
    pub task: String,
    /// 共享上下文 KV（Agent 可写入中间产物、配置等）
    pub shared_context: HashMap<String, String>,
    /// 每个 Agent 的输出历史（agent_id → [outputs]）
    pub agent_outputs: HashMap<String, Vec<String>>,
    /// 最终结果（任一 Agent 写入即视为达成目标）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_result: Option<String>,
    /// 已完成的轮次数
    pub rounds_completed: usize,
}

impl SharedBlackboard {
    /// 创建新的黑板
    pub fn new(task: impl Into<String>) -> Self {
        Self {
            task: task.into(),
            shared_context: HashMap::new(),
            agent_outputs: HashMap::new(),
            final_result: None,
            rounds_completed: 0,
        }
    }

    /// 写入共享上下文 KV
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.shared_context.insert(key.into(), value.into());
    }

    /// 读取共享上下文 KV
    pub fn get(&self, key: &str) -> Option<&String> {
        self.shared_context.get(key)
    }

    /// 追加 Agent 输出
    pub fn append_output(&mut self, agent_id: impl Into<String>, output: impl Into<String>) {
        self.agent_outputs
            .entry(agent_id.into())
            .or_default()
            .push(output.into());
    }

    /// 获取 Agent 的所有输出
    pub fn get_outputs(&self, agent_id: &str) -> &[String] {
        self.agent_outputs
            .get(agent_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// 设置最终结果
    pub fn set_final_result(&mut self, result: impl Into<String>) {
        self.final_result = Some(result.into());
    }

    /// 增加完成轮次
    pub fn increment_rounds(&mut self) {
        self.rounds_completed += 1;
    }
}

// ─── 多 Agent 配置 ────────────────────────────────────────────

/// Multi-Agent 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiAgentConfig {
    /// 最大协作轮次（防止无限循环，默认 10）
    pub max_rounds: usize,
    /// 单轮最大并发 Agent 数（默认 5，受 tokio JoinSet 调度）
    pub max_concurrency: usize,
    /// 拓扑结构（默认 Mesh）
    #[serde(default)]
    pub topology: Topology,
    /// 是否启用共享黑板（默认 true）
    #[serde(default = "default_true")]
    pub blackboard_enabled: bool,
    /// 是否启用消息传递（默认 true）
    #[serde(default = "default_true")]
    pub message_passing_enabled: bool,
    /// 收敛策略（默认 Hybrid: goal_check + max_rounds=10）
    #[serde(default)]
    pub convergence_strategy: ConvergenceStrategy,
    /// mpsc 通道容量（默认 32，避免背压过大）
    #[serde(default = "default_channel_capacity")]
    pub channel_capacity: usize,
    /// 子 Agent 共享的 AgentLoop 配置
    ///
    /// 注意：`system_prompt` 和 `max_iterations` 会被 `AgentSpec` 的对应字段覆盖。
    /// 序列化时跳过（AgentLoopConfig 含 Duration 等不可序列化字段），
    /// 反序列化时用 `AgentLoopConfig::default()`。
    #[serde(skip)]
    pub agent_loop_config: AgentLoopConfig,
    /// 是否在最后综合所有 Agent 输出（生成 final_result）
    #[serde(default = "default_true")]
    pub require_synthesis: bool,
}

fn default_true() -> bool {
    true
}

fn default_channel_capacity() -> usize {
    32
}

impl Default for MultiAgentConfig {
    fn default() -> Self {
        Self {
            max_rounds: 10,
            max_concurrency: 5,
            topology: Topology::default(),
            blackboard_enabled: true,
            message_passing_enabled: true,
            convergence_strategy: ConvergenceStrategy::default(),
            channel_capacity: 32,
            agent_loop_config: AgentLoopConfig::default(),
            require_synthesis: true,
        }
    }
}

// ─── 错误类型 ────────────────────────────────────────────

/// Multi-Agent 错误类型
#[derive(Debug, thiserror::Error)]
pub enum MultiAgentError {
    #[error("Agent 不存在: {0}")]
    AgentNotFound(String),

    #[error("无可用 Agent（specs 为空）")]
    NoAgents,

    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("Agent '{0}' 执行失败: {1}")]
    AgentRun(String, String),

    #[error("收敛检查失败: {0}")]
    ConvergenceCheck(String),

    #[error("综合输出失败: {0}")]
    Synthesis(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for MultiAgentError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

impl From<crate::agent::AgentError> for MultiAgentError {
    fn from(e: crate::agent::AgentError) -> Self {
        Self::AgentRun("unknown".into(), e.to_string())
    }
}

// ─── 综合策略 trait ────────────────────────────────────────────

/// 综合策略 trait — 如何将多个 Agent 的输出合并为最终结果
///
/// 默认实现：`LlmSynthesisStrategy`（通过 LLM 综合所有 Agent 输出）
/// 可注入自定义实现：拼接、投票、加权等。
#[async_trait]
pub trait SynthesisStrategy: Send + Sync {
    /// 综合 Agent 输出与黑板状态，生成最终结果
    ///
    /// # 参数
    /// - `task`：原始任务
    /// - `blackboard`：共享黑板（含 agent_outputs 等）
    /// - `backend`：LLM 后端访问器
    async fn synthesize(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<String, MultiAgentError>;
}

/// 综合提示词模板
#[derive(Debug, Clone)]
pub struct SynthesisPromptTemplate {
    pub system: String,
    pub user_template: String,
}

impl Default for SynthesisPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个综合者，负责将多个 Agent 的输出整合为最终答案。\
                    请综合所有 Agent 的输出，去除冗余，保留有价值的信息，生成连贯的最终答案。".into(),
            user_template: r#"原始任务：{task}

各 Agent 输出：
{outputs}

请综合上述输出，生成最终的完整答案："#
                .into(),
        }
    }
}

/// LLM 综合策略（默认）
pub struct LlmSynthesisStrategy {
    pub prompt_template: SynthesisPromptTemplate,
}

impl Default for LlmSynthesisStrategy {
    fn default() -> Self {
        Self {
            prompt_template: SynthesisPromptTemplate::default(),
        }
    }
}

impl LlmSynthesisStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_template(template: SynthesisPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 格式化各 Agent 输出
    fn format_outputs(blackboard: &SharedBlackboard) -> String {
        blackboard
            .agent_outputs
            .iter()
            .map(|(agent_id, outputs)| {
                let combined = outputs.join("\n---\n");
                format!("[Agent {}]:\n{}", agent_id, combined)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, task: &str, blackboard: &SharedBlackboard) -> String {
        self.prompt_template
            .user_template
            .replace("{task}", task)
            .replace("{outputs}", &Self::format_outputs(blackboard))
    }
}

#[async_trait]
impl SynthesisStrategy for LlmSynthesisStrategy {
    async fn synthesize(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<String, MultiAgentError> {
        // 如果黑板已有 final_result，直接返回
        if let Some(result) = &blackboard.final_result {
            return Ok(result.clone());
        }

        // 如果只有一个 Agent 输出，直接返回（无需综合）
        if blackboard.agent_outputs.len() == 1 {
            let outputs = blackboard.agent_outputs.values().next().unwrap();
            if outputs.len() == 1 {
                return Ok(outputs[0].clone());
            }
        }

        // 调用 LLM 综合
        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(task, blackboard);
        debug!("Multi-Agent: 调用 LLM 综合，task 长度: {}", task.len());

        let response = backend.prompt(user_prompt, Some(options)).await?;
        info!(
            "Multi-Agent: LLM 综合完成，输出长度: {}",
            response.text.len()
        );

        Ok(response.text)
    }
}

// ─── 目标检查策略 trait ────────────────────────────────────────────

/// 目标检查策略 trait — 判断协作是否已达成目标
///
/// 默认实现：`LlmGoalCheckStrategy`（通过 LLM 判断）
/// 可注入自定义实现：基于关键词、基于评分等。
#[async_trait]
pub trait GoalCheckStrategyMA: Send + Sync {
    /// 检查协作是否已达成目标
    ///
    /// # 参数
    /// - `task`：原始任务
    /// - `blackboard`：共享黑板
    /// - `backend`：LLM 后端访问器
    async fn check_goal(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, MultiAgentError>;
}

/// 目标检查提示词模板
#[derive(Debug, Clone)]
pub struct GoalCheckMAPromptTemplate {
    pub system: String,
    pub user_template: String,
}

impl Default for GoalCheckMAPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个目标检查者，负责判断多 Agent 协作是否已达成原始任务目标。\
                    请基于各 Agent 的输出，判断任务是否已完成。\
                    必须输出合法 JSON 格式：{\"goal_reached\": true/false, \"reasoning\": \"...\"}".into(),
            user_template: r#"原始任务：{task}

各 Agent 输出：
{outputs}

请判断任务是否已完成（仅输出 JSON）："#
                .into(),
        }
    }
}

/// LLM 目标检查策略（默认）
pub struct LlmGoalCheckStrategyMA {
    pub prompt_template: GoalCheckMAPromptTemplate,
}

impl Default for LlmGoalCheckStrategyMA {
    fn default() -> Self {
        Self {
            prompt_template: GoalCheckMAPromptTemplate::default(),
        }
    }
}

impl LlmGoalCheckStrategyMA {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_template(template: GoalCheckMAPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    fn format_outputs(blackboard: &SharedBlackboard) -> String {
        blackboard
            .agent_outputs
            .iter()
            .map(|(agent_id, outputs)| {
                let combined = outputs.join("\n---\n");
                format!("[Agent {}]:\n{}", agent_id, combined)
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn render_user_prompt(&self, task: &str, blackboard: &SharedBlackboard) -> String {
        self.prompt_template
            .user_template
            .replace("{task}", task)
            .replace("{outputs}", &Self::format_outputs(blackboard))
    }

    fn parse_response(text: &str) -> Result<bool, MultiAgentError> {
        let trimmed = text.trim();
        let json_str = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .and_then(|s| s.strip_suffix("```"))
            .map(|s| s.trim())
            .unwrap_or(trimmed);

        #[derive(serde::Deserialize)]
        struct GoalCheckResponse {
            goal_reached: bool,
            #[serde(default)]
            #[allow(dead_code)]
            reasoning: Option<String>,
        }

        let result: GoalCheckResponse = serde_json::from_str(json_str).map_err(|e| {
            MultiAgentError::Parse(format!("JSON 解析失败: {} (input: {})", e, json_str))
        })?;

        Ok(result.goal_reached)
    }
}

#[async_trait]
impl GoalCheckStrategyMA for LlmGoalCheckStrategyMA {
    async fn check_goal(
        &self,
        task: &str,
        blackboard: &SharedBlackboard,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, MultiAgentError> {
        // 如果黑板已有 final_result，视为达成
        if blackboard.final_result.is_some() {
            return Ok(true);
        }

        // 如果无 Agent 输出，未达成
        if blackboard.agent_outputs.is_empty() {
            return Ok(false);
        }

        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        let user_prompt = self.render_user_prompt(task, blackboard);
        let response = backend.prompt(user_prompt, Some(options)).await?;

        Self::parse_response(&response.text)
    }
}

// ─── MultiAgentNode ────────────────────────────────────────────

/// MultiAgentNode — 多 Agent 协作节点
///
/// 在编排图中作为一个节点存在，被 Orchestrator 调度执行时：
/// 1. 初始化：创建 N 个 AgentLoop + N 个 mpsc 通道 + SharedBlackboard
/// 2. 按 topology 构建 sender 网络
/// 3. 注入 initial_message 启动协作
/// 4. 循环执行直到收敛
/// 5. 综合输出，写入 state.messages
/// 6. 返回 `Done`
pub struct MultiAgentNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// Agent 规格列表
    specs: Vec<AgentSpec>,
    /// 子 Agent 实例池（lazy 初始化）
    agents: Arc<RwLock<HashMap<String, Arc<AgentLoop>>>>,
    /// 共享 LLM 后端
    backend: Arc<dyn NodeBackendAccessor>,
    /// 共享工具总线
    tool_bus: Arc<dyn ToolBus>,
    /// 配置
    config: MultiAgentConfig,
    /// 综合策略
    synthesis_strategy: Arc<dyn SynthesisStrategy>,
    /// 目标检查策略
    goal_check_strategy: Arc<dyn GoalCheckStrategyMA>,
    /// 最后一次 execute 的黑板快照（用于 cmd_multi_agent_get_blackboard 读取）
    ///
    /// 每次 execute 结束时写入最新黑板状态。命令层通过 `last_blackboard()` 读取。
    /// 初始为 None（未执行过 execute）。
    last_blackboard: Arc<RwLock<Option<SharedBlackboard>>>,
}

impl MultiAgentNode {
    /// 创建新的 Multi-Agent 节点
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        specs: Vec<AgentSpec>,
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        config: MultiAgentConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            specs,
            agents: Arc::new(RwLock::new(HashMap::new())),
            backend,
            tool_bus,
            config,
            synthesis_strategy: Arc::new(LlmSynthesisStrategy::new()),
            goal_check_strategy: Arc::new(LlmGoalCheckStrategyMA::new()),
            last_blackboard: Arc::new(RwLock::new(None)),
        }
    }

    /// 使用自定义综合策略与目标检查策略创建
    #[allow(clippy::too_many_arguments)]
    pub fn with_strategies(
        id: impl Into<String>,
        name: impl Into<String>,
        specs: Vec<AgentSpec>,
        backend: Arc<dyn NodeBackendAccessor>,
        tool_bus: Arc<dyn ToolBus>,
        config: MultiAgentConfig,
        synthesis_strategy: Arc<dyn SynthesisStrategy>,
        goal_check_strategy: Arc<dyn GoalCheckStrategyMA>,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            specs,
            agents: Arc::new(RwLock::new(HashMap::new())),
            backend,
            tool_bus,
            config,
            synthesis_strategy,
            goal_check_strategy,
            last_blackboard: Arc::new(RwLock::new(None)),
        }
    }

    /// 获取最后一次 execute 的黑板快照
    ///
    /// 返回 `Option<SharedBlackboard>`：
    /// - `Some(bb)`：已执行过 execute，返回最后一次的黑板快照
    /// - `None`：尚未执行 execute
    ///
    /// 用于 `cmd_multi_agent_get_blackboard` 命令读取协作过程中的黑板状态，
    /// 供前端展示 Agent 输出、共享上下文、最终结果等。
    pub async fn last_blackboard(&self) -> Option<SharedBlackboard> {
        self.last_blackboard.read().await.clone()
    }

    /// 获取或创建子 Agent 实例（lazy 初始化）
    async fn get_or_create_agent(&self, spec: &AgentSpec) -> Arc<AgentLoop> {
        {
            let agents = self.agents.read().await;
            if let Some(agent) = agents.get(&spec.id) {
                return Arc::clone(agent);
            }
        }

        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get(&spec.id) {
            return Arc::clone(agent);
        }

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
        info!("Multi-Agent: 创建子 Agent 实例 id={} name={}", spec.id, spec.name);
        agent
    }

    /// 查找 Agent 规格
    ///
    /// 当前未被调用（deep 编排子 Agent 检索待 5.4 高级能力补齐时启用），
    /// 保留供后续多 Agent 编排使用。
    #[allow(dead_code)]
    fn find_spec(&self, agent_id: &str) -> Option<&AgentSpec> {
        self.specs.iter().find(|s| s.id == agent_id)
    }

    /// 获取 Agent 规格列表（只读）
    pub fn specs(&self) -> &[AgentSpec] {
        &self.specs
    }

    /// 清空子 Agent 实例池
    pub async fn clear_agent_pool(&self) {
        let mut agents = self.agents.write().await;
        agents.clear();
    }

    /// 发送消息给指定 peer（如果拓扑允许）
    async fn send_message(
        peer_senders: &HashMap<String, mpsc::Sender<AgentMessage>>,
        message: AgentMessage,
    ) {
        let to = message.to().to_string();
        if to == "all" {
            // 广播：发送给所有 peers
            for sender in peer_senders.values() {
                let _ = sender.send(message.clone()).await;
            }
        } else if let Some(sender) = peer_senders.get(&to) {
            let _ = sender.send(message).await;
        } else {
            warn!(
                "Multi-Agent: 无法发送消息给 '{}'（拓扑不允许或 Agent 不存在）",
                to
            );
        }
    }

    /// 执行单个 Agent 的一轮（取消息 + 执行 + 写黑板 + 发消息）
    async fn execute_agent_round(
        agent_id: String,
        agent: Arc<AgentLoop>,
        mut receiver: mpsc::Receiver<AgentMessage>,
        blackboard: Arc<RwLock<SharedBlackboard>>,
        peer_senders: HashMap<String, mpsc::Sender<AgentMessage>>,
        initial_message: Option<String>,
        node_id: String,
        emitter: Arc<dyn EventEmitterSafe>,
    ) -> Result<String, MultiAgentError> {
        let _node_id = node_id;

        // ── 1. 获取输入消息 ──
        let input = if let Some(msg) = initial_message {
            msg
        } else if let Some(msg) = receiver.recv().await {
            // 将消息内容作为输入
            let content = msg.content().to_string();
            let from = msg.from().to_string();
            let msg_type = msg.message_type();
            emitter.emit_safe(OrchestratorEvent::MultiAgentMessageSent {
                node_id: _node_id.clone(),
                from: from.clone(),
                to: agent_id.clone(),
                message_type: msg_type.into(),
                content_preview: content.chars().take(200).collect(),
            });
            content
        } else {
            // 通道关闭且无初始消息：Agent 空闲
            debug!("Multi-Agent: Agent '{}' 空闲（通道关闭）", agent_id);
            return Ok(String::new());
        };

        // ── 2. 执行 Agent ──
        debug!(
            "Multi-Agent: Agent '{}' 开始执行，输入长度: {}",
            agent_id,
            input.len()
        );

        let output = match agent.run(input.clone()).await {
            Ok(text) => text,
            Err(e) => {
                let err_msg = format!("Agent '{}' 执行失败: {}", agent_id, e);
                emitter.emit_safe(OrchestratorEvent::MultiAgentError {
                    node_id: _node_id.clone(),
                    agent_id: agent_id.clone(),
                    error: err_msg.clone(),
                });
                return Err(MultiAgentError::AgentRun(agent_id.clone(), err_msg));
            }
        };

        // ── 3. 写入黑板 ──
        {
            let mut bb = blackboard.write().await;
            bb.append_output(&agent_id, &output);
            emitter.emit_safe(OrchestratorEvent::MultiAgentBlackboardUpdated {
                node_id: _node_id.clone(),
                key: format!("agent_output:{}", agent_id),
                by: agent_id.clone(),
            });
        }

        // ── 4. 通过 sender 发送结果消息给 peers ──
        // 默认行为：广播结果给所有 peers（前端可据此展示消息流）
        if !peer_senders.is_empty() {
            let broadcast_msg = AgentMessage::Result {
                from: agent_id.clone(),
                to: "all".into(),
                content: output.clone(),
            };
            Self::send_message(&peer_senders, broadcast_msg).await;
        }

        Ok(output)
    }

    /// 检查收敛条件
    async fn check_convergence(
        &self,
        ctx: &NodeContext<'_>,
        blackboard: &SharedBlackboard,
        round: usize,
    ) -> Result<Option<ConvergenceReason>, MultiAgentError> {
        // 外部中断
        if ctx.is_aborted() {
            return Ok(Some(ConvergenceReason::Aborted));
        }

        match &self.config.convergence_strategy {
            ConvergenceStrategy::MaxRounds => {
                if round >= self.config.max_rounds {
                    return Ok(Some(ConvergenceReason::MaxRoundsReached));
                }
            }
            ConvergenceStrategy::GoalReached => {
                let reached = self
                    .goal_check_strategy
                    .check_goal(&blackboard.task, blackboard, ctx.backend)
                    .await?;
                if reached {
                    return Ok(Some(ConvergenceReason::GoalReached));
                }
            }
            ConvergenceStrategy::AllAgentsIdle => {
                // 如果所有 Agent 都已有输出且无新消息，视为空闲
                // 简化判断：如果所有 Agent 都有输出且轮次 >= 1，视为完成
                if round >= 1
                    && blackboard
                        .agent_outputs
                        .len()
                        .saturating_sub(self.specs.len())
                        == 0
                    && !blackboard.agent_outputs.is_empty()
                {
                    return Ok(Some(ConvergenceReason::AllAgentsIdle));
                }
            }
            ConvergenceStrategy::Hybrid {
                goal_check,
                max_rounds,
            } => {
                if round >= *max_rounds {
                    return Ok(Some(ConvergenceReason::MaxRoundsReached));
                }
                if *goal_check {
                    let reached = self
                        .goal_check_strategy
                        .check_goal(&blackboard.task, blackboard, ctx.backend)
                        .await?;
                    if reached {
                        return Ok(Some(ConvergenceReason::GoalReached));
                    }
                }
            }
        }

        Ok(None)
    }
}

// ─── EventEmitterSafe 包装 trait ────────────────────────────────────────────

/// 线程安全的事件发射器包装（用于 JoinSet 并发执行）
///
/// `NodeContext<'a>` 的生命周期限制使其无法跨 JoinSet 任务使用，
/// 通过此 trait 将 emit 能力提取为 'static 闭包。
pub trait EventEmitterSafe: Send + Sync {
    fn emit_safe(&self, event: OrchestratorEvent);
}

/// 基于 Mutex 收集事件的实现（用于 JoinSet 内部收集后统一发射）
pub struct CollectingEmitter {
    events: tokio::sync::Mutex<Vec<OrchestratorEvent>>,
}

impl CollectingEmitter {
    pub fn new() -> Self {
        Self {
            events: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    pub async fn drain(&self) -> Vec<OrchestratorEvent> {
        self.events.lock().await.drain(..).collect()
    }
}

impl Default for CollectingEmitter {
    fn default() -> Self {
        Self::new()
    }
}

impl EventEmitterSafe for CollectingEmitter {
    fn emit_safe(&self, event: OrchestratorEvent) {
        let events = &self.events;
        // 使用 try_lock 避免阻塞，失败则丢弃事件
        if let Ok(mut guard) = events.try_lock() {
            guard.push(event);
        }
    }
}

#[async_trait]
impl OrchestratorNode for MultiAgentNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::MultiAgent
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // ── 1. 读取当前任务 ──
        let task = if !ctx.state.input.is_empty() {
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

        if task.is_empty() {
            return NodeResult::error(
                "Multi-Agent: 任务为空（state.input 与 messages 中均无 user 消息）",
            );
        }

        if self.specs.is_empty() {
            return NodeResult::error("Multi-Agent: 无可用 Agent（specs 为空）");
        }

        // ── 2. 中断检查 ──
        if ctx.is_aborted() {
            warn!("Multi-Agent: 中断检查命中（初始化前）");
            return NodeResult::aborted();
        }

        // ── 3. 初始化黑板 ──
        let blackboard = Arc::new(RwLock::new(SharedBlackboard::new(task.clone())));

        // 写入 Agent 索引到黑板
        {
            let mut bb = blackboard.write().await;
            for spec in &self.specs {
                bb.set(
                    format!("agent_info:{}", spec.id),
                    format!(
                        "{{\"name\":\"{}\",\"role\":\"{}\",\"description\":\"{}\"}}",
                        spec.name,
                        spec.role.as_str(),
                        spec.description
                    ),
                );
            }
        }

        // ── 4. 创建 mpsc 通道 ──
        let mut senders: HashMap<String, mpsc::Sender<AgentMessage>> = HashMap::new();
        let mut receivers: HashMap<String, mpsc::Receiver<AgentMessage>> = HashMap::new();
        for spec in &self.specs {
            let (tx, rx) = mpsc::channel::<AgentMessage>(self.config.channel_capacity);
            senders.insert(spec.id.clone(), tx);
            receivers.insert(spec.id.clone(), rx);
        }

        // ── 5. 构建拓扑网络 ──
        // 注意：network 必须声明为 mut，因为每轮 receiver 被 move 到 JoinSet 后，
        // 需要重建通道（含新 sender），并用新 senders 重建 network。
        // 旧 sender 对应的 receiver 已被消费，发消息会失败（channel closed）。
        let agent_ids: Vec<String> = self.specs.iter().map(|s| s.id.clone()).collect();
        let mut network = self
            .config
            .topology
            .build_sender_network(&agent_ids, &senders);

        // ── 6. 注入 initial_message 启动协作 ──
        // 找到第一个配置了 initial_message 的 Agent，注入用户任务作为首轮消息
        for spec in &self.specs {
            if let Some(initial) = &spec.initial_message {
                let combined = format!("原始任务：{}\n\n初始指令：{}", task, initial);
                if let Some(sender) = senders.get(&spec.id) {
                    let _ = sender
                        .send(AgentMessage::Task {
                            from: "user".into(),
                            to: spec.id.clone(),
                            content: combined,
                        })
                        .await;
                    debug!(
                        "Multi-Agent: 注入 initial_message 给 Agent '{}'",
                        spec.id
                    );
                }
            }
        }

        // ── 7. 循环执行直到收敛 ──
        let mut round = 0;
        let mut convergence_reason: Option<ConvergenceReason> = None;

        while round < self.config.max_rounds {
            round += 1;

            // 中断检查
            if ctx.is_aborted() {
                convergence_reason = Some(ConvergenceReason::Aborted);
                break;
            }

            ctx.emit(OrchestratorEvent::MultiAgentRoundStarted {
                node_id: self.id.clone(),
                round,
                agent_count: self.specs.len(),
            });

            // ── 7.1 并发执行所有 Agent 的一轮 ──
            let collecting_emitter = Arc::new(CollectingEmitter::new());
            let mut join_set: JoinSet<Result<String, MultiAgentError>> = JoinSet::new();

            for spec in self.specs.clone() {
                let agent = self.get_or_create_agent(&spec).await;
                let rx = match receivers.remove(&spec.id) {
                    Some(rx) => rx,
                    None => {
                        return NodeResult::error(format!("通道丢失: {}", spec.id));
                    }
                };
                let bb = Arc::clone(&blackboard);
                let peers = network
                    .get(&spec.id)
                    .cloned()
                    .unwrap_or_default();
                let initial_msg = if round == 1 {
                    spec.initial_message.clone()
                } else {
                    None
                };
                let node_id = self.id.clone();
                let emitter = Arc::clone(&collecting_emitter);

                join_set.spawn(async move {
                    Self::execute_agent_round(
                        spec.id.clone(),
                        agent,
                        rx,
                        bb,
                        peers,
                        initial_msg,
                        node_id,
                        emitter,
                    )
                    .await
                });
            }

            // ── 7.2 等待所有 Agent 完成本轮 ──
            let mut round_outputs: Vec<String> = Vec::new();
            let mut had_error = false;

            while let Some(result) = join_set.join_next().await {
                match result {
                    Ok(Ok(output)) => {
                        if !output.is_empty() {
                            round_outputs.push(output);
                        }
                    }
                    Ok(Err(e)) => {
                        had_error = true;
                        warn!("Multi-Agent: Agent 执行失败: {}", e);
                    }
                    Err(e) => {
                        had_error = true;
                        warn!("Multi-Agent: JoinSet 任务失败: {}", e);
                    }
                }
            }

            // ── 7.3 重建通道与 network（用于下一轮）──
            // 每轮 receiver 被 move 到 JoinSet 任务后无法恢复，必须重建所有通道。
            // 关键：senders 更新后必须同步重建 network，否则下一轮 network 持有的
            // 旧 sender 对应的 receiver 已被消费完毕，发消息会失败（channel closed）。
            for spec in &self.specs {
                let (new_tx, new_rx) =
                    mpsc::channel::<AgentMessage>(self.config.channel_capacity);
                senders.insert(spec.id.clone(), new_tx);
                receivers.insert(spec.id.clone(), new_rx);
            }
            // 用新 senders 重建 network（关键修复：旧 sender 已失效）
            network = self
                .config
                .topology
                .build_sender_network(&agent_ids, &senders);

            // ── 7.4 收集事件并转发到主 emitter ──
            let collected = collecting_emitter.drain().await;
            for event in collected {
                ctx.emit(event);
            }

            // ── 7.5 增加完成轮次 ──
            {
                let mut bb = blackboard.write().await;
                bb.increment_rounds();
            }

            ctx.emit(OrchestratorEvent::MultiAgentRoundCompleted {
                node_id: self.id.clone(),
                round,
                outputs: round_outputs.clone(),
            });

            // ── 7.6 检查收敛 ──
            let bb_snapshot = blackboard.read().await.clone();
            match self.check_convergence(&ctx, &bb_snapshot, round).await {
                Ok(Some(reason)) => {
                    convergence_reason = Some(reason);
                    break;
                }
                Ok(None) => {
                    // 继续下一轮
                }
                Err(e) => {
                    let err_msg = format!("收敛检查失败: {}", e);
                    ctx.emit(OrchestratorEvent::MultiAgentError {
                        node_id: self.id.clone(),
                        agent_id: "system".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult::error(err_msg);
                }
            }

            // 如果本轮所有 Agent 都失败，提前终止
            if had_error && round_outputs.is_empty() {
                warn!("Multi-Agent: 本轮所有 Agent 失败且无输出，提前终止");
                convergence_reason = Some(ConvergenceReason::AllAgentsIdle);
                break;
            }
        }

        // ── 8. 收敛原因兜底 ──
        let reason = convergence_reason.unwrap_or(ConvergenceReason::MaxRoundsReached);

        // ── 9. 综合输出 ──
        let final_result = if self.config.require_synthesis {
            let bb_snapshot = blackboard.read().await.clone();
            match self
                .synthesis_strategy
                .synthesize(&task, &bb_snapshot, ctx.backend)
                .await
            {
                Ok(text) => text,
                Err(e) => {
                    warn!("Multi-Agent: 综合输出失败: {}, 使用最后输出兜底", e);
                    bb_snapshot
                        .agent_outputs
                        .values()
                        .last()
                        .and_then(|v| v.last())
                        .cloned()
                        .unwrap_or_default()
                }
            }
        } else {
            // 不综合：取最后一个 Agent 的输出
            blackboard
                .read()
                .await
                .agent_outputs
                .values()
                .last()
                .and_then(|v| v.last())
                .cloned()
                .unwrap_or_default()
        };

        // 写入 final_result 到黑板
        {
            let mut bb = blackboard.write().await;
            bb.set_final_result(&final_result);
        }

        ctx.emit(OrchestratorEvent::MultiAgentConverged {
            node_id: self.id.clone(),
            reason: format!("{:?}", reason),
            final_result: final_result.clone(),
        });

        // ── 10. 写入 state.messages ──
        let mut meta = HashMap::new();
        meta.insert(
            "multi_agent_node_id".to_string(),
            serde_json::json!(self.id),
        );
        meta.insert(
            "agent_count".to_string(),
            serde_json::json!(self.specs.len()),
        );
        meta.insert(
            "rounds_completed".to_string(),
            serde_json::json!(round),
        );
        meta.insert(
            "convergence_reason".to_string(),
            serde_json::json!(format!("{:?}", reason)),
        );

        ctx.state.messages.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: format!(
                "[Multi-Agent 协作完成] 共 {} 个 Agent，{} 轮协作\n\n{}",
                self.specs.len(),
                round,
                final_result
            ),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: Some(meta),
        });

        // ── 11. 写入 last_blackboard 快照（供 cmd_multi_agent_get_blackboard 读取）──
        {
            let bb_snapshot = blackboard.read().await.clone();
            *self.last_blackboard.write().await = Some(bb_snapshot);
        }

        // ── 12. 返回 Done ──
        NodeResult {
            status: NodeStatus::Done,
            next_node_id: None,
            error: None,
            summary: Some(format!(
                "Multi-Agent: {} 个 Agent 协作完成（{} 轮）",
                self.specs.len(),
                round
            )),
        }
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_role_as_str() {
        assert_eq!(AgentRole::Coordinator.as_str(), "coordinator");
        assert_eq!(AgentRole::Worker.as_str(), "worker");
        assert_eq!(AgentRole::Critic.as_str(), "critic");
        assert_eq!(AgentRole::Researcher.as_str(), "researcher");
        assert_eq!(AgentRole::Creative.as_str(), "creative");
        assert_eq!(AgentRole::Custom.as_str(), "custom");
    }

    #[test]
    fn test_agent_message_helpers() {
        let msg = AgentMessage::Task {
            from: "a".into(),
            to: "b".into(),
            content: "hello".into(),
        };
        assert_eq!(msg.from(), "a");
        assert_eq!(msg.to(), "b");
        assert_eq!(msg.content(), "hello");
        assert_eq!(msg.message_type(), "task");

        let broadcast = AgentMessage::Broadcast {
            from: "a".into(),
            content: "info".into(),
        };
        assert_eq!(broadcast.to(), "all");
        assert_eq!(broadcast.message_type(), "broadcast");
    }

    #[test]
    fn test_shared_blackboard() {
        let mut bb = SharedBlackboard::new("测试任务");
        assert_eq!(bb.task, "测试任务");
        assert_eq!(bb.rounds_completed, 0);

        bb.set("key1", "value1");
        assert_eq!(bb.get("key1"), Some(&"value1".to_string()));

        bb.append_output("agent_a", "输出1");
        bb.append_output("agent_a", "输出2");
        assert_eq!(bb.get_outputs("agent_a"), &["输出1", "输出2"]);

        bb.set_final_result("最终结果");
        assert_eq!(bb.final_result, Some("最终结果".to_string()));

        bb.increment_rounds();
        assert_eq!(bb.rounds_completed, 1);
    }

    #[test]
    fn test_topology_mesh_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Mesh.build_sender_network(&agent_ids, &senders);
        assert_eq!(network.len(), 3);
        // Mesh: 每个 Agent 应有 2 个 peers
        assert_eq!(network.get("a").unwrap().len(), 2);
        assert_eq!(network.get("b").unwrap().len(), 2);
        assert_eq!(network.get("c").unwrap().len(), 2);
    }

    #[test]
    fn test_topology_ring_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Ring.build_sender_network(&agent_ids, &senders);
        // Ring: 每个 Agent 只能向下一个发消息
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("b"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("c"));
        assert_eq!(network.get("c").unwrap().len(), 1);
        assert!(network.get("c").unwrap().contains_key("a"));
    }

    #[test]
    fn test_topology_star_build_network() {
        let agent_ids = vec![
            "hub".to_string(),
            "a".to_string(),
            "b".to_string(),
        ];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Star {
            hub_id: "hub".into(),
        }
        .build_sender_network(&agent_ids, &senders);

        // 中心 Agent 可向所有其他 Agent 发消息
        assert_eq!(network.get("hub").unwrap().len(), 2);
        // 非中心 Agent 只能向中心发消息
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("hub"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("hub"));
    }

    #[test]
    fn test_topology_pipeline_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let network = Topology::Pipeline.build_sender_network(&agent_ids, &senders);
        // Pipeline: A→B→C，单向
        assert_eq!(network.get("a").unwrap().len(), 1);
        assert!(network.get("a").unwrap().contains_key("b"));
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert!(network.get("b").unwrap().contains_key("c"));
        // 末端 C 无下游
        assert_eq!(network.get("c").unwrap().len(), 0);
    }

    #[test]
    fn test_topology_custom_build_network() {
        let agent_ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let mut senders = HashMap::new();
        for id in &agent_ids {
            let (tx, _rx) = mpsc::channel::<AgentMessage>(8);
            senders.insert(id.clone(), tx);
        }

        let mut peers = HashMap::new();
        peers.insert("a".to_string(), vec!["b".to_string(), "c".to_string()]);
        peers.insert("b".to_string(), vec!["c".to_string()]);
        peers.insert("c".to_string(), vec!["a".to_string()]);

        let network = Topology::Custom { peers }.build_sender_network(&agent_ids, &senders);
        assert_eq!(network.get("a").unwrap().len(), 2);
        assert_eq!(network.get("b").unwrap().len(), 1);
        assert_eq!(network.get("c").unwrap().len(), 1);
    }

    #[test]
    fn test_multi_agent_config_default() {
        let config = MultiAgentConfig::default();
        assert_eq!(config.max_rounds, 10);
        assert_eq!(config.max_concurrency, 5);
        assert!(matches!(config.topology, Topology::Mesh));
        assert!(config.blackboard_enabled);
        assert!(config.message_passing_enabled);
        assert_eq!(config.channel_capacity, 32);
        assert!(config.require_synthesis);
    }

    #[test]
    fn test_collecting_emitter() {
        let emitter = CollectingEmitter::new();
        emitter.emit_safe(OrchestratorEvent::MultiAgentRoundStarted {
            node_id: "test".into(),
            round: 1,
            agent_count: 3,
        });

        let rt = tokio::runtime::Runtime::new().unwrap();
        let collected = rt.block_on(emitter.drain());
        assert_eq!(collected.len(), 1);
    }
}
