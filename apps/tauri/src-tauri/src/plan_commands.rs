//! A4 Plan-Exec 计划工具（MVP：计划生成 → 逐步执行闭环）
//!
//! 提供两个原生工具，注册进 Rust `ToolBus` 供 LLM 调用：
//! - `plan_create`：LLM 提交任务计划（数组），工具规范化后返回 `{items:[...]}`，
//!   TS `useAgentEvents` 解析结果写入 `usePlanStore`，驱动 PlanPanel 展示。
//! - `plan_update`：LLM 更新某计划项状态，返回 `{item_id, status}`，
//!   TS 解析后更新 `usePlanStore` 对应项。
//!
//! MVP 为「计划工具闭环」：工具是无状态规范化器，计划状态由前端 `usePlanStore`（内存）
//! 维护。计划持久化 / checkpoint 回放 / 重规划 属后续范围。

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

// ─── plan_create 工具 ─────────────────────────────────────────

/// `plan_create` — 创建/替换当前任务计划
pub struct PlanCreateTool;

#[async_trait]
impl Tool for PlanCreateTool {
    fn name(&self) -> &str {
        "plan_create"
    }

    fn description(&self) -> &str {
        "创建或替换当前任务计划。传入一组计划步骤（每步含标题、可选描述、可选状态），\
         返回规范化后的计划项列表（含自动生成的 id）。执行任务时按步骤推进，\
         每完成/跳过一步用 plan_update 更新该步骤状态。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "plan": {
                    "type": "array",
                    "description": "计划步骤列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "步骤标题" },
                            "description": { "type": "string", "description": "(可选)步骤说明" },
                            "status": {
                                "type": "string",
                                "enum": ["pending", "in_progress", "completed", "skipped", "failed"],
                                "description": "(可选)初始状态，默认 pending"
                            }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["plan"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "plan", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let plan = args
            .get("plan")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ToolError::ArgsParse("plan 参数需为数组".into()))?;

        let items: Vec<PlanItem> = plan
            .iter()
            .enumerate()
            .filter_map(|(idx, step)| {
                let title = step
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())?;
                let status = step
                    .get("status")
                    .and_then(|v| v.as_str())
                    .and_then(parse_status)
                    .unwrap_or(PlanItemStatus::Pending);
                Some(PlanItem {
                    id: gen_plan_id(idx),
                    title: title.to_string(),
                    description: step
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    status,
                    order: idx as i32,
                    output: None,
                })
            })
            .collect();

        if items.is_empty() {
            return Err(ToolError::ArgsParse("计划至少包含一个有效步骤".into()));
        }

        // 2026-09-02 待办串行执行规范：随工具结果回传给模型（最强引导位置）——
        // 步骤代表实际工作任务；严格「in_progress → 执行真实工具 → completed」逐条推进。
        let usage = concat!(
            "执行规范（必须遵守）：\n",
            "1. 每个步骤代表一项实际工作任务，禁止把「创建计划」本身当作步骤完成。\n",
            "2. 严格串行：立即将第 1 个步骤设为 in_progress，然后执行该步骤的真实工作（调用 read_file/execute_command 等工具），",
            "完成后才将其设为 completed；随后再将下一个步骤设为 in_progress，重复此过程。\n",
            "3. 任何时刻只允许一个步骤处于 in_progress；禁止跳过执行直接把步骤标为 completed。\n",
            "4. 全部步骤完成后，才输出最终总结。"
        );
        Ok(serde_json::json!({ "items": items, "usage": usage }))
    }
}

// ─── plan_update 工具 ─────────────────────────────────────────

/// `plan_update` — 更新某计划项状态
pub struct PlanUpdateTool;

#[async_trait]
impl Tool for PlanUpdateTool {
    fn name(&self) -> &str {
        "plan_update"
    }

    fn description(&self) -> &str {
        "更新任务计划中某项的状态。传入由 plan_create 返回的 item_id 与目标状态 \
         (pending / in_progress / completed / skipped / failed)。\
         严格串行推进：先把当前步骤设为 in_progress，执行其真实工作（调用其他工具），\
         完成后才设为 completed；任何时刻只有一个步骤处于 in_progress，\
         禁止跳过执行直接标记 completed。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "item_id": { "type": "string", "description": "计划项 id（plan_create 返回）" },
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed", "skipped", "failed"],
                    "description": "目标状态"
                }
            },
            "required": ["item_id", "status"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "plan", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let item_id = args
            .get("item_id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::ArgsParse("缺少 item_id 参数".into()))?;
        let status = args
            .get("status")
            .and_then(|v| v.as_str())
            .and_then(parse_status)
            .ok_or_else(|| ToolError::ArgsParse("status 非法，需为 pending/in_progress/completed/skipped/failed".into()))?;

        Ok(serde_json::json!({ "item_id": item_id, "status": status }))
    }
}

// ─── plan_replan 工具（Replanner）─────────────────────────

/// `plan_replan` — 计划失败后重新规划后续步骤
pub struct PlanReplanTool;

#[async_trait]
impl Tool for PlanReplanTool {
    fn name(&self) -> &str {
        "plan_replan"
    }

