//! Tree of Thoughts (ToT) — 思维树编排模式，详细见 docs/details/注释/agent-runtime/tree_of_thoughts.md
//!
//! 类型与策略已上移 patterns/shared/thoughts.rs（GoT 共享），本模块仅保留 ToTNode 执行体。

// 从共享层转入类型与策略（同时 re-export，保持对外可见性不变）
pub use crate::shared::thoughts::{
    BeamSearchStrategy, ExplorationPromptTemplate, ExplorationStrategy, GoalCheckPromptTemplate,
    GoalCheckStrategy, LlmGoalCheckStrategy, LlmScoringStrategy, ScoringPromptTemplate,
    ScoringStrategy, ThoughtNode, ThoughtNodeStatus, ToTConfig, ToTError, ToTTerminationReason,
};

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;
use tokio::task::JoinSet;
use tracing::{debug, info, warn};

use agent_kernel::backend::NodeBackendAccessor;
use agent_kernel::event::OrchestratorEvent;
use agent_kernel::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
use agent_kernel::types::{MessageRole, OrchestratorMessage};

#[cfg(test)]
use agent_kernel::backend::PromptCallOptions;

// ─── ToTNode ────────────────────────────────────────────

/// ToTNode — Tree of Thoughts 节点，详细见 docs/details/注释/agent-runtime/tree_of_thoughts.md
pub struct ToTNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 探索策略
    exploration_strategy: Arc<dyn ExplorationStrategy>,
    /// 评分策略
    scoring_strategy: Arc<dyn ScoringStrategy>,
    /// 目标检查策略
    goal_check_strategy: Arc<dyn GoalCheckStrategy>,
    /// 共享 LLM 后端
    backend: Arc<dyn NodeBackendAccessor>,
    /// 配置
    config: ToTConfig,
    /// 思维树（id → node）
    tree: Arc<RwLock<HashMap<String, ThoughtNode>>>,
    /// 最优节点 ID（执行完成后更新）
    best_node_id: Arc<RwLock<Option<String>>>,
    /// 节点 ID 生成计数器
    id_counter: Arc<RwLock<usize>>,
}

