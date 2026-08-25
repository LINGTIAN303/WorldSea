//! Multi-Agent Pattern — 多 Agent 协作模式，详细见 docs/details/注释/agent-runtime/multi_agent.md

mod blackboard;
mod config;
mod error;
mod strategies;
mod types;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::{mpsc, RwLock};
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use crate::agent::AgentLoop;
use crate::backend::NodeBackendAccessor;
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use crate::tool::ToolBus;
use crate::types::{MessageRole, OrchestratorMessage};

pub use blackboard::SharedBlackboard;
pub use config::MultiAgentConfig;
pub use error::{ConvergenceReason, ConvergenceStrategy, MultiAgentError};
pub use strategies::{
    GoalCheckMAPromptTemplate, GoalCheckStrategyMA, LlmGoalCheckStrategyMA, LlmSynthesisStrategy,
    SynthesisPromptTemplate, SynthesisStrategy,
};
pub use types::{AgentMessage, AgentRole, AgentSpec, Topology};

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

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