    fn description(&self) -> &str {
        "当计划中某一步骤执行失败时，重新规划其后的后续步骤。传入触发失败的步骤 id \
         与一组新的后续步骤，框架会保留该失败步骤及其之前的已完成进度，仅把其后的 \
         待执行步骤替换为新步骤序列。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "failed_item_id": {
                    "type": "string",
                    "description": "触发重规划的失败步骤 id（由 plan_create 返回）"
                },
                "new_steps": {
                    "type": "array",
                    "description": "重规划后的后续步骤列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "步骤标题" },
                            "description": { "type": "string", "description": "(可选)步骤说明" }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["failed_item_id", "new_steps"]
        })
    }
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::writes(self.name(), "plan", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let failed_item_id = args
            .get("failed_item_id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::ArgsParse("缺少 failed_item_id 参数".into()))?;
        let new_steps = args
            .get("new_steps")
            .and_then(|v| v.as_array())
            .ok_or_else(|| ToolError::ArgsParse("new_steps 参数需为数组".into()))?;
        // 规范化：过滤空标题，保留 title/description
        let normalized: Vec<serde_json::Value> = new_steps
            .iter()
            .filter_map(|step| {
                let title = step
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())?;
                Some(serde_json::json!({
                    "title": title,
                    "description": step.get("description").and_then(|v| v.as_str()),
                }))
            })
            .collect();
        if normalized.is_empty() {
            return Err(ToolError::ArgsParse("new_steps 至少包含一个有效步骤".into()));
        }
        Ok(serde_json::json!({
            "failed_item_id": failed_item_id,
            "new_steps": normalized,
        }))
    }
}

// ─── 工厂 ─────────────────────────────────────────────────────

/// 构造 A4 计划工具集合（注册进 Rust ToolBus 用）
pub fn plan_tools() -> Vec<Arc<dyn Tool>> {
    vec![
        Arc::new(PlanCreateTool),
        Arc::new(PlanUpdateTool),
        Arc::new(PlanReplanTool),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn plan_create_normalizes_items_with_ids() {
        let tool = PlanCreateTool;
        let result = tool
            .execute(serde_json::json!({
                "plan": [
                    { "title": "第一步", "description": "调研" },
                    { "title": "第二步", "status": "in_progress" },
                    { "title": "   ", "description": "空标题应被过滤" }
                ]
            }))
            .await
            .unwrap();
        let items = result["items"].as_array().unwrap();
        assert_eq!(items.len(), 2, "空标题步骤应被过滤");
        assert_eq!(items[0]["title"], "第一步");
        assert_eq!(items[0]["status"], "pending", "默认 pending");
        assert_eq!(items[0]["description"], "调研");
        assert!(items[0]["id"].as_str().unwrap().starts_with("plan-item-"));
        assert_eq!(items[1]["status"], "in_progress");
        assert_eq!(items[1]["order"], 1);
    }

    #[tokio::test]
    async fn plan_create_missing_plan_returns_args_error() {
        let tool = PlanCreateTool;
        let result = tool.execute(serde_json::json!({})).await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[tokio::test]
    async fn plan_create_empty_plan_returns_args_error() {
        let tool = PlanCreateTool;
        let result = tool.execute(serde_json::json!({ "plan": [] })).await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[tokio::test]
    async fn plan_update_echoes_item_and_status() {
        let tool = PlanUpdateTool;
        let result = tool
            .execute(serde_json::json!({ "item_id": "plan-item-1-0", "status": "completed" }))
            .await
            .unwrap();
        assert_eq!(result["item_id"], "plan-item-1-0");
        assert_eq!(result["status"], "completed");
    }

    #[tokio::test]
    async fn plan_update_invalid_status_returns_args_error() {
        let tool = PlanUpdateTool;
        let result = tool
            .execute(serde_json::json!({ "item_id": "x", "status": "bogus" }))
            .await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[tokio::test]
    async fn plan_update_missing_item_id_returns_args_error() {
        let tool = PlanUpdateTool;
        let result = tool.execute(serde_json::json!({ "status": "completed" })).await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[tokio::test]
    async fn plan_replan_echoes_failed_id_and_normalizes_steps() {
        let tool = PlanReplanTool;
        let result = tool
            .execute(serde_json::json!({
                "failed_item_id": "plan-item-1-1",
                "new_steps": [
                    { "title": "重规划一", "description": "补做" },
                    { "title": "   ", "description": "空标题应被过滤" },
                    { "title": "重规划二" }
                ]
            }))
            .await
            .unwrap();
        assert_eq!(result["failed_item_id"], "plan-item-1-1");
        let steps = result["new_steps"].as_array().unwrap();
        assert_eq!(steps.len(), 2, "空标题步骤应被过滤");
        assert_eq!(steps[0]["title"], "重规划一");
        assert_eq!(steps[0]["description"], "补做");
        assert_eq!(steps[1]["title"], "重规划二");
    }

    #[tokio::test]
    async fn plan_replan_missing_failed_id_returns_args_error() {
        let tool = PlanReplanTool;
        let result = tool
            .execute(serde_json::json!({ "new_steps": [{ "title": "X" }] }))
            .await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }

    #[tokio::test]
    async fn plan_replan_empty_steps_returns_args_error() {
        let tool = PlanReplanTool;
        let result = tool
            .execute(serde_json::json!({ "failed_item_id": "x", "new_steps": [] }))
            .await;
        assert!(matches!(result, Err(ToolError::ArgsParse(_))));
    }
}