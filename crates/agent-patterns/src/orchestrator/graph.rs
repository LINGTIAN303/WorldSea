//! 图结构 — 节点 + 端口 + 边（设计 §3.3 / §4.1）
//!
//! 「图即链路」：每种模式等价于一张图模板。构图时静态校验
//! （边引用的节点存在、源端口在该节点 outputs 声明内、entry 存在），
//! 坏图在构建期报错而不是运行期。

use std::collections::HashMap;

use crate::orchestrator::error::NodeError;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeId, Port};

/// Branch 端口的静态谓词（设计 §3.3：Branch 端口可带条件，构图时静态声明）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Condition {
    /// 黑板当前值等于给定 JSON 值
    KeyEquals { key: String, value: serde_json::Value },
    /// 黑板存在该键
    KeyExists(String),
}

impl Condition {
    fn eval(&self, state: &crate::orchestrator::blackboard::Blackboard) -> bool {
        match self {
            Condition::KeyEquals { key, value } => state.read(key) == Some(value),
            Condition::KeyExists(k) => state.contains(k),
        }
    }
}

/// 图的边：从 (源节点, 源端口) 到目标节点（设计 §3.3）。
#[derive(Debug, Clone)]
pub struct Edge {
    pub from: NodeId,
    pub from_port: Port,
    pub to: NodeId,
    /// 可选谓词：Branch 端口可带条件（构图时静态声明）
    pub when: Option<Condition>,
}

impl Edge {
    pub fn new(from: impl Into<NodeId>, from_port: Port, to: impl Into<NodeId>) -> Self {
        Self { from: from.into(), from_port, to: to.into(), when: None }
    }

    pub fn when(mut self, cond: Condition) -> Self {
        self.when = Some(cond);
        self
    }
}

/// 汇合点声明（设计 §4.4 wait-set）：`node` 需等 `expect` 次「到达」才入就绪队列。
///
/// 车道模型下，每条车道终节点的出边都指向 `node`（fan-in）——第 `expect` 次
/// 到达即全部车道就绪，聚合节点才被调度。计数式声明比列节点名单更简单通用：
/// fan-in 的边数就是期望到达次数。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JoinSpec {
    /// 聚合节点（fan-in 目标）
    pub node: NodeId,
    /// 期望到达次数（= 车道数 / fan-in 边数）
    pub expect: usize,
}

/// 构图错误（坏图构建期报错）
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GraphError {
    #[error("边引用了未注册的节点: {0}")]
    UnknownNode(String),
    #[error("节点 {node} 未声明出口端口 {port}")]
    UndeclaredPort { node: String, port: String },
    #[error("边 (节点 {node}) 重复绑定目标: {port}")]
    DuplicateEdge { node: String, port: String },
    #[error("入口节点未注册: {0}")]
    UnknownEntry(String),
    #[error("图内无节点")]
    EmptyGraph,
}

/// 一张可执行的链路图（设计 §4.1）。
pub struct Graph {
    nodes: HashMap<NodeId, Box<dyn OrchestratorNode>>,
    edges: Vec<Edge>,
    entry: NodeId,
    /// 汇合点声明（wait-set，设计 §4.4）
    joins: Vec<JoinSpec>,
}

impl Graph {
    /// 构图入口：全量注册节点与边后一次性校验（坏图构建期报错）。
    pub fn build(
        nodes: Vec<Box<dyn OrchestratorNode>>,
        edges: Vec<Edge>,
        entry: impl Into<NodeId>,
    ) -> Result<Self, GraphError> {
        if nodes.is_empty() {
            return Err(GraphError::EmptyGraph);
        }
        let mut table: HashMap<NodeId, Box<dyn OrchestratorNode>> = HashMap::new();
        for n in nodes {
            table.insert(n.id().to_string(), n);
        }
        let entry: NodeId = entry.into();
        if !table.contains_key(&entry) {
            return Err(GraphError::UnknownEntry(entry.clone()));
        }
        // 边校验：源节点存在、源端口在 outputs 声明内、目标节点存在。
        // 同 (from, port) 多边 = fan-out（车道分发/并发分发的基本形态，设计 4.4），合法；
        // 分支歧义由 Branch 谓词边表达（谓词边 + 兜底边顺序即优先级）。
        for e in &edges {
            let src = table
                .get(&e.from)
                .ok_or_else(|| GraphError::UnknownNode(e.from.clone()))?;
            if !src.outputs().iter().any(|p| p == &e.from_port) {
                return Err(GraphError::UndeclaredPort {
                    node: e.from.clone(),
                    port: e.from_port.key(),
                });
            }
            if !table.contains_key(&e.to) {
                return Err(GraphError::UnknownNode(e.to.clone()));
            }
        }
        Ok(Self { nodes: table, edges, entry, joins: Vec::new() })
    }

    /// 声明汇合点（builder 链式；node 必须为已注册节点，expect ≥ 1）
    pub fn with_joins(mut self, joins: Vec<JoinSpec>) -> Result<Self, GraphError> {
        for j in &joins {
            if !self.nodes.contains_key(&j.node) {
                return Err(GraphError::UnknownNode(j.node.clone()));
            }
        }
        self.joins = joins;
        Ok(self)
    }

    /// 节点的汇合期望（无声明返回 None）
    pub fn join_expect(&self, id: &str) -> Option<usize> {
        self.joins.iter().find(|j| j.node == id).map(|j| j.expect)
    }

