//! Supervisor 主管调度（设计 §6.4）— 星型派发—回收，运行时定序
//!
//! 核心状态：`sup.queue`（待派发任务项，全量随黑板快照——恢复后队列不丢）。
//! 每轮：主管读队列 + 已回收结果 → 决策（派发下一项 / 动态入队新任务 / 收工）→
//! 解析工人（按角色从目录 registry）内联执行（黑盒语义，设计 6.4 伪代码
//! `worker.execute(ctx)`）→ 验收回写。与 Multi-Agent 的本质区别：
//! **任务序列运行时才完全确定**（动态入队）。
//!
//! 终止条件三分（设计 6.4）：① 队列空且决策收工 → `Done`；
//! ② 派发轮次上限 → 治理性完成；③ 同任务重派超限 → `Fatal("dispatch")`。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

/// 待派发任务项（`sup.queue` 条目）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct TaskItem {
    pub role: String,
    pub task: String,
    /// 重派次数（同任务重派超上限 → Fatal，设计 6.4 终止③）
    #[serde(default)]
    pub retries: u32,
}

/// 主管单轮决策（LLM JSON 约定：
/// `{"done":false,"role":"…","task":"…","new_tasks":[{"role":"…","task":"…"}]}`）
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DispatchDecision {
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub task: String,
    #[serde(default)]
    pub new_tasks: Vec<TaskItem>,
}

pub struct SupervisorNode {
    id: String,
    meta: NodeMeta,
    /// 派发决策 system 提示（读队列 + 已回收结果，设计 §6.4 `dispatch_spec`）
    dispatch_prompt: String,
    /// 角色目录：role → 工人节点（黑盒，常为 CompositeNode(loop 模式)，设计 6.4）
    role_registry: HashMap<String, Arc<dyn OrchestratorNode>>,
    max_dispatches: u32,
    max_retries_per_task: u32,
    /// 已派发轮次
    dispatches: Mutex<u32>,
}

impl SupervisorNode {
    pub fn new(
        id: impl Into<String>,
        dispatch_prompt: impl Into<String>,
        role_registry: HashMap<String, Arc<dyn OrchestratorNode>>,
        max_dispatches: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("supervisor", "主管调度"),
            dispatch_prompt: dispatch_prompt.into(),
            role_registry,
            max_dispatches,
            max_retries_per_task: 2,
            dispatches: Mutex::new(0),
        }
    }

    async fn decide(&self, ctx: &NodeCtx<'_>, queue: &[TaskItem], done: &[String]) -> Result<(DispatchDecision, Usage), NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let roles: Vec<&str> = self.role_registry.keys().map(|s| s.as_str()).collect();
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.dispatch_prompt.clone(),
                format!(
                    "任务意图：{intent}\n可用角色：{}\n待派发队列：{:?}\n已回收：{:?}\n\n请决策。输出 JSON：{{\"done\":bool,\"role\":\"…\",\"task\":\"…\",\"new_tasks\":[{{\"role\":\"…\",\"task\":\"…\"}}]}}；队列已清且无需补充时 done=true。",
                    roles.join(" | "), queue, done
                ),
            ))
            .await?;
        let d: DispatchDecision = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("派发决策非约定 JSON：{e}")))?;
        Ok((d, resp.usage))
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for SupervisorNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("dispatch".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let mut usage = Usage::default();
        // 队列与回收记录都在黑板（全量入快照——恢复后队列不丢，设计 6.4 要点）
        let mut queue: Vec<TaskItem> = ctx.state.read_t::<Vec<TaskItem>>("sup.queue").unwrap_or(None).unwrap_or_default();
        let mut done: Vec<String> = ctx.state.read_t::<Vec<String>>("sup.done").unwrap_or(None).unwrap_or_default();

        loop {
            let dispatches = { *self.dispatches.lock().unwrap() };
            // 终止②：派发轮次上限 → 治理性完成
            if dispatches >= self.max_dispatches {
                ctx.state.write("sup.queue", &queue);
                return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
            }

            let (decision, d_usage) = self.decide(ctx, &queue, &done).await?;
            usage.saturating_add(&d_usage);
            // 动态入队（运行时发现的新工作直接入队，设计 6.4 数据流；队列供决策参考）
            queue.extend(decision.new_tasks.clone());
            if decision.done {
                ctx.state.write("sup.queue", &queue);
                return Ok(NodeResult { port: Port::Done, usage, progress: None });
            }
            // 派发项 = 决策给的 (role, task)——选哪项/改什么参由主管 LLM 承担
            // （设计 6.4：`decision.pop_front` 的队列消费语义由决策承担，队列是备忘录）
            if decision.role.is_empty() || decision.task.is_empty() {
                ctx.state.write("sup.queue", &queue);
                return Err(NodeError::fatal("schema", "派发决策缺 role/task 且未收工"));
            }
            let mut item = TaskItem { role: decision.role.clone(), task: decision.task.clone(), retries: 0 };
            let worker = self.role_registry.get(&item.role).ok_or_else(|| {
                NodeError::fatal("dispatch", format!("角色 {} 不在目录中", item.role))
            })?;

            // 派发任务写入黑板 `sup.current`：工人节点（含 SubAgent 桥接适配层）
            // 据此读当前派发项（role/task），worker 内联执行方可无参访问。
            ctx.state.write("sup.current", json!({ "role": item.role, "task": item.task }));

            // 派发（Spawn 语义的内联黑盒执行：工人是 CompositeNode(loop)，设计 6.4 组合示例）
            let r = worker.execute(ctx).await?;
            usage.saturating_add(&r.usage);
            { *self.dispatches.lock().unwrap() += 1; }

            // 验收：工人成功即回收（队列是备忘录，派发项独立于队列——重派项才回队）
            if r.port == Port::Done || r.port == Port::Out {
                done.push(format!("{}: {}", item.role, item.task));
                ctx.state.append("sup.done", json!({ "role": item.role, "task": item.task }));
            } else if item.retries < self.max_retries_per_task {
                item.retries += 1;
                queue.insert(0, item); // 重派项回队首（备忘录）
            } else {
                ctx.state.write("sup.queue", &queue);
                return Ok(NodeResult {
                    port: Port::Fatal("dispatch".into()),
                    usage,
                    progress: Some(ProgressNote::Note(format!("任务「{}」重派超上限", item.task))),
                });
            }
            ctx.state.write("sup.queue", &queue);
        }
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot { payload: json!({ "dispatches": *self.dispatches.lock().unwrap() }) })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("dispatches").and_then(|v| v.as_u64()) {
            *self.dispatches.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}
