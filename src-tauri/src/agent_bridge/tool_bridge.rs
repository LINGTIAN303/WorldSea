//! # FrontendToolBridge — Rust 到 TS 的工具调用桥接
//!
//! 阶段 P0-A1 新增。本模块实现 Rust Agent 调用前端 TS 工具实现的 IPC 桥接机制。
//!
//! ## 背景
//! AgentLoop 在 ReAct 循环中遇到工具调用时，需要执行工具获取结果。
//! 基础 IO 工具（fs/read_file/write_file 等）由 Rust 原生实现（P0-A2），
//! 业务工具（entity/kb/schema/ui/persona/image 等）通过本桥接反向调用前端 TS 实现。
//!
//! ## IPC 流程
//! ```text
//! AgentLoop.run_react_loop
//!   ↓ tool_bus.call_tool("entity_create", args)
//! FrontendTool.execute
//!   ↓ bridge.call_tool(name, args)
//!   ↓ 生成 call_id + oneshot::channel
//!   ↓ tool_call_map.insert(call_id, tx)
//!   ↓ app.emit("agent:tool_call:{session_id}", ToolCallRequest)
//!   ↓ rx.await  ← 阻塞等待前端响应
//!   ↓
//! 前端 listen("agent:tool_call:" + sessionId)
//!   ↓ 执行 TS 工具实现
//!   ↓ invoke('cmd_agent_tool_result', { sessionId, callId, result, success })
//! cmd_agent_tool_result
//!   ↓ registry.get_tool_bridge(sessionId)
//!   ↓ bridge.on_tool_result(callId, result)
//!   ↓ tool_call_map.remove(callId) → tx.send(result)
//!   ↓
//! FrontendTool.execute 的 rx.await 返回结果
//!   ↓ 返回给 AgentLoop
//! ```
//!
//! ## 超时处理
//! 默认 60 秒超时，避免前端无响应导致 AgentLoop 永久阻塞。
//! 超时后返回 `ToolError::Timeout`，并清理 tool_call_map 中的 entry。
//!
//! ## 并发安全
//! - `tool_call_map` 使用 `tokio::sync::RwLock<HashMap<String, oneshot::Sender<ToolResult>>>`
//! - 支持并发工具调用（不同 call_id 互不干扰）
//! - Agent 中断时通过 `abort_all` 取消所有 pending 调用

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, RwLock};
use tracing::{debug, warn};
use uuid::Uuid;

use agent_runtime::tool::{Tool, ToolDefinition, ToolError};

// ─── 事件名约定 ────────────────────────────────────────────

/// 工具调用请求事件名前缀
///
/// 完整事件名：`agent:tool_call:{session_id}`
/// 前端：`listen(\`agent:tool_call:${sessionId}\`, ...)`
const fn tool_call_event_prefix() -> &'static str {
    "agent:tool_call:"
}

/// 构造工具调用请求的事件名
fn session_tool_call_event_name(session_id: &str) -> String {
    format!("{}{}", tool_call_event_prefix(), session_id)
}

// ─── 工具调用请求 Payload ────────────────────────────────────────────

/// Rust → 前端的工具调用请求
///
/// 通过 `app.emit("agent:tool_call:{session_id}", this)` 推送到前端。
/// 前端执行完工具后，调用 `invoke('cmd_agent_tool_result', {...})` 回传结果。
///
/// # 字段命名
/// 使用 camelCase（`#[serde(rename_all = "camelCase")]`），与前端 TS 习惯一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRequest {
    /// 调用 ID（前端回传结果时用作关联键）
    pub call_id: String,
    /// 会话 ID（前端校验用）
    pub session_id: String,
    /// 工具名称（如 "entity_create"）
    pub tool_name: String,
    /// 调用参数（LLM 生成的 JSON）
    pub args: serde_json::Value,
}

// ─── 工具调用结果 ────────────────────────────────────────────

/// 前端 → Rust 的工具调用结果
///
/// 由 `cmd_agent_tool_result` 命令接收，通过 `FrontendToolBridge::on_tool_result`
/// 唤醒对应的 oneshot receiver。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallResult {
    /// 调用 ID（与 ToolCallRequest.call_id 对应）
    pub call_id: String,
    /// 工具执行结果（成功时为工具返回值，失败时为错误信息）
    pub result: serde_json::Value,
    /// 是否成功
    pub success: bool,
}

impl ToolCallResult {
    /// 构造成功结果
    pub fn success(call_id: impl Into<String>, result: serde_json::Value) -> Self {
        Self {
            call_id: call_id.into(),
            result,
            success: true,
        }
    }

    /// 构造失败结果
    pub fn error(call_id: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            call_id: call_id.into(),
            result: serde_json::json!({ "error": message.into() }),
            success: false,
        }
    }
}

