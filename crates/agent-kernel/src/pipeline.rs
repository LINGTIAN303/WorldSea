//! # 声明式管线定义与构图期校验（D15 / D0-1 / D0-2 / D0-3，M1-7）
//!
//! 管线的"合法路径"集中在**一份声明式定义**里表达（拒绝运行时任意乱连）：
//!
//! ```text
//! PipelineDecl { nodes, edges, entry }
//! ├── nodes: 节点声明（id / 节点类型 / 产出 kind）
//! └── edges: 边声明（from / to / 接受 kind 集合）
//! ```
//!
//! `validate_pipeline` 是**构图期硬校验**（D23 双层校验之硬层）：
//! - 入口必须存在、节点 id 唯一、边两端节点必须已声明
//! - **kind 匹配**：上游节点产出 kind 必须在下游边声明的接受集合内
//!   - 上游不产出物（`output_kind=None`）→ 不参与 kind 匹配（运行期软校验兜底）
//!   - `Degraded` 兜底物例外：任何边都接受（一等降级物，审计链不断裂，D23）
//!   - `accepts` 为空 = 未约束（接受任意）
//! - 每条非法组合对应一条枚举式拒绝用例（D0-3）
//!
//! 运行期软校验（物缺失 → 声明式降级支路产出 Degraded 物，D0-14）不在本模块：
//! 由 Degraded 物机制（types.rs / orchestrator.rs 冻结检测）承载。

use std::collections::HashSet;

use crate::node::NodeType;
use crate::types::ArtifactKindTag;

/// 节点声明 — 一个管线阶段（与交接物同粒度，D0-11）
#[derive(Debug, Clone)]
pub struct PipelineNodeDecl {
    /// 节点 ID（构图时与 OrchestratorNode::id 对应）
    pub id: String,
    /// 节点类型（错误信息 / 审计用）
    pub node_type: NodeType,
    /// 该节点产出的交接物 kind（None = 不产出物）
    pub output_kind: Option<ArtifactKindTag>,
}

/// 边声明 — 阶段间的合法连接
#[derive(Debug, Clone)]
pub struct PipelineEdgeDecl {
    /// 源节点 ID
    pub from: String,
    /// 目标节点 ID
    pub to: String,
    /// 本边接受的产出 kind（空 = 未约束；Degraded 总是允许）
    pub accepts: Vec<ArtifactKindTag>,
}

/// 声明式管线定义 — 唯一拓扑源（D15）
#[derive(Debug, Clone)]
pub struct PipelineDecl {
    pub nodes: Vec<PipelineNodeDecl>,
    pub edges: Vec<PipelineEdgeDecl>,
    /// 入口节点 ID
    pub entry: String,
}

/// 构图期硬校验错误（D23 双层校验之硬层）
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PipelineValidationError {
    #[error("入口节点不存在: {0}")]
    EntryNotFound(String),

    #[error("节点 id 重复: {0}")]
    DuplicateNodeId(String),

    #[error("边引用了未声明的节点: from={from} to={to}（缺失: {missing}）")]
    UndeclaredNode { from: String, to: String, missing: String },

    #[error("kind 不匹配: {from} 产出 {produced:?}，但 {to} 只接受 {accepts:?}")]
    KindMismatch {
        from: String,
        produced: ArtifactKindTag,
        to: String,
        accepts: Vec<ArtifactKindTag>,
    },
}

