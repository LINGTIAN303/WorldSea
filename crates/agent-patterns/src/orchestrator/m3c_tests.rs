//! M3 尾验收测试 — TOT（§6.1）/ GoT（§6.2）/ Loop Engineering（§6.6）


use std::sync::Arc;


use crate::orchestrator::blackboard::Blackboard;
use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig};
use crate::orchestrator::graph::{Edge, Graph};
use crate::orchestrator::handles::test_support::ScriptedLlm;
use crate::orchestrator::handles::{NoopMemory, Response};
use crate::orchestrator::loop_engineering::{ConvergePolicy, LoopEngineeringNode, RoundConverge};
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::single_agent::{PromptSpec, SingleAgentNode};
use crate::orchestrator::tot::TotNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

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

fn two_node_graph(second: Box<dyn OrchestratorNode>) -> Graph {
    let target = second.id().to_string();
    Graph::build(
        vec![Box::new(IntentNode { id: "ingress".into() }), second],
        vec![Edge::new("ingress", Port::Out, target.as_str())],
        "ingress",
    )
    .unwrap()
}

async fn run(graph: &Graph, texts: Vec<String>) -> Result<crate::orchestrator::executor::RunReport, NodeError> {
    let llm = Arc::new(ScriptedLlm::new(
        texts.into_iter().map(|t| Response { text: t, usage: Usage::of(1, 1) }).collect(),
    ));
    DefaultOrchestrator::new(graph, llm, Arc::new(NoopMemory), RunConfig::default()).run().await
}

// ══ TOT（§6.1）══════════════════════════════════════════

#[tokio::test]
async fn M3c_TOT_展开评分剪枝后分数饱和提前收敛() {
    // k=2, top-b=1, 深度上限 3：首轮候选 60/80（剪枝留 80）；次轮 80/85 → 最优 85>80 未饱和；
    // 三轮 85/85 → 最优 85 ≤ 85 饱和 → 提前收敛（终止②）
    let node = TotNode::new("node", "展开提示", "评分提示", 2, 1, 3, None);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            r#"{"candidates":["方案A","方案B"]}"#.into(),
            r#"{"score":60}"#.into(),
            r#"{"score":80}"#.into(),
            r#"{"candidates":["方案C","方案D"]}"#.into(),
            r#"{"score":80}"#.into(),
            r#"{"score":85}"#.into(),
            r#"{"candidates":["方案E","方案F"]}"#.into(),
            r#"{"score":85}"#.into(),
            r#"{"score":85}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    let got_text = report.result_text().unwrap_or_default();
    assert!(
        got_text == "方案D" || got_text == "方案E",
        "饱和轮并列最优（85 分）任一交付，实际 {got_text}"
    );
    // 剪枝验证：top-b=1 → 每轮只保留 1 叶子参与下轮展开
    assert!(report.usage.llm_calls >= 8);
}

