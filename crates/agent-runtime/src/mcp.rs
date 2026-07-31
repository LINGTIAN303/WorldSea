//! # MCP 工具适配器 — 把 MCP 服务器工具包装为 `Tool` trait
//!
//! 对应 TS 版 `worldsmith-agent/src/mcp/mcp-adapter.ts` 的 `MCPToolAdapter`。
//!
//! ## 设计
//! - `McpCaller` trait：抽象 MCP 服务器调用入口（HTTP/SSE/stdio 等传输层由上层注入）
//! - `McpTool`：实现 `Tool` trait，持有 `server_id` + `tool_name` + `Arc<dyn McpCaller>`
//! - `McpToolAdapter`：把 `McpToolInfo`（元数据）转换为 `McpTool` 实例
//!
//! ## 工具命名规则
//! 与 TS 版一致：`mcp_{server_id}_{tool_name}`
//! - 不同 server_id 下同名工具天然不冲突
//! - 前缀 `mcp_` 便于在日志/事件中识别
//!
//! ## 阶段边界
//! - **阶段 1.4（本模块）**：仅提供 trait 与适配器，不实现具体传输层
//! - **阶段 1.5+**：在 Tauri 集成时实现 `McpCaller` 的 HTTP/SSE 传输

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

use crate::tool::{Tool, ToolError};

// ─── MCP 类型定义 ────────────────────────────────────────────

/// MCP 工具元信息（从 MCP 服务器 `tools/list` 响应解析）
///
/// 对应 TS 版 `MCPToolInfo`，参考 MCP 协议规范。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolInfo {
    /// MCP 服务器上报的工具名（不含 `mcp_{server_id}_` 前缀）
    pub name: String,
    /// 工具描述
    pub description: String,
    /// 输入参数 JSON Schema
    pub input_schema: Value,
}

/// MCP 服务器配置（HTTP/SSE 模式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// 服务器 ID（唯一标识，用于工具名前缀和注销）
    pub server_id: String,
    /// 服务器 URL
    pub url: String,
    /// 自定义请求头
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

// ─── McpCaller trait ────────────────────────────────────────────

/// MCP 服务器调用入口 — 由上层（Tauri/HTTP 客户端）注入实现
///
/// # 设计意图
/// 本 trait 只定义"如何调用 MCP 服务器上的工具"，
/// 不关心传输层细节（HTTP/SSE/stdio）。
/// 阶段 1.4 不提供具体实现，由阶段 1.5+ 在 Tauri 集成时注入。
#[async_trait]
pub trait McpCaller: Send + Sync {
    /// 调用 MCP 服务器上的工具
    ///
    /// # 参数
    /// - `name`：工具名（不含前缀，原样传给 MCP 服务器）
    /// - `args`：调用参数（JSON Value）
    ///
    /// # 返回
    /// 工具执行结果（MCP 协议的 `result.content` 已提取为 JSON Value）
    async fn call_tool(
        &self,
        name: &str,
        args: Value,
    ) -> Result<Value, McpError>;

    /// 列出 MCP 服务器上的所有工具
    ///
    /// 默认实现返回 `NotImplemented`，由具体传输层覆写。
    async fn list_tools(&self) -> Result<Vec<McpToolInfo>, McpError> {
        Err(McpError::NotImplemented("list_tools".into()))
    }
}

/// MCP 错误类型
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("MCP 服务器错误: {0}")]
    Server(String),

    #[error("MCP 网络错误: {0}")]
    Network(String),

    #[error("MCP 工具不存在: {0}")]
    ToolNotFound(String),

    #[error("MCP 响应解析失败: {0}")]
    Parse(String),

    #[error("MCP 调用超时")]
    Timeout,

    #[error("MCP 功能未实现: {0}")]
    NotImplemented(String),

    #[error("MCP 其他错误: {0}")]
    Other(String),
}

// ─── McpTool — Tool trait 实现 ────────────────────────────────────────────

/// MCP 工具 — 包装远程 MCP 服务器上的工具为本地 `Tool` trait 对象
///
/// # 字段
/// - `full_name`：预存的完整工具名（含 `mcp_{server_id}_` 前缀）
///   预存是为了让 `name() -> &str` 能直接返回引用，避免每次构造新 String
/// - `server_id`：所属 MCP 服务器 ID
/// - `tool_name`：MCP 服务器上的原始工具名
/// - `description`：工具描述
/// - `input_schema`：参数 JSON Schema
/// - `caller`：MCP 服务器调用入口
///
/// # 构造方式
/// 通过 [`McpToolAdapter::adapt`] 创建，确保 `full_name` 与 `server_id`/`tool_name` 一致。
/// `McpTool::new` 也公开，便于自定义场景手动构造。
pub struct McpTool {
    /// 预存的完整工具名（含 `mcp_{server_id}_` 前缀）
    full_name: String,
    /// 服务器 ID（用于工具名前缀和注销）
    server_id: String,
    /// MCP 服务器上的原始工具名
    tool_name: String,
    /// 工具描述
    description: String,
    /// 参数 JSON Schema
    input_schema: Value,
    /// MCP 服务器调用入口
    caller: Arc<dyn McpCaller>,
}

