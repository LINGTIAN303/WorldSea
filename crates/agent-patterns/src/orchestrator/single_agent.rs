//! Single Agent 单智能体直通（设计 §5.1）— M1 骨架的端到端验收链路
//!
//! 任务画像：单步可完成的即席生成。无分支、无回边的最短链路：
//! `ingress（写入 task.intent）→ solve（单次 LLM 调用）→ egress（交付）`。
//! 也是其余一切模式的退化底座（设计 5.1）。



use crate::orchestrator::context::NodeCtx;
use crate::orchestrator::error::NodeError;
use crate::orchestrator::handles::Request;
use crate::orchestrator::node::OrchestratorNode;
use crate::orchestrator::types::{NodeMeta, NodeResult, Port, Usage};

/// Prompt 模板的最小形态（设计 §5.1 `PromptSpec`）：
/// system 固定 + user 从黑板约定键 `task.intent` 取当前值渲染。
#[derive(Debug, Clone)]
pub struct PromptSpec {
    pub system: String,
    /// 是否把黑板召回记忆（`ctx.recalled`）拼进 user 输入（M4 打开后生效）
    pub include_recalled: bool,
}

impl PromptSpec {
    pub fn new(system: impl Into<String>) -> Self {
        Self { system: system.into(), include_recalled: false }
    }

    /// 渲染：意图取自黑板约定键 `task.intent`（设计 表 3-1）
    fn render(&self, ctx: &NodeCtx<'_>) -> Result<Request, NodeError> {
        let intent = ctx
            .state
            .read("task.intent")
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .ok_or_else(|| NodeError::fatal("prompt", "黑板缺少 task.intent（ingress 未写入）"))?;
        let mut user = intent;
        if self.include_recalled && !ctx.recalled.is_empty() {
            let notes: Vec<String> =
                ctx.recalled.iter().map(|e| format!("- {}", e.content)).collect();
            user.push_str("\n\n相关记忆：\n");
            user.push_str(&notes.join("\n"));
        }
        Ok(Request::new(self.system.clone(), user))
    }
}

/// Single Agent 直通节点（设计 5.1 trait 实现要点）：
/// `outputs()` 返回 `[Out, Fatal]`——但作为单节点图时以 `Done` 收口；
/// 作为子图节点时经 `Out` 出边交给 egress。执行体一致：一次 `ctx.llm.complete`。
pub struct SingleAgentNode {
    id: String,
    meta: NodeMeta,
    prompt_spec: PromptSpec,
    /// 出口端口表（构造期定形，`outputs()` 返回其引用）
    outs: Vec<Port>,
}

impl SingleAgentNode {
    /// 单节点图形态：solve 即出口（M1 验收形态）
    pub fn terminal(id: impl Into<String>, prompt_spec: PromptSpec) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("single_agent", "单智能体直通"),
            prompt_spec,
            outs: vec![Port::Done, Port::Fatal("llm".into())],
        }
    }

    /// 子图节点形态：solve 从 Out 出边（egress 承接交付）
    pub fn with_egress(id: impl Into<String>, prompt_spec: PromptSpec) -> Self {
        Self {
            id: id.into(),
            meta: NodeMeta::new("single_agent", "单智能体直通"),
            prompt_spec,
            outs: vec![Port::Out, Port::Fatal("llm".into())],
        }
    }

    pub fn prompt_spec(&self) -> &PromptSpec {
        &self.prompt_spec
    }
}

#[async_trait::async_trait]
impl OrchestratorNode for SingleAgentNode {
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
        // 唯一一次调用（设计 5.1：单次 `ctx.llm.complete(req)`）
        let req = self.prompt_spec.render(ctx)?;
        let resp = ctx.llm.complete(&req).await.map_err(NodeError::from)?;
        // 产出物写入黑板（数据与路由分离，设计 3.2 要点解读）
        ctx.state.write("result.draft", resp.text.clone());
        let port = self.outs[0].clone();
        Ok(NodeResult { port, usage: resp.usage, progress: None })
    }
}

/// 用量归零的结果便捷构造（测试用）
#[allow(dead_code)]
fn zero_usage() -> Usage {
    Usage::default()
}