    /// 入口节点 id
    pub fn entry(&self) -> &str {
        &self.entry
    }

    /// 节点查表
    pub fn node(&self, id: &str) -> Option<&dyn OrchestratorNode> {
        self.nodes.get(id).map(|b| b.as_ref())
    }

    /// 端口路由查表（设计 4.2 第 7 步）：按 (源节点, 源端口) 命中**全部**目标
    /// （fan-out = 车道/并发分发的基本形态，设计 4.4）；
    /// Branch 边按谓词二次过滤（谓词通过的边全部生效，无谓词兜底边随后）。
    pub fn route_all(
        &self,
        from: &str,
        port: &Port,
        state: &crate::orchestrator::blackboard::Blackboard,
    ) -> Vec<&str> {
        let matching: Vec<&Edge> = self
            .edges
            .iter()
            .filter(|e| &e.from == from && &e.from_port == port)
            .collect();
        // 分组互斥语义：同端口下「带谓词」的边为一组（Branch 分发），命中的谓词边
        // 全部胜出、兜底边不生效（Branch 语义，原单目标 find 的多目标泛化）；
        // 无谓词命中时兜底边（fan-out 分发）全部生效（车道模型，4.4）。
        let pred_hit: Vec<&Edge> = matching
            .iter()
            .filter(|e| e.when.as_ref().map(|c| c.eval(state)).unwrap_or(false))
            .copied()
            .collect();
        let chosen: Vec<&Edge> = if pred_hit.is_empty() {
            matching.into_iter().filter(|e| e.when.is_none()).collect()
        } else {
            pred_hit
        };
        chosen.into_iter().map(|e| e.to.as_str()).collect()
    }

    /// 单目标路由（兼容便捷；= route_all 首个）
    pub fn route(
        &self,
        from: &str,
        port: &Port,
        state: &crate::orchestrator::blackboard::Blackboard,
    ) -> Option<&str> {
        self.route_all(from, port, state).into_iter().next()
    }

    /// 节点是否存在（子图作用域路由判定用）
    pub fn contains(&self, id: &str) -> bool {
        self.nodes.contains_key(id)
    }

    /// 全部节点 id（快照聚合遍历用，设计 4.6）
    pub fn node_ids(&self) -> Vec<&str> {
        self.nodes.keys().map(|s| s.as_str()).collect()
    }

    /// 节点数（调试/报告）
    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }
}

impl From<GraphError> for NodeError {
    fn from(e: GraphError) -> Self {
        NodeError::fatal("graph", e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::blackboard::Blackboard;
    use crate::orchestrator::context::NodeCtx;
    use crate::orchestrator::types::{NodeMeta, NodeResult, Usage};

    /// 测试桩节点：按构造时的端口序列依次返回
    struct Stub {
        id: String,
        outs: Vec<Port>,
        emit: Port,
    }

    impl Stub {
        fn new(id: &str, outs: Vec<Port>, emit: Port) -> Box<Self> {
            Box::new(Self { id: id.into(), outs, emit })
        }
    }

    #[async_trait::async_trait]
    impl OrchestratorNode for Stub {
        fn id(&self) -> &str {
            &self.id
        }
        fn meta(&self) -> &NodeMeta {
            static M: std::sync::OnceLock<NodeMeta> = std::sync::OnceLock::new();
            M.get_or_init(|| NodeMeta::new("stub", "测试桩"))
        }
        fn outputs(&self) -> &[Port] {
            &self.outs
        }
        async fn execute(&self, _ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
            Ok(NodeResult { port: self.emit.clone(), usage: Usage::default(), progress: None })
        }
    }

    #[test]
    fn 坏图构建期报错_未声明端口() {
        // stub_a 只声明 Done，却试图从 Out 出边
        let r = Graph::build(
            vec![Stub::new("a", vec![Port::Done], Port::Done), Stub::new("b", vec![], Port::Done)],
            vec![Edge::new("a", Port::Out, "b")],
            "a",
        );
        assert!(matches!(r, Err(GraphError::UndeclaredPort { .. })));
    }

    #[test]
    fn 坏图构建期报错_未知节点() {
        let r = Graph::build(
            vec![Stub::new("a", vec![Port::Done], Port::Done)],
            vec![Edge::new("a", Port::Done, "ghost")],
            "a",
        );
        assert!(matches!(r, Err(GraphError::UnknownNode(_))));
    }

    #[test]
    fn 路由查表与谓词() {
        let g = Graph::build(
            vec![
                Stub::new("a", vec![Port::Branch("x".into()), Port::Branch("y".into())], Port::Out),
                Stub::new("x", vec![Port::Done], Port::Done),
                Stub::new("y", vec![Port::Done], Port::Done),
            ],
            vec![
                Edge::new("a", Port::Branch("x".into()), "x").when(Condition::KeyExists("flag".into())),
                Edge::new("a", Port::Branch("x".into()), "y"),
                Edge::new("a", Port::Branch("y".into()), "y"),
            ],
            "a",
        )
        .unwrap();
        let mut bb = Blackboard::new();
        assert_eq!(g.route("a", &Port::Branch("x".into()), &bb), Some("y"), "无谓词边兜底");
        bb.write("flag", true);
        assert_eq!(g.route("a", &Port::Branch("x".into()), &bb), Some("x"), "谓词通过则胜出");
    }
}
