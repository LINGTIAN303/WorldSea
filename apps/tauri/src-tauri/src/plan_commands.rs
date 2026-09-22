//! A4 Plan-Exec 任务清单工具（2026-09-23 归一：单工具全量重写，对齐 Claude Code TodoWrite）
//!
//! `todo_write`：LLM 提交**完整任务清单**（全量重写语义——带 id 的项更新、无 id 的项新建、
//! 未出现的旧项删除、数组顺序即执行序）；工具规范化后返回 `{items:[...]}`，
//! kernel `apply_plan_result` 据此写 `AgentState.plan` 并按**结构/状态差异**广播既有三事件
//! （`plan_created` / `plan_update`；前端 `usePlanStore` 与计划段渲染零改动）。
//!
//! 工具是**无状态规范化器**：计划状态由内核 `AgentState.plan`（真相源）与前端 store 同步。

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_runtime::tool::{SideEffectScope, Tool, ToolDescriptor, ToolError};
use agent_runtime::types::{PlanItem, PlanItemStatus};
use async_trait::async_trait;

/// 生成形如 `plan-item-<ts>-<idx>` 的计划项 ID（避免引入 uuid 依赖）
fn gen_plan_id(idx: usize) -> String {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("plan-item-{ts}-{idx}")
}

/// 解析状态字符串 → `PlanItemStatus`（非法返回 `None`）
fn parse_status(s: &str) -> Option<PlanItemStatus> {
    match s {
        "pending" => Some(PlanItemStatus::Pending),
        "in_progress" => Some(PlanItemStatus::InProgress),
        "completed" => Some(PlanItemStatus::Completed),
        "skipped" => Some(PlanItemStatus::Skipped),
        "failed" => Some(PlanItemStatus::Failed),
        _ => None,
    }
}

// ─── todo_write 工具 ─────────────────────────────────────────

/// `todo_write` — 创建/更新任务清单（全量重写）
pub struct TodoWriteTool;

#[async_trait]
impl Tool for TodoWriteTool {
    fn name(&self) -> &str {
        "todo_write"
    }

    fn description(&self) -> &str {
        "创建或更新任务清单（todo list），用于多步任务（3 步以上）的规划与进度跟踪：\
         把任务拆成可独立验收的步骤，**每次调用传入完整清单**（全量重写：带 id 的项更新、\
         无 id 的项新建、未出现的旧项删除，数组顺序即执行顺序）。\
         规则：至多一个步骤处于 in_progress；完成一步立即标 completed 再开始下一步；\
         简单问答（1-2 步）无需使用本工具。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "description": "完整任务清单（全量重写；数组顺序即执行顺序）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": { "type": "string", "description": "(可选)已有项 id（本工具上次返回）；新项省略" },
                            "content": { "type": "string", "description": "步骤内容（一句话）" },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed", "skipped", "failed"],
                                "description": "状态"
                            },
                            "description": { "type": "string", "description": "(可选)步骤说明" }
                        },
                        "required": ["content", "status"]
                    }
                }
            },
            "required": ["todos"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "plan", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let todos = args
            .get("todos")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ToolError::ArgsParse("todos 参数需为数组".into()))?;

        let mut items: Vec<PlanItem> = Vec::with_capacity(todos.len());
        // 状态语义收紧：至多一个 in_progress（保留第一个，其余降 pending——温和降级，不报错）
        let mut in_progress_seen = false;
        for (idx, t) in todos.iter().enumerate() {
            let content = t
                .get("content")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ToolError::ArgsParse(format!("todos[{idx}] 缺少 content")))?;
            let mut status = t
                .get("status")
                .and_then(|v| v.as_str())
                .and_then(parse_status)
                .ok_or_else(|| {
                    ToolError::ArgsParse(format!(
                        "todos[{idx}].status 非法，需为 pending/in_progress/completed/skipped/failed"
                    ))
                })?;
            if status == PlanItemStatus::InProgress {
                if in_progress_seen {
                    status = PlanItemStatus::Pending;
                } else {
                    in_progress_seen = true;
                }
            }
            let id = t
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| gen_plan_id(idx));
            items.push(PlanItem {
                id,
                title: content.to_string(),
                description: t
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                status,
                order: idx as i32,
                output: None, // 由 kernel 合并旧项 output（前端「产出区」沿用）
            });
        }

        if items.is_empty() {
            return Err(ToolError::ArgsParse("清单至少包含一个有效步骤".into()));
        }

        Ok(serde_json::json!({ "items": items }))
    }
}

// ─── 工厂 ─────────────────────────────────────────────────────

/// 构造 A4 计划工具集合（注册进 Rust ToolBus 用）
pub fn plan_tools() -> Vec<Arc<dyn Tool>> {
    vec![Arc::new(TodoWriteTool)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn todo_write_normalizes_full_list_with_ids() {
        let tool = TodoWriteTool;
        let result = tool
            .execute(serde_json::json!({
                "todos": [
                    { "content": "第一步", "status": "in_progress", "description": "调研" },
                    { "id": "keep-me", "content": "第二步", "status": "pending" }
                ]
            }))
            .await
            .unwrap();
        let items = result["items"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["title"], "第一步");
        assert_eq!(items[0]["status"], "in_progress");
        assert_eq!(items[0]["description"], "调研");
        assert!(items[0]["id"].as_str().unwrap().starts_with("plan-item-"), "无 id 项自动生成");
        assert_eq!(items[1]["id"], "keep-me", "带 id 项沿用模型给的 id（kernel 据此保留 output）");
        assert_eq!(items[1]["order"], 1, "数组顺序即执行序");
    }

    #[tokio::test]
    async fn todo_write_enforces_single_in_progress_softly() {
        // 状态语义收紧：多 in_progress → 保留第一个，其余降 pending（不报错）
        let tool = TodoWriteTool;
        let result = tool
            .execute(serde_json::json!({
                "todos": [
                    { "content": "A", "status": "in_progress" },
                    { "content": "B", "status": "in_progress" },
                    { "content": "C", "status": "in_progress" }
                ]
            }))
            .await
            .unwrap();
        let items = result["items"].as_array().unwrap();
        assert_eq!(items[0]["status"], "in_progress");
        assert_eq!(items[1]["status"], "pending", "第二个 in_progress 应降级");
        assert_eq!(items[2]["status"], "pending");
    }

    #[tokio::test]
    async fn todo_write_rejects_empty_and_malformed() {
        let tool = TodoWriteTool;
        assert!(matches!(
            tool.execute(serde_json::json!({})).await,
            Err(ToolError::ArgsParse(_))
        ));
        assert!(
            matches!(
                tool.execute(serde_json::json!({ "todos": [] })).await,
                Err(ToolError::ArgsParse(_))
            ),
            "空清单应被拒绝（防误清空）"
        );
        assert!(
            matches!(
                tool.execute(serde_json::json!({ "todos": [{ "content": "  ", "status": "pending" }] }))
                    .await,
                Err(ToolError::ArgsParse(_))
            ),
            "空 content 应被拒绝"
        );
        assert!(
            matches!(
                tool.execute(serde_json::json!({ "todos": [{ "content": "x", "status": "bogus" }] }))
                    .await,
                Err(ToolError::ArgsParse(_))
            ),
            "非法状态应被拒绝"
        );
    }

    #[tokio::test]
    async fn plan_tools_exposes_single_tool() {
        let tools = plan_tools();
        assert_eq!(tools.len(), 1, "归一后仅一个工具");
        assert_eq!(tools[0].name(), "todo_write");
    }
}
