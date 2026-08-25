//! Graph of Thoughts (GoT) — 思维图编排模式，详细见 docs/details/注释/agent-runtime/graph_of_thoughts.md

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::backend::PromptCallOptions;
use crate::event::OrchestratorEvent;
use crate::node::{NodeContext, NodeResult, NodeStatus, NodeType, OrchestratorNode};
// GoT 经 patterns/shared 公开类型复用（matrix §4 解耦，不再跨模式 import tot 内部符号）
use crate::patterns::shared::thoughts::{
    ExplorationStrategy, GoalCheckStrategy, LlmGoalCheckStrategy, LlmScoringStrategy,
    ScoringStrategy, ThoughtNode, ThoughtNodeStatus, ToTConfig, ToTError, ToTTerminationReason,
};
use crate::types::{MessageRole, OrchestratorMessage};

// ─── GoT 配置 ────────────────────────────────────────────

/// GoT 配置 — 扩展 ToTConfig 增加聚合参数
///
/// 包装 `ToTConfig` + 聚合专用参数。前端通过 camelCase 字段传递，
/// 内部转换为 Rust 端 snake_case 字段。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct GoTConfig {
    /// 基础 ToT 配置（深度/节点数/beam_width/branch_factor/收敛阈值等）
    #[serde(flatten)]
    pub tot: ToTConfig,
    /// 是否启用聚合（默认 true）
    #[serde(default = "default_true")]
    pub aggregation_enabled: bool,
    /// 聚合评分阈值 — 只有评分≥此值的节点才参与聚合（默认 70）
    ///
    /// 避免低质节点参与聚合，浪费 LLM 调用。
    #[serde(default = "default_aggregation_threshold")]
    pub aggregation_threshold: u8,
    /// 单次聚合的节点数上限（默认 3）
    ///
    /// 一次聚合最多合并多少个源节点。过多会导致 prompt 过长。
    #[serde(default = "default_max_aggregation_size")]
    pub max_aggregation_size: usize,
    /// 每层生成的聚合节点数（默认 1）
    ///
    /// 每层结束时生成多少个聚合节点进入下一层。
    #[serde(default = "default_aggregation_branch_factor")]
    pub aggregation_branch_factor: usize,
}

fn default_true() -> bool {
    true
}

fn default_aggregation_threshold() -> u8 {
    70
}

fn default_max_aggregation_size() -> usize {
    3
}

fn default_aggregation_branch_factor() -> usize {
    1
}

impl Default for GoTConfig {
    fn default() -> Self {
        Self {
            tot: ToTConfig::default(),
            aggregation_enabled: true,
            aggregation_threshold: default_aggregation_threshold(),
            max_aggregation_size: default_max_aggregation_size(),
            aggregation_branch_factor: default_aggregation_branch_factor(),
        }
    }
}

// ─── 聚合策略 trait ────────────────────────────────────────────

/// 聚合策略 — 把多个思维合并为一个新思维，详细见 docs/details/注释/agent-runtime/graph_of_thoughts.md
#[async_trait]
pub trait AggregationStrategy: Send + Sync {
    /// 聚合多个思维节点为一个新思维
    ///
    /// # 参数
    /// - `ctx`：节点上下文（用于事件发射、中断检查）
    /// - `nodes`：参与聚合的源节点（已评分，按评分降序）
    ///
    /// # 返回
    /// 聚合生成的新思维内容（字符串）。调用方负责构造 `ThoughtNode` 并设置 parents。
    async fn aggregate(
        &self,
        ctx: &NodeContext<'_>,
        nodes: &[ThoughtNode],
    ) -> Result<String, ToTError>;
}

// ─── 聚合提示词模板 ────────────────────────────────────────────

/// 聚合提示词模板 — 自定义 LLM 聚合提示词
///
/// 支持占位符：
/// - `{context}`：用户原始输入
/// - `{thoughts}`：参与聚合的思维列表（JSON 数组，含 content + score）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AggregationPromptTemplate {
    /// 系统提示词
    pub system: String,
    /// 用户提示词模板
    pub user_template: String,
}

