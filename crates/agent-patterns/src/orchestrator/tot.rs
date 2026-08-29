//! TOT 思维树（设计 §6.1）— expand → evaluate → prune → select 树形搜索
//!
//! 核心状态：`tot.tree`（黑板当前值：节点=候选方案，边=细化关系，节点带分数）。
//! 一轮搜索：对保留集每个叶子生成 k 个候选（expand）→ 独立评分器打分
//! （evaluate，与展开器用不同 prompt 避免自我偏好，设计 6.1 要点）→ 保留 top-b
//! （prune）→ 收敛判定（select：分数饱和或深度上限）。
//!
//! 终止条件三分（设计 6.1）：① 达到深度上限且选出最优叶子 → `Done`；
//! ② 分数饱和（最优候选连续 2 轮无提升）→ `Done`（提前收敛）；
//! ③ 预算耗尽 → 执行器治理终止（本节点上报用量，治理在 4.2 第 5 步）。
//!
//! LLM 面约定：expand 输出 `{"candidates":["…",…]}`；evaluate 输出 `{"score":0-100}`。

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 思维树节点（轻量形态；候选方案即节点内容）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ThoughtNode {
    pub id: String,
    pub content: String,
    /// 评分（evaluate 产出；根/未评分为 -1）
    pub score: i64,
    /// 深度（根 0）
    pub depth: u32,
    /// 父节点 id（根为空）
    pub parent: Option<String>,
}

/// 思维树（`tot.tree` 的黑板值形态）
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ThoughtTree {
    pub nodes: Vec<ThoughtNode>,
    /// 轮次（搜索深度游标）
    pub round: u32,
}

impl ThoughtTree {
    fn best(&self) -> Option<&ThoughtNode> {
        self.nodes.iter().filter(|n| n.depth > 0).max_by_key(|n| n.score)
    }
}

pub struct TotNode {
    id: String,
    meta: NodeMeta,
    /// 每叶子展开的候选数（branching_k）
    branching_k: usize,
    /// 剪枝后保留宽度（keep_top_b）
    keep_top_b: usize,
    /// 树深上限（治理终止闸门，max_depth）
    max_depth: u32,
    /// 展开器 prompt（expand_spec）
    expand_prompt: String,
    /// 评分器 prompt（evaluate_spec，独立避免自我偏好）
    evaluate_prompt: String,
    /// 候选打磨内层节点（常为 Self-Refine 黑盒；None = 粗候选直接参评）
    candidate_refiner: Option<Arc<dyn OrchestratorNode>>,
    /// 当前轮次（restore(&self) 纪律）
    round: Mutex<u32>,
}

