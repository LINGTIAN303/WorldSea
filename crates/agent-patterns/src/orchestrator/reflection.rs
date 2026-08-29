//! Reflection 反思（设计 §5.4）— actor–critic 双视角交替循环
//!
//! 与 Self-Refine 的区别在节点数（设计 5.4 要点）：Reflection 是**双节点双角色**
//! （critic 用独立 prompt 与独立评分 rubric），Self-Refine 是单节点自评。
//! 核心状态：`reflect.review`（评估者反馈，只追加）。
//!
//! 终止条件三分（设计 5.4）：
//! ① critic 反馈无高严重度问题 → `Done`；
//! ② 轮次上限 → 治理性完成（附未解决问题清单于 mem.notes）；
//! ③ 反馈震荡（连续两轮反馈相同）→ `Fatal("oscillate")` 防死循环。

use std::sync::Mutex;

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 结构化评审反馈（critic 输出约定：`{"issues":[{"severity":"high|medium|low","desc":"..."}]}`）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Review {
    pub issues: Vec<Issue>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Issue {
    /// 严重度：high（阻断交付）/ medium / low
    pub severity: String,
    pub desc: String,
}

impl Review {
    /// 高严重度问题（终止①的判定信号，设计 5.4：`severe_issues().is_empty()`）
    pub fn severe_issues(&self) -> Vec<&Issue> {
        self.issues.iter().filter(|i| i.severity.eq_ignore_ascii_case("high")).collect()
    }
}

pub struct ReflectionNode {
    id: String,
    meta: NodeMeta,
    max_rounds: u32,
    /// actor 的 system 提示（产出/修订，独立于 critic）
    actor_prompt: String,
    /// critic 的 system 提示（独立 rubric：问题列表 + 严重度分级，设计 5.4 要点）
    critic_prompt: String,
    /// 当前轮次
    round: Mutex<u32>,
    /// 上一轮评审原文（震荡检测：连续两轮相同 → Fatal，设计 5.4 终止③）
    last_review_raw: Mutex<Option<String>>,
}

impl ReflectionNode {
    pub fn new(
        id: impl Into<String>,
        actor_prompt: impl Into<String>,
        critic_prompt: impl Into<String>,
        max_rounds: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("reflection", "actor–critic 反思"),
            max_rounds,
            actor_prompt: actor_prompt.into(),
            critic_prompt: critic_prompt.into(),
            round: Mutex::new(0),
            last_review_raw: Mutex::new(None),
        }
    }

    fn render(&self, system: &str, user: String) -> Request {
        Request::new(system.to_string(), user)
    }

    /// critic 调用：解析结构化评审（schema 不匹配 → Fatal，设计 4.5）
    async fn review_of(
        &self,
        ctx: &NodeCtx<'_>,
        draft: &str,
        acceptance: &str,
    ) -> Result<(Review, String, Usage), NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let req = self.render(
            &self.critic_prompt,
            format!(
                "任务意图：{intent}\n验收标准：{acceptance}\n\n稿件：\n{draft}\n\n请输出 JSON：{{\"issues\":[{{\"severity\":\"high|medium|low\",\"desc\":\"…\"}}]}}，无问题输出空数组。"
            ),
        );
        let resp = ctx.llm.complete(&req).await?;
        let review: Review = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("critic 输出非约定 JSON：{e}")))?;
        Ok((review, resp.text.trim().to_string(), resp.usage))
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for ReflectionNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("oscillate".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let acceptance = ctx
            .state
            .read("task.acceptance")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "按意图完成".into());
        let mut usage = Usage::default();

        // 初稿（render_initial）
        let mut draft = ctx
            .llm
            .complete(&self.render(&self.actor_prompt, format!("任务意图：{intent}\n验收标准：{acceptance}")))
            .await?;
        usage.saturating_add(&draft.usage);

        let mut last_review: Option<Review> = None;
        loop {
            let round = { *self.round.lock().unwrap() };
            if round >= self.max_rounds {
                // 终止②：治理性完成（未解决问题清单随 mem.notes 留档）
                ctx.state.write("result.draft", draft.text.clone());
                ctx.state.append(
                    "mem.notes",
                    json!({ "content": format!("reflection 达轮次上限 {round}，终稿附未解决问题清单") }),
                );
                return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
            }

            // critic：对照验收挑刺（独立 rubric）
            let (review, raw, r_usage) = self.review_of(ctx, &draft.text, &acceptance).await?;
            usage.saturating_add(&r_usage);
            ctx.state.append("reflect.review", &review);

            // 终止①：无高严重度问题 → 交付终稿
            if review.severe_issues().is_empty() {
                ctx.state.write("result.draft", draft.text.clone());
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }

            // 终止③：反馈震荡（连续两轮相同）→ Fatal 防死循环
            if Some(&review) == last_review.as_ref() {
                return Ok(NodeResult {
                    port: Port::Fatal("oscillate".into()),
                    usage,
                    progress: Some(ProgressNote::Note("连续两轮评审相同，判定震荡".into())),
                });
            }
            last_review = Some(review.clone());
            { *self.last_review_raw.lock().unwrap() = Some(raw); }

            // actor 修订（render_revision：携带前稿 + 反馈）
            let issues_desc: Vec<String> = review.issues.iter().map(|i| format!("[{}] {}", i.severity, i.desc)).collect();
            draft = ctx
                .llm
                .complete(&self.render(
                    &self.actor_prompt,
                    format!(
                        "任务意图：{intent}\n验收标准：{acceptance}\n\n当前稿件：\n{}\n\n评审反馈（修订这些高严重度问题）：\n{}",
                        draft.text,
                        issues_desc.join("\n")
                    ),
                ))
                .await?;
            usage.saturating_add(&draft.usage);
            { *self.round.lock().unwrap() += 1; }
        }
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot {
            payload: json!({
                "round": *self.round.lock().unwrap(),
                "last_review_raw": *self.last_review_raw.lock().unwrap(),
            }),
        })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("round").and_then(|v| v.as_u64()) {
            *self.round.lock().unwrap() = v as u32;
        }
        if let Some(v) = snap.payload.get("last_review_raw").and_then(|v| v.as_str()) {
            *self.last_review_raw.lock().unwrap() = Some(v.to_string());
        }
        Ok(())
    }
}
