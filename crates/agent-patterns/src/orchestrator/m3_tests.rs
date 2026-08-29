//! M3 框架层首批验收 — CompositeNode（设计 §3.4：白盒图 ⇄ 黑盒节点自由切换）
//!
//! 复用 M1 作用域栈挂接语义：子图与父图共享黑板与句柄（直通），
//! exit_map 映射终止端口，内层快照由执行器聚合采集（4.6）。

use std::sync::Arc;

use crate::orchestrator::composite::CompositeNode;
use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig};
use crate::orchestrator::graph::{Edge, Graph, GraphError};
use crate::orchestrator::handles::test_support::ScriptedLlm;
use crate::orchestrator::handles::NoopMemory;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::single_agent::{PromptSpec, SingleAgentNode};
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

struct EgressNode {
    id: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for EgressNode {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("egress", "出口"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        // 黑板直通验证点：子图产出对本节点可见（设计 3.4「黑板直通」）
        assert!(ctx.state.contains("result.draft"), "egress 应能看到子图写入的黑板");
        Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
    }
}

/// 子图工厂：sub_solve（SingleAgent 黑盒，Done 收口）
fn solve_subgraph_factory() -> Arc<dyn Fn() -> Result<Graph, GraphError> + Send + Sync> {
    Arc::new(|| {
        let solve = SingleAgentNode::terminal("sub_solve", PromptSpec::new("子图执行"));
        Graph::build(vec![Box::new(solve)], vec![], "sub_solve")
    })
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

fn scripted(text: &str) -> Arc<ScriptedLlm> {
    Arc::new(ScriptedLlm::of_texts(&[text]))
}

// ── 测试 ────────────────────────────────────────────────

#[tokio::test]
async fn M3_Composite_子图黑盒端到端() {
    // 父图：ingress → composite（内层 sub_solve）→ egress
    let composite = CompositeNode::new(
        "comp",
        "worker: SingleAgent",
        solve_subgraph_factory(),
        vec![(Port::Done, Port::Out)],
    );
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(composite),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![Edge::new("ingress", Port::Out, "comp"), Edge::new("comp", Port::Out, "egress")],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted("子图答案"), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("子图答案"), "结果层来自子图（黑板直通）");
    // 步序：ingress → comp(Spawn) → sub_solve → egress（黑盒对外仅占 1 个父图节点位）
    let nodes: Vec<&str> = report.steps.iter().map(|s| s.node.as_str()).collect();
    assert_eq!(nodes, vec!["ingress", "comp", "sub_solve", "egress"]);
}

#[tokio::test]
async fn M3_Composite_嵌套组合任意深度() {
    // 内层复合 C1 包装 solve；外层复合 C2 包装 [C1 → sub_egress]
    let c2 = CompositeNode::new(
        "c2",
        "outer worker",
        {
            let c1_factory_solve = solve_subgraph_factory();
            Arc::new(move || {
                let c1 = CompositeNode::new(
                    "c1_inner",
                    "inner worker",
                    c1_factory_solve.clone(),
                    vec![(Port::Done, Port::Out)],
                );
                let sub_egress = EgressNode { id: "sub_egress".into() };
                Graph::build(
                    vec![Box::new(c1), Box::new(sub_egress)],
                    vec![Edge::new("c1_inner", Port::Out, "sub_egress")],
                    "c1_inner",
                )
            }) as Arc<dyn Fn() -> Result<Graph, GraphError> + Send + Sync>
        },
        vec![(Port::Done, Port::Out)],
    );
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(c2),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![Edge::new("ingress", Port::Out, "c2"), Edge::new("c2", Port::Out, "egress")],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted("嵌套答案"), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("嵌套答案"), "两层嵌套仍直通黑板");
}

