//! Tool Use 工具调用（设计 §5.6）— 一切越出模型边界动作的协议底座
//!
//! 协议循环：`propose`（按工具 schema 产出调用意图或直接回答）→
//! `invoke`（宿主执行，采集结构化观察）→ `feedback`（回填 `tool.calls`）→ 判定。
//! 与 ReAct 的分工：ReAct 的 reason 每轮显式思考选工具（策略层），
//! Tool Use 的 propose 是无策略的协议层——ReAct 建立在 Tool Use 之上（设计 5.6）。
//!
//! 终止条件三分（设计 5.6）：
//! ① propose 直接给出最终回答 → `Done`；
//! ② 单工具调用失败超过重试上限 → `Fatal`；
//! ③ 总调用数上限 → 治理性完成（Done + `ProgressNote::MaxCalls`）。

use std::sync::Mutex;

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::tools::{CallRecord, Decision, Observation, ToolCall, ToolHandle, ToolSpecSet};
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

pub struct ToolUseNode {
    id: String,
    meta: NodeMeta,
    /// 工具面（JSON schema 声明，经通信层转换，设计 8.3）
    tools: ToolSpecSet,
    /// 宿主侧工具执行入口
    tool_handle: std::sync::Arc<dyn ToolHandle>,
    /// 总调用数上限（治理性完成闸门）
    max_calls: u32,
    /// 单工具瞬态失败的重试上限（设计 5.6 终止②）
    max_retries_per_call: u32,
    /// 已发起的调用数（内部可变性：restore(&self) 纪律，M1 定策）
    calls_made: Mutex<u32>,
}

impl ToolUseNode {
    pub fn new(
        id: impl Into<String>,
        tools: ToolSpecSet,
        tool_handle: std::sync::Arc<dyn ToolHandle>,
        max_calls: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("tool_use", "工具调用协议循环"),
            tools,
            tool_handle,
            max_calls,
            max_retries_per_call: 2,
            calls_made: Mutex::new(0),
        }
    }

    pub fn with_retries(mut self, max_retries_per_call: u32) -> Self {
        self.max_retries_per_call = max_retries_per_call;
        self
    }

    /// 沙箱执行单次调用：Retryable 在上限内重试（不换工具），Fatal 直接上抛（设计 4.5）
    async fn invoke_with_retry(
        &self,
        call: &ToolCall,
    ) -> Result<(Observation, u64, Usage), NodeError> {
        let started = std::time::Instant::now();
        let mut retries = 0u32;
        loop {
            match self.tool_handle.invoke(call).await {
                Ok(obs) => {
                    let usage = Usage { input_tokens: 0, output_tokens: 0, llm_calls: 0 };
                    return Ok((obs, started.elapsed().as_millis() as u64, usage));
                }
                Err(e) if e.is_retryable() && retries < self.max_retries_per_call => {
                    retries += 1;
                    tracing::warn!(tool = %call.name, attempt = retries, "工具瞬态失败，上限内重试");
                }
                Err(e) => return Err(e),
            }
        }
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for ToolUseNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Out, Port::Fatal("tool".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let mut usage = Usage::default();
        let mut history: Vec<(ToolCall, Observation)> = Vec::new();

        loop {
            // 1. propose：读任务 + 工具 schema + 已有调用记录（设计 §5.6 数据流）
            let proposal = ctx.llm.propose_tool_call(&intent, &self.tools, &history).await?;
            usage.saturating_add(&proposal.usage);

            match proposal.decision {
                // 终止①：propose 直接给出最终回答 → Done
                Decision::Answer(text) => {
                    ctx.state.write("result.draft", text);
                    return Ok(NodeResult { port: Port::Done, usage, progress: None });
                }
                Decision::Call(call) => {
                    // 治理闸门：总调用数上限（终止③，伪代码语义 Done + MaxCalls）
                    let made = { *self.calls_made.lock().unwrap() };
                    if made >= self.max_calls {
                        return Ok(NodeResult::governed_done(usage, ProgressNote::MaxCalls));
                    }
                    // 2. invoke：宿主执行（终止②：失败超重试上限 → Fatal）
                    let (obs, duration_ms, invoke_usage) = self.invoke_with_retry(&call).await?;
                    usage.saturating_add(&invoke_usage);
                    { *self.calls_made.lock().unwrap() += 1; }

                    // 3. feedback：结构化结果回填 `tool.calls`（只追加）+ 历史
                    let record = CallRecord { call: call.clone(), observation: obs.clone(), duration_ms };
                    ctx.state.append("tool.calls", &record);
                    history.push((call, obs));
                }
            }
        }
    }

    /// 可恢复快照：已发起调用数（黑板的 tool.calls 为权威轨迹，此处为游标）
    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot {
            payload: json!({ "calls_made": *self.calls_made.lock().unwrap() }),
        })
    }

    /// 从快照恢复：游标重置为快照值（黑板 tool.calls 不清——只追加，审计可回放）
    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("calls_made").and_then(|v| v.as_u64()) {
            *self.calls_made.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}