impl Default for AggregationPromptTemplate {
    fn default() -> Self {
        Self {
            system: "你是一个思维聚合专家。给定多个相关的思维节点，\
                     请综合它们的优点，生成一个更全面、更深入的新思维。\
                     新思维应整合所有源思维的关键洞察，避免简单拼接。"
                .into(),
            user_template: "## 任务背景\n{context}\n\n\
                    ## 待聚合的思维（按评分降序）\n{thoughts}\n\n\
                    请综合以上思维，生成一个更优的聚合思维。\
                    直接输出聚合后的思维内容（不要解释、不要 JSON、不要 markdown 代码块）."
                .into(),
        }
    }
}

// ─── LLM 聚合策略（默认实现） ────────────────────────────────────────────

/// LLM 聚合策略 — 默认实现
///
/// 通过调用 LLM 把多个源思维合并为一个新思维。
/// 思维列表以 JSON 数组形式注入 prompt，LLM 返回纯文本聚合结果。
pub struct LlmAggregationStrategy {
    /// 提示词模板
    pub prompt_template: AggregationPromptTemplate,
}

impl Default for LlmAggregationStrategy {
    fn default() -> Self {
        Self {
            prompt_template: AggregationPromptTemplate::default(),
        }
    }
}

impl LlmAggregationStrategy {
    pub fn new() -> Self {
        Self::default()
    }

    /// 使用自定义提示词模板
    pub fn with_template(template: AggregationPromptTemplate) -> Self {
        Self {
            prompt_template: template,
        }
    }

    /// 渲染用户提示词
    fn render_user_prompt(&self, context: &str, nodes: &[ThoughtNode]) -> String {
        let thoughts_json: Vec<serde_json::Value> = nodes
            .iter()
            .map(|n| {
                serde_json::json!({
                    "content": n.content,
                    "score": n.score.unwrap_or(0),
                })
            })
            .collect();
        let thoughts = serde_json::to_string_pretty(&thoughts_json).unwrap_or_default();

        self.prompt_template
            .user_template
            .replace("{context}", context)
            .replace("{thoughts}", &thoughts)
    }
}

#[async_trait]
impl AggregationStrategy for LlmAggregationStrategy {
    async fn aggregate(
        &self,
        ctx: &NodeContext<'_>,
        nodes: &[ThoughtNode],
    ) -> Result<String, ToTError> {
        if nodes.is_empty() {
            return Err(ToTError::Config("聚合节点列表不能为空".into()));
        }
        if nodes.len() == 1 {
            // 单节点聚合：直接返回原内容（无意义的聚合）
            return Ok(nodes[0].content.clone());
        }

        let context = ctx.state.input.clone();
        let user_prompt = self.render_user_prompt(&context, nodes);

        let options = PromptCallOptions {
            system_prompt_override: Some(self.prompt_template.system.clone()),
            tools_override: Some(Vec::new()),
            ..Default::default()
        };

        debug!(
            "GoT LlmAggregation: 聚合 {} 个节点，depth={}",
            nodes.len(),
            nodes[0].depth
        );

        let response = ctx.backend.prompt(user_prompt, Some(options)).await?;
        let aggregated = response.text.trim().to_string();

        if aggregated.is_empty() {
            return Err(ToTError::LlmCall("聚合结果为空".into()));
        }

        info!(
            "GoT LlmAggregation: 聚合完成，结果长度: {}",
            aggregated.len()
        );

        Ok(aggregated)
    }
}

// ─── GoTNode — 思维图节点 ────────────────────────────────────────────