impl ToTNode {
    /// 创建新的 ToT 节点，详细见 docs/details/注释/agent-runtime/tree_of_thoughts.md
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        exploration_strategy: Arc<dyn ExplorationStrategy>,
        scoring_strategy: Arc<dyn ScoringStrategy>,
        goal_check_strategy: Arc<dyn GoalCheckStrategy>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: ToTConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            exploration_strategy,
            scoring_strategy,
            goal_check_strategy,
            backend,
            config,
            tree: Arc::new(RwLock::new(HashMap::new())),
            best_node_id: Arc::new(RwLock::new(None)),
            id_counter: Arc::new(RwLock::new(0)),
        }
    }

    /// 使用默认 LLM 策略创建（便捷方法）
    pub fn with_default_strategies(
        id: impl Into<String>,
        name: impl Into<String>,
        backend: Arc<dyn NodeBackendAccessor>,
        config: ToTConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            Arc::new(BeamSearchStrategy::new()),
            Arc::new(LlmScoringStrategy::new()),
            Arc::new(LlmGoalCheckStrategy::new()),
            backend,
            config,
        )
    }

    /// 生成下一个节点 ID
    async fn next_id(&self) -> String {
        let mut counter = self.id_counter.write().await;
        *counter += 1;
        format!("thought_{}", counter)
    }

    /// 检查评分是否收敛
    ///
    /// 收敛条件：top-K 节点的评分最大值与最小值之差 < threshold
    fn is_converged(top_nodes: &[&ThoughtNode], threshold: u8) -> bool {
        if top_nodes.len() < 2 {
            return false;
        }
        let scores: Vec<u8> = top_nodes
            .iter()
            .filter_map(|n| n.score)
            .collect();
        if scores.len() < 2 {
            return false;
        }
        let max = *scores.iter().max().unwrap();
        let min = *scores.iter().min().unwrap();
        max.saturating_sub(min) < threshold
    }

    /// 评分单个节点并更新树
    async fn score_node(
        &self,
        node_id: String,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<(u8, Option<String>), ToTError> {
        let node_clone = {
            let tree = self.tree.read().await;
            tree.get(&node_id)
                .ok_or_else(|| ToTError::Other(format!("节点不存在: {}", node_id)))?
                .clone()
        };

        let (score, reasoning) = self
            .scoring_strategy
            .score(&node_clone, context, ctx.backend)
            .await?;

        // 更新树中节点
        {
            let mut tree = self.tree.write().await;
            if let Some(node) = tree.get_mut(&node_id) {
                node.score = Some(score);
                node.score_reasoning = reasoning.clone();
                node.status = ThoughtNodeStatus::Scored;
            }
        }

        // 发射评分事件
        ctx.emit(OrchestratorEvent::ThoughtNodeScored {
            node_id: self.id.clone(),
            thought_id: node_id,
            score,
            reasoning: reasoning.clone(),
        });

        Ok((score, reasoning))
    }

    /// 检查目标达成
    async fn check_goal(
        &self,
        node_id: &str,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<bool, ToTError> {
        let node_clone = {
            let tree = self.tree.read().await;
            tree.get(node_id)
                .ok_or_else(|| ToTError::Other(format!("节点不存在: {}", node_id)))?
                .clone()
        };

        self.goal_check_strategy
            .check_goal(&node_clone, context, ctx.backend)
            .await
    }

    /// 扩展一层：对 `parents` 并发生成候选思维
    ///
    /// 返回所有新生成的子节点 ID 列表。
    async fn expand_layer(
        &self,
        parents: Vec<String>,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<Vec<String>, ToTError> {
        let branch_factor = self.config.branch_factor;
        let mut join_set: JoinSet<Result<Vec<(String, usize, String)>, ToTError>> =
            JoinSet::new();

        // 为每个父节点启动一个并发任务
        for parent_id in parents {
            let parent_node = {
                let tree = self.tree.read().await;
                tree.get(&parent_id).cloned()
            };

            let Some(parent) = parent_node else {
                warn!("ToT: 父节点 {} 不存在，跳过", parent_id);
                continue;
            };

            let strategy = Arc::clone(&self.exploration_strategy);
            let backend = Arc::clone(&self.backend);
            let context_owned = context.to_string();

            join_set.spawn(async move {
                let thoughts = strategy
                    .expand(&parent, &context_owned, branch_factor, &*backend)
                    .await?;

                // 返回 (parent_id, parent_depth, thought_content) 列表
                Ok(thoughts
                    .into_iter()
                    .map(|t| (parent_id.clone(), parent.depth, t))
                    .collect::<Vec<_>>())
            });
        }

        // 收集所有候选
        let mut candidates: Vec<(String, usize, String)> = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(items)) => candidates.extend(items),
                Ok(Err(e)) => {
                    return Err(ToTError::Explore(format!("并发扩展失败: {}", e)));
                }
                Err(e) => {
                    return Err(ToTError::Explore(format!("Task join 失败: {}", e)));
                }
            }
        }

        // 创建子节点并写入树
        let mut new_node_ids = Vec::with_capacity(candidates.len());
        {
            let mut tree = self.tree.write().await;
            for (parent_id, parent_depth, content) in candidates {
                let new_id = format!(
                    "thought_{}_{}",
                    parent_depth + 1,
                    tree.len() + 1
                );
                let content_preview: String = content.chars().take(200).collect();
                let child_depth = parent_depth + 1;

                let child = ThoughtNode {
                    id: new_id.clone(),
                    content,
                    parent_id: Some(parent_id.clone()),
                    parents: Vec::new(),
                    depth: child_depth,
                    score: None,
                    score_reasoning: None,
                    children: Vec::new(),
                    status: ThoughtNodeStatus::Pending,
                };

                // 更新父节点的 children 列表
                if let Some(parent) = tree.get_mut(&parent_id) {
                    parent.children.push(new_id.clone());
                    parent.status = ThoughtNodeStatus::Expanded;
                }

                tree.insert(new_id.clone(), child);

                ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
                    node_id: self.id.clone(),
                    thought_id: new_id.clone(),
                    parent_id: Some(parent_id),
                    depth: child_depth,
                    content_preview,
                });

                new_node_ids.push(new_id);
            }
        }

        Ok(new_node_ids)
    }

    /// 评分多个节点（并发）
    ///
    /// 当前未被调用（ToT 深度推理待 5.4 高级能力补齐时启用），保留备用。
    #[allow(dead_code)]
    async fn score_nodes(
        &self,
        node_ids: Vec<String>,
        context: &str,
        ctx: &NodeContext<'_>,
    ) -> Result<(), ToTError> {
        let mut join_set: JoinSet<Result<String, ToTError>> = JoinSet::new();

        for node_id in node_ids {
            let strategy = Arc::clone(&self.scoring_strategy);
            let backend = Arc::clone(&self.backend);
            let context_owned = context.to_string();

            let node_clone = {
                let tree = self.tree.read().await;
                tree.get(&node_id).cloned()
            };

            let Some(node) = node_clone else {
                continue;
            };

            join_set.spawn(async move {
                let (score, reasoning) =
                    strategy.score(&node, &context_owned, &*backend).await?;
                debug!(
                    "ToT 并发评分: node={} score={} reasoning={:?}",
                    node.id, score, reasoning
                );
                Ok(node.id)
            });
        }

        // 收集评分结果，统一更新树
        let mut scored_ids = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(Ok(id)) => scored_ids.push(id),
                Ok(Err(e)) => return Err(ToTError::Score(format!("并发评分失败: {}", e))),
                Err(e) => return Err(ToTError::Score(format!("Task join 失败: {}", e))),
            }
        }

        // 重新读取每个节点的评分（评分策略已通过 trait 调用，
        // 但 trait 方法是无状态的，我们需要重新调用以更新树）
        // 这里采用串行方式更新树（评分本身已并发完成）
        for id in scored_ids {
            self.score_node(id, context, ctx).await?;
        }

        Ok(())
    }

    /// 获取当前层 top-K 节点（按评分降序），并将未选中节点显式标记为 `Pruned`
    ///
    /// 只返回已评分且未被剪枝的节点。
    ///
    /// ## 显式剪枝
    /// 调用后，未被选入 top-K 的候选节点会被标记为 `ThoughtNodeStatus::Pruned`，
    /// 便于前端可视化与调试时清晰区分"被扩展"/"被剪枝"/"待评分"三类节点。
    /// 已达成目标（`Goal`）的节点不会被剪枝。
    async fn select_top_k(&self, k: usize, depth: usize) -> Vec<String> {
        // ── 1. 读锁：收集候选节点并按评分降序排序 ──
        let (selected_ids, pruned_ids): (Vec<String>, Vec<String>) = {
            let tree = self.tree.read().await;
            let mut candidates: Vec<&ThoughtNode> = tree
                .values()
                .filter(|n| {
                    n.depth == depth
                        && n.score.is_some()
                        && n.status != ThoughtNodeStatus::Pruned
                })
                .collect();

            // 按评分降序排序
            candidates.sort_by(|a, b| b.score.unwrap_or(0).cmp(&a.score.unwrap_or(0)));

            // 选中的 top-K 节点 ID
            let selected_ids: Vec<String> =
                candidates.iter().take(k).map(|n| n.id.clone()).collect();

            // 未选中的节点 ID（用于显式标记 Pruned，过滤掉已达成目标的节点）
            let pruned_ids: Vec<String> = candidates
                .iter()
                .skip(k)
                .filter(|n| n.status != ThoughtNodeStatus::Goal)
                .map(|n| n.id.clone())
                .collect();

            (selected_ids, pruned_ids)
        };

        // ── 2. 写锁：将未选中的节点显式标记为 Pruned ──
        if !pruned_ids.is_empty() {
            let mut tree = self.tree.write().await;
            for id in &pruned_ids {
                if let Some(node) = tree.get_mut(id) {
                    node.status = ThoughtNodeStatus::Pruned;
                }
            }
            debug!(
                "ToT: 深度 {} 显式剪枝 {} 个节点（beam_width={}）",
                depth,
                pruned_ids.len(),
                k
            );
        }

        selected_ids
    }

    /// 查找最优节点（全树搜索）
    async fn find_best_node(&self) -> Option<(String, u8, String, usize)> {
        let tree = self.tree.read().await;
        tree.values()
            .filter_map(|n| {
                n.score.map(|s| (n.id.clone(), s, n.content.clone(), n.depth))
            })
            .max_by_key(|(_, score, _, _)| *score)
    }

    /// 查找目标节点（status=Goal）
    ///
    /// 当前未被调用（ToT 深度推理待 5.4 高级能力补齐时启用），保留备用。
    #[allow(dead_code)]
    async fn find_goal_node(&self) -> Option<(String, u8, String, usize)> {
        let tree = self.tree.read().await;
        tree.values()
            .find(|n| n.status == ThoughtNodeStatus::Goal)
            .map(|n| {
                (
                    n.id.clone(),
                    n.score.unwrap_or(0),
                    n.content.clone(),
                    n.depth,
                )
            })
    }

    /// 获取思维树快照（用于状态序列化）
    pub async fn tree_snapshot(&self) -> Vec<ThoughtNode> {
        let tree = self.tree.read().await;
        tree.values().cloned().collect()
    }

    /// 获取最优节点 ID
    pub async fn best_node_id(&self) -> Option<String> {
        self.best_node_id.read().await.clone()
    }

    /// 清空思维树（用于 reset）
    pub async fn clear_tree(&self) {
        let mut tree = self.tree.write().await;
        tree.clear();
        let mut best = self.best_node_id.write().await;
        *best = None;
        let mut counter = self.id_counter.write().await;
        *counter = 0;
    }
}

