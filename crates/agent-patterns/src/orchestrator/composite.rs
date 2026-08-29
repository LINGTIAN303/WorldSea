//! CompositeNode 组合粘合剂（设计 §3.4）— 把子图包装成单节点
//!
//! 组合律：**白盒图 ⇄ 黑盒节点自由切换，嵌套任意深度**。Supervisor 的工人、
//! Loop Engineering 的被治理链、TOT 的候选评估器，都是 CompositeNode 的实例。
//!
//! M3 实现说明：execute 把内层子图经 `ctx.pending` 呈递（Spawn 通道），
//! 由 M1 执行器的作用域栈挂接——子图与父图**共享黑板与 llm/memory 句柄**
//! （设计 3.4「黑板/llm/memory 直通」语义的最直接落地），子图终止端口经
//! `exit_map` 映射回本节点的对外端口，控制权回到父图本节点的后继边。
//! 内层子图节点的快照由执行器在快照点聚合采集（设计 4.6）。
//!
//! 子图以工厂构造（`build_inner`）：Spawn 通道要求持有所有权，而节点自身
//! `execute(&self)` 不可变——每次执行重建子图（幂等构图，设计 3.5 纪律 3）；
//! 有状态的内层节点用内部可变性承载状态（M1 纪律），重建不丢语义。

use std::sync::Arc;


use crate::orchestrator::context::{NodeCtx, SubgraphRequest};
use crate::orchestrator::error::NodeError;
use crate::orchestrator::graph::{Graph, GraphError};
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port};

pub struct CompositeNode {
    id: String,
    meta: NodeMeta,
    /// 内层子图工厂（每次执行重建，幂等构图）
    build_inner: Arc<dyn Fn() -> Result<Graph, GraphError> + Send + Sync>,
    /// 子图终止端口 → 本节点对外端口（设计 §3.4 `exit_map`）
    exit_map: Vec<(Port, Port)>,
    /// 对外端口表（构造期定形；outputs() 返回其引用）
    outs: Vec<Port>,
}

impl CompositeNode {
    /// 构图工厂 + 终止端口映射。
    ///
    /// `meta_title` 建议标注被包装的链路（如 "worker: ReAct"）。
    pub fn new(
        id: impl Into<String>,
        meta_title: impl Into<String>,
        build_inner: Arc<dyn Fn() -> Result<Graph, GraphError> + Send + Sync>,
        exit_map: Vec<(Port, Port)>,
    ) -> Self {
        let mut outs: Vec<Port> = exit_map.iter().map(|(_, to)| to.clone()).collect();
        outs.push(Port::Fatal("compose".into()));
        Self {
            id: id.into(),
            meta: NodeMeta::new("composite", meta_title),
            build_inner,
            exit_map,
            outs,
        }
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for CompositeNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        // 对外端口 = exit_map 的映射目标集 + Fatal（构图失败）——构造期定形
        &self.outs
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        // 幂等构图：子图构建失败属 Fatal（schema 级，设计 4.5）
        let subgraph = (self.build_inner)()
            .map_err(|e| NodeError::fatal("compose", format!("内层子图构建失败：{e}")))?;
        if !self.exit_map.iter().any(|_| true) {
            return Err(NodeError::fatal("compose", "exit_map 为空：子图终止无法映射回父图"));
        }
        // 呈递 Spawn：执行器挂接子图（共享黑板与句柄），终止后经 exit_map 回本节点后继
        ctx.pending = Some(SubgraphRequest::Single {
            graph: subgraph,
            return_port_map: self.exit_map.clone(),
        });
        Ok(NodeResult { port: Port::Spawn, usage: Default::default(), progress: None })
    }

    /// 快照：内层子图节点的快照由执行器在作用域内聚合采集（见 executor 快照协议），
    /// 本节点自身无附加状态——默认实现即可。
    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot {
            payload: serde_json::json!({ "composite": self.id, "exits": self.exit_map.len() }),
        })
    }
}
