//! 编排内部决策工具定义（DecisionSpec，2026-09-02 B 类 JSON 决策点迁移试点）
//!
//! B 类决策点（路由/验收等）此前用「提示词要求输出 JSON + 手解析」，脆弱易格式漂移。
//! 迁移方案：每个决策点对应一个「决策工具」（参数 JSON Schema），经 `LlmHandle::decide`
//! 强制工具调用（genai `ToolChoice::Tool`，tool-use-as-JSON）返回结构化参数。
//! 决策工具**不注册进对外 ToolBus**——它们是编排内部机制，不污染主 Agent 工具面。

use agent_kernel::tool::ToolDefinition;
use serde_json::json;

/// 路由决策工具（RouterNode：从可路由标签中选一）
///
/// 参数对应 [`crate::orchestrator::router::RouteChoice`]：
/// label + confidence(0~1) + reason。只读决策，无副作用。
pub fn route_decision_tool() -> ToolDefinition {
    ToolDefinition {
        name: "route_decision".into(),
        description: "路由决策：从给定的可路由标签中唯一选择一个，并给出置信度与理由。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "label": { "type": "string", "description": "选中的路由标签（必须来自可路由标签集）" },
                "confidence": { "type": "number", "description": "置信度 0.0~1.0" },
                "reason": { "type": "string", "description": "决策理由" }
            },
            "required": ["label", "confidence"]
        }),
    }
}

/// 步骤验收工具（PlanExecuteNode::assess_step：判断步骤是否已被产出文本完成）
///
/// 参数对应验收结论 Verdict：passed + reason。只读决策，无副作用。
pub fn step_assess_decision_tool() -> ToolDefinition {
    ToolDefinition {
        name: "step_assess_decision".into(),
        description: "步骤验收：判断给定步骤是否已被「步骤产出」文本完成，给出是否通过及未通过原因。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "passed": { "type": "boolean", "description": "是否通过验收" },
                "reason": { "type": "string", "description": "未通过时的原因" }
            },
            "required": ["passed"]
        }),
    }
}

/// 路由目标决策工具（A3 发送链路由 `patterns::router::LlmRoutingStrategy`）
///
/// 参数对应 `RouteResult`：target_id + reason。这是主 Agent 日常发消息即触发的
/// 真实路由决策点（classify_pipeline / run_router_decision 都走它）。只读决策。
pub fn route_target_decision_tool() -> ToolDefinition {
    ToolDefinition {
        name: "route_target_decision".into(),
        description: "路由决策：从可用的路由分支中唯一选择一个目标分支，并给出选择理由。".into(),
        parameters: json!({
            "type": "object",
            "properties": {
                "target_id": { "type": "string", "description": "选中的路由目标 ID（必须来自可用分支列表）" },
                "reason": { "type": "string", "description": "选择理由（一句话）" }
            },
            "required": ["target_id"]
        }),
    }
}