/// GoTNode — Graph of Thoughts 节点，详细见 docs/details/注释/agent-runtime/graph_of_thoughts.md
pub struct GoTNode {
    /// 节点 ID
    id: String,
    /// 节点名称
    name: String,
    /// 探索策略（复用 ToT）
    exploration_strategy: Arc<dyn ExplorationStrategy>,
    /// 评分策略（复用 ToT）
    scoring_strategy: Arc<dyn ScoringStrategy>,
    /// 目标检查策略（复用 ToT）
    goal_check_strategy: Arc<dyn GoalCheckStrategy>,
    /// 聚合策略（GoT 新增）
    aggregation_strategy: Arc<dyn AggregationStrategy>,
    /// GoT 配置
    config: GoTConfig,
    /// 思维图（id → node）— 复用 ThoughtNode，parents 字段用于图语义
    tree: Arc<RwLock<HashMap<String, ThoughtNode>>>,
    /// 最优节点 ID（执行完成后更新）
    best_node_id: Arc<RwLock<Option<String>>>,
    /// 节点 ID 生成计数器
    id_counter: Arc<RwLock<usize>>,
}

impl GoTNode {
    /// 创建新的 GoT 节点
    ///
    /// 注意：GoTNode 不持有 backend 字段，所有 LLM 调用通过 `ctx.backend`（NodeContext 传入）。
    /// 这与 ToTNode 不同（ToTNode 需要 backend 字段，因为并发 JoinSet 任务需要 clone Arc）。
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        exploration_strategy: Arc<dyn ExplorationStrategy>,
        scoring_strategy: Arc<dyn ScoringStrategy>,
        goal_check_strategy: Arc<dyn GoalCheckStrategy>,
        aggregation_strategy: Arc<dyn AggregationStrategy>,
        config: GoTConfig,
    ) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            exploration_strategy,
            scoring_strategy,
            goal_check_strategy,
            aggregation_strategy,
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
        config: GoTConfig,
    ) -> Self {
        Self::new(
            id,
            name,
            Arc::new(crate::patterns::shared::thoughts::BeamSearchStrategy::new()),
            Arc::new(LlmScoringStrategy::new()),
            Arc::new(LlmGoalCheckStrategy::new()),
            Arc::new(LlmAggregationStrategy::new()),
            config,
        )
    }

    /// 生成下一个节点 ID
    async fn next_id(&self) -> String {
        let mut counter = self.id_counter.write().await;
        *counter += 1;
        format!("thought_{}", counter)
    }

    /// 检查评分是否收敛（复用 ToT 逻辑）
    async fn is_converged(&self, threshold: u8) -> bool {
        let tree = self.tree.read().await;
        let scored: Vec<u8> = tree
            .values()
            .filter(|n| n.score.is_some())
            .map(|n| n.score.unwrap())
            .collect();
        if scored.len() < 2 {
            return false;
        }
        let max = *scored.iter().max().unwrap();
        let min = *scored.iter().min().unwrap();
        max.saturating_sub(min) < threshold
    }

    /// 找出最优节点
    async fn find_best_node(&self) -> Option<String> {
        let tree = self.tree.read().await;
        tree.iter()
            .filter(|(_, n)| n.score.is_some())
            .max_by_key(|(_, n)| n.score.unwrap())
            .map(|(id, _)| id.clone())
    }

    /// 评分单个节点（复用 ToT 逻辑）
    async fn score_node(
        &self,
        ctx: &NodeContext<'_>,
        node_id: &str,
    ) -> Result<(u8, Option<String>), ToTError> {
        let node = {
            let tree = self.tree.read().await;
            tree.get(node_id).cloned().ok_or_else(|| {
                ToTError::Other(format!("评分时找不到节点: {}", node_id))
            })?
        };

        let context = ctx.state.input.clone();
        let (score, reasoning) = self
            .scoring_strategy
            .score(&node, &context, ctx.backend)
            .await?;

        // 更新节点评分
        {
            let mut tree = self.tree.write().await;
            if let Some(n) = tree.get_mut(node_id) {
                n.score = Some(score);
                n.score_reasoning = reasoning.clone();
                n.status = ThoughtNodeStatus::Scored;
            }
        }

        // 触发评分事件
        ctx.emit(OrchestratorEvent::ThoughtNodeScored {
            node_id: self.id.clone(),
            thought_id: node_id.to_string(),
            score,
            reasoning,
        });

        Ok((score, None))
    }

    /// 目标检查（复用 ToT 逻辑）
    async fn check_goal(
        &self,
        ctx: &NodeContext<'_>,
        node_id: &str,
    ) -> Result<bool, ToTError> {
        let node = {
            let tree = self.tree.read().await;
            tree.get(node_id).cloned().ok_or_else(|| {
                ToTError::Other(format!("目标检查时找不到节点: {}", node_id))
            })?
        };

        let context = ctx.state.input.clone();
        let reached = self
            .goal_check_strategy
            .check_goal(&node, &context, ctx.backend)
            .await?;

        if reached {
            // 更新节点状态
            {
                let mut tree = self.tree.write().await;
                if let Some(n) = tree.get_mut(node_id) {
                    n.status = ThoughtNodeStatus::Goal;
                }
            }

            // 更新最优节点
            {
                let mut best = self.best_node_id.write().await;
                *best = Some(node_id.to_string());
            }

            // 触发目标达成事件
            ctx.emit(OrchestratorEvent::ToTGoalReached {
                node_id: self.id.clone(),
                thought_id: node_id.to_string(),
                depth: node.depth,
                content: node.content.clone(),
                score: node.score.unwrap_or(0),
            });
        }

        Ok(reached)
    }

    /// 层扩展 — 对单个 parent 生成 branch_factor 个候选（复用 ToT 逻辑）
    ///
    /// 返回生成的子节点 ID 列表
    async fn expand_node(
        &self,
        ctx: &NodeContext<'_>,
        parent_id: &str,
    ) -> Result<Vec<String>, ToTError> {
        let parent = {
            let tree = self.tree.read().await;
            tree.get(parent_id).cloned().ok_or_else(|| {
                ToTError::Other(format!("扩展时找不到父节点: {}", parent_id))
            })?
        };

        let context = ctx.state.input.clone();
        let branch_factor = self.config.tot.branch_factor;
        let thoughts = self
            .exploration_strategy
            .expand(&parent, &context, branch_factor, ctx.backend)
            .await?;

        let parent_depth = parent.depth;
        let mut new_ids = Vec::with_capacity(thoughts.len());

        for content in thoughts {
            if ctx.is_aborted() {
                return Err(ToTError::Other("Aborted".to_string()));
            }

            let new_id = self.next_id().await;
            let content_preview: String = content.chars().take(200).collect();
            let child_depth = parent_depth + 1;

            let child = ThoughtNode {
                id: new_id.clone(),
                content,
                parent_id: Some(parent_id.to_string()),
                parents: Vec::new(), // 树扩展节点：parents 为空（仅 parent_id）
                depth: child_depth,
                score: None,
                score_reasoning: None,
                children: Vec::new(),
                status: ThoughtNodeStatus::Pending,
            };

            // 更新父节点的 children 列表
            {
                let mut tree = self.tree.write().await;
                if let Some(p) = tree.get_mut(parent_id) {
                    p.children.push(new_id.clone());
                    p.status = ThoughtNodeStatus::Expanded;
                }
                tree.insert(new_id.clone(), child);
            }

            // 触发节点创建事件
            ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
                node_id: self.id.clone(),
                thought_id: new_id.clone(),
                parent_id: Some(parent_id.to_string()),
                depth: child_depth,
                content_preview,
            });

            new_ids.push(new_id);
        }

        Ok(new_ids)
    }

    /// 【GoT 新增】层聚合，详细见 docs/details/注释/agent-runtime/graph_of_thoughts.md
    async fn aggregate_layer(
        &self,
        ctx: &NodeContext<'_>,
        depth: usize,
    ) -> Result<Vec<String>, ToTError> {
        if !self.config.aggregation_enabled {
            return Ok(Vec::new());
        }

        // 1. 筛选本层评分≥阈值的节点
        let candidates: Vec<ThoughtNode> = {
            let tree = self.tree.read().await;
            tree.values()
                .filter(|n| {
                    n.depth == depth
                        && n.score.is_some()
                        && n.score.unwrap() >= self.config.aggregation_threshold
                })
                .cloned()
                .collect()
        };

        // 候选不足 2 个，无法聚合
        if candidates.len() < 2 {
            debug!(
                "GoT aggregate_layer: depth={} 候选不足（{}），跳过聚合",
                depth,
                candidates.len()
            );
            return Ok(Vec::new());
        }

        // 2. 按评分降序排序
        let mut sorted_candidates = candidates;
        sorted_candidates.sort_by(|a, b| {
            b.score.unwrap_or(0).cmp(&a.score.unwrap_or(0))
        });

        let mut aggregated_ids = Vec::new();

        // 3. 生成 aggregation_branch_factor 个聚合节点
        for agg_idx in 0..self.config.aggregation_branch_factor {
            if ctx.is_aborted() {
                return Err(ToTError::Other("Aborted".to_string()));
            }

            // 取 top-N 作为本次聚合的源节点
            let take_n = self.config.max_aggregation_size.min(sorted_candidates.len());
            if take_n < 2 {
                break; // 不足 2 个源节点，停止聚合
            }

            // 简单策略：每次取 top-N（可扩展为滑动窗口/随机采样等）
            let sources: Vec<ThoughtNode> = sorted_candidates
                .iter()
                .take(take_n)
                .cloned()
                .collect();

            let source_ids: Vec<String> = sources.iter().map(|n| n.id.clone()).collect();
            let source_count = source_ids.len();

            // 4. 调用聚合策略
            let aggregated_content = match self
                .aggregation_strategy
                .aggregate(ctx, &sources)
                .await
            {
                Ok(content) => content,
                Err(e) => {
                    warn!(
                        "GoT aggregate_layer: 第 {} 次聚合失败: {}",
                        agg_idx + 1,
                        e
                    );
                    continue; // 跳过本次聚合，继续下一次
                }
            };

            // 5. 构造聚合节点
            let new_id = self.next_id().await;
            let content_preview: String = aggregated_content.chars().take(200).collect();
            let agg_depth = depth; // 聚合节点与源节点同层（进入下一层候选池）

            let agg_node = ThoughtNode {
                id: new_id.clone(),
                content: aggregated_content,
                parent_id: Some(source_ids[0].clone()), // 取第一个源节点作为 parent_id（向后兼容）
                parents: source_ids.clone(),            // 图语义：所有源节点
                depth: agg_depth,
                score: None,
                score_reasoning: None,
                children: Vec::new(),
                status: ThoughtNodeStatus::Pending,
            };

            // 更新源节点的 children 列表（建立反向引用）
            {
                let mut tree = self.tree.write().await;
                for sid in &source_ids {
                    if let Some(s) = tree.get_mut(sid) {
                        s.children.push(new_id.clone());
                    }
                }
                tree.insert(new_id.clone(), agg_node);
            }

            // 6. 触发聚合事件
            ctx.emit(OrchestratorEvent::ThoughtsAggregated {
                node_id: self.id.clone(),
                aggregated_thought_id: new_id.clone(),
                source_ids: source_ids.clone(),
                depth: agg_depth,
                content_preview,
            });

            debug!(
                "GoT aggregate_layer: depth={} 聚合 #{} 完成，源节点 {} 个，新节点 {}",
                depth, agg_idx + 1, source_count, new_id
            );

            aggregated_ids.push(new_id.clone());

            // 评分聚合节点 + 目标检查
            let (score, _) = self.score_node(ctx, &new_id).await?;
            let reached = self.check_goal(ctx, &new_id).await?;
            if reached {
                info!(
                    "GoT aggregate_layer: 聚合节点 {} 达成目标，score={}",
                    new_id, score
                );
                break; // 目标达成，停止聚合
            }
        }

        Ok(aggregated_ids)
    }

    /// 获取思维图快照（前端展示用）
    pub async fn tree_snapshot(&self) -> Vec<ThoughtNode> {
        let tree = self.tree.read().await;
        tree.values().cloned().collect()
    }

    /// 获取最优节点 ID
    pub async fn best_node_id(&self) -> Option<String> {
        self.best_node_id.read().await.clone()
    }
}

