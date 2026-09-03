//! GoT 思维图（设计 §6.2）— split 并发求解 → merge 融合 → evaluate 回边
//!
//! 核心状态：`got.graph`（思维图：节点=思维单元，边=细化/合并关系——M3 以
//! 轮次记录形态承载：views / merged 历史）。split 产出视角 → 每视角一条并发
//! 车道（`SubgraphRequest::Lanes`，车道图由 `lane_factory` 生成，车道内可内嵌
//! 任意 loop 模式，设计 6.2 组合示例）→ 全部车道完成后 merge 融合 → evaluate
//! 整体评估 → 不达标回 split/merge（round 上限治理）。
//!
//! 终止条件三分（设计 6.2）：① 融合评估达标 → `Done`；
//! ② resplit/remerge 轮次上限 → 治理性完成；③ 车道 Fatal → 整链 Fatal
//! （执行器车道语义承担）。

use std::sync::{Arc, Mutex};

use serde_json::json;

use crate::orchestrator::context::{LaneSpec, NodeCtx, SubgraphRequest};
use crate::orchestrator::graph::Graph;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, NodeSnapshot, Port, ProgressNote, Usage};

pub struct GotNode {
    id: String,
    meta: NodeMeta,
    /// 拆分 system 提示（split_spec）
    split_prompt: String,
    /// 融合 system 提示（merge_spec）
    merge_prompt: String,
    /// 评估 system 提示（evaluate_spec）
    evaluate_prompt: String,
    /// 视角求解车道工厂：`fn(视角序号, 视角文本) -> (车道键, 子图)`
    /// （车道内节点应把部分解写入 `got.view.<键>`，供 merge 读取）
    lane_factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync>,
    /// resplit/remerge 轮次上限
    max_rounds: u32,
    round: Mutex<u32>,
}

