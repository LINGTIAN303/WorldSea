//! Self-Refine 自我精炼（设计 §5.5）— 单角色自评自改循环
//!
//! 核心状态：版本链 `refine.draft@k`（黑板只追加原则：每轮写**新版本键**，
//! 设计 5.5 数据流）。收敛信号优先客观指标（工具观察），自评分兜底（设计 5.5）。
//!
//! 终止条件三分（设计 5.5）：
//! ① 客观指标达标（acceptable）→ `Done`；
//! ② 轮次上限 → 治理性完成（Done + `ProgressNote::MaxTurns`）；
//! ③ 连续两轮指标无改善 → `Fatal("stalled")`（防收益递减）。

use std::sync::Mutex;

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 客观指标信号（设计 §5.5 `ObjectiveSignal`）：由工具观察提供（lint/test/bench）
#[async_trait::async_trait]
pub trait ObjectiveSignal: Send + Sync {
    /// 对稿件测量客观分数（越大越好）
    async fn measure(&self, text: &str) -> Result<u32, NodeError>;
}

/// 固定目标线：分数 ≥ threshold 即达标
pub struct ThresholdObjective {
    pub threshold: u32,
}

#[async_trait::async_trait]
impl ObjectiveSignal for ThresholdObjective {
    async fn measure(&self, _text: &str) -> Result<u32, NodeError> {
        // M2 桩语义：真实指标器由宿主注入；此处不可用——节点测试以自定义实现注入
        Err(NodeError::fatal("objective", "ThresholdObjective 无内建测量，请注入自定义 ObjectiveSignal"))
    }
}

pub struct SelfRefineNode {
    id: String,
    meta: NodeMeta,
    /// 轮次上限（治理性完成闸门）
    max_rounds: u32,
    /// 自评自改一体的 system 提示（设计 §5.5 `refine_spec`）
    system_prompt: String,
    objective: std::sync::Arc<dyn ObjectiveSignal>,
    /// 达标线：score ≥ threshold 即 acceptable（设计 5.5 终止①）
    threshold: u32,
    /// 当前轮次 k（版本键 refine.draft@k 的游标；restore(&self) 纪律）
    round: Mutex<u32>,
}

impl SelfRefineNode {
    pub fn new(
        id: impl Into<String>,
        system_prompt: impl Into<String>,
        objective: std::sync::Arc<dyn ObjectiveSignal>,
        max_rounds: u32,
        threshold: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("self_refine", "自我精炼"),
            max_rounds,
            system_prompt: system_prompt.into(),
            objective,
            threshold,
            round: Mutex::new(0),
        }
    }

    fn refine_request(&self, intent: &str, draft: Option<&str>, score: Option<u32>) -> Request {
        let mut user = intent.to_string();
        if let (Some(d), Some(s)) = (draft, score) {
            user.push_str(&format!(
                "\n\n当前稿件（客观得分 {s}，未达标）：\n{d}\n\n请对照目标自评差距并产出改进稿。"
            ));
        }
        Request::new(self.system_prompt.clone(), user)
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for SelfRefineNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("stalled".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let mut usage = Usage::default();

        // 初稿（render_initial，设计 5.5 伪代码）
        let mut draft = ctx.llm.complete(&self.refine_request(&intent, None, None)).await?;
        usage.saturating_add(&draft.usage);
        let mut score = self.objective.measure(&draft.text).await?;
        if score >= self.threshold {
            ctx.state.write("result.draft", draft.text.clone());
            return Ok(NodeResult { port: Port::Done, usage, progress: None });
        }

        let mut prev_score: Option<u32> = None;
        loop {
            let k = { *self.round.lock().unwrap() };
            // 终止③：连续两轮无改善 → Fatal("stalled")（伪代码：improved_over 判定）
            if let Some(p) = prev_score {
                if score <= p {
                    return Ok(NodeResult {
                        port: Port::Fatal("stalled".into()),
                        usage,
                        progress: Some(ProgressNote::Note(format!(
                            "指标停滞（{p} → {score}），防收益递减终止"
                        ))),
                    });
                }
            }
            // 终止②：轮次上限 → 治理性完成
            if k >= self.max_rounds {
                ctx.state.write("result.draft", draft.text.clone());
                return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
            }
            prev_score = Some(score);

            // 自评自改一体（render_next：携带前稿 + 目标差距）
            draft = ctx
                .llm
                .complete(&self.refine_request(&intent, Some(&draft.text), Some(score)))
                .await?;
            usage.saturating_add(&draft.usage);
            score = self.objective.measure(&draft.text).await?;
            { *self.round.lock().unwrap() += 1; }
            // 版本链：写新版本键（黑板只追加原则，设计 5.5）
            ctx.state.write(format!("refine.draft@{}", k + 1), draft.text.clone());

            // 终止①：客观指标达标
            if score >= self.threshold {
                ctx.state.write("result.draft", draft.text.clone());
                ctx.state.append("mem.notes", json!({ "content": format!("self-refine 收敛于第 {} 轮，得分 {score}", k + 1) }));
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }
        }
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
