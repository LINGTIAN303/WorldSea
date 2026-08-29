//! M2 循环层验收测试 — Tool Use（设计 §5.6）/ ReAct（设计 §5.2）三分终止全分支

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use crate::orchestrator::error::{LlmError, NodeError};
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig, TerminalReason};
use crate::orchestrator::graph::{Edge, Graph};
use crate::orchestrator::handles::{LlmHandle, NoopMemory, Request as LlmRequest, Response};
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::react::ReActLoopNode;
use crate::orchestrator::tool_use::ToolUseNode;
use crate::orchestrator::tools::{
    Decision, Observation, ReactStep, ToolCall, ToolHandle, ToolProposal, ToolSpec, ToolSpecSet,
};
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

// 复用 M1 测试模块的 IngressNode 桩（crate 内 tests 模块私有——此处重建轻量版）
struct IntentNode {
    id: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for IntentNode {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("ingress", "入口"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Out])
    }
    async fn execute(&self, ctx: &mut crate::orchestrator::context::NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        ctx.state.write("task.intent", "测试意图");
        Ok(NodeResult { port: Port::Out, usage: Usage::default(), progress: None })
    }
}

/// 脚本化 LLM：propose / react_step 各自按序回放（单条常驻回放；耗尽即 Fatal 显式暴露）
struct ToolScriptedLlm {
    proposals: Mutex<Vec<ToolProposal>>,
    react_steps: Mutex<Vec<ReactStep>>,
}

impl ToolScriptedLlm {
    fn new(proposals: Vec<ToolProposal>, react_steps: Vec<ReactStep>) -> Arc<Self> {
        Arc::new(Self { proposals: Mutex::new(proposals), react_steps: Mutex::new(react_steps) })
    }
}

#[async_trait::async_trait]
impl LlmHandle for ToolScriptedLlm {
    async fn complete(&self, _req: &LlmRequest) -> Result<Response, LlmError> {
        Ok(Response { text: String::new(), usage: Usage::default() })
    }
    async fn propose_tool_call(
        &self,
        _intent: &str,
        _tools: &ToolSpecSet,
        _history: &[(ToolCall, Observation)],
    ) -> Result<ToolProposal, LlmError> {
        let mut p = self.proposals.lock().unwrap();
        if p.is_empty() {
            return Err(LlmError::Fatal("proposals 脚本耗尽".into()));
        }
        Ok(if p.len() == 1 { p[0].clone() } else { p.remove(0) })
    }
    async fn react_step(
        &self,
        _trace: &[crate::orchestrator::tools::TraceEntry],
        _tools: &ToolSpecSet,
    ) -> Result<ReactStep, LlmError> {
        let mut s = self.react_steps.lock().unwrap();
        if s.is_empty() {
            return Err(LlmError::Fatal("react_steps 脚本耗尽".into()));
        }
        Ok(if s.len() == 1 { s[0].clone() } else { s.remove(0) })
    }
}

/// 脚本化工具：按序回放结果；空脚本回默认成功
struct ScriptedTools {
    results: Mutex<VecDeque<Result<Observation, NodeError>>>,
}

impl ScriptedTools {
    fn ok(texts: &[&str]) -> Arc<Self> {
        Arc::new(Self {
            results: Mutex::new(texts.iter().map(|t| Ok(Observation::ok(*t))).collect()),
        })
    }
    fn mixed(items: Vec<Result<Observation, NodeError>>) -> Arc<Self> {
        Arc::new(Self { results: Mutex::new(items.into()) })
    }
}

#[async_trait::async_trait]
impl ToolHandle for ScriptedTools {
    async fn invoke(&self, _call: &ToolCall) -> Result<Observation, NodeError> {
        let mut q = self.results.lock().unwrap();
        match q.pop_front() {
            Some(r) => r,
            None => Ok(Observation::ok("默认结果")),
        }
    }
}

fn fs_tools() -> ToolSpecSet {
    ToolSpecSet::new(vec![ToolSpec {
        name: "fs_read".into(),
        description: "读文件".into(),
        parameters: serde_json::json!({}),
    }])
}

fn two_node_graph(second: Box<dyn OrchestratorNode>) -> Graph {
    Graph::build(
        vec![Box::new(IntentNode { id: "ingress".into() }), second],
        vec![Edge::new("ingress", Port::Out, "m2node")],
        "ingress",
    )
    .unwrap()
}

