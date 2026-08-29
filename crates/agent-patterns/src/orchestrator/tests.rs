//! M1 骨架验收测试（设计 §10 表 10-1）
//!
//! M1 验收标准：「Single Agent 链路端到端跑通（最小验证）」。
//! 同时覆盖调度循环各机制：端口路由 / Branch 谓词 / Loop 回边 / 预算门 /
//! 取消 / Retryable 重试 / Spawn 挂接回接 / 快照恢复。

use std::sync::Arc;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::{LlmError, NodeError};
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig, TerminalReason};
use crate::orchestrator::graph::{Condition, Edge, Graph};
use crate::orchestrator::handles::test_support::ScriptedLlm;
use crate::orchestrator::handles::{NoopMemory, Response};
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::single_agent::{PromptSpec, SingleAgentNode};
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

// ── 测试桩节点 ──────────────────────────────────────────

/// ingress 桩：写入 task.intent 后按端口出（设计 表 3-1：task.intent 由 Ingress 写入）
struct IngressNode {
    id: String,
    intent: String,
    out: Port,
}

impl IngressNode {
    fn boxed(id: &str, intent: &str, out: Port) -> Box<dyn OrchestratorNode> {
        Box::new(Self { id: id.into(), intent: intent.into(), out })
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for IngressNode {
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
        ctx.state.write("task.intent", self.intent.clone());
        Ok(NodeResult { port: self.out.clone(), usage: Usage::default(), progress: None })
    }
}

/// 可编程路由桩：按黑板状态返回指定端口（判定门语义）
struct GateNode {
    id: String,
    /// 轮次达到该数后走 done 端口，否则走 loop 端口（写轮次进黑板）
    rounds_then_done: u32,
    loop_port: Port,
}

impl GateNode {
    fn boxed(id: &str, rounds_then_done: u32) -> Box<dyn OrchestratorNode> {
        Box::new(Self {
            id: id.into(),
            rounds_then_done,
            loop_port: Port::Loop,
        })
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for GateNode {
    fn id(&self) -> &str {
        &self.id
    }
    fn meta(&self) -> &NodeMeta {
        static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
        M.get_or_init(|| NodeMeta::without_llm("gate", "判定门"))
    }
    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Loop, Port::Done])
    }
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let n = ctx.state.read_t::<u32>("gate.rounds").unwrap().unwrap_or(0) + 1;
        ctx.state.write("gate.rounds", n);
        let port = if n >= self.rounds_then_done { Port::Done } else { self.loop_port.clone() };
        Ok(NodeResult { port, usage: Usage::default(), progress: None })
    }
}

/// 先 Retryable N 次再成功的 LLM（设计 4.5：按退避重试，上限内不换路由）
struct FlakyLlm {
    fail_times: std::sync::atomic::AtomicU32,
}

#[async_trait::async_trait]
impl crate::orchestrator::handles::LlmHandle for FlakyLlm {
    async fn complete(
        &self,
        _req: &crate::orchestrator::handles::Request,
    ) -> Result<Response, LlmError> {
        let prev = self.fail_times.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        if prev > 0 {
            Err(LlmError::Retryable("瞬态失败".into()))
        } else {
            Ok(Response { text: "恢复成功".into(), usage: Usage::of(1, 1) })
        }
    }
}

fn scripted(texts: &[&str]) -> Arc<ScriptedLlm> {
    Arc::new(ScriptedLlm::of_texts(texts))
}

// ── M1 验收：Single Agent 端到端 ─────────────────────────

#[tokio::test]
async fn M1验收_Single_Agent链路端到端跑通() {
    // ingress → solve(SingleAgent.terminal)
    let solve = SingleAgentNode::terminal(
        "solve",
        PromptSpec::new("你是代码助手"),
    );
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "写一个匹配中国大陆手机号的正则", Port::Out), Box::new(solve)],
        vec![Edge::new("ingress", Port::Out, "solve")],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted(&["#[13-19]\\d{9}"]), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();

    assert!(report.is_done(), "自然终局：{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("#[13-19]\\d{9}"), "结果层=黑板 result.draft");
    assert_eq!(report.steps.len(), 2, "ingress + solve 两步");
    assert_eq!(report.usage.llm_calls, 1, "Single Agent 恰一次 LLM 调用");
    // 步序号单调连续（设计 4.3）
    assert_eq!(report.steps[0].step, 1);
    assert_eq!(report.steps[1].step, 2);
}

// ── Loop 回边 ────────────────────────────────────────────