/// 构图前硬校验（D0-1/2/3）：非法组合在构图期暴露，不留到运行期
pub fn validate_pipeline(decl: &PipelineDecl) -> Result<(), PipelineValidationError> {
    // 1. 节点 id 唯一
    let mut seen: HashSet<&str> = HashSet::new();
    for node in &decl.nodes {
        if !seen.insert(node.id.as_str()) {
            return Err(PipelineValidationError::DuplicateNodeId(node.id.clone()));
        }
    }

    // 2. 入口存在
    if !decl.nodes.iter().any(|n| n.id == decl.entry) {
        return Err(PipelineValidationError::EntryNotFound(decl.entry.clone()));
    }

    // 3. 逐边：两端已声明 + kind 匹配
    for edge in &decl.edges {
        let from_decl = match decl.nodes.iter().find(|n| n.id == edge.from) {
            Some(n) => n,
            None => {
                return Err(PipelineValidationError::UndeclaredNode {
                    from: edge.from.clone(),
                    to: edge.to.clone(),
                    missing: edge.from.clone(),
                })
            }
        };
        if !decl.nodes.iter().any(|n| n.id == edge.to) {
            return Err(PipelineValidationError::UndeclaredNode {
                from: edge.from.clone(),
                to: edge.to.clone(),
                missing: edge.to.clone(),
            });
        }

        // kind 匹配（硬）：上游有产出 && 非 Degraded && accepts 非空托管 → 必须在集合内
        if let Some(produced) = from_decl.output_kind {
            if produced != ArtifactKindTag::Degraded && !edge.accepts.is_empty() {
                if !edge.accepts.contains(&produced) {
                    return Err(PipelineValidationError::KindMismatch {
                        from: edge.from.clone(),
                        produced,
                        to: edge.to.clone(),
                        accepts: edge.accepts.clone(),
                    });
                }
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_node(id: &str) -> PipelineNodeDecl {
        PipelineNodeDecl {
            id: id.into(),
            node_type: NodeType::Custom,
            output_kind: None,
        }
    }

    /// 合法链：Plan → Execute（Execute 接受 Plan 产出）
    #[test]
    fn valid_plan_execute_chain_passes() {
        let decl = PipelineDecl {
            nodes: vec![
                PipelineNodeDecl {
                    id: "plan".into(),
                    node_type: NodeType::Plan,
                    output_kind: Some(ArtifactKindTag::Plan),
                },
                PipelineNodeDecl {
                    id: "execute".into(),
                    node_type: NodeType::Execute,
                    output_kind: Some(ArtifactKindTag::Execution),
                },
            ],
            edges: vec![PipelineEdgeDecl {
                from: "plan".into(),
                to: "execute".into(),
                accepts: vec![ArtifactKindTag::Plan],
            }],
            entry: "plan".into(),
        };
        assert!(validate_pipeline(&decl).is_ok(), "{:?}", validate_pipeline(&decl));
    }

    /// 非法组合 ①：Execution 产出喂给只接受 Exploration 的边 → 拒绝（D0-3 第一条枚举用例）
    #[test]
    fn illegal_kind_mismatch_rejected() {
        let decl = PipelineDecl {
            nodes: vec![
                PipelineNodeDecl {
                    id: "execute".into(),
                    node_type: NodeType::Execute,
                    output_kind: Some(ArtifactKindTag::Execution),
                },
                PipelineNodeDecl {
                    id: "tot".into(),
                    node_type: NodeType::Thought,
                    output_kind: Some(ArtifactKindTag::Exploration),
                },
            ],
            edges: vec![PipelineEdgeDecl {
                from: "execute".into(),
                to: "tot".into(),
                accepts: vec![ArtifactKindTag::Exploration],
            }],
            entry: "execute".into(),
        };
        match validate_pipeline(&decl) {
            Err(PipelineValidationError::KindMismatch { produced, .. }) => {
                assert_eq!(produced, ArtifactKindTag::Execution)
            }
            other => panic!("应拒绝 kind 不匹配: {:?}", other),
        }
    }

    /// 非法组合 ②：入口缺失 → 拒绝
    #[test]
    fn missing_entry_rejected() {
        let decl = PipelineDecl {
            nodes: vec![plan_node("plan")],
            edges: vec![],
            entry: "ghost".into(),
        };
        match validate_pipeline(&decl) {
            Err(PipelineValidationError::EntryNotFound(id)) => assert_eq!(id, "ghost"),
            other => panic!("应报入口缺失: {:?}", other),
        }
    }

    /// 非法组合 ③：边引用未声明节点 → 拒绝
    #[test]
    fn undeclared_node_rejected() {
        let decl = PipelineDecl {
            nodes: vec![plan_node("plan")],
            edges: vec![PipelineEdgeDecl {
                from: "plan".into(),
                to: "ghost".into(),
                accepts: vec![],
            }],
            entry: "plan".into(),
        };
        match validate_pipeline(&decl) {
            Err(PipelineValidationError::UndeclaredNode { missing, .. }) => {
                assert_eq!(missing, "ghost")
            }
            other => panic!("应报未声明节点: {:?}", other),
        }
    }

    /// 非法组合 ④：节点 id 重复 → 拒绝
    #[test]
    fn duplicate_node_id_rejected() {
        let decl = PipelineDecl {
            nodes: vec![plan_node("plan"), plan_node("plan")],
            edges: vec![],
            entry: "plan".into(),
        };
        match validate_pipeline(&decl) {
            Err(PipelineValidationError::DuplicateNodeId(id)) => assert_eq!(id, "plan"),
            other => panic!("应报重复节点: {:?}", other),
        }
    }

    /// 非法组合 ⑤：重复 kind 不影响（不接受集合重复即允许，无二义）
    #[test]
    fn duplicate_accept_entries_still_valid() {
        let decl = PipelineDecl {
            nodes: vec![
                PipelineNodeDecl {
                    id: "plan".into(),
                    node_type: NodeType::Plan,
                    output_kind: Some(ArtifactKindTag::Plan),
                },
                PipelineNodeDecl {
                    id: "execute".into(),
                    node_type: NodeType::Execute,
                    output_kind: Some(ArtifactKindTag::Execution),
                },
            ],
            edges: vec![PipelineEdgeDecl {
                from: "plan".into(),
                to: "execute".into(),
                accepts: vec![ArtifactKindTag::Plan, ArtifactKindTag::Plan],
            }],
            entry: "plan".into(),
        };
        assert!(validate_pipeline(&decl).is_ok());
    }

    /// Degraded 兜底：上游产出 Degraded，任何边都接受（一等降级物语义）
    #[test]
    fn degraded_output_always_accepted() {
        let decl = PipelineDecl {
            nodes: vec![
                PipelineNodeDecl {
                    id: "tot".into(),
                    node_type: NodeType::Thought,
                    output_kind: Some(ArtifactKindTag::Degraded),
                },
                PipelineNodeDecl {
                    id: "continue".into(),
                    node_type: NodeType::Execute,
                    output_kind: None,
                },
            ],
            edges: vec![PipelineEdgeDecl {
                from: "tot".into(),
                to: "continue".into(),
                accepts: vec![ArtifactKindTag::Execution],
            }],
            entry: "tot".into(),
        };
        assert!(validate_pipeline(&decl).is_ok());
    }

    /// 无产出节点（output_kind=None）不参与 kind 匹配（软降级兜底）
    #[test]
    fn no_output_node_skips_kind_check() {
        let decl = PipelineDecl {
            nodes: vec![plan_node("plan"), plan_node("next")],
            edges: vec![PipelineEdgeDecl {
                from: "plan".into(),
                to: "next".into(),
                accepts: vec![ArtifactKindTag::Exploration],
            }],
            entry: "plan".into(),
        };
        assert!(validate_pipeline(&decl).is_ok());
    }
}