// ══ Tool Use（设计 §5.6）══════════════════════════════════

#[tokio::test]
async fn M2_ToolUse_propose直接回答自然终局() {
    let tool_use = ToolUseNode::new("m2node", fs_tools(), ScriptedTools::ok(&[]), 10);
    let graph = two_node_graph(Box::new(tool_use));
    let llm = ToolScriptedLlm::new(
        vec![ToolProposal { decision: Decision::Answer("没有已知漏洞".into()), usage: Usage::of(5, 7) }],
        vec![],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("没有已知漏洞"), "终止①：直接回答");
    assert_eq!(report.usage.llm_calls, 1);
}

#[tokio::test]
async fn M2_ToolUse_协议循环调用后回答() {
    let tool_use = ToolUseNode::new("m2node", fs_tools(), ScriptedTools::ok(&["结果A", "结果B"]), 10);
    let graph = two_node_graph(Box::new(tool_use));
    let mk_call = |id: &str| ToolCall::new(id, "fs_read", serde_json::json!({"path": "Cargo.lock"}));
    let llm = ToolScriptedLlm::new(
        vec![
            ToolProposal { decision: Decision::Call(mk_call("c1")), usage: Usage::of(1, 1) },
            ToolProposal { decision: Decision::Call(mk_call("c2")), usage: Usage::of(1, 1) },
            ToolProposal { decision: Decision::Answer("结论".into()), usage: Usage::of(1, 1) },
        ],
        vec![],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("结论"));
    assert_eq!(report.usage.llm_calls, 3, "两次 propose + 一次回答（工具执行不计 LLM 用量）");
}

#[tokio::test]
async fn M2_ToolUse_调用数上限治理性完成() {
    // proposals 持续发起调用，max_calls=2 截停（终止③，闸门在 invoke 前）
    let tool_use = ToolUseNode::new("m2node", fs_tools(), ScriptedTools::ok(&[]), 2);
    let graph = two_node_graph(Box::new(tool_use));
    let call = ToolCall::new("c", "fs_read", serde_json::json!({}));
    let llm = ToolScriptedLlm::new(
        (0..3)
            .map(|_| ToolProposal { decision: Decision::Call(call.clone()), usage: Usage::of(1, 1) })
            .collect(),
        vec![],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "治理性完成也是 Done 端口：{:?}", report.reason);
    assert_eq!(report.usage.llm_calls, 3, "对齐设计 5.6 伪代码：propose→invoke→检查，第 3 次 propose 发生但第 3 次调用被闸门截停");
}

#[tokio::test]
async fn M2_ToolUse_工具瞬态失败上限内重试后继续() {
    let tool_use = ToolUseNode::new(
        "m2node",
        fs_tools(),
        ScriptedTools::mixed(vec![
            Err(NodeError::retryable("tool", "超时")),
            Ok(Observation::ok("重试成功")),
        ]),
        10,
    )
    .with_retries(2);
    let graph = two_node_graph(Box::new(tool_use));
    let llm = ToolScriptedLlm::new(
        vec![
            ToolProposal { decision: Decision::Call(ToolCall::new("c1", "fs_read", serde_json::json!({}))), usage: Usage::of(1, 1) },
            ToolProposal { decision: Decision::Answer("完成".into()), usage: Usage::of(1, 1) },
        ],
        vec![],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("完成"));
}