#[async_trait]
impl OrchestratorNode for ToTNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Thought
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        // ── 1. 读取原始问题 ──
        let context = if !ctx.state.input.is_empty() {
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

        if context.is_empty() {
            return NodeResult::error(
                "ToT: 原始问题为空（state.input 与 messages 中均无 user 消息）",
            );
        }

        // ── 2. 中断检查 ──
        if ctx.is_aborted() {
            warn!("ToT: 中断检查命中（初始化前）");
            return NodeResult::aborted();
        }

        // ── 3. 创建根节点 ──
        let root_id = self.next_id().await;
        let root_node = ThoughtNode {
            id: root_id.clone(),
            content: context.clone(),
            parent_id: None,
            parents: Vec::new(),
            depth: 0,
            score: None,
            score_reasoning: None,
            children: Vec::new(),
            status: ThoughtNodeStatus::Pending,
        };

        {
            let mut tree = self.tree.write().await;
            tree.insert(root_id.clone(), root_node);
        }

        ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
            node_id: self.id.clone(),
            thought_id: root_id.clone(),
            parent_id: None,
            depth: 0,
            content_preview: context.chars().take(200).collect(),
        });

        info!("ToT: 创建根节点 id={}", root_id);

        // ── 4. 评分根节点 ──
        if let Err(e) = self.score_node(root_id.clone(), &context, &ctx).await {
            let err_msg = format!("ToT 根节点评分失败: {}", e);
            ctx.emit(OrchestratorEvent::ToTError {
                node_id: self.id.clone(),
                stage: "score".into(),
                error: err_msg.clone(),
            });
            return NodeResult::error(err_msg);
        }

        // ── 5. 可选：根节点目标检查 ──
        if self.config.check_goal_at_root {
            match self.check_goal(&root_id, &context, &ctx).await {
                Ok(true) => {
                    let tree = self.tree.read().await;
                    if let Some(node) = tree.get(&root_id) {
                        let score = node.score.unwrap_or(0);
                        ctx.emit(OrchestratorEvent::ToTGoalReached {
                            node_id: self.id.clone(),
                            thought_id: node.id.clone(),
                            depth: node.depth,
                            content: node.content.clone(),
                            score,
                        });

                        // 更新最优节点
                        {
                            let mut best = self.best_node_id.write().await;
                            *best = Some(node.id.clone());
                        }

                        return NodeResult::done_with_summary(format!(
                            "ToT: 根节点已达成目标（score={}）",
                            score
                        ));
                    }
                }
                Ok(false) => {}
                Err(e) => {
                    warn!("ToT: 根节点目标检查失败: {}", e);
                }
            }
        }

        // ── 6. 层扩展循环 ──
        let mut current_depth = 0usize;
        let mut current_layer_parents: Vec<String> = vec![root_id.clone()];

        loop {
            // ── 6a. 检查终止条件：max_depth ──
            if current_depth >= self.config.max_depth {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxDepthExceeded.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                let summary = match best {
                    Some((id, s, _content, depth)) => {
                        let mut best_guard = self.best_node_id.write().await;
                        *best_guard = Some(id.clone());
                        format!(
                            "ToT: 深度超限终止（depth={}，最优 score={}，深度={}）",
                            current_depth, s, depth
                        )
                    }
                    None => "ToT: 深度超限终止（无评分节点）".into(),
                };
                let _ = summary; // summary 已在 best 写入后通过下方逻辑生成
                break;
            }

            // ── 6b. 检查终止条件：max_thoughts ──
            let total_nodes = self.tree.read().await.len();
            if total_nodes >= self.config.max_thoughts {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxThoughtsExceeded.as_str().into(),
                    total_nodes,
                    max_depth_reached: current_depth,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                if let Some((id, s, _, depth)) = best {
                    let mut best_guard = self.best_node_id.write().await;
                    *best_guard = Some(id);
                    let _ = (s, depth);
                }
                break;
            }

            // ── 6c. 检查终止条件：无候选 ──
            if current_layer_parents.is_empty() {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::NoCandidates.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                break;
            }

            // ── 6d. 中断检查 ──
            if ctx.is_aborted() {
                warn!("ToT: 中断检查命中（层扩展前）");
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::Aborted.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                return NodeResult::aborted();
            }

            // ── 6e. 扩展当前层 ──
            let new_node_ids = match self
                .expand_layer(current_layer_parents.clone(), &context, &ctx)
                .await
            {
                Ok(ids) => ids,
                Err(e) => {
                    let err_msg = format!("ToT 层扩展失败: {}", e);
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "expand".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult::error(err_msg);
                }
            };

            if new_node_ids.is_empty() {
                // 所有父节点都未生成子节点
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::NoCandidates.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best_id,
                    best_score,
                });
                break;
            }

            // ── 6f. 并发评分新节点 ──
            // 注意：score_nodes 内部会触发 ThoughtNodeScored 事件
            // 但当前实现是先并发调用 strategy.score，再串行 score_node 更新树
            // 这会导致重复调用 strategy.score。修复：直接串行评分（简化）
            for node_id in &new_node_ids {
                if let Err(e) = self.score_node(node_id.clone(), &context, &ctx).await {
                    let err_msg = format!("ToT 节点评分失败: {}", e);
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "score".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult::error(err_msg);
                }
            }

            // ── 6g. 检查目标达成（每个新节点） ──
            let mut goal_reached: Option<(String, u8, String, usize)> = None;
            for node_id in &new_node_ids {
                match self.check_goal(node_id, &context, &ctx).await {
                    Ok(true) => {
                        // 找到目标节点
                        let tree = self.tree.read().await;
                        if let Some(node) = tree.get(node_id) {
                            let score = node.score.unwrap_or(0);
                            goal_reached = Some((
                                node.id.clone(),
                                score,
                                node.content.clone(),
                                node.depth,
                            ));
                        }
                        // 标记为 Goal 状态
                        drop(tree);
                        let mut tree = self.tree.write().await;
                        if let Some(node) = tree.get_mut(node_id) {
                            node.status = ThoughtNodeStatus::Goal;
                        }
                        break;
                    }
                    Ok(false) => {}
                    Err(e) => {
                        warn!("ToT: 目标检查失败 node={}: {}", node_id, e);
                    }
                }
            }

            if let Some((goal_id, goal_score, goal_content, goal_depth)) = goal_reached {
                ctx.emit(OrchestratorEvent::ToTGoalReached {
                    node_id: self.id.clone(),
                    thought_id: goal_id.clone(),
                    depth: goal_depth,
                    content: goal_content.clone(),
                    score: goal_score,
                });

                // 更新最优节点
                {
                    let mut best = self.best_node_id.write().await;
                    *best = Some(goal_id.clone());
                }

                // 写入 state.messages
                let mut meta = HashMap::new();
                meta.insert("tot_node_id".to_string(), serde_json::json!(self.id));
                meta.insert(
                    "goal_thought_id".to_string(),
                    serde_json::json!(goal_id),
                );
                meta.insert(
                    "goal_depth".to_string(),
                    serde_json::json!(goal_depth),
                );
                meta.insert(
                    "goal_score".to_string(),
                    serde_json::json!(goal_score),
                );

                ctx.state.messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: format!(
                        "[ToT 目标达成（depth={}, score={}）]:\n{}",
                        goal_depth, goal_score, goal_content
                    ),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: Some(meta),
                });

                let summary = if self.config.require_summary {
                    Some(format!(
                        "ToT: 在深度 {} 找到目标（score={}，节点数={}）",
                        goal_depth,
                        goal_score,
                        self.tree.read().await.len()
                    ))
                } else {
                    None
                };

                return NodeResult {
                    status: NodeStatus::Done,
                    next_node_id: None,
                    error: None,
                    summary,
                    ..Default::default()
                };
            }

            // ── 6h. 选择 top-K 进入下一层 ──
            let next_layer_parents = self
                .select_top_k(self.config.beam_width, current_depth + 1)
                .await;

            // 发射层扩展完成事件（用第一个父节点作为代表）
            if let Some(first_parent) = current_layer_parents.first() {
                ctx.emit(OrchestratorEvent::ThoughtBranchExplored {
                    node_id: self.id.clone(),
                    parent_id: first_parent.clone(),
                    child_count: new_node_ids.len(),
                    depth: current_depth + 1,
                    kept_count: next_layer_parents.len(),
                });
            }

            // ── 6i. 检查终止条件：评分收敛 ──
            // 注意：top_nodes 持有对 tree 的引用，必须在 read guard 作用域内完成 is_converged 调用
            let converged = {
                let tree = self.tree.read().await;
                let top_nodes: Vec<&ThoughtNode> = next_layer_parents
                    .iter()
                    .filter_map(|id| tree.get(id))
                    .collect();
                Self::is_converged(&top_nodes, self.config.score_convergence_threshold)
            };
            if converged {
                let best = self.find_best_node().await;
                let (best_id, best_score) = match &best {
                    Some((id, s, _, _)) => (Some(id.clone()), Some(*s)),
                    None => (None, None),
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::ScoreConverged.as_str().into(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth + 1,
                    best_thought_id: best_id.clone(),
                    best_score,
                });

                if let Some((id, _, _, _)) = best {
                    let mut best_guard = self.best_node_id.write().await;
                    *best_guard = Some(id);
                }
                break;
            }

            // ── 6j. 准备下一层 ──
            current_depth += 1;
            current_layer_parents = next_layer_parents;
        }

        // ── 7. 循环结束，写入最优结果 ──
        // find_best_node 已统一查找评分最高的节点（不限于 goal 节点），
        // 无需额外的 or_else 分支。
        let best = self.find_best_node().await;

        let (best_id, best_score, best_content, best_depth) = match best {
            Some(b) => b,
            None => {
                return NodeResult::error("ToT: 无可用最优节点（树为空或未评分）");
            }
        };

        // 更新最优节点引用
        {
            let mut best_guard = self.best_node_id.write().await;
            *best_guard = Some(best_id.clone());
        }

        // 写入 state.messages
        let mut meta = HashMap::new();
        meta.insert("tot_node_id".to_string(), serde_json::json!(self.id));
        meta.insert(
            "best_thought_id".to_string(),
            serde_json::json!(best_id),
        );
        meta.insert(
            "best_depth".to_string(),
            serde_json::json!(best_depth),
        );
        meta.insert(
            "best_score".to_string(),
            serde_json::json!(best_score),
        );
        meta.insert(
            "total_nodes".to_string(),
            serde_json::json!(self.tree.read().await.len()),
        );

        ctx.state.messages.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: format!(
                "[ToT 最优思维（depth={}, score={}）]:\n{}",
                best_depth, best_score, best_content
            ),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: Some(meta),
        });

        let summary = if self.config.require_summary {
            Some(format!(
                "ToT: 探索完成（最优 score={}，深度={}，总节点数={}）",
                best_score,
                best_depth,
                self.tree.read().await.len()
            ))
        } else {
            None
        };

        NodeResult {
            status: NodeStatus::Continue,
            next_node_id: None,
            error: None,
            summary,
            ..Default::default()
        }
    }
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