#[tokio::test]
async fn Loop回边循环至判定门出口() {
    // ingress → gate(3 轮后 Done)；Loop 回边 gate→gate
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), GateNode::boxed("gate", 3)],
        vec![
            Edge::new("ingress", Port::Out, "gate"),
            Edge::new("gate", Port::Loop, "gate"),
        ],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted(&[""]), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done());
    assert_eq!(report.steps.len(), 1 + 3, "ingress + 3 轮 gate（Loop 回边）");
    assert_eq!(
        report.steps.last().unwrap().port,
        Port::Done,
        "第 3 轮 gate 走 Done 端口且无边 → 自然终局"
    );
}

// ── Branch 谓词（黑板条件路由）────────────────────────────

#[tokio::test]
async fn Branch谓词按黑板状态路由() {
    struct ClassifierNode {
        id: String,
        label: &'static str,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for ClassifierNode {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("router", "分类器"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Branch("bug".into()), Port::Branch("feature".into())])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            ctx.state.write("route.choice", self.label);
            Ok(NodeResult {
                port: Port::Branch(self.label.to_string()),
                usage: Usage::default(),
                progress: None,
            })
        }
    }

    // classify --branch:bug(谓词: route.choice=="bug")--> bug 链
    // classify --branch:bug(无谓词兜底)----------------> feature 链
    let graph = Graph::build(
        vec![
            IngressNode::boxed("ingress", "修个 bug", Port::Out),
            Box::new(ClassifierNode { id: "classify".into(), label: "bug" }),
            GateNode::boxed("bug_chain", 1),
            GateNode::boxed("feature_chain", 1),
        ],
        vec![
            Edge::new("ingress", Port::Out, "classify"),
            Edge::new("classify", Port::Branch("bug".into()), "bug_chain")
                .when(Condition::KeyEquals { key: "route.choice".into(), value: serde_json::json!("bug") }),
            Edge::new("classify", Port::Branch("bug".into()), "feature_chain"),
            Edge::new("classify", Port::Branch("feature".into()), "feature_chain"),
        ],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(&graph, scripted(&[""]), Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done());
    let routed: Vec<&str> = report.steps.iter().map(|s| s.node.as_str()).collect();
    assert_eq!(routed, vec!["ingress", "classify", "bug_chain"], "谓词命中 bug 链，不落兜底");
}

// ── 预算门（治理终止）────────────────────────────────────

#[tokio::test]
async fn 预算耗尽触发治理终止() {
    // 循环耗 LLM 的桩：每轮调一次 LLM（用量如实上报，设计 3.5 纪律 5）
    struct LoopLlmNode {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for LoopLlmNode {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("loop", "循环耗用"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Loop, Port::Done])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let resp = ctx.llm.complete(&Default::default()).await.map_err(NodeError::from)?;
            let n = ctx.state.read_t::<u32>("rounds").unwrap().unwrap_or(0) + 1;
            ctx.state.write("rounds", n);
            let port = if n >= 100 { Port::Done } else { Port::Loop };
            Ok(NodeResult { port, usage: resp.usage, progress: None })
        }
    }

    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), Box::new(LoopLlmNode { id: "loop".into() })],
        vec![Edge::new("ingress", Port::Out, "loop"), Edge::new("loop", Port::Loop, "loop")],
        "ingress",
    )
    .unwrap();
    // llm_calls 上限=3：ingress 0 次 + loop 每轮 1 次 → 第 4 次超限
    // （input/output 给 MAX：只考核 llm_calls 维度）
    let cfg = RunConfig {
        budget_cap: Some(Usage { llm_calls: 3, input_tokens: u64::MAX, output_tokens: u64::MAX }),
        ..Default::default()
    };
    let orch = DefaultOrchestrator::new(&graph, scripted(&["a", "b", "c", "d", "e"]), Arc::new(NoopMemory), cfg);
    let report = orch.run().await.unwrap();
    assert_eq!(
        report.reason,
        TerminalReason::Governed("预算耗尽".into()),
        "第 4 次 LLM 调用累计超 llm_calls=3 → 治理终止"
    );
    assert_eq!(report.usage.llm_calls, 4, "超限的那一步也如实计入台账");
}

// ── 用户取消 ─────────────────────────────────────────────