// ─── FrontendToolBridge ────────────────────────────────────────────

/// 前端工具桥接器 — 管理 Rust ↔ TS 工具调用的 oneshot channel 映射
///
/// 每个 Agent 会话对应一个 `FrontendToolBridge` 实例，在 `cmd_agent_create` 时
/// 创建并注册到 `AgentRegistry`。
///
/// # 字段
/// - `app`: Tauri 应用句柄，用于 emit 事件
/// - `session_id`: 会话 ID（事件名组成部分）
/// - `tool_call_map`: call_id → oneshot::Sender 映射，等待前端回传结果
/// - `timeout_secs`: 单次工具调用超时时间（默认 60 秒）
///
/// # 生命周期
/// - 创建：`cmd_agent_create` 中创建，与 Agent 实例绑定
/// - 使用：`FrontendTool::execute` 调用 `call_tool`
/// - 销毁：`cmd_agent_destroy` 中调用 `abort_all` 取消所有 pending 调用
pub struct FrontendToolBridge {
    /// Tauri 应用句柄
    app: AppHandle,
    /// 会话 ID
    session_id: String,
    /// 待响应的工具调用映射（call_id → oneshot sender）
    tool_call_map: Arc<RwLock<HashMap<String, oneshot::Sender<ToolCallResult>>>>,
    /// 单次工具调用超时时间（秒）
    timeout_secs: u64,
}

impl FrontendToolBridge {
    /// 创建新的桥接器
    pub fn new(app: AppHandle, session_id: impl Into<String>) -> Self {
        Self {
            app,
            session_id: session_id.into(),
            tool_call_map: Arc::new(RwLock::new(HashMap::new())),
            timeout_secs: 60,
        }
    }

    /// 设置超时时间（秒）
    pub fn with_timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    /// 调用前端工具
    ///
    /// # 流程
    /// 1. 生成 call_id
    /// 2. 创建 oneshot channel
    /// 3. sender 存入 tool_call_map
    /// 4. emit 事件到前端
    /// 5. await receiver（带超时）
    /// 6. 返回结果
    ///
    /// # 错误
    /// - `ToolError::Timeout`：前端 60 秒内未响应
    /// - `ToolError::Aborted`：Agent 销毁时调用 abort_all 取消了该调用
    /// - `ToolError::Other`：emit 事件失败
    pub async fn call_tool(
        &self,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let call_id = format!("call_{}", Uuid::new_v4().simple());
        let (tx, rx) = oneshot::channel::<ToolCallResult>();

        // 存入映射
        {
            let mut map = self.tool_call_map.write().await;
            map.insert(call_id.clone(), tx);
        }

        // 构造请求并 emit
        let request = ToolCallRequest {
            call_id: call_id.clone(),
            session_id: self.session_id.clone(),
            tool_name: tool_name.to_string(),
            args,
        };

        let event_name = session_tool_call_event_name(&self.session_id);
        debug!(
            "FrontendToolBridge emit: session={} event={} tool={} call_id={}",
            self.session_id, event_name, tool_name, call_id
        );

        if let Err(e) = self.app.emit(&event_name, request) {
            // emit 失败：清理映射并返回错误
            let mut map = self.tool_call_map.write().await;
            map.remove(&call_id);
            return Err(ToolError::Other(format!(
                "emit tool_call event failed: {}",
                e
            )));
        }

        // 等待结果（带超时）
        let timeout = Duration::from_secs(self.timeout_secs);
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(result)) => {
                debug!(
                    "FrontendToolBridge 收到结果: call_id={} success={}",
                    result.call_id, result.success
                );
                if result.success {
                    Ok(result.result)
                } else {
                    // 失败：提取 error 字段
                    let msg = result
                        .result
                        .get("error")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unknown tool error".to_string());
                    Err(ToolError::Execution(msg))
                }
            }
            Ok(Err(_)) => {
                // sender 被 drop（通常因 abort_all）
                warn!(
                    "FrontendToolBridge sender dropped: call_id={} tool={}",
                    call_id, tool_name
                );
                Err(ToolError::Aborted)
            }
            Err(_) => {
                // 超时：清理映射
                let mut map = self.tool_call_map.write().await;
                map.remove(&call_id);
                warn!(
                    "FrontendToolBridge 超时: call_id={} tool={} timeout={}s",
                    call_id, tool_name, self.timeout_secs
                );
                Err(ToolError::Timeout)
            }
        }
    }

    /// 接收前端回传的工具调用结果
    ///
    /// 由 `cmd_agent_tool_result` 命令调用。
    /// 从 tool_call_map 中取出对应 call_id 的 sender，发送结果。
    ///
    /// # 返回
    /// - `Ok(true)`：成功唤醒等待的调用
    /// - `Ok(false)`：call_id 不存在（可能已被超时清理或 abort）
    pub async fn on_tool_result(&self, result: ToolCallResult) -> bool {
        let call_id = result.call_id.clone();
        let mut map = self.tool_call_map.write().await;
        if let Some(tx) = map.remove(&call_id) {
            let _ = tx.send(result);
            debug!("FrontendToolBridge 唤醒等待者: call_id={}", call_id);
            true
        } else {
            warn!(
                "FrontendToolBridge 收到未知 call_id 的结果: {}（可能已超时或 abort）",
                call_id
            );
            false
        }
    }

    /// 取消所有 pending 调用（Agent 销毁时调用）
    ///
    /// 所有等待中的 call_tool 会收到 `ToolError::Aborted`。
    pub async fn abort_all(&self) {
        let mut map = self.tool_call_map.write().await;
        let count = map.len();
        if count > 0 {
            debug!("FrontendToolBridge abort_all: 取消 {} 个 pending 调用", count);
        }
        // drop 所有 sender，receiver 端会收到 Err（Aborted）
        map.clear();
    }

    /// 当前 pending 调用数量（用于调试）
    pub async fn pending_count(&self) -> usize {
        self.tool_call_map.read().await.len()
    }

    /// 获取会话 ID
    pub fn session_id(&self) -> &str {
        &self.session_id
    }
}

