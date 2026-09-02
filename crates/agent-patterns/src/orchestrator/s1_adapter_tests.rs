//! S1 适配层验收测试（编排双轨收拢试点）
//!
//! 覆盖 B 轨引擎新增能力：输入 seed（黑板预写）、运行观察者（阶段事件透出 +
//! on_finished 终局）、终局黑板快照（Report.blackboard 供命令层产物翻译）。
//! 不依赖真实 LLM：`ScriptedCompleteLlm` 按序回放 complete 文本。

use std::sync::{Arc, Mutex};

use crate::orchestrator::error::LlmError;
use crate::orchestrator::executor::{DefaultOrchestrator, RunConfig, RunReport, TerminalReason};
use crate::orchestrator::graph::Graph;
use crate::orchestrator::handles::{LlmHandle, NoopMemory, Request as LlmRequest, Response};
use crate::orchestrator::observer::{PhaseStatus, RunObserver};
use crate::orchestrator::plan_execute::PlanExecuteNode;
use crate::orchestrator::single_agent::{PromptSpec, SingleAgentNode};
use crate::orchestrator::types::Usage;

/// 脚本化补全 LLM：complete 按序回放文本；耗尽即 Fatal 显式暴露
struct ScriptedCompleteLlm {
    replies: Mutex<Vec<String>>,
}

impl ScriptedCompleteLlm {
    fn new(replies: Vec<String>) -> Arc<Self> {
        Arc::new(Self { replies: Mutex::new(replies) })
    }
}

#[async_trait::async_trait]
impl LlmHandle for ScriptedCompleteLlm {
    async fn complete(&self, _req: &LlmRequest) -> Result<Response, LlmError> {
        let mut r = self.replies.lock().unwrap();
        if r.is_empty() {
            return Err(LlmError::Fatal("complete 脚本耗尽".into()));
        }
        Ok(Response { text: if r.len() == 1 { r[0].clone() } else { r.remove(0) }, usage: Usage::of(10, 10) })
    }
}

/// 记录型运行观察者：阶段事件序列 + 终局报告
struct CollectObserverInner {
    events: Mutex<Vec<(String, String, Option<PhaseStatus>, String)>>,
    finished: Mutex<Vec<RunReport>>,
}

impl CollectObserverInner {
    fn new() -> Arc<Self> {
        Arc::new(Self { events: Mutex::new(Vec::new()), finished: Mutex::new(Vec::new()) })
    }
}

impl RunObserver for CollectObserverInner {
    fn on_phase(&self, node_id: &str, phase: &str, status: Option<PhaseStatus>, summary: &str) {
        self.events
            .lock()
            .unwrap()
            .push((node_id.to_string(), phase.to_string(), status, summary.to_string()));
    }

    fn on_finished(&self, report: &RunReport) {
        self.finished.lock().unwrap().push(report.clone());
    }
}

/// 构 B 轨 plan 单节点图（inner = 步骤执行器，读 pne.step.current）
fn plan_graph(max_replans: u32) -> Graph {
    let inner: Arc<dyn crate::orchestrator::node::OrchestratorNode> = Arc::new(
        SingleAgentNode::terminal("step", PromptSpec::for_key("执行步骤", "pne.step.current")),
    );
    let plan_node = PlanExecuteNode::new(
        "plan_execute",
        inner,
        "拆解任务为步骤",
        "验收步骤",
        max_replans,
    );
    Graph::build(vec![Box::new(plan_node)], vec![], "plan_execute").unwrap()
}