impl TotNode {
    pub fn new(
        id: impl Into<String>,
        expand_prompt: impl Into<String>,
        evaluate_prompt: impl Into<String>,
        branching_k: usize,
        keep_top_b: usize,
        max_depth: u32,
        candidate_refiner: Option<Arc<dyn OrchestratorNode>>,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("tot", "思维树搜索"),
            branching_k,
            keep_top_b,
            max_depth,
            expand_prompt: expand_prompt.into(),
            evaluate_prompt: evaluate_prompt.into(),
            candidate_refiner,
            round: Mutex::new(0),
        }
    }

    async fn expand_of(&self, ctx: &NodeCtx<'_>, leaf: &ThoughtNode) -> Result<(Vec<String>, Usage), NodeError> {
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.expand_prompt.clone(),
                format!(
                    "任务意图见黑板。基于当前分支「{}」生成 {} 个候选细化方案。输出 JSON：{{\"candidates\":[\"…\"]}}",
                    leaf.content, self.branching_k
                ),
            ))
            .await?;
        #[derive(serde::Deserialize)]
        struct Cands {
            candidates: Vec<String>,
        }
        let c: Cands = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("展开输出非约定 JSON：{e}")))?;
        Ok((c.candidates, resp.usage))
    }

    async fn score_of(&self, ctx: &NodeCtx<'_>, content: &str) -> Result<(i64, Usage), NodeError> {
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.evaluate_prompt.clone(),
                format!("请对以下候选方案按质量打 0-100 分。输出 JSON：{{\"score\":分数}}\n\n候选：{content}"),
            ))
            .await?;
        #[derive(serde::Deserialize)]
        struct S {
            score: i64,
        }
        let v: S = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("评分输出非约定 JSON：{e}")))?;
        Ok((v.score, resp.usage))
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for TotNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("budget".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let mut usage = Usage::default();

        // root：锚定根问题（tot.tree 初始化）
        let mut tree: ThoughtTree = ctx.state.read_t("tot.tree").unwrap_or(None).unwrap_or_default();
        if tree.nodes.is_empty() {
            tree.nodes.push(ThoughtNode { id: "root".into(), content: intent.clone(), score: -1, depth: 0, parent: None });
        }

        let mut best_history: Vec<i64> = Vec::new();
        loop {
            let round = { *self.round.lock().unwrap() };
            // 终止①：深度上限
            if round >= self.max_depth {
                break;
            }
            // frontier：上一轮保留集叶子（深度 = round 的节点）
            let frontier: Vec<ThoughtNode> =
                tree.nodes.iter().filter(|n| n.depth == round).cloned().collect();
            if frontier.is_empty() {
                break;
            }
            let mut candidates: Vec<ThoughtNode> = Vec::new();
            for leaf in &frontier {
                // expand：k 路候选
                let (cands, u) = self.expand_of(ctx, leaf).await?;
                usage.saturating_add(&u);
                for (i, cand) in cands.into_iter().take(self.branching_k).enumerate() {
                    let mut content = cand;
                    // 候选打磨：可选内嵌 Self-Refine（设计 6.1 组合示例）
                    if let Some(refiner) = &self.candidate_refiner {
                        ctx.state.write("tot.candidate", content.clone());
                        let rr = refiner.execute(ctx).await?;
                        usage.saturating_add(&rr.usage);
                        if let Some(v) = ctx.state.read("result.draft").and_then(|v| v.as_str().map(|s| s.to_string())) {
                            content = v;
                        }
                    }
                    // evaluate：独立评分器
                    let (score, u2) = self.score_of(ctx, &content).await?;
                    usage.saturating_add(&u2);
                    candidates.push(ThoughtNode {
                        id: format!("r{}-{}-{}", round, leaf.id, i),
                        content,
                        score,
                        depth: round + 1,
                        parent: Some(leaf.id.clone()),
                    });
                }
            }
            // prune：保留 top-b
            candidates.sort_by(|a, b| b.score.cmp(&a.score));
            candidates.truncate(self.keep_top_b);
            tree.nodes.extend(candidates);
            tree.round = round + 1;
            ctx.state.write("tot.tree", &tree);
            { *self.round.lock().unwrap() = round + 1; }

            // select：收敛判定（分数饱和：最优分连续 2 轮无提升，设计 6.1 终止②）
            if let Some(b) = tree.best() {
                if let Some(&prev) = best_history.last() {
                    if b.score <= prev {
                        break;
                    }
                }
                best_history.push(b.score);
            }
        }

        // egress：胜出方案交付（树形探索报告随 tot.tree 留黑板）
        let best = tree
            .best()
            .cloned()
            .ok_or_else(|| NodeError::fatal("budget", "思维树为空：无候选幸存"))?;
        ctx.state.write("result.draft", best.content.clone());
        ctx.state.append(
            "mem.notes",
            json!({ "content": format!("TOT 收敛：深度 {}，最优得分 {}", tree.round, best.score) }),
        );
        Ok(NodeResult { port: Port::Done, usage, progress: Some(ProgressNote::MaxTurns) })
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot { payload: json!({ "round": *self.round.lock().unwrap() }) })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("round").and_then(|v| v.as_u64()) {
            *self.round.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}
