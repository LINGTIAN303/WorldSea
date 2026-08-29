//! Loop Engineering 循环工程（设计 §6.6）— 预算/收敛/压缩/退避四闸门治理
//!
//! 不是新链路，而是「链路的循环策略层」：对任意内层链路（`inner`，常为
//! `CompositeNode(loop 模式)` 黑盒）的重复执行施加治理。台账 `gov.budget_ledger`
//! 随轮累计（设计 表 3-1）；收敛判定客观优先（ConvergePolicy 可插拔）；退避
//! 指数等待 + 上限；压缩经 LLM 摘要后 `Blackboard::compact_keep`。
//!
//! 终止条件三分（设计 6.6）：① 收敛 → `Done`；
//! ② 预算耗尽 → 治理性完成（best-effort 交付当前最好结果 + 台账）；
//! ③ 退避上限 → `Fatal("backoff")`；取消 → 执行器治理。

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::orchestrator::blackboard::Blackboard;
use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 收敛判定策略（可插拔，设计 §6.6 `converge_policy`；
/// 客观指标优先、趋势次之、平台期兜底——由实现方裁量）
#[async_trait::async_trait]
pub trait ConvergePolicy: Send + Sync {
    async fn converged(&self, state: &Blackboard) -> bool;
}

/// 轮次达标即收敛的最简策略（内层链路产出 `result.draft` 后按轮次收敛）
pub struct RoundConverge {
    pub rounds: u32,
}

#[async_trait::async_trait]
impl ConvergePolicy for RoundConverge {
    async fn converged(&self, state: &Blackboard) -> bool {
        state.read_t::<u32>("gov.round").unwrap_or(None).unwrap_or(0) >= self.rounds
    }
}

pub struct LoopEngineeringNode {
    id: String,
    meta: NodeMeta,
    /// 被治理的内层链路（任意模式图的黑盒，设计 §6.6 `inner`）
    inner: Arc<dyn OrchestratorNode>,
    /// 局部预算上限（token 台账自累计；全局预算由执行器 4.2 第 5 步另行封顶）
    budget_cap: Usage,
    /// 收敛策略
    converge: Arc<dyn ConvergePolicy>,
    /// 上下文压缩 prompt（None = 不压缩）
    compact_prompt: Option<String>,
    /// 压缩时保留的黑板键（其余清理）
    compact_keep: Vec<String>,
    /// Retryable 退避上限（策略降级链留宿主注入，M3 记录为已知简化）
    max_attempts: u32,
    /// 最大治理轮次（兜底收敛闸门）
    max_rounds: u32,
    state: Mutex<LoopState>,
}

#[derive(Default)]
struct LoopState {
    round: u32,
    attempts: u32,
    ledger: Usage,
}