#[tokio::test]
async fn M3_Composite_内层节点快照聚合() {
    // 快照协议（4.6）：checkpoint 的 node_snapshots 应含活跃作用域内的子图节点
    let composite = CompositeNode::new(
        "comp",
        "worker",
        solve_subgraph_factory(),
        vec![(Port::Done, Port::Out)],
    );
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(composite),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![Edge::new("ingress", Port::Out, "comp"), Edge::new("comp", Port::Out, "egress")],
        "ingress",
    )
    .unwrap();
    let cfg = RunConfig { snapshot_interval: 1, ..Default::default() };
    let orch = DefaultOrchestrator::new(&graph, scripted("快照答案"), Arc::new(NoopMemory), cfg);
    let (report, ckpt) = orch.run_with_checkpoint().await.unwrap();
    assert!(report.is_done());
    let ckpt = ckpt.expect("interval=1 必有快照");
    assert!(
        ckpt.node_snapshots.contains_key("sub_solve"),
        "子图节点快照应被聚合采集（设计 4.6），实际键：{:?}",
        ckpt.node_snapshots.keys().collect::<Vec<_>>()
    );
}

#[tokio::test]
async fn M3_Composite_构图失败Fatal() {
    // 工厂返回 Err → composite 报 Fatal("compose")
    let composite = CompositeNode::new(
        "comp",
        "broken",
        Arc::new(|| Err(GraphError::EmptyGraph)) as Arc<dyn Fn() -> Result<Graph, GraphError> + Send + Sync>,
        vec![(Port::Done, Port::Out)],
    );
    let graph = Graph::build(
        vec![Box::new(IntentNode { id: "ingress".into() }), Box::new(composite)],
        vec![Edge::new("ingress", Port::Out, "comp")],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted("x"), Arc::new(NoopMemory), RunConfig::default());
    assert!(orch.run().await.is_err(), "子图构图失败 → Fatal 上抛（设计 4.5 schema 级）");
}


// ══ M3 续：车道并发 + wait-set（设计 §4.4）════════════════

use crate::orchestrator::context::{LaneSpec, SubgraphRequest};
use crate::orchestrator::graph::JoinSpec;

/// 双车道 Spawn 节点：lanes = [lane-a(读 solve), lane-b(写 solve)]
struct MultiLaneSpawner {
    id: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for MultiLaneSpawner {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::new("spawn", "双车道容器"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Spawn, Port::Out])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let mk = |lane_solve_id: &'static str| {
            let solve = SingleAgentNode::terminal(lane_solve_id, PromptSpec::new("车道执行"));
            Graph::build(vec![Box::new(solve)], vec![], lane_solve_id)
        };
        let lanes = vec![
            LaneSpec { id: "lane-a".into(), graph: mk("lane_a_solve")? },
            LaneSpec { id: "lane-b".into(), graph: mk("lane_b_solve")? },
        ];
        ctx.pending = Some(SubgraphRequest::Lanes {
            lanes,
            return_port_map: vec![(Port::Done, Port::Out)],
        });
        Ok(NodeResult { port: Port::Spawn, usage: Usage::default(), progress: None })
    }
}

#[tokio::test]
async fn M3_双车道并发执行与黑板合并() {
    let spawner = MultiLaneSpawner { id: "lanes".into() };
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(spawner),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![
            Edge::new("ingress", Port::Out, "lanes"),
            Edge::new("lanes", Port::Out, "egress"),
        ],
        "ingress",
    )
    .unwrap();
    // 两车道各消费一个 LLM 响应（脚本按序：a、b）
    let orch = DefaultOrchestrator::new(
        &graph,
        scripted("车道A答案"),
        Arc::new(NoopMemory),
        RunConfig::default(),
    );
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    // 步序：ingress → lanes(Spawn) → lane_a_solve → lane_b_solve → egress（合并重编号连续）
    let nodes: Vec<&str> = report.steps.iter().map(|s| s.node.as_str()).collect();
    assert_eq!(nodes, vec!["ingress", "lanes", "lane_a_solve", "lane_b_solve", "egress"]);
    assert!(
        report.steps.iter().all(|s| s.step > 0),
        "车道步号合并后连续不重复"
    );
}

