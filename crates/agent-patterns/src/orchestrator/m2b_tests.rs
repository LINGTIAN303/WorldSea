//! M2 收尾验收测试 — Self-Refine（§5.5）/ Reflection（§5.4）/ Plan-and-Execute（§5.3）
//!
//! 三者皆只经 `LlmHandle::complete` + JSON 约定（LlmHandle 保持 §8.5 方法集）。
//! 计划/评审/验收脚本用 M1 的 `ScriptedLlm`（complete 按序回放）。

use std::sync::{Arc, Mutex};


use crate::orchestrator::blackboard::Blackboard;
use crate::orchestrator::context::{BudgetView, CancelToken, NodeCtx};
use crate::orchestrator::error::NodeError;
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig, TerminalReason};
use crate::orchestrator::graph::{Edge, Graph};
use crate::orchestrator::handles::test_support::ScriptedLlm;
use crate::orchestrator::handles::NoopMemory;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::plan_execute::PlanExecuteNode;
use crate::orchestrator::reflection::ReflectionNode;
use crate::orchestrator::self_refine::{ObjectiveSignal, SelfRefineNode};
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

// ── 桩 ──────────────────────────────────────────────────

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
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        ctx.state.write("task.intent", "测试意图");
        Ok(NodeResult { port: Port::Out, usage: Usage::default(), progress: None })
    }
}

/// P&E 的步执行器桩：不走 LLM，直接把当前步标记完成（隔离 complete 脚本）
struct StepWorkerStub {
    id: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for StepWorkerStub {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("inner", "步执行器"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Out])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let step = ctx
            .state
            .read("pne.step.current")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        ctx.state.write("result.draft", format!("完成：{step}"));
        Ok(NodeResult { port: Port::Out, usage: Usage::default(), progress: None })
    }
}

/// 脚本化客观指标：按测量序回放（单条常驻）
struct ScriptedObjective {
    scores: Mutex<Vec<u32>>,
}

impl ScriptedObjective {
    fn new(scores: Vec<u32>) -> Arc<Self> {
        Arc::new(Self { scores: Mutex::new(scores) })
    }
}

#[async_trait::async_trait]
impl ObjectiveSignal for ScriptedObjective {
    async fn measure(&self, _text: &str) -> Result<u32, NodeError> {
        let mut s = self.scores.lock().unwrap();
        Ok(if s.len() == 1 { s[0] } else { s.remove(0) })
    }
}

fn two_node_graph(second: Box<dyn OrchestratorNode>) -> Graph {
    Graph::build(
        vec![Box::new(IntentNode { id: "ingress".into() }), second],
        vec![Edge::new("ingress", Port::Out, "node")],
        "ingress",
    )
    .unwrap()
}

async fn run(graph: &Graph, texts: Vec<String>) -> Result<crate::orchestrator::executor::RunReport, NodeError> {
    let llm = Arc::new(ScriptedLlm::new(
        texts.into_iter().map(|t| crate::orchestrator::handles::Response { text: t, usage: Usage::of(1, 1) }).collect(),
    ));
    DefaultOrchestrator::new(graph, llm, Arc::new(NoopMemory), RunConfig::default()).run().await
}

// ══ Self-Refine（§5.5）══════════════════════════════════

#[tokio::test]
async fn M2b_SelfRefine_初稿即达标() {
    // 初稿得分 85 ≥ 80 → 终止①，仅 1 次 LLM 调用，无版本键
    let node = SelfRefineNode::new("node", "打磨", ScriptedObjective::new(vec![85]), 5, 80);
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["初稿".into(), "不应被消费".into()]).await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("初稿"));
    assert_eq!(report.usage.llm_calls, 1);
}

#[tokio::test]
async fn M2b_SelfRefine_两轮精炼后收敛写版本链() {
    // 60 → 70 → 85：refine.draft@1/@2 版本链落黑板，结果层为终稿
    let node = SelfRefineNode::new("node", "打磨", ScriptedObjective::new(vec![60, 70, 85]), 5, 80);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec!["初稿".into(), "稿v1".into(), "稿v2".into()],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("稿v2"));
    assert_eq!(report.usage.llm_calls, 3, "初稿 + 两轮自改");
}

#[tokio::test]
async fn M2b_SelfRefine_指标停滞防收益递减() {
    // 60 → 60：连续无改善 → Fatal("stalled")（终止③）
    let node = SelfRefineNode::new("node", "打磨", ScriptedObjective::new(vec![60, 60]), 5, 80);
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["初稿".into(), "改稿".into()]).await.unwrap();
    assert!(
        matches!(report.reason, TerminalReason::Fatal(_)),
        "停滞 → 失败终局：{:?}",
        report.reason
    );
}

