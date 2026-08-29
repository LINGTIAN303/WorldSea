//! 统一节点抽象 `OrchestratorNode`（设计 §3.2 核心定义）
//!
//! 13 种模式的所有可调度单元实现这一个 trait（原子/循环/容器三类形态，3.1）。
//! 默认实现给足零负担：无状态节点继承 `snapshot`/`restore` 默认即可。



use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port};

/// 统一节点抽象（设计 §3.2）。
#[async_trait::async_trait]
pub trait OrchestratorNode: Send + Sync {
    /// 节点稳定标识（图内唯一；同名不同实例用实例后缀区分）
    fn id(&self) -> &str;

    /// 元信息：模式来源、端口规格、资源画像。执行器用于校验与预算。
    fn meta(&self) -> &NodeMeta;

    /// 声明本节点可能出现的出口端口集合（静态可查，供构图校验）
    fn outputs(&self) -> &[Port];

    /// 执行节点：读黑板、调 LLM/工具、写黑板、返回路由。
    /// 一切 LLM 访问经 ctx.llm，一切记忆访问经 ctx.memory。
    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError>;

    /// 产出可恢复快照。容器节点在此保存子图状态（默认无状态）。
    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot::default())
    }

    /// 从快照恢复（默认无状态）。恢复后 execute 应从断点继续而非重跑。
    ///
    /// 以 `&self` 承载：节点以 `Box<dyn OrchestratorNode>` 存于图内，
    /// 有状态节点用内部可变性（Mutex/原子）承载恢复写入——执行器持有
    /// 不可变引用即可完成级联恢复（设计 4.6）。
    async fn restore(&self, _snap: NodeSnapshot) -> Result<(), NodeError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::orchestrator::types::Usage;

    /// 默认快照：无状态节点零负担
    #[tokio::test]
    async fn 默认快照往返() {
        struct N;
        #[async_trait::async_trait]
        impl OrchestratorNode for N {
            fn id(&self) -> &str {
                "n"
            }
            fn meta(&self) -> &NodeMeta {
                unreachable!()
            }
            fn outputs(&self) -> &[Port] {
                &[Port::Done]
            }
            async fn execute(&self, _ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
                Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
            }
        }
        let n = N;
        let snap = n.snapshot().await.unwrap();
        assert!(snap.payload.is_null());
        n.restore(snap).await.unwrap();
    }
}