// ─── OrchestratorNode 实现 ────────────────────────────────────────────

#[async_trait]
impl OrchestratorNode for GoTNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn node_type(&self) -> NodeType {
        NodeType::Graph
    }

    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult {
        info!(
            "GoTNode '{}' 开始执行，输入: {}",
            self.id,
            ctx.state.input.chars().take(100).collect::<String>()
        );

        let context = ctx.state.input.clone();

        // ── 1. 创建根节点 ──
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

        // 触发根节点创建事件
        {
            let content_preview: String = context.chars().take(200).collect();
            ctx.emit(OrchestratorEvent::ThoughtNodeCreated {
                node_id: self.id.clone(),
                thought_id: root_id.clone(),
                parent_id: None,
                depth: 0,
                content_preview,
            });
        }

        // ── 2. 评分根节点 + 目标检查 ──
        match self.score_node(&ctx, &root_id).await {
            Ok((score, _)) => {
                debug!("GoT 根节点评分: {}", score);
            }
            Err(e) => {
                let err_msg = e.to_string();
                ctx.emit(OrchestratorEvent::ToTError {
                    node_id: self.id.clone(),
                    stage: "score".into(),
                    error: err_msg.clone(),
                });
                return NodeResult {
                    status: NodeStatus::Error,
                    next_node_id: None,
                    error: Some(err_msg),
                    summary: Some("GoT: 根节点评分失败".into()),
                };
            }
        }

        if self.config.tot.check_goal_at_root {
            match self.check_goal(&ctx, &root_id).await {
                Ok(true) => {
                    let best = self.best_node_id.read().await.clone();
                    let content = {
                        let tree = self.tree.read().await;
                        tree.get(best.as_deref().unwrap_or(&root_id))
                            .map(|n| n.content.clone())
                            .unwrap_or_default()
                    };
                    // 写入 state.messages
                    ctx.state.messages.push(OrchestratorMessage {
                        role: MessageRole::Assistant,
                        content,
                        tool_calls: Vec::new(),
                        tool_call_id: None,
                        meta: None,
                    });
                    return NodeResult {
                        status: NodeStatus::Done,
                        next_node_id: None,
                        error: None,
                        summary: Some("GoT: 根节点已达成目标".into()),
                    };
                }
                Ok(false) => {}
                Err(e) => {
                    let err_msg = e.to_string();
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "goal_check".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult {
                        status: NodeStatus::Error,
                        next_node_id: None,
                        error: Some(err_msg),
                        summary: Some("GoT: 根节点目标检查失败".into()),
                    };
                }
            }
        }

        // ── 3. 循环（层扩展 + 跨层聚合）──
        let mut current_depth = 0;
        let mut current_layer_ids: Vec<String> = vec![root_id.clone()];

        loop {
            // 3a. 检查终止条件
            if ctx.is_aborted() {
                let best = self.find_best_node().await;
                let best_score = {
                    let tree = self.tree.read().await;
                    best.as_ref()
                        .and_then(|id| tree.get(id))
                        .and_then(|n| n.score)
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::Aborted.as_str().to_string(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best,
                    best_score,
                });
                return NodeResult {
                    status: NodeStatus::Aborted,
                    next_node_id: None,
                    error: None,
                    summary: Some("GoT: 用户中断".into()),
                };
            }

            if current_depth >= self.config.tot.max_depth {
                let best = self.find_best_node().await;
                let best_score = {
                    let tree = self.tree.read().await;
                    best.as_ref()
                        .and_then(|id| tree.get(id))
                        .and_then(|n| n.score)
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxDepthExceeded.as_str().to_string(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best,
                    best_score,
                });
                break; // 跳到收尾
            }

            let total_nodes = self.tree.read().await.len();
            if total_nodes >= self.config.tot.max_thoughts {
                let best = self.find_best_node().await;
                let best_score = {
                    let tree = self.tree.read().await;
                    best.as_ref()
                        .and_then(|id| tree.get(id))
                        .and_then(|n| n.score)
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::MaxThoughtsExceeded.as_str().to_string(),
                    total_nodes,
                    max_depth_reached: current_depth,
                    best_thought_id: best,
                    best_score,
                });
                break;
            }

            if self
                .is_converged(self.config.tot.score_convergence_threshold)
                .await
            {
                let best = self.find_best_node().await;
                let best_score = {
                    let tree = self.tree.read().await;
                    best.as_ref()
                        .and_then(|id| tree.get(id))
                        .and_then(|n| n.score)
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::ScoreConverged.as_str().to_string(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best,
                    best_score,
                });
                break;
            }

            // 3b. 选择当前层 top-K 节点（beam_width）
            let beam_width = self.config.tot.beam_width;
            let mut candidates: Vec<(String, u8)> = {
                let tree = self.tree.read().await;
                current_layer_ids
                    .iter()
                    .filter_map(|id| {
                        tree.get(id).and_then(|n| n.score.map(|s| (id.clone(), s)))
                    })
                    .collect()
            };
            candidates.sort_by(|a, b| b.1.cmp(&a.1));
            let selected: Vec<String> = candidates
                .into_iter()
                .take(beam_width)
                .map(|(id, _)| id)
                .collect();

            if selected.is_empty() {
                let best = self.find_best_node().await;
                let best_score = {
                    let tree = self.tree.read().await;
                    best.as_ref()
                        .and_then(|id| tree.get(id))
                        .and_then(|n| n.score)
                };
                ctx.emit(OrchestratorEvent::ToTTerminated {
                    node_id: self.id.clone(),
                    reason: ToTTerminationReason::NoCandidates.as_str().to_string(),
                    total_nodes: self.tree.read().await.len(),
                    max_depth_reached: current_depth,
                    best_thought_id: best,
                    best_score,
                });
                break;
            }

            // 3c. 串行调用 expand_node（与 ToTNode 一致）
            //
            // 设计说明：
            // - 理论上可用 JoinSet 并发生成候选思维，但需要避免 RwLock 写锁竞争
            // - 为简化实现 + 复用 expand_node 的事件发射，采用串行调用
            // - LLM 调用本身是异步的，串行循环中 tokio 会自动让出执行权
            let mut all_new_ids = Vec::new();
            for parent_id in &selected {
                if ctx.is_aborted() {
                    return NodeResult {
                        status: NodeStatus::Aborted,
                        next_node_id: None,
                        error: None,
                        summary: Some("GoT: 用户中断".into()),
                    };
                }

                match self.expand_node(&ctx, parent_id).await {
                    Ok(new_ids) => {
                        all_new_ids.extend(new_ids);
                    }
                    Err(e) => {
                        let err_msg = e.to_string();
                        ctx.emit(OrchestratorEvent::ToTError {
                            node_id: self.id.clone(),
                            stage: "expand".into(),
                            error: err_msg.clone(),
                        });
                        return NodeResult {
                            status: NodeStatus::Error,
                            next_node_id: None,
                            error: Some(err_msg),
                            summary: Some("GoT: 扩展失败".into()),
                        };
                    }
                }
            }

            // 3d. 评分所有候选 + 目标检查
            for new_id in &all_new_ids {
                if ctx.is_aborted() {
                    return NodeResult {
                        status: NodeStatus::Aborted,
                        next_node_id: None,
                        error: None,
                        summary: Some("GoT: 用户中断".into()),
                    };
                }

                match self.score_node(&ctx, new_id).await {
                    Ok((score, _)) => {
                        debug!("GoT 节点 {} 评分: {}", new_id, score);
                    }
                    Err(e) => {
                        let err_msg = e.to_string();
                        ctx.emit(OrchestratorEvent::ToTError {
                            node_id: self.id.clone(),
                            stage: "score".into(),
                            error: err_msg.clone(),
                        });
                        return NodeResult {
                            status: NodeStatus::Error,
                            next_node_id: None,
                            error: Some(err_msg),
                            summary: Some("GoT: 评分失败".into()),
                        };
                    }
                }

                match self.check_goal(&ctx, new_id).await {
                    Ok(true) => {
                        // 目标达成：写入 state.messages 并返回
                        let content = {
                            let tree = self.tree.read().await;
                            tree.get(new_id).map(|n| n.content.clone()).unwrap_or_default()
                        };
                        ctx.state.messages.push(OrchestratorMessage {
                            role: MessageRole::Assistant,
                            content,
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            meta: None,
                        });
                        return NodeResult {
                            status: NodeStatus::Done,
                            next_node_id: None,
                            error: None,
                            summary: Some(format!(
                                "GoT: 已达成目标（深度 {}，评分 {}）",
                                current_depth + 1,
                                {
                                    let tree = self.tree.read().await;
                                    tree.get(new_id).and_then(|n| n.score).unwrap_or(0)
                                }
                            )),
                        };
                    }
                    Ok(false) => {}
                    Err(e) => {
                        let err_msg = e.to_string();
                        ctx.emit(OrchestratorEvent::ToTError {
                            node_id: self.id.clone(),
                            stage: "goal_check".into(),
                            error: err_msg.clone(),
                        });
                        return NodeResult {
                            status: NodeStatus::Error,
                            next_node_id: None,
                            error: Some(err_msg),
                            summary: Some("GoT: 目标检查失败".into()),
                        };
                    }
                }
            }

            // 触发层扩展完成事件
            for parent_id in &selected {
                let child_count = {
                    let tree = self.tree.read().await;
                    tree.get(parent_id)
                        .map(|n| n.children.len())
                        .unwrap_or(0)
                };
                ctx.emit(OrchestratorEvent::ThoughtBranchExplored {
                    node_id: self.id.clone(),
                    parent_id: parent_id.clone(),
                    child_count,
                    depth: current_depth + 1,
                    kept_count: all_new_ids.len(),
                });
            }

            // 3e. 【GoT 新增】对本层 top-N 节点做聚合
            let agg_ids = match self.aggregate_layer(&ctx, current_depth + 1).await {
                Ok(ids) => ids,
                Err(e) => {
                    let err_msg = e.to_string();
                    ctx.emit(OrchestratorEvent::ToTError {
                        node_id: self.id.clone(),
                        stage: "aggregate".into(),
                        error: err_msg.clone(),
                    });
                    return NodeResult {
                        status: NodeStatus::Error,
                        next_node_id: None,
                        error: Some(err_msg),
                        summary: Some("GoT: 聚合失败".into()),
                    };
                }
            };

            // 3f. 下一层候选 = 本层扩展的新节点 + 聚合节点
            current_layer_ids = all_new_ids;
            current_layer_ids.extend(agg_ids);
            current_depth += 1;
        }

        // ── 4. 收尾：返回最优思维 ──
        let best_id = self.find_best_node().await;
        if let Some(best_id) = best_id {
            {
                let mut best = self.best_node_id.write().await;
                *best = Some(best_id.clone());
            }

            let best_content = {
                let tree = self.tree.read().await;
                tree.get(&best_id).map(|n| n.content.clone()).unwrap_or_default()
            };
            let best_score = {
                let tree = self.tree.read().await;
                tree.get(&best_id).and_then(|n| n.score).unwrap_or(0)
            };

            // 写入 state.messages
            ctx.state.messages.push(OrchestratorMessage {
                role: MessageRole::Assistant,
                content: best_content,
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });

            NodeResult {
                status: NodeStatus::Done,
                next_node_id: None,
                error: None,
                summary: Some(format!(
                    "GoT: 已找到最优思维（深度 {}，评分 {}）",
                    current_depth, best_score
                )),
            }
        } else {
            NodeResult {
                status: NodeStatus::Error,
                next_node_id: None,
                error: Some("GoT: 未找到任何思维节点".into()),
                summary: Some("GoT: 探索失败".into()),
            }
        }
    }
}

#[cfg(test)]
#[path = "graph_of_thoughts_tests.rs"]
mod tests;