impl GotNode {
    pub fn new(
        id: impl Into<String>,
        split_prompt: impl Into<String>,
        merge_prompt: impl Into<String>,
        evaluate_prompt: impl Into<String>,
        lane_factory: Arc<dyn Fn(usize, &str) -> Result<(String, Graph), NodeError> + Send + Sync>,
        max_rounds: u32,
    ) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("got", "思维图"),
            split_prompt: split_prompt.into(),
            merge_prompt: merge_prompt.into(),
            evaluate_prompt: evaluate_prompt.into(),
            lane_factory,
            max_rounds,
            round: Mutex::new(0),
        }
    }

    // 融合与评估由父图环回（GotNode --Out--> GotNode）后的下一轮 execute 承担：
    async fn post_lane_round(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let round = { *self.round.lock().unwrap() };
        let phase = ctx.state.read("got.phase").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        let mut usage = Usage::default();

        if phase == "await-merge" {
            // merge：读全部视角部分解，融合为全解（设计 6.2 数据流）
            let mut parts: Vec<String> = Vec::new();
            for k in ctx.state.keys() {
                if k.starts_with("got.view.") && k.ends_with(".result") {
                    if let Some(v) = ctx.state.read(k).and_then(|v| v.as_str().map(|s| s.to_string())) {
                        parts.push(v);
                    }
                }
            }
            let resp = ctx
                .llm
                .complete(&Request::new(
                    self.merge_prompt.clone(),
                    format!("各视角部分解：\n{}\n\n请对齐冲突并融合为统一全解。", parts.join("\n\n")),
                ))
                .await?;
            usage.saturating_add(&resp.usage);
            // merge 输出约定 JSON：{"merged":"…"}——取解析文本，避免 raw JSON 进结果层
            #[derive(serde::Deserialize)]
            struct M {
                merged: String,
            }
            let m: M = serde_json::from_str(resp.text.trim())
                .map_err(|e| NodeError::fatal("schema", format!("融合输出非约定 JSON：{e}")))?;
            ctx.state.write("got.merged", m.merged);
            ctx.state.write("got.phase", "await-evaluate");
            // 继续待评估（父图再环回一次）
            return Ok(NodeResult { port: Port::Out, usage, progress: None });
        }

        // evaluate：整体评估 → Accept 出口 / 未达标回环（round 上限治理）
        let merged = ctx.state.read("got.merged").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.evaluate_prompt.clone(),
                format!("融合全解：\n{merged}\n\n请整体评估。输出 JSON：{{\"accept\":true}} 或 {{\"accept\":false,\"reason\":\"…\"}}"),
            ))
            .await?;
        usage.saturating_add(&resp.usage);
        #[derive(serde::Deserialize)]
        struct V {
            accept: bool,
        }
        let v: V = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("评估输出非约定 JSON：{e}")))?;
        if v.accept {
            ctx.state.write("result.draft", merged);
            ctx.state.write("got.graph", json!({ "round": round, "phase": "accepted" }));
            return Ok(NodeResult { port: Port::Done, usage, progress: None });
        }
        // 未达标：round 上限 → 治理性完成（best-effort 交付当前融合解）
        { *self.round.lock().unwrap() = round + 1; }
        if round + 1 >= self.max_rounds {
            ctx.state.write("result.draft", merged.clone());
            return Ok(NodeResult::governed_done(usage, ProgressNote::MaxTurns));
        }
        // 回 split 再来（父图环回边 Out→本节点；round 已推进，下轮走 split）
        ctx.state.write("got.phase", "split");
        Ok(NodeResult { port: Port::Out, usage, progress: None })
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for GotNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Spawn, Port::Out, Port::Fatal("merge".into())])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let usage = Usage::default();
        let round = { *self.round.lock().unwrap() };

        // phase 分派：车道完成后的环回轮进入融合 / 评估态（父图 Out→本节点环回边）
        let phase = ctx
            .state
            .read("got.phase")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| "split".into());
        if phase == "await-merge" || phase == "await-evaluate" {
            return self.post_lane_round(ctx).await;
        }

        // 1. split：拆 n 个视角（写 got.graph 轮次记录）
        let resp = ctx
            .llm
            .complete(&Request::new(
                self.split_prompt.clone(),
                format!(
                    "任务意图：{intent}\n\n请拆分为 2-4 个独立求解视角。输出 JSON：{{\"views\":[\"性能视角…\",\"可测性视角…\"]}}"
                ),
            ))
            .await?;
        #[derive(serde::Deserialize)]
        struct Split {
            views: Vec<String>,
        }
        let sp: Split = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("拆分输出非约定 JSON：{e}")))?;
        ctx.state.write(
            "got.graph",
            json!({ "round": round, "views": sp.views, "phase": "split" }),
        );

        // 2. 每视角一条并发车道（Spawn 语义，设计 6.2 图 6-2：Spawn: lane-i）
        let mut lanes = Vec::new();
        for (i, view) in sp.views.iter().enumerate() {
            let (key, graph) = (self.lane_factory)(i, view)?;
            ctx.state.write(format!("got.view.{}.task", key), view.clone());
            lanes.push(LaneSpec { id: key, graph });
        }

        // 3. Spawn：车道并发（部分解写 got.view.<键>）→ 合并回黑板 → 本节点后续轮次
        //    读取融合。return_map 映射回自身 Out 不可行（Spawn 后控制权回父图），
        //    因此融合与评估在**车道完成后的父图后继**不可行——改为：
        //    车道完成后经 return_map 回本节点后继边（父图把 GotNode 的 Out 指回自身
        //    不必要）——M3 简化：融合/评估内嵌于下一次 execute 前？无法（控制权已离）。
        //    设计取舍：车道 return_map 映射到 Out，父图把 GotNode 的 Out 环回 GotNode
        //    （Loop 边），本节点以 round 奇偶区分「待融合 / 待评估」阶段。
        ctx.pending = Some(SubgraphRequest::Lanes {
            lanes,
            return_port_map: vec![(Port::Done, Port::Out)],
        });
        let phase = if round % 2 == 0 { "await-merge" } else { "await-evaluate" };
        ctx.state.write("got.phase", phase);
        Ok(NodeResult { port: Port::Spawn, usage, progress: None })
    }


    async fn snapshot(&self) -> Result<NodeSnapshot, NodeError> {
        Ok(NodeSnapshot { payload: json!({ "round": *self.round.lock().unwrap() }) })
    }

    async fn restore(&self, snap: NodeSnapshot) -> Result<(), NodeError> {
        if let Some(v) = snap.payload.get("round").and_then(|v| v.as_u64()) {
            *self.round.lock().unwrap() = v as u32;
        }
        Ok(())
    }
}