#[tokio::test]
async fn 取消信号触发治理终止() {
    struct CancelAfterOne {
        id: String,
        cancel: crate::orchestrator::context::CancelToken,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for CancelAfterOne {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::without_llm("loop", "取消触发"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Loop, Port::Done])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            let n = ctx.state.read_t::<u32>("rounds").unwrap().unwrap_or(0) + 1;
            ctx.state.write("rounds", n);
            if n >= 1 {
                self.cancel.cancel(); // 模拟用户在下一步前取消
            }
            Ok(NodeResult { port: Port::Loop, usage: Usage::default(), progress: None })
        }
    }
    let cancel = crate::orchestrator::context::CancelToken::new();
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), Box::new(CancelAfterOne { id: "n".into(), cancel: cancel.clone() })],
        vec![Edge::new("ingress", Port::Out, "n"), Edge::new("n", Port::Loop, "n")],
        "ingress",
    )
    .unwrap();
    // 注入同一份取消令牌（执行器与节点共享，设计 §3.2 cancel 语义）
    let orch = DefaultOrchestrator::new(&graph, scripted(&[""]), Arc::new(NoopMemory), RunConfig::default())
        .with_cancel(cancel);
    let report = orch.run().await.unwrap();
    assert_eq!(report.reason, TerminalReason::Governed("用户取消".into()));
    assert_eq!(report.steps.len(), 2, "ingress + n 各一步；取消在下一步边界生效，不再推进第 3 步");
}

// ── Retryable 重试 ───────────────────────────────────────

#[tokio::test]
async fn Retryable错误上限内重试且不换路由() {
    let solve = SingleAgentNode::terminal("solve", PromptSpec::new("s"));
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), Box::new(solve)],
        vec![Edge::new("ingress", Port::Out, "solve")],
        "ingress",
    )
    .unwrap();
    let llm = Arc::new(FlakyLlm { fail_times: std::sync::atomic::AtomicU32::new(2) });
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done());
    assert_eq!(report.result_text().as_deref(), Some("恢复成功"));
    let solve_step = report.steps.iter().find(|s| s.node == "solve").unwrap();
    assert_eq!(solve_step.retries, 2, "两次 Retryable 后第三次成功");
}

#[tokio::test]
async fn Retryable超上限上抛() {
    let solve = SingleAgentNode::terminal("solve", PromptSpec::new("s"));
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), Box::new(solve)],
        vec![Edge::new("ingress", Port::Out, "solve")],
        "ingress",
    )
    .unwrap();
    // 失败 3 次 > 默认上限 2 → Err 上抛
    let llm = Arc::new(FlakyLlm { fail_times: std::sync::atomic::AtomicU32::new(3) });
    let orch = DefaultOrchestrator::new(&graph, llm, Arc::new(NoopMemory), RunConfig::default());
    let r = orch.run().await;
    assert!(r.is_err(), "超过 max_retries_per_step 后 Fatal 上抛（设计 4.5）");
}

// ── Spawn 挂接 + return_map 回接 ──────────────────────────

#[tokio::test]
async fn Spawn挂接子图并经return_map回父图() {
    // 父图：ingress → spawner --Out--> egress
    struct SpawnerNode {
        id: String,
    }
    #[async_trait::async_trait]
    impl OrchestratorNode for SpawnerNode {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("spawn", "容器"))
        }
        fn outputs(&self) -> &[Port] {
            static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
            OUTS.get_or_init(|| vec![Port::Spawn, Port::Out])
        }
        async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            // 声明子图：sub_solve（单节点，Done 收口）→ 经映射 Done→Out 回父图
            let sub_solve = SingleAgentNode::terminal("sub_solve", PromptSpec::new("sub"));
            let sub = Graph::build(
                vec![Box::new(sub_solve)],
                vec![],
                "sub_solve",
            )
            .unwrap();
            ctx.pending = Some(crate::orchestrator::context::SubgraphRequest::Single {
                graph: sub,
                return_port_map: vec![(Port::Done, Port::Out)],
            });
            Ok(NodeResult { port: Port::Spawn, usage: Usage::default(), progress: None })
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
            // 校验子图产出已写进共享黑板（设计 4.4：车道共享同一黑板）
            assert!(ctx.state.contains("result.draft"), "子图产出对父图可见");
            Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
        }
    }

    let graph = Graph::build(
        vec![
            IngressNode::boxed("ingress", "x", Port::Out),
            Box::new(SpawnerNode { id: "spawner".into() }),
            Box::new(EgressNode { id: "egress".into() }),
        ],
        vec![
            Edge::new("ingress", Port::Out, "spawner"),
            Edge::new("spawner", Port::Out, "egress"),
        ],
        "ingress",
    )
    .unwrap();
    let orch = DefaultOrchestrator::new(
        &graph,
        scripted(&["子图结果"]),
        Arc::new(NoopMemory),
        RunConfig::default(),
    );
    let report = orch.run().await.unwrap();
    assert!(report.is_done(), "{:?}", report.reason);
    assert_eq!(report.result_text().as_deref(), Some("子图结果"));
    let spawned_step = report.steps.iter().find(|s| s.spawned).expect("存在 Spawn 步");
    assert_eq!(spawned_step.node, "spawner");
    // 步序：ingress → spawner(Spawn) → sub_solve → egress
    assert_eq!(report.steps.len(), 4);
}

