//! 工作流定义校验
//!
//! 负责在 `WorkflowDefinition` 持久化/执行前发现结构性问题：
//!   * 节点 id 唯一性
//!   * 边引用的节点存在性
//!   * 必含 `start` 与 `end` 节点
//!   * DAG 无环（Kahn 拓扑排序）
//!   * 起点可达性（孤立节点）

use crate::workflow::types::WorkflowDefinition;
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ValidationError {
    #[error("工作流必须包含一个 start 节点")]
    NoStartNode,

    #[error("工作流必须包含一个 end 节点")]
    NoEndNode,

    #[error("节点 id 重复: {0}")]
    DuplicateNodeId(String),

    #[error("边引用的节点不存在: {0}")]
    UnknownNodeRef(String),

    #[error("环检测发现循环: {0:?}")]
    CycleDetected(Vec<String>),

    #[error("孤立节点（不可达）: {0}")]
    OrphanNode(String),

    #[error("节点 {0} 的 type 为空")]
    EmptyNodeType(String),
}

pub fn validate_definition(def: &WorkflowDefinition) -> Result<(), ValidationError> {
    // 1. 节点 id 唯一性 + type 非空
    let mut seen: HashSet<&str> = HashSet::with_capacity(def.nodes.len());
    for node in &def.nodes {
        if node.type_.is_empty() {
            return Err(ValidationError::EmptyNodeType(node.id.clone()));
        }
        if !seen.insert(node.id.as_str()) {
            return Err(ValidationError::DuplicateNodeId(node.id.clone()));
        }
    }

    // 2. 边引用的节点都存在
    for edge in &def.edges {
        if !seen.contains(edge.from.as_str()) {
            return Err(ValidationError::UnknownNodeRef(edge.from.clone()));
        }
        if !seen.contains(edge.to.as_str()) {
            return Err(ValidationError::UnknownNodeRef(edge.to.clone()));
        }
    }

    // 3. 必含 start 与 end
    if !def.nodes.iter().any(|n| n.type_ == "start") {
        return Err(ValidationError::NoStartNode);
    }
    if !def.nodes.iter().any(|n| n.type_ == "end") {
        return Err(ValidationError::NoEndNode);
    }

    // 4. 构建邻接表 + 入度表
    let mut in_degree: HashMap<&str, usize> = def.nodes.iter().map(|n| (n.id.as_str(), 0)).collect();
    let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in &def.edges {
        *in_degree.entry(edge.to.as_str()).or_insert(0) += 1;
        adj.entry(edge.from.as_str()).or_default().push(edge.to.as_str());
    }

    // 5. Kahn 拓扑排序
    let mut queue: VecDeque<&str> = in_degree
        .iter()
        .filter_map(|(id, d)| (*d == 0).then_some(*id))
        .collect();
    let mut sorted: Vec<String> = Vec::with_capacity(def.nodes.len());
    while let Some(id) = queue.pop_front() {
        sorted.push(id.to_string());
        if let Some(next) = adj.get(id) {
            for n in next {
                let d = in_degree.get_mut(n).expect("node present in in_degree");
                *d -= 1;
                if *d == 0 {
                    queue.push_back(n);
                }
            }
        }
    }
    if sorted.len() != def.nodes.len() {
        // 剩下的就是环里的节点
        let cycle: Vec<String> = def
            .nodes
            .iter()
            .map(|n| n.id.clone())
            .filter(|id| !sorted.contains(id))
            .collect();
        return Err(ValidationError::CycleDetected(cycle));
    }

    // 6. 从 start 反向可达性 DFS（孤立节点）
    let starts: Vec<&str> = def
        .nodes
        .iter()
        .filter(|n| n.type_ == "start")
        .map(|n| n.id.as_str())
        .collect();

    let mut reachable: HashSet<&str> = HashSet::new();
    if let Some(&first) = starts.first() {
        let mut stack: Vec<&str> = vec![first];
        while let Some(id) = stack.pop() {
            if !reachable.insert(id) {
                continue;
            }
            if let Some(next) = adj.get(id) {
                for n in next {
                    stack.push(n);
                }
            }
        }
    }

    for node in &def.nodes {
        if !reachable.contains(node.id.as_str()) {
            return Err(ValidationError::OrphanNode(node.id.clone()));
        }
    }

    Ok(())
}