/// 车道内 wait-set：split fan-out 两工人 → merge（expect=2）→ 验证 merge 执行时两工人产物可见
struct MergeProbe {
    id: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for MergeProbe {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("merge", "聚合探针"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        // wait-set 语义：merge 执行时两工人（w1/w2）产物都已在黑板
        let has_w1 = ctx.state.contains("lane.w1.done");
        let has_w2 = ctx.state.contains("lane.w2.done");
        assert!(has_w1 && has_w2, "merge 仅在两分支就绪后调度（wait-set），w1={} w2={}", has_w1, has_w2);
        ctx.state.write("result.draft", "两分支已汇合");
        Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
    }
}

#[tokio::test]
async fn M3_车道内wait_set汇合点计数触发() {
    // 车道图：split --Out--> w1 / w2（fan-out）；w1/w2 --Out--> merge（expect=2）
    struct FanOutSplit {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for FanOutSplit {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("split", "拆分"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Out])
        }
        async fn execute(&self, _ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            Ok(NodeResult { port: Port::Out, usage: Usage::default(), progress: None })
        }
    }
    struct Worker {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for Worker {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("worker", "工人"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Out])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            ctx.state.write(format!("lane.{}.done", self.id), true);
            Ok(NodeResult { port: Port::Out, usage: Usage::default(), progress: None })
        }
    }

    struct SingleLaneSpawner {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for SingleLaneSpawner {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("spawn", "单车道容器"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Spawn, Port::Out])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let split = FanOutSplit { id: "split".into() };
            let w1 = Worker { id: "w1".into() };
            let w2 = Worker { id: "w2".into() };
            let merge = MergeProbe { id: "merge".into() };
            let lane_graph = Graph::build(
                vec![Box::new(split), Box::new(w1), Box::new(w2), Box::new(merge)],
                vec![
                    Edge::new("split", Port::Out, "w1"),
                    Edge::new("split", Port::Out, "w2"),
                    Edge::new("w1", Port::Out, "merge"),
                    Edge::new("w2", Port::Out, "merge"),
                ],
                "split",
            )?
            .with_joins(vec![JoinSpec { node: "merge".into(), expect: 2 }])?;
            ctx.pending = Some(SubgraphRequest::Lanes {
                lanes: vec![LaneSpec { id: "lane-main".into(), graph: lane_graph }],
                return_port_map: vec![(Port::Done, Port::Out)],
            });
            Ok(NodeResult { port: Port::Spawn, usage: Usage::default(), progress: None })
        }
    }

    let spawner = SingleLaneSpawner { id: "lanes".into() };
    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(spawner),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![
            Edge::new("ingress", Port::Out, "lanes"),
            Edge::new("lanes", Port::Out, "egress"),
        ],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted("x"), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("两分支已汇合"), "wait-set 满足后 merge 执行并交付");
}

// ══ M3 三批：Router（§6.5）/ Multi-Agent（§6.3）/ Supervisor（§6.4）════

use crate::orchestrator::multi_agent::MultiAgentNode;
use crate::orchestrator::router::{AggregateNode, RouterNode};
use crate::orchestrator::supervisor::SupervisorNode;
use std::collections::HashMap;

/// 车道工人节点：把任务结果写进 ma.results.<id>（车道命名空间约定，设计 6.3）
struct LaneWorker {
    id: String,
    result: String,
}

#[async_trait::async_trait]
impl OrchestratorNode for LaneWorker {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("worker", "车道工人"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        ctx.state.write(format!("ma.results.{}", self.id), self.result.clone());
        Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
    }
}