#[tokio::test]
async fn M3c_TOT_深度上限治理收敛() {
    // 每轮分数持续提升（不饱和）→ 深度上限 2 → 治理性 Done（终止①）
    let node = TotNode::new("node", "展开", "评分", 1, 1, 2, None);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec![
            r#"{"candidates":["A"]}"#.into(),
            r#"{"score":50}"#.into(),
            r#"{"candidates":["B"]}"#.into(),
            r#"{"score":70}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(report.is_done(), "深度上限 → Done：{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("B"));
}

// ══ GoT（§6.2）══════════════════════════════════════════

#[tokio::test]
async fn M3c_GOT_split并发车道融合评估达标() {
    // GotNode 环回图：got --Out--> got（车道完成回融合 → 回评估 → accept → Done）
    struct ViewWorker {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for ViewWorker {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("worker", "视角求解"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Done])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let task = ctx
                .state
                .read(&format!("got.view.{}.task", self.id))
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_default();
            ctx.state.write(format!("got.view.{}.result", self.id), format!("「{task}」的部分解"));
            Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
        }
    }

    struct GotHolder {
        id: String,
        got: Arc<crate::orchestrator::got::GotNode>,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for GotHolder {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("got", "思维图外壳"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Spawn, Port::Out, Port::Done, Port::Fatal("merge".into())])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            self.got.execute(ctx).await
        }
    }

    let factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync> =
        Arc::new(|i, _view| {
            let wid = format!("view-{i}");
            let w = ViewWorker { id: wid.clone() };
            let g = Graph::build(vec![Box::new(w)], vec![], &wid)?;
            Ok((wid, g))
        });
    let got = Arc::new(crate::orchestrator::got::GotNode::new(
        "got_core",
        "拆分提示",
        "融合提示",
        "评估提示",
        factory,
        2,
    ));
    // 环回图：ingress → got --Out--> got（融合/评估轮）；accept → Done（GotNode 内部出 Done）
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(GotHolder { id: "got".into(), got }),
        ],
        vec![Edge::new("ingress", Port::Out, "got"), Edge::new("got", Port::Out, "got")],
        "ingress",
    )
    .unwrap();
    // 脚本：split → (车道无 LLM) → merge → evaluate(accept)
    let report = run(
        &graph,
        vec![
            r#"{"views":["性能视角","可测性视角"]}"#.into(),
            r#"{"merged":"统一重构路线图"}"#.into(),
            r#"{"accept":true}"#.into(),
            "不应消费".into(),
        ],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("统一重构路线图"), "融合全解交付");
}

// ══ Loop Engineering（§6.6）══════════════════════════════

#[tokio::test]
async fn M3c_LoopEng_两轮后收敛() {
    // RoundConverge(2)：inner 跑 2 轮 → 收敛 Done
    let inner = Arc::new(SingleAgentNode::terminal("inner", PromptSpec::new("s")));
    let node = LoopEngineeringNode::new("node", inner, Usage { llm_calls: 99, input_tokens: u64::MAX, output_tokens: u64::MAX }, Arc::new(RoundConverge { rounds: 2 }), 5);
    let graph = two_node_graph(Box::new(node));
    let report = run(
        &graph,
        vec!["第一轮产出".into(), "第二轮产出".into(), "不应消费".into()],
    )
    .await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("第二轮产出"));
    assert_eq!(report.usage.llm_calls, 2, "恰好 2 轮 inner");
}

#[tokio::test]
async fn M3c_LoopEng_预算耗尽best_effort交付() {
    // 局部预算 llm_calls=1：首轮后超限 → 治理性 Done + best-effort 交付（终止②）
    let inner = Arc::new(SingleAgentNode::terminal("inner", PromptSpec::new("s")));
    let node = LoopEngineeringNode::new(
        "node",
        inner,
        Usage { llm_calls: 1, input_tokens: u64::MAX, output_tokens: u64::MAX },
        Arc::new(RoundConverge { rounds: 99 }),
        99,
    );
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["首轮产出".into(), "不应消费".into()]).await.unwrap();
    assert!(report.is_done(), "预算耗尽 → 治理性 Done：{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("首轮产出"), "best-effort 交付当前最好结果");
}

/// 稳定不收敛策略（测轮次兜底）
struct NeverConverge;

#[async_trait::async_trait]
impl ConvergePolicy for NeverConverge {
    async fn converged(&self, _state: &Blackboard) -> bool {
        false
    }
}

#[tokio::test]
async fn M3c_LoopEng_轮次兜底治理完成() {
    let inner = Arc::new(SingleAgentNode::terminal("inner", PromptSpec::new("s")));
    let node = LoopEngineeringNode::new(
        "node",
        inner,
        Usage { llm_calls: 99, input_tokens: u64::MAX, output_tokens: u64::MAX },
        Arc::new(NeverConverge),
        2,
    );
    let graph = two_node_graph(Box::new(node));
    let report = run(&graph, vec!["a".into(), "b".into(), "不应消费".into()]).await.unwrap();
    assert!(report.is_done(), "轮次上限 → 治理性 Done：{:?}", report.reason);
    assert_eq!(report.usage.llm_calls, 2);
}