impl LoopEngineeringNode {
    pub fn new(
        id: impl Into<String>,
        inner: Arc<dyn OrchestratorNode>,
        budget_cap: Usage,
        converge: Arc<dyn ConvergePolicy>,
        max_rounds: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("loop_engineering", "循环工程治理"),
            inner,
            budget_cap,
            converge,
            compact_prompt: None,
            compact_keep: vec!["task.intent".into(), "result.draft".into(), "gov.budget_ledger".into(), "gov.round".into()],
            max_attempts: 3,
            max_rounds,
            state: Mutex::new(LoopState::default()),
        }
    }

    pub fn with_compaction(mut self, prompt: impl Into<String>) -> Self {
        self.compact_prompt = Some(prompt.into());
        self
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for LoopEngineeringNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("backoff".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let mut usage = Usage::default();
        let mut best_effort: Option<String> = None;

        loop {
            // 1. 预算门：台账达到上限（>=）→ 治理性完成（best-effort 交付当前最好结果，设计 6.6；
            //    局部预算语义为「允许上限」，与执行器全局预算门的 exceeds(>) 有意区分）
            {
                let st = self.state.lock().unwrap();
                let hit = st.ledger.input_tokens >= self.budget_cap.input_tokens
                    || st.ledger.output_tokens >= self.budget_cap.output_tokens
                    || st.ledger.llm_calls >= self.budget_cap.llm_calls;
                if hit {
                    if let Some(b) = best_effort.clone() {
                        ctx.state.write("result.draft", b);
                    }
                    return Ok(NodeResult {
                        port: Port::Done,
                        usage,
                        progress: Some(ProgressNote::Budget),
                    });
                }
            }
            let round = { self.state.lock().unwrap().round };
            if round >= self.max_rounds {
                if let Some(b) = best_effort.clone() {
                    ctx.state.write("result.draft", b);
                }
                return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
            }

            // 2. inner 执行（Retryable → 退避重试；上限 → Fatal，设计 6.6 伪代码）
            match self.inner.execute(ctx).await {
                Ok(r) => {
                    usage.saturating_add(&r.usage);
                    { self.state.lock().unwrap().ledger.saturating_add(&r.usage); }
                    if let Some(v) = ctx.state.read("result.draft").and_then(|v| v.as_str().map(|s| s.to_string())) {
                        best_effort = Some(v);
                    }
                }
                Err(e) if e.is_retryable() => {
                    let attempts = { self.state.lock().unwrap().attempts += 1; self.state.lock().unwrap().attempts };
                    if attempts > self.max_attempts {
                        return Ok(NodeResult {
                            port: Port::Fatal("backoff".into()),
                            usage,
                            progress: Some(ProgressNote::Note(format!("退避 {attempts} 次仍失败"))),
                        });
                    }
                    // 指数退避（基础 10ms × 2^n；治理层等待，不占 LLM 用量）
                    tokio::time::sleep(std::time::Duration::from_millis(10u64 << attempts.min(6))).await;
                    continue;
                }
                Err(e) => return Err(e),
            }

            // 3. 收敛门：客观指标 → 趋势 → 平台期（策略可插拔）
            { self.state.lock().unwrap().round += 1; }
            let round = { self.state.lock().unwrap().round };
            ctx.state.write("gov.round", round);
            ctx.state.write("gov.budget_ledger", json!({ "input": usage.input_tokens, "output": usage.output_tokens, "calls": usage.llm_calls }));
            if self.converge.converged(ctx.state).await {
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }

            // 4. 压缩门：摘要轨迹、清理低价值键后进入下一轮（设计 6.6 compact）
            if let Some(prompt) = &self.compact_prompt {
                let draft = best_effort.clone().unwrap_or_default();
                let resp = ctx
                    .llm
                    .complete(&Request::new(prompt.clone(), format!("当前进展摘要（供下一轮压缩上下文）：\n{draft}")))
                    .await?;
                usage.saturating_add(&resp.usage);
                ctx.state.write("gov.compacted", resp.text.clone());
            }
            let keep: Vec<&str> = self.compact_keep.iter().map(|s| s.as_str()).collect();
            ctx.state.compact_keep(&keep);
        }
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        let st = self.state.lock().unwrap();
        Ok(NodeSnapshot {
            payload: json!({ "round": st.round, "attempts": st.attempts,
                             "ledger": { "input": st.ledger.input_tokens, "output": st.ledger.output_tokens, "calls": st.ledger.llm_calls } }),
        })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        let mut st = self.state.lock().unwrap();
        if let Some(v) = snap.payload.get("round").and_then(|v| v.as_u64()) {
            st.round = v as u32;
        }
        if let Some(v) = snap.payload.get("attempts").and_then(|v| v.as_u64()) {
            st.attempts = v as u32;
        }
        if let Some(l) = snap.payload.get("ledger") {
            st.ledger.input_tokens = l.get("input").and_then(|v| v.as_u64()).unwrap_or(0);
            st.ledger.output_tokens = l.get("output").and_then(|v| v.as_u64()).unwrap_or(0);
            st.ledger.llm_calls = l.get("calls").and_then(|v| v.as_u64()).unwrap_or(0);
        }
        Ok(())
    }
}