/// 例：两步骤全通过 → Done + plan/execute 两阶段事件（进入+结果）+ 信封产物黑板
#[tokio::test]
async fn s1_plan_execute_runs_two_steps_with_phase_events_and_report() {
    let llm = ScriptedCompleteLlm::new(vec![
        r#"{"steps":["步骤A","步骤B"]}"#.into(), // make_plan
        "步骤A结果".into(),                       // inner 执行步骤A
        r#"{"passed":true}"#.into(),           // assess A
        "步骤B结果".into(),                       // inner 执行步骤B
        r#"{"passed":true}"#.into(),           // assess B
    ]);
    let inner = CollectObserverInner::new();
    let observer: Arc<dyn RunObserver> = inner.clone();
    let memory: Arc<dyn crate::orchestrator::handles::MemoryHandle> = Arc::new(NoopMemory);
    let graph = plan_graph(1);
    let orch = DefaultOrchestrator::new(&graph, llm, memory, RunConfig::default())
        .with_seed(serde_json::json!({ "task.intent": "测试任务" }))
        .with_observer(observer);
    let report = orch.run().await.unwrap();

    // 终局：Done + 结果文本 = 最后一步产出
    assert_eq!(report.reason, TerminalReason::Done);
    assert_eq!(report.result_text().as_deref(), Some("步骤B结果"));

    // 信封产物输入：终局黑板快照含 pne.plan（追加语义 → 末元素为当前值）
    let plan = serde_json::from_value::<crate::orchestrator::plan_execute::Plan>(
        report
            .blackboard
            .get("pne.plan")
            .and_then(|v| v.as_array())
            .and_then(|a| a.last())
            .expect("黑板应有 pne.plan 当前值")
            .clone(),
    )
    .unwrap();
    assert_eq!(plan.steps, vec!["步骤A".to_string(), "步骤B".to_string()]);

    // 阶段事件序列：plan(进入→成功) → execute(进入→成功)；node_id 正确
    let events = inner.events.lock().unwrap().clone();
    let phases: Vec<(String, Option<PhaseStatus>)> =
        events.iter().map(|(n, p, s, _)| (n.clone(), *s)).collect();
    assert_eq!(
        phases,
        vec![
            ("plan_execute".into(), None),
            ("plan_execute".into(), Some(PhaseStatus::Success)),
            ("plan_execute".into(), None),
            ("plan_execute".into(), Some(PhaseStatus::Success)),
        ]
    );
    assert_eq!(events[1].2, Some(PhaseStatus::Success));
    assert_eq!(events[3].3, "执行完成 2 步");

    // on_finished 携终局报告（含黑板快照）
    let finished = inner.finished.lock().unwrap();
    assert_eq!(finished.len(), 1);
    assert!(finished[0].blackboard.get("pne.plan").is_some());
}

/// 例：验收始终不通过 + max_replans=0 → Fatal("replan") + execute 阶段 Failed 事件
#[tokio::test]
async fn s1_plan_execute_replan_exhausted_emits_failed_phase() {
    let llm = ScriptedCompleteLlm::new(vec![
        r#"{"steps":["步骤A"]}"#.into(), // make_plan
        "步骤A结果".into(),               // inner 执行
        r#"{"passed":false,"reason":"不达标"}"#.into(), // assess → 失败
    ]);
    let inner = CollectObserverInner::new();
    let observer: Arc<dyn RunObserver> = inner.clone();
    let memory: Arc<dyn crate::orchestrator::handles::MemoryHandle> = Arc::new(NoopMemory);
    let graph = plan_graph(0);
    let orch = DefaultOrchestrator::new(&graph, llm, memory, RunConfig::default())
        .with_seed(serde_json::json!({ "task.intent": "测试任务" }))
        .with_observer(observer);
    let report = orch.run().await.unwrap();

    // Fatal(replan) 终局（execute 阶段 Failed 事件）
    assert!(matches!(report.reason, TerminalReason::Fatal(_)));
    let events = inner.events.lock().unwrap().clone();
    let last = events.last().unwrap();
    assert_eq!(last.1, "execute");
    assert_eq!(last.2, Some(PhaseStatus::Failed));
}

/// 例：无观察者时链路零开销（既有骨架场景不受影响）
#[tokio::test]
async fn s1_without_observer_runs_plain() {
    let llm = ScriptedCompleteLlm::new(vec![
        r#"{"steps":["步骤A"]}"#.into(),
        "步骤A结果".into(),
        r#"{"passed":true}"#.into(),
    ]);
    let memory: Arc<dyn crate::orchestrator::handles::MemoryHandle> = Arc::new(NoopMemory);
    let graph = plan_graph(1);
    let orch = DefaultOrchestrator::new(&graph, llm, memory, RunConfig::default())
        .with_seed(serde_json::json!({ "task.intent": "测试任务" }));
    let report = orch.run().await.unwrap();
    assert!(matches!(report.reason, TerminalReason::Done));
}