impl McpTool {
    /// 创建新的 MCP 工具（自动构建 `full_name` 字段）
    ///
    /// # 参数
    /// - `server_id`：所属 MCP 服务器 ID
    /// - `tool_name`：MCP 服务器上的原始工具名（不含前缀）
    /// - `description`：工具描述
    /// - `input_schema`：参数 JSON Schema
    /// - `caller`：MCP 服务器调用入口
    pub fn new(
        server_id: impl Into<String>,
        tool_name: impl Into<String>,
        description: impl Into<String>,
        input_schema: Value,
        caller: Arc<dyn McpCaller>,
    ) -> Self {
        let server_id = server_id.into();
        let tool_name = tool_name.into();
        let full_name = format!("mcp_{}_{}", server_id, tool_name);
        Self {
            full_name,
            server_id,
            tool_name,
            description: description.into(),
            input_schema,
            caller,
        }
    }

    /// 工具的全名（含前缀）
    ///
    /// 规则：`mcp_{server_id}_{tool_name}`
    pub fn full_name(&self) -> &str {
        &self.full_name
    }

    /// 所属服务器 ID
    pub fn server_id(&self) -> &str {
        &self.server_id
    }

    /// 原始工具名（不含前缀）
    pub fn tool_name(&self) -> &str {
        &self.tool_name
    }
}

#[async_trait]
impl Tool for McpTool {
    fn name(&self) -> &str {
        // 直接返回预存的 full_name，避免 &str 生命周期问题
        &self.full_name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn parameters(&self) -> Value {
        self.input_schema.clone()
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        // 调用 MCP 服务器上的工具（用原始名，不含前缀）
        self.caller
            .call_tool(&self.tool_name, args)
            .await
            .map_err(|e| ToolError::Execution(format!("MCP 调用失败: {e}")))
    }
}

// ─── McpToolAdapter ────────────────────────────────────────────

/// MCP 工具适配器 — 把 `McpToolInfo` 转换为 `McpTool` 实例
///
/// 对应 TS 版 `MCPToolAdapter.adapt()` / `adaptAll()`。
pub struct McpToolAdapter;

impl McpToolAdapter {
    /// 适配单个 MCP 工具
    ///
    /// # 参数
    /// - `tool_info`：MCP 服务器上报的工具元信息
    /// - `server_id`：所属 MCP 服务器 ID
    /// - `caller`：MCP 服务器调用入口
    ///
    /// # 返回
    /// 可注册到 `ToolBus` 的 `McpTool` 实例（以 `Arc<dyn Tool>` 形式）
    pub fn adapt(
        tool_info: McpToolInfo,
        server_id: impl Into<String> + Clone,
        caller: Arc<dyn McpCaller>,
    ) -> Arc<dyn Tool> {
        let server_id_owned = server_id.into();
        let description = Self::build_description(&tool_info.description, &server_id_owned);

        Arc::new(McpTool::new(
            server_id_owned,
            tool_info.name,
            description,
            tool_info.input_schema,
            caller,
        ))
    }

    /// 批量适配 MCP 工具
    ///
    /// 对应 TS 版 `MCPToolAdapter.adaptAll()`。
    pub fn adapt_all(
        tools: Vec<McpToolInfo>,
        server_id: impl Into<String> + Clone,
        caller: Arc<dyn McpCaller>,
    ) -> Vec<Arc<dyn Tool>> {
        let server_id_owned = server_id.into();
        tools
            .into_iter()
            .map(|info| {
                Self::adapt(
                    info,
                    server_id_owned.clone(),
                    caller.clone(),
                )
            })
            .collect()
    }

    /// 构建工具描述（加 `[MCP:{server_id}]` 前缀）
    ///
    /// 对应 TS 版 `buildMcpDescription()`。
    fn build_description(base: &str, server_id: &str) -> String {
        format!("[MCP:{}] {}", server_id, base)
    }
}

// ─── Mock 实现（用于测试） ────────────────────────────────────────────

/// 测试用的 Mock MCP 调用器
pub struct MockMcpCaller {
    /// 工具名 → 预设响应
    responses: RwLock<HashMap<String, Value>>,
}

impl MockMcpCaller {
    pub fn new() -> Self {
        Self {
            responses: RwLock::new(HashMap::new()),
        }
    }

    /// 注册预设响应
    pub async fn set_response(&self, tool_name: impl Into<String>, response: Value) {
        self.responses.write().await.insert(tool_name.into(), response);
    }
}

impl Default for MockMcpCaller {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl McpCaller for MockMcpCaller {
    async fn call_tool(&self, name: &str, args: Value) -> Result<Value, McpError> {
        let map = self.responses.read().await;
        match map.get(name) {
            Some(resp) => {
                // 把 args 也回显，便于测试验证
                Ok(serde_json::json!({
                    "tool": name,
                    "args": args,
                    "result": resp,
                }))
            }
            None => Err(McpError::ToolNotFound(name.to_string())),
        }
    }