#[tokio::test]
async fn M3_Router_高置信度分发低置信度兜底() {
    // 高置信：classify --Branch(bug)--> bug 链；低置信：--low-conf--> fallback
    let mk = |id: &'static str, resp: &'static str, threshold: f64| {
        let router = RouterNode::new(id, "分类提示", vec!["bug".into(), "feature".into()], threshold);
        let graph = two_node_graph(Box::new(router));
        let llm = Arc::new(ScriptedLlm::of_texts(&[resp]));
        (graph, llm)
    };
    // 高置信 bug
    let (g, llm) = mk("node", r#"{"label":"bug","confidence":0.95,"reason":"明确排障"}"#, 0.8);
    let orch = DefaultOrchestrator::new(&g, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    // 单节点图 Branch 无出边 → 悬空出口 Governed；分发正确性看端口
    assert_eq!(report.steps.last().unwrap().port, Port::Branch("bug".into()), "高置信分发 bug");

    // 低置信 → Branch("low-conf")（fallback 链由父图组合）
    let (g2, llm2) = mk("node", r#"{"label":"bug","confidence":0.3,"reason":"模糊"}"#, 0.8);
    let orch2 = DefaultOrchestrator::new(&g2, llm2, Arc::new(NoopMemory), RunConfig::default());
    let report2 = orch2.run().await.unwrap();
    assert_eq!(
        report2.steps.last().unwrap().port,
        Port::Branch("low-conf".into()),
        "低置信走 low-conf：{:?}",
        report2.reason
    );
}

#[tokio::test]
async fn M3_MultiAgent_静态切分并发车道聚合() {
    // decompose 切 2 车道 → 工厂造工人子图（写 ma.results.<lane>）→ 并发 → 聚合合并
    struct DecomposeSpawner {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for DecomposeSpawner {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("multi_agent", "多智能体"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Spawn, Port::Out, Port::Fatal("lanes".into())])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync> =
                Arc::new(|i, task| {
                    let wid = format!("lane-{i}");
                    let worker = LaneWorker { id: wid.clone(), result: format!("「{task}」完成") };
                    let g = Graph::build(vec![Box::new(worker)], vec![], &wid)?;
                    Ok((wid, g))
                });
            let ma = MultiAgentNode::new(
                "ma_inner",
                "切分提示",
                factory,
                4,
            );
            // 借内层节点执行（其 ctx.pending 即本节点的 pending）
            ma.execute(ctx).await
        }
    }

    let graph = Graph::build(
        vec![
            Box::new(IntentNode { id: "ingress".into() }),
            Box::new(DecomposeSpawner { id: "ma".into() }),
            Box::new(AggregateNode::new("aggregate", false)),
        ],
        vec![
            Edge::new("ingress", Port::Out, "ma"),
            Edge::new("ma", Port::Out, "aggregate"),
        ],
        "ingress",
    )
    .unwrap();
    // 脚本 1：decompose JSON（车道工人不走 LLM）
    let llm = Arc::new(ScriptedLlm::of_texts(&[
        r#"{"lanes":[{"id":"lane-a","task":"写代码"},{"id":"lane-b","task":"写测试"}]}"#,
    ]));
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert!(
        report.result_text().as_deref().map(|t| t.contains("写代码」完成") && t.contains("写测试」完成")).unwrap_or(false),
        "聚合应含两车道结果：{:?}",
        report.result_text()
    );
}

#[tokio::test]
async fn M3_Supervisor_派发回收动态入队收工() {
    // 决策脚本：派发 researcher → 动态入队 coder → 派发 coder → done
    struct EchoWorker {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for EchoWorker {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("worker", "工人"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Done])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            ctx.state.write(format!("sup.result.{}", self.id), "完成");
            Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
        }
    }
    let mut registry: HashMap<String, Arc<dyn OrchestratorNode>> = HashMap::new();
    registry.insert("researcher".into(), Arc::new(EchoWorker { id: "researcher".into() }));
    registry.insert("coder".into(), Arc::new(EchoWorker { id: "coder".into() }));

    let sup = SupervisorNode::new("node", "派发提示", registry, 10);
    let graph = two_node_graph(Box::new(sup));
    let llm = Arc::new(ScriptedLlm::of_texts(&[
        r#"{"done":false,"role":"researcher","task":"摸底","new_tasks":[{"role":"coder","task":"迁移"}]}"#,
        r#"{"done":false,"role":"coder","task":"迁移","new_tasks":[]}"#,
        r#"{"done":true}"#,
    ]));
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.usage.llm_calls, 3, "两次派发决策 + 一次收工决策");
    assert_eq!(report.steps.len(), 2, "ingress + supervisor 节点（工人内联执行，不占执行器步）");
}
