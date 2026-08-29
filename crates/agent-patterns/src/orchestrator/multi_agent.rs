//! Multi-Agent 多智能体协作（设计 §6.3）— 静态切分 → 并发车道 → 聚合
//!
//! 与 GoT 的区别（设计 6.3）：Multi-Agent 的车道图是**静态切分**（decompose 产出
//! 即定），GoT 是运行时动态拆分。核心状态：`ma.results.<lane>`（车道命名空间隔离，
//! 设计 表 3-1 / 4.4 车道模型——由执行器 `SubgraphRequest::Lanes` 并发承担）。
//!
//! 组合形态：decompose（本节点）→ Lanes 并发 → 车道完成后 return_map 回父图 →
//! 聚合节点（`AggregateNode`，可再接 Reflection 终审——设计 9.3「三线交付」）。
//! 定向重跑（gate.ma）M3 首版未内嵌，留上层图组合（redos 轮次以 `max_redo_rounds` 预留）。

use std::sync::Arc;

use serde_json::json;

use crate::orchestrator::context::{LaneSpec, NodeCtx, SubgraphRequest};
use crate::orchestrator::error::NodeError;
use crate::orchestrator::graph::Graph;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, Port};

pub struct MultiAgentNode {
    id: String,
    meta: NodeMeta,
    /// 切分 system 提示
    decompose_prompt: String,
    /// 车道子图工厂：`fn(车道序号, 车道任务) -> 子图`——子图入口节点执行时
    /// 应把产出写入黑板键 `ma.results.<lane-id>`（车道命名空间隔离，设计 6.3）
    lane_factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync>,
    /// 车道数上限（decompose 结果截断）
    max_lanes: usize,
}

impl MultiAgentNode {
    pub fn new(
        id: impl Into<String>,
        decompose_prompt: impl Into<String>,
        lane_factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync>,
        max_lanes: usize,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("multi_agent", "多智能体协作"),
            decompose_prompt: decompose_prompt.into(),
            lane_factory,
            max_lanes,
        }
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for MultiAgentNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Spawn, Port::Out, Port::Fatal("lanes".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        // 1. decompose：静态切分为独立子任务（设计 6.3；LLM 面走 complete + JSON）
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.decompose_prompt.clone(),
                format!(
                    "任务意图：{intent}\n\n请切分为至多 {} 个互不阻塞的独立子任务。输出 JSON：{{\"lanes\":[{{\"id\":\"lane-a\",\"task\":\"…\"}}]}}",
                    self.max_lanes
                ),
            ))
            .await?;
        #[derive(serde::Deserialize)]
        struct Decompose {
            lanes: Vec<LaneTask>,
        }
        #[derive(serde::Deserialize)]
        struct LaneTask {
            id: String,
            task: String,
        }
        let de: Decompose = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("切分输出非约定 JSON：{e}")))?;
        if de.lanes.is_empty() {
            return Err(NodeError::fatal("lanes", "切分为空"));
        }
        ctx.state.append(
            "ma.tasks",
            json!(de.lanes.iter().map(|l| json!({"id": l.id, "task": l.task})).collect::<Vec<_>>()),
        );

        // 2. 车道构造（静态注册语义：车道子图由工厂按任务生成）
        let mut lanes = Vec::new();
        for (i, lt) in de.lanes.iter().take(self.max_lanes).enumerate() {
            ctx.state.write(format!("ma.task.{}", lt.id), lt.task.clone());
            let (entry, graph) = (self.lane_factory)(i, &lt.task)?;
            lanes.push(LaneSpec { id: lt.id.clone(), graph });
            let _ = entry;
        }

        // 3. Spawn 并发车道：车道间并发、各自黑板分身；全部完成后合并回父图，
        //    由 return_map 回父图后继（聚合节点）——wait-set 语义由「全部车道完成」承担
        ctx.pending = Some(SubgraphRequest::Lanes {
            lanes,
            return_port_map: vec![(Port::Done, Port::Out)],
        });
        Ok(NodeResult { port: Port::Spawn, usage: resp.usage, progress: None })
    }
}