#[tokio::test]
async fn M2_ToolUse_工具致命失败终局上抛() {
    let tool_use = ToolUseNode::new(
        "m2node",
        fs_tools(),
        ScriptedTools::mixed(vec![Err(NodeError::fatal("tool", "权限拒绝"))]),
        10,
    );
    let graph = two_node_graph(Box::new(tool_use));
    let llm = ToolScriptedLlm::new(
        vec![ToolProposal { decision: Decision::Call(ToolCall::new("c1", "fs_read", serde_json::json!({}))), usage: Usage::of(1, 1) }],
        vec![],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    assert!(orch.run().await.is_err(), "工具 Fatal → 终局上抛（设计 4.5）");
}

// ══ ReAct（设计 §5.2）═════════════════════════════════════

#[tokio::test]
async fn M2_ReAct_首轮最终答案自然终局() {
    let react = ReActLoopNode::new("m2node", fs_tools(), ScriptedTools::ok(&[]), 5);
    let graph = two_node_graph(Box::new(react));
    let llm = ToolScriptedLlm::new(
        vec![],
        vec![ReactStep {
            thought: Some("现象明确，无需看现场".into()),
            action: None,
            final_answer: Some("根因是锁文件版本漂移".into()),
            usage: Usage::of(2, 3),
        }],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("根因是锁文件版本漂移"), "终止①：final answer");
    assert_eq!(report.usage.llm_calls, 1);
}

#[tokio::test]
async fn M2_ReAct_思考行动观察循环后交付() {
    let react = ReActLoopNode::new("m2node", fs_tools(), ScriptedTools::ok(&["观察1", "观察2"]), 8);
    let graph = two_node_graph(Box::new(react));
    let step = |thought: &'static str, call: Option<ToolCall>, ans: Option<&'static str>| ReactStep {
        thought: Some(thought.into()),
        action: call,
        final_answer: ans.map(|s| s.to_string()),
        usage: Usage::of(2, 3),
    };
    let llm = ToolScriptedLlm::new(
        vec![],
        vec![
            step("先看测试代码", Some(ToolCall::new("c1", "fs_read", serde_json::json!({}))), None),
            step("再看日志", Some(ToolCall::new("c2", "fs_read", serde_json::json!({}))), None),
            step("假设已验证", None, Some("时序依赖导致时绿时红")),
        ],
    );
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("时序依赖导致时绿时红"));
    assert_eq!(report.usage.llm_calls, 3, "三轮 reason");
}

#[tokio::test]
async fn M2_ReAct_轮次上限治理性完成() {
    let react = ReActLoopNode::new("m2node", fs_tools(), ScriptedTools::ok(&[]), 2);
    let graph = two_node_graph(Box::new(react));
    // 永不收敛：一直行动不回答（单条脚本常驻回放）
    let step = ReactStep {
        thought: Some("再看一眼".into()),
        action: Some(ToolCall::new("c", "fs_read", serde_json::json!({}))),
        final_answer: None,
        usage: Usage::of(1, 1),
    };
    let llm = ToolScriptedLlm::new(vec![], vec![step]);
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "轮次上限 → 治理性 Done：{:?}", report.reason);
    assert_eq!(report.usage.llm_calls, 2, "恰好 max_turns 轮");
}

#[tokio::test]
async fn M2_ReAct_工具连续失败触发Fatal() {
    let react = ReActLoopNode::new(
        "m2node",
        fs_tools(),
        ScriptedTools::mixed(vec![
            Ok(Observation::failed("失败1")),
            Ok(Observation::failed("失败2")),
            Ok(Observation::failed("失败3")),
        ]),
        10,
    );
    let graph = two_node_graph(Box::new(react));
    let step = ReactStep {
        thought: Some("试试".into()),
        action: Some(ToolCall::new("c", "fs_read", serde_json::json!({}))),
        final_answer: None,
        usage: Usage::of(1, 1),
    };
    let llm = ToolScriptedLlm::new(vec![], vec![step]);
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(
        matches!(report.reason, TerminalReason::Fatal(_)),
        "连续失败 → 失败终局：{:?}",
        report.reason
    );
}

#[tokio::test]
async fn M2_ReAct_成功一次清零连续失败计数() {
    // 失败×2 → 成功 → 失败×2 → 回答：始终不达连续 3 次 → Done（终止③不误伤）
    let react = ReActLoopNode::new(
        "m2node",
        fs_tools(),
        ScriptedTools::mixed(vec![
            Ok(Observation::failed("失败1")),
            Ok(Observation::failed("失败2")),
            Ok(Observation::ok("恢复")),
            Ok(Observation::failed("失败1'")),
            Ok(Observation::failed("失败2'")),
        ]),
        10,
    );
    let graph = two_node_graph(Box::new(react));
    let act = ReactStep {
        thought: Some("行动".into()),
        action: Some(ToolCall::new("c", "fs_read", serde_json::json!({}))),
        final_answer: None,
        usage: Usage::of(1, 1),
    };
    let final_step = ReactStep {
        thought: Some("结论".into()),
        action: None,
        final_answer: Some("答案".into()),
        usage: Usage::of(1, 1),
    };
    let llm = ToolScriptedLlm::new(vec![], vec![act, final_step]);
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "失败未连续成串 → 不触发 Fatal：{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("答案"));
}
