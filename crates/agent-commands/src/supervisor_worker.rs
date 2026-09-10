//! Supervisor B 轨桥接：SubAgent 委派工人节点（2026-09-09 迁移 S1/S2 适配层）
//!
//! B 轨 `SupervisorNode` 的工人是内联 `OrchestratorNode`（黑盒执行）。本节点把
//! 「主管派发」桥接到真实子 Agent：读委派任务，经
//! [`SubAgentManager::delegate`] 委派指定子 Agent 同步执行（内部已内置 M3-1 子
//! run 会计 + SubAgentStarted/Completed/Error 事件广播），成功后将子 Agent 首输出
//! 写入结果键交付验收/聚合。
//!
//! 复用场景（任务键/结果键可配置）：
//! - supervisor：读黑板 `sup.current`（object{role,task}，SupervisorNode 派发前
//!   写入），写 `result.draft`，广播 `SupervisorTaskAssigned`（右栏委派现场建行）。
//! - multi_agent 车道：读 `ma.task.<lane>`（字符串，MultiAgentNode 切分写入），
//!   写 `ma.results.<lane>`（聚合键约定，AggregateNode 收集），不广播
//!   `SupervisorTaskAssigned`（非 supervisor 委派现场）。
//!
//! 事件链路：派发前广播 `SupervisorTaskAssigned`（会话广播器 → tauri 监听 →
//! `orch_supervisor:task_assigned` → 右栏委派现场建行）；随后 manager.delegate
//! 广播 SubAgentStarted/Completed 推进该行 running/completed。
//!
//! 角色目录：上层装配 `role → SubAgentWorkerNode`，role 名 = 子 Agent 规格 id
//! （sub_agent_id），主管 LLM 决策 role 即直接可委派。

use std::sync::Arc;

use agent_patterns::orchestrator::context::NodeCtx;
use agent_patterns::orchestrator::error::NodeError;
use agent_patterns::orchestrator::node::OrchestratorNode;
use agent_patterns::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, Usage};
use agent_runtime::event::{EventBroadcaster, OrchestratorEvent};
use crate::subagent::SubAgentManager;

/// Supervisor 委派工人：把委派任务 (role, task) 桥接到真实子 Agent
pub struct SubAgentWorkerNode {
    id: String,
    meta: NodeMeta,
    /// 绑定的子 Agent 规格 id（与注册表 entry.role 一致）
    sub_agent_id: String,
    /// 子 Agent 人类可读名称（SupervisorTaskAssigned 事件透传前端）
    sub_agent_name: String,
    manager: Arc<SubAgentManager>,
    /// 会话广播器（可选；无则跳过 SupervisorTaskAssigned 建行事件）
    broadcaster: Option<Arc<tokio::sync::RwLock<EventBroadcaster>>>,
    /// 委派任务黑板键：supervisor 为 `sup.current`（object{task}）；multi_agent 车道为 `ma.task.<lane>`（字符串）
    task_key: String,
    /// 委派成功输出写入的黑板键：supervisor 为 `result.draft`；multi_agent 车道为 `ma.results.<lane>`（聚合键）
    result_key: String,
    /// 是否广播 SupervisorTaskAssigned 建行事件（supervisor 委派现场用；multi_agent 车道复用本节点时关闭）
    emit_assigned: bool,
}

impl SubAgentWorkerNode {
    pub fn new(
        id: impl Into<String>,
        sub_agent_id: impl Into<String>,
        sub_agent_name: impl Into<String>,
        manager: Arc<SubAgentManager>,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("sup-worker", "子 Agent 委派工人"),
            sub_agent_id: sub_agent_id.into(),
            sub_agent_name: sub_agent_name.into(),
            manager,
            broadcaster: None,
            task_key: "sup.current".to_string(),
            result_key: "result.draft".to_string(),
            emit_assigned: true,
        }
    }

    /// 注入会话广播器（SupervisorTaskAssigned 建行事件；指向 `AgentLoop::broadcaster_ref()`）
    pub fn with_broadcaster(mut self, broadcaster: Arc<tokio::sync::RwLock<EventBroadcaster>>) -> Self {
        self.broadcaster = Some(broadcaster);
        self
    }

    /// 委派任务黑板键（multi_agent 车道：`ma.task.<lane>`，字符串任务直读）
    pub fn with_task_key(mut self, key: impl Into<String>) -> Self {
        self.task_key = key.into();
        self
    }

    /// 委派结果输出写入键（multi_agent 车道：`ma.results.<lane>`，供 AggregateNode 收集）
    pub fn with_result_key(mut self, key: impl Into<String>) -> Self {
        self.result_key = key.into();
        self
    }

    /// 关闭 SupervisorTaskAssigned 建行事件（multi_agent 车道不属于 supervisor 委派现场）
    pub fn without_assigned_event(mut self) -> Self {
        self.emit_assigned = false;
        self
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for SubAgentWorkerNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done, Port::Fatal("subagent".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        // 读委派任务：`sup.current` 为 object{task}（supervisor 主管派发写入）；
        // multi_agent 车道键 `ma.task.<lane>` 为字符串直读。泛化：object → task 字段，string → 自身。
        let task = match ctx.state.read(&self.task_key) {
            Some(serde_json::Value::Object(o)) => o
                .get("task")
                .and_then(|t| t.as_str())
                .unwrap_or_default()
                .to_string(),
            Some(serde_json::Value::String(s)) => s.clone(),
            _ => String::new(),
        };
        if task.trim().is_empty() {
            return Err(NodeError::fatal("dispatch", format!("{} 缺任务（空字符串）", self.task_key)));
        }

        // 建行事件：SupervisorTaskAssigned → tauri → orch_supervisor:task_assigned（仅 supervisor 委派现场）
        if self.emit_assigned {
            if let Some(b) = &self.broadcaster {
                b.read().await.broadcast(&OrchestratorEvent::SupervisorTaskAssigned {
                    node_id: self.id.clone(),
                    sub_agent_id: self.sub_agent_id.clone(),
                    sub_agent_name: self.sub_agent_name.clone(),
                    task_description: task.clone(),
                    reasoning: None,
                });
            }
        }

        // 委派真实子 Agent（SubAgentManager：M3-1 子 run 会计 + 事件广播内置）
        match self.manager.delegate(&self.sub_agent_id, &task).await {
            Ok(output) => {
                let text = output
                    .get("result")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .unwrap_or_default();
                ctx.state.write(&self.result_key, text);
                Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
            }
            Err(e) => Err(NodeError::fatal(
                "subagent",
                format!("子 Agent '{}' 委派失败: {e}", self.sub_agent_id),
            )),
        }
    }

    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot { payload: serde_json::json!({ "sub_agent_id": self.sub_agent_id }) })
    }

    async fn restore(&self, _snap: NodeSnapshot) -> Result<(), NodeError> {
        Ok(())
    }
}