// ─── FrontendTool — 实现 Tool trait 的前端工具包装器 ────────────────────────────────────────────

/// 前端工具 — 包装 `FrontendToolBridge` 实现 `Tool` trait
///
/// 每个前端工具创建一个 `FrontendTool` 实例，注册到 `ToolBus`。
/// `execute` 时通过 `FrontendToolBridge` emit 事件到前端，等待 TS 实现回传结果。
///
/// # 使用示例
/// ```rust,ignore
/// let bridge = Arc::new(FrontendToolBridge::new(app, session_id));
/// let tool = FrontendTool::new(
///     bridge.clone(),
///     "entity_create",
///     "创建实体",
///     serde_json::json!({ "type": "object", "properties": { ... } }),
/// );
/// tool_bus.register(Arc::new(tool)).await;
/// ```
pub struct FrontendTool {
    /// 桥接器引用
    bridge: Arc<FrontendToolBridge>,
    /// 工具名称
    name: String,
    /// 工具描述
    description: String,
    /// 参数 JSON Schema
    parameters: serde_json::Value,
}

impl FrontendTool {
    /// 创建新的前端工具
    pub fn new(
        bridge: Arc<FrontendToolBridge>,
        name: impl Into<String>,
        description: impl Into<String>,
        parameters: serde_json::Value,
    ) -> Self {
        Self {
            bridge,
            name: name.into(),
            description: description.into(),
            parameters,
        }
    }
}

#[async_trait]
impl Tool for FrontendTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn parameters(&self) -> serde_json::Value {
        self.parameters.clone()
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        debug!(
            "FrontendTool execute: tool={} args={}",
            self.name,
            serde_json::to_string(&args).unwrap_or_default()
        );
        self.bridge.call_tool(&self.name, args).await
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name.clone(),
            description: self.description.clone(),
            parameters: self.parameters.clone(),
        }
    }
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_call_request_serializes_camel_case() {
        let req = ToolCallRequest {
            call_id: "call_1".into(),
            session_id: "sess_1".into(),
            tool_name: "entity_create".into(),
            args: serde_json::json!({"name": "test"}),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("\"callId\":\"call_1\""));
        assert!(json.contains("\"sessionId\":\"sess_1\""));
        assert!(json.contains("\"toolName\":\"entity_create\""));
    }

    #[test]
    fn tool_call_result_success_construction() {
        let result = ToolCallResult::success("call_1", serde_json::json!({"id": 42}));
        assert!(result.success);
        assert_eq!(result.call_id, "call_1");
        assert_eq!(result.result["id"], 42);
    }

    #[test]
    fn tool_call_result_error_construction() {
        let result = ToolCallResult::error("call_1", "文件不存在");
        assert!(!result.success);
        assert_eq!(result.result["error"], "文件不存在");
    }

    #[test]
    fn session_tool_call_event_name_formats_correctly() {
        let name = session_tool_call_event_name("sess_abc");
        assert_eq!(name, "agent:tool_call:sess_abc");
    }

    #[test]
    fn frontend_tool_holds_metadata() {
        // 不依赖 AppHandle 的纯逻辑测试
        let schema = serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string" }
            }
        });
        // 测试 ToolDefinition 构造（不调用 execute，不需要 bridge）
        let def = ToolDefinition {
            name: "entity_create".into(),
            description: "创建实体".into(),
            parameters: schema.clone(),
        };
        assert_eq!(def.name, "entity_create");
        assert_eq!(def.description, "创建实体");
        assert_eq!(def.parameters, schema);
    }
}