    async fn list_tools(&self) -> Result<Vec<McpToolInfo>, McpError> {
        // 默认返回空列表，测试中可覆写
        Ok(Vec::new())
    }
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool::ToolBus;

    #[test]
    fn adapt_creates_tool_with_prefixed_name() {
        let info = McpToolInfo {
            name: "get_weather".into(),
            description: "Get weather".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let caller: Arc<dyn McpCaller> = Arc::new(MockMcpCaller::new());
        let tool = McpToolAdapter::adapt(info, "test-server", caller);

        assert_eq!(tool.name(), "mcp_test-server_get_weather");
        assert_eq!(tool.description(), "[MCP:test-server] Get weather");
    }

    #[test]
    fn adapt_all_creates_multiple_tools() {
        let infos = vec![
            McpToolInfo {
                name: "tool_a".into(),
                description: "Tool A".into(),
                input_schema: serde_json::json!({"type": "object"}),
            },
            McpToolInfo {
                name: "tool_b".into(),
                description: "Tool B".into(),
                input_schema: serde_json::json!({"type": "object"}),
            },
        ];
        let caller: Arc<dyn McpCaller> = Arc::new(MockMcpCaller::new());
        let tools = McpToolAdapter::adapt_all(infos, "srv", caller);

        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0].name(), "mcp_srv_tool_a");
        assert_eq!(tools[1].name(), "mcp_srv_tool_b");
    }

    #[tokio::test]
    async fn mcp_tool_execute_calls_caller() {
        let caller = Arc::new(MockMcpCaller::new());
        caller
            .set_response("get_weather", serde_json::json!({"temp": 25}))
            .await;

        let info = McpToolInfo {
            name: "get_weather".into(),
            description: "Get weather".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let tool = McpToolAdapter::adapt(info, "test", caller);

        let args = serde_json::json!({"city": "Beijing"});
        let result = tool.execute(args.clone()).await.expect("应执行成功");

        assert_eq!(result["tool"], "get_weather");
        assert_eq!(result["args"], args);
        assert_eq!(result["result"]["temp"], 25);
    }

    #[tokio::test]
    async fn mcp_tool_execute_returns_error_on_missing_tool() {
        let caller: Arc<dyn McpCaller> = Arc::new(MockMcpCaller::new());

        let info = McpToolInfo {
            name: "missing_tool".into(),
            description: "Missing".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let tool = McpToolAdapter::adapt(info, "test", caller);

        let result = tool.execute(serde_json::json!({})).await;
        assert!(result.is_err());
        match result {
            Err(ToolError::Execution(msg)) => assert!(msg.contains("MCP 调用失败")),
            _ => panic!("应为 Execution 错误"),
        }
    }

    #[tokio::test]
    async fn mcp_tool_can_be_registered_in_toolbus() {
        use crate::tool::SimpleToolBus;

        let caller = Arc::new(MockMcpCaller::new());
        caller
            .set_response("search", serde_json::json!({"results": []}))
            .await;

        let info = McpToolInfo {
            name: "search".into(),
            description: "Search".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let tool = McpToolAdapter::adapt(info, "firecrawl-keyless", caller);

        let bus = SimpleToolBus::new();
        bus.register(tool).await;

        assert_eq!(bus.count().await, 1);

        let def = bus
            .get_by_name("mcp_firecrawl-keyless_search")
            .await
            .expect("应找到工具");
        assert_eq!(def.name, "mcp_firecrawl-keyless_search");
        assert!(def.description.contains("[MCP:firecrawl-keyless]"));
    }

    #[test]
    fn build_description_adds_prefix() {
        let desc = McpToolAdapter::build_description("Get weather", "test-srv");
        assert_eq!(desc, "[MCP:test-srv] Get weather");
    }

    #[tokio::test]
    async fn mock_mcp_caller_returns_not_found_for_unregistered() {
        let caller = MockMcpCaller::new();
        let result = caller
            .call_tool("unknown", serde_json::json!({}))
            .await;
        assert!(result.is_err());
        match result {
            Err(McpError::ToolNotFound(name)) => assert_eq!(name, "unknown"),
            _ => panic!("应为 ToolNotFound 错误"),
        }
    }

    #[tokio::test]
    async fn mock_mcp_caller_returns_registered_response() {
        let caller = MockMcpCaller::new();
        caller
            .set_response("hello", serde_json::json!({"message": "world"}))
            .await;

        let result = caller
            .call_tool("hello", serde_json::json!({"name": "test"}))
            .await
            .expect("应执行成功");

        assert_eq!(result["tool"], "hello");
        assert_eq!(result["result"]["message"], "world");
    }

    #[test]
    fn mcp_tool_info_serializes_correctly() {
        let info = McpToolInfo {
            name: "test".into(),
            description: "Test tool".into(),
            input_schema: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_string(&info).expect("序列化应成功");
        assert!(json.contains("\"name\":\"test\""));
        assert!(json.contains("\"description\":\"Test tool\""));
    }
}