// ── 快照与恢复 ───────────────────────────────────────────

#[tokio::test]
async fn 快照间隔落盘且resume断点续跑() {
    // 链：ingress → solve → gate(1轮即Done)
    let solve = SingleAgentNode::terminal("solve", PromptSpec::new("s"));
    let graph = Graph::build(
        vec![
            IngressNode::boxed("ingress", "x", Port::Out),
            Box::new(solve),
            GateNode::boxed("gate", 1),
        ],
        vec![Edge::new("ingress", Port::Out, "solve"), Edge::new("solve", Port::Done, "gate")],
        "ingress",
    )
    .unwrap();

    // 第一次跑：snapshot_interval=1 → 每步都有 checkpoint；只让前 2 步后中断
    // （用预算 cap 在第 2 步后触发治理终止？预算按用量，gate 无 LLM…）
    // 更直接：run_with_checkpoint 跑完全程拿 checkpoint，再以 checkpoint.resume 验证
    // 「恢复后步序号连续不回卷」（设计 4.3）与终局一致。
    let cfg = RunConfig { snapshot_interval: 1, ..Default::default() };
    let orch = DefaultOrchestrator::new(&graph, scripted(&["答案"]), Arc::new(NoopMemory), cfg.clone());
    let (report, ckpt) = orch.run_with_checkpoint().await.unwrap();
    assert!(report.is_done());
    let ckpt = ckpt.expect("snapshot_interval=1 时必有快照");
    assert_eq!(ckpt.step_cursor, 3);

    // resume：从同一断点继续（队列已空 → 立即自然完成，步号不回卷）
    let orch2 = DefaultOrchestrator::new(&graph, scripted(&["答案"]), Arc::new(NoopMemory), cfg);
    let report2 = orch2.resume(ckpt).await.unwrap();
    assert!(report2.is_done());
    assert_eq!(report2.result_text().as_deref(), Some("答案"));
    assert!(
        report2.steps.iter().all(|s| s.step > 3),
        "恢复后步序号从断点之后继续（设计 4.3：连续不回卷）"
    );
}

// ── 记忆钩子横切 ─────────────────────────────────────────

#[tokio::test]
async fn 记忆前后钩子由执行器统一挂() {
    use crate::orchestrator::handles::{MemEntry, MemLayer, MemoryHandle};
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingMemory {
        befores: Mutex<Vec<String>>,
        afters: Mutex<Vec<String>>,
    }
    #[async_trait::async_trait]
    impl MemoryHandle for RecordingMemory {
        async fn before(&self, node: &str) -> Result<Vec<MemEntry>, crate::orchestrator::error::MemoryError> {
            self.befores.lock().unwrap().push(node.to_string());
            Ok(vec![MemEntry {
                layer: MemLayer::Semantic,
                key: "k".into(),
                content: "相关记忆内容".into(),
            }])
        }
        async fn after(&self, node: &str, _note: MemEntry) -> Result<(), crate::orchestrator::error::MemoryError> {
            self.afters.lock().unwrap().push(node.to_string());
            Ok(())
        }
    }

    let solve = SingleAgentNode::terminal("solve", PromptSpec::new("s"));
    let graph = Graph::build(
        vec![IngressNode::boxed("ingress", "x", Port::Out), Box::new(solve)],
        vec![Edge::new("ingress", Port::Out, "solve")],
        "ingress",
    )
    .unwrap();
    let mem = Arc::new(RecordingMemory::default());
    let orch = DefaultOrchestrator::new(&graph, scripted(&["ok"]), mem.clone(), RunConfig::default());
    let report = orch.run().await.unwrap();
    assert!(report.is_done());
    assert_eq!(*mem.befores.lock().unwrap(), vec!["ingress".to_string(), "solve".to_string()]);
    assert_eq!(*mem.afters.lock().unwrap(), vec!["ingress".to_string(), "solve".to_string()]);
}