#[tokio::test]
async fn M2b_SelfRefine_轮次上限治理性完成() {
    // 持续改善但达不到 80：60 → 65 → 70 → 75（脚本耗尽常驻 75）
    let node = SelfRefineNode::new("node", "打磨", ScriptedObjective::new(vec![60, 65, 70, 75]), 2, 80);
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["a".into(), "b".into(), "c".into(), "d".into()]).await.unwrap();
    assert!(report.is_done(), "轮次上限 → 治理性 Done：{:?}", report.reason);
}

// ══ Reflection（§5.4）═══════════════════════════════════

const REVIEW_NONE: &str = r#"{"issues":[]}"#;
const REVIEW_HIGH: &str = r#"{"issues":[{"severity":"high","desc":"缺边界测试"}]}"#;

#[tokio::test]
async fn M2b_Reflection_critic一次通过() {
    // 终止①：无高严重度问题 → Done（初稿 + 一次评审 = 2 次 LLM）
    let node = ReflectionNode::new("node", "actor提示", "critic提示", 3);
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["初稿".into(), REVIEW_NONE.into(), "不应消费".into()]).await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("初稿"));
    assert_eq!(report.usage.llm_calls, 2);
}

#[tokio::test]
async fn M2b_Reflection_修订一轮后通过() {
    // 高严重度 → actor 修订 → 评审通过：4 次 LLM（draft, review, revise, review）
    let node = ReflectionNode::new("node", "actor提示", "critic提示", 3);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec!["初稿".into(), REVIEW_HIGH.into(), "修订稿".into(), REVIEW_NONE.into(), "不应消费".into()],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("修订稿"));
    assert_eq!(report.usage.llm_calls, 4);
}

#[tokio::test]
async fn M2b_Reflection_评审震荡防死循环() {
    // 终止③：连续两轮相同评审 → Fatal("oscillate")
    let node = ReflectionNode::new("node", "actor提示", "critic提示", 5);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            "初稿".into(),
            REVIEW_HIGH.into(),
            "修订稿".into(),
            REVIEW_HIGH.into(), // 与上一轮完全相同 → 震荡
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(
        matches!(report.reason, TerminalReason::Fatal(_)),
        "震荡 → 失败终局：{:?}",
        report.reason
    );
}

#[tokio::test]
async fn M2b_Reflection_轮次上限治理性完成() {
    // max_rounds=1：评审 high → 修订 → round=1 → 上限 → 治理性 Done
    let node = ReflectionNode::new("node", "actor提示", "critic提示", 1);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec!["初稿".into(), REVIEW_HIGH.into(), "修订稿".into(), "不应消费".into()],
    )
    .await.unwrap();
    assert!(report.is_done(), "轮次上限 → 治理性 Done：{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("修订稿"), "治理性完成交付当前最好结果");
}

// ══ Plan-and-Execute（§5.3）═════════════════════════════

#[tokio::test]
async fn M2b_PE_两步顺序执行验收全过() {
    // 终止①：游标越过末步 → Done
    let inner = Arc::new(StepWorkerStub { id: "inner".into() });
    let node = PlanExecuteNode::new("node", inner, "规划提示", "验收提示", 2);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            r#"{"steps":["升级依赖","迁移语法"]}"#.into(),
            r#"{"passed":true}"#.into(),
            r#"{"passed":true}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("完成：迁移语法"), "结果层=最后一步产出");
    assert_eq!(report.usage.llm_calls, 3, "plan + 两次 assess（inner 不走 LLM）");
}

#[tokio::test]
async fn M2b_PE_步失败触发重规划后通过() {
    // gate.replan：验收不过 → 重规划 1 次 → 新计划执行通过
    let inner = Arc::new(StepWorkerStub { id: "inner".into() });
    let node = PlanExecuteNode::new("node", inner, "规划提示", "验收提示", 2);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            r#"{"steps":["迁移 clap3"]}"#.into(),
            r#"{"passed":false,"reason":"API 不兼容"}"#.into(),
            r#"{"steps":["先升 derive 语法","再迁移 clap3"]}"#.into(),
            r#"{"passed":true}"#.into(),
            r#"{"passed":true}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("完成：再迁移 clap3"));
    assert_eq!(report.usage.llm_calls, 5, "plan + assess(败) + replan + 两次 assess");
}

#[tokio::test]
async fn M2b_PE_重规划超上限失败终局() {
    // 终止②：max_replans=0 → 首次失败即 Fatal("replan")
    let inner = Arc::new(StepWorkerStub { id: "inner".into() });
    let node = PlanExecuteNode::new("node", inner, "规划提示", "验收提示", 0);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            r#"{"steps":["迁移"]}"#.into(),
            r#"{"passed":false,"reason":"不可行"}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(
        matches!(report.reason, TerminalReason::Fatal(_)),
        "重规划上限 → 失败终局：{:?}",
        report.reason
    );
}

// 防止 unused 警告（Blackboard/BudgetView/CancelToken 在桩演进时使用）
#[allow(dead_code)]
fn _touch(_: &Blackboard, _: &BudgetView, _: &CancelToken) {}
