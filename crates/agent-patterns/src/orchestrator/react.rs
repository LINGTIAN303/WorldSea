//! ReAct 推理与行动（设计 §5.2）— 思考—行动—观察回边循环
//!
//! 核心状态是 `react.trace`（思考/行动/观察条目的只追加序列，设计 表 3-1）。
//! 每轮：`reason` 读全部轨迹 → 产出一条 Thought + 一个 Action →
//! 执行工具 → Observation 追加回轨迹 → 判定。
//!
//! 终止条件三分（设计 5.2）：
//! ① reason 标记 final answer → `Done`（自然终止）；
//! ② 轮次上限 → 治理性完成（Done + `ProgressNote::MaxTurns`，输出当前轨迹）；
//! ③ 工具连续 N 次失败 → `Fatal`（防原地打转）。

use std::sync::Mutex;

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::tools::{Observation, ReactStep, ToolCall, ToolHandle, ToolSpecSet, TraceEntry};
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 工具连续失败阈值（终止③；设计 5.2「工具连续 N 次失败」）
pub const MAX_CONSECUTIVE_TOOL_FAILURES: u32 = 3;

pub struct ReActLoopNode {
    id: String,
    meta: NodeMeta,
    /// 治理终止闸门：最大轮次
    max_turns: u32,
    /// 本链路可用的工具集（策略层：reason 每轮显式选工具）
    tools: ToolSpecSet,
    tool_handle: std::sync::Arc<dyn ToolHandle>,
    /// 当前轮次（内部可变性：restore(&self) 纪律）
    round: Mutex<u32>,
    /// 工具连续失败计数（成功一次即清零）
    consecutive_failures: Mutex<u32>,
}

impl ReActLoopNode {
    pub fn new(
        id: impl Into<String>,
        tools: ToolSpecSet,
        tool_handle: std::sync::Arc<dyn ToolHandle>,
        max_turns: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("react", "ReAct 推理与行动"),
            max_turns,
            tools,
            tool_handle,
            round: Mutex::new(0),
            consecutive_failures: Mutex::new(0),
        }
    }

    /// 读黑板轨迹（只追加序列反序列化；坏条目跳过——审计可回放优先于强一致）
    fn read_trace(ctx: &NodeCtx<'_>) -> Vec<TraceEntry> {
        ctx.state
            .read_all("react.trace")
            .iter()
            .filter_map(|v| serde_json::from_value(v.clone()).ok())
            .collect()
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for ReActLoopNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("tool".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let mut usage = Usage::default();

        loop {
            let round = { *self.round.lock().unwrap() };
            // 终止②：轮次上限 → 治理性完成（伪代码语义：Done + max_turns 进度注记）
            if round >= self.max_turns {
                return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
            }

            // 1. reason：携带全部轨迹请求下一步（思考 + 行动选择）
            let trace = Self::read_trace(ctx);
            let step: ReactStep = ctx.llm.react_step(&trace, &self.tools).await?;
            usage.saturating_add(&step.usage);
            if let Some(thought) = &step.thought {
                ctx.state.append("react.trace", &TraceEntry::Thought { text: thought.clone() });
            }

            // 终止①：最终答案 → 写黑板，自然终局
            if let Some(answer) = step.final_answer {
                ctx.state.write("result.draft", answer);
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }

            // 异常步：无行动也无答案 → schema 级失败（Fatal，设计 4.5）
            let call: ToolCall = match &step.action {
                Some(c) => c.clone(),
                None => return Err(NodeError::fatal("react", "react_step 既无行动也无最终答案")),
            };

            // 2. act：执行工具（工具错误归一为失败观察——ReAct 以观察消化失败，
            //    避免整步重放造成轨迹重复；Fatal 级工具错误直接上抛）
            let started = std::time::Instant::now();
            let observation: Observation = match self.tool_handle.invoke(&call).await {
                Ok(obs) => obs,
                Err(NodeError::Retryable { message, .. }) => Observation::failed(message),
                Err(e) => return Err(e),
            };
            let _ = started.elapsed();

            // 3. observe：ActionObs 追加回轨迹（只追加，设计 5.2 数据流）
            ctx.state.append("react.trace", &TraceEntry::ActObs { call, observation: observation.clone() });

            // 终止③：工具连续 N 次失败 → Fatal（成功一次即清零）
            let mut fails = self.consecutive_failures.lock().unwrap();
            if observation.ok {
                *fails = 0;
            } else {
                *fails += 1;
                if *fails >= MAX_CONSECUTIVE_TOOL_FAILURES {
                    return Ok(NodeResult {
                        port: Port::Fatal("tool".into()),
                        usage,
                        progress: Some(ProgressNote::Note(format!(
                            "工具连续 {fails} 次失败，防原地打转终止"
                        ))),
                    });
                }
            }
            drop(fails);

            // 轮次边界：计数推进（快照由执行器在快照点经 snapshot() 采集）
            { *self.round.lock().unwrap() += 1; }
        }
    }

    /// 可恢复快照：轮次游标 + 连续失败计数（轨迹权威在黑板 react.trace）
    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot {
            payload: json!({
                "round": *self.round.lock().unwrap(),
                "consecutive_failures": *self.consecutive_failures.lock().unwrap(),
            }),
        })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("round").and_then(|v| v.as_u64()) {
            *self.round.lock().unwrap() = v as u32;
        }
        if let Some(v) = snap.payload.get("consecutive_failures").and_then(|v| v.as_u64()) {
            *self.consecutive_failures.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}
