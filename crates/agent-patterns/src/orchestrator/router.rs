//! Router 智能路由（设计 §6.5）— 统一入口的意图分类分发器
//!
//! Router 是链路之间的分发器，不是任务执行者（设计 6.5）：分类产出
//! `route.choice`（label + 置信度 + 理由，审计留痕），高置信度走 `Branch(label)`
//! 进目标链路，低置信度走 `Branch("low-conf")`（父图接 fallback 节点）。
//! **无 Loop 端口**——路由是单步决策，循环属于目标链路（设计 6.5 要点）。
//!
//! LLM 面：classify 走 `complete` + JSON 约定 `{"label":"…","confidence":0.9,"reason":"…"}`；
//! few-shot 示例从程序性记忆注入（M4 接入前由构造参数传入，设计 6.5 要点）。

use std::sync::Arc;

use serde_json::json;

use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

/// 路由决策（`route.choice` 黑板键的值形态，设计 表 3-1）
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct RouteChoice {
    pub label: String,
    pub confidence: f64,
    #[serde(default)]
    pub reason: String,
}

pub struct RouterNode {
    id: String,
    meta: NodeMeta,
    classify_prompt: String,
    /// 可路由标签集（= 父图 Branch 边的目标标签）
    labels: Vec<String>,
    confidence_threshold: f64,
    few_shot: Vec<(String, String)>,
    /// few-shot 程序性记忆源（设计 6.5/7.4：优先于静态 few_shot；M4 接入点）
    few_shot_provider: Option<Arc<dyn Fn() -> Vec<(String, String)> + Send + Sync>>,
    /// 对外端口（构造期定形：labels Branch + low-conf + Fatal；无 Loop）
    outs: Vec<Port>,
}

impl RouterNode {
    pub fn new(
        id: impl Into<String>,
        classify_prompt: impl Into<String>,
        labels: Vec<String>,
        confidence_threshold: f64,
    ) -> Self {
        let mut outs: Vec<Port> = labels.iter().map(|l| Port::Branch(l.clone())).collect();
        outs.push(Port::Branch("low-conf".into()));
        outs.push(Port::Fatal("classify".into()));
        Self {
            id: id.into(),
            meta: NodeMeta::new("router", "智能路由"),
            classify_prompt: classify_prompt.into(),
            labels,
            confidence_threshold,
            few_shot: Vec::new(),
            few_shot_provider: None,
            outs,
        }
    }

    pub fn with_few_shot(mut self, few_shot: Vec<(String, String)>) -> Self {
        self.few_shot = few_shot;
        self
    }

    /// 注入 few-shot 程序性记忆源（`LayeredMemoryStore::procedural_few_shot` 的
    /// 闭包包装；execute 时动态加载，随路由质量数据持续优化，设计 6.5 要点）
    pub fn with_few_shot_provider(
        mut self,
        provider: Arc<dyn Fn() -> Vec<(String, String)> + Send + Sync>,
    ) -> Self {
        self.few_shot_provider = Some(provider);
        self
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for RouterNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        &self.outs
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        let labels_desc = self.labels.join(" | ");
        let mut user = format!(
            "任务意图：{intent}\n\n可路由标签（只能从中选一）：{labels_desc}\n\n请输出 JSON：{{\"label\":\"…\",\"confidence\":0.0到1.0,\"reason\":\"…\"}}。"
        );
        if !self.few_shot.is_empty() {
            let shots: Vec<String> = self
                .few_shot
                .iter()
                .map(|(i, l)| format!("- 意图「{i}」→ {l}"))
                .collect();
            user.push_str(&format!("\n\n路由先例：\n{}", shots.join("\n")));
        }
        let resp = ctx
            .llm
            .complete(&Request::new(self.classify_prompt.clone(), user))
            .await?;
        let cls: RouteChoice = serde_json::from_str(resp.text.trim())
            .map_err(|e| NodeError::fatal("schema", format!("分类输出非约定 JSON：{e}")))?;
        // 审计留痕（设计 6.5：路由决策全量记录）
        ctx.state.write("route.choice", &cls);
        let legal = self.labels.iter().any(|l| l == &cls.label);
        let port = if legal && cls.confidence >= self.confidence_threshold {
            Port::Branch(cls.label.clone())
        } else {
            // 未知标签或低置信度 → fallback（设计 6.5：澄清或安全默认链路）
            Port::Branch("low-conf".into())
        };
        Ok(NodeResult { port, usage: resp.usage, progress: None })
    }
}

/// 聚合节点（Multi-Agent/GoT 的汇合交付用）：收集 `ma.results.<lane>` 全部
/// 车道结果合并为结果层（聚合质量判定与定向重跑由上层图组合，M3 首版不做）。
pub struct AggregateNode {
    id: String,
    meta: NodeMeta,
    /// 聚合提示（M3 首版仅拼接；LLM 融合留给上层用 Reflection 组合）
    merge: bool,
}

impl AggregateNode {
    pub fn new(id: impl Into<String>, merge_with_llm: bool) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("aggregate", "车道聚合"),
            merge: merge_with_llm,
        }
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for AggregateNode {
    fn id(&self) -> &str {
        &self.id
    }

    fn meta(&self) -> &NodeMeta {
        &self.meta
    }

    fn outputs(&self) -> &[Port] {
        static OUTS: std::sync::OnceLock<Vec<Port>> = std::sync::OnceLock::new();
        OUTS.get_or_init(|| vec![Port::Done])
    }

    async fn execute(&self, ctx: &mut NodeCtx<'_>) -> Result<NodeResult, NodeError> {
        // 收集全部车道结果（键约定 ma.results.<lane>，设计 表 3-1 / §6.3）
        let mut lanes: Vec<(String, String)> = Vec::new();
        for k in ctx.state.keys() {
            if let Some(lane) = k.strip_prefix("ma.results.") {
                if let Some(v) = ctx.state.read(k).and_then(|v| v.as_str().map(|s| s.to_string())) {
                    lanes.push((lane.to_string(), v));
                }
            }
        }
        lanes.sort();
        if self.merge && !lanes.is_empty() {
            let merged = ctx
                .llm
                .complete(&Request::new(
                    "你是聚合器：把多条车道的产出对齐合并为一份连贯交付。",
                    format!(
                        "车道产出：\n{}",
                        lanes.iter().map(|(l, v)| format!("[{l}] {v}")).collect::<Vec<_>>().join("\n\n")
                    ),
                ))
                .await?;
            ctx.state.write("result.draft", merged.text.clone());
            return Ok(NodeResult { port: Port::Done, usage: merged.usage, progress: None });
        }
        // 无 LLM 聚合：按车道序拼接
        let joined = lanes.iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>().join("\n\n");
        ctx.state.write("result.draft", joined);
        ctx.state.append("mem.notes", json!({ "content": format!("聚合 {} 条车道结果", lanes.len()) }));
        Ok(NodeResult { port: Port::Done, usage: Usage::default(), progress: None })
    }
}
