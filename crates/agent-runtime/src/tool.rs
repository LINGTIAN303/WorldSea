//! # 工具与工具总线
//!
//! 对应 TS 版 `packages/agent-core/src/bus/` 的 ToolBus。
//! 阶段 1.3 提供最小可用实现，阶段 1.4 扩展 MCP/别名/按服务器注销。
//!
//! ## 阶段划分
//! - **阶段 1.3**：`Tool` trait + `ToolBus` trait + `SimpleToolBus`（仅内部工具注册/调用）
//! - **阶段 1.4（本模块扩展）**：
//!   - MCP 服务器工具批量注册（`register_mcp_tools` / `unregister_mcp_server`）
//!   - 别名系统（`resolve_alias`，调用前透明映射旧名→新名）
//!   - 工具调用前自动解析别名（`call_tool` / `get_by_name` 内置）
//!
//! ## 设计原则
//! - **异步优先**：`Tool::execute` 使用 `async_trait`，为 IO 密集型工具（文件/网络/数据库）做准备
//! - **Arc 共享**：工具以 `Arc<dyn Tool>` 注册，可在多个 Agent/节点间共享
//! - **JSON Schema**：参数定义用 `serde_json::Value` 承载 JSON Schema，与 OpenAI/Anthropic 工具规范对齐
//! - **错误隔离**：单个工具执行失败不会影响 ToolBus 稳定性
//! - **向后兼容**：`ToolBus` trait 新增方法均带默认实现，不破坏现有实现者

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::alias::resolve_alias as resolve_alias_global;

// ─── 工具定义 ────────────────────────────────────────────

/// 工具元数据快照（用于序列化给 LLM）
///
/// 对应 TS 版 `ToolDefinition` 的元数据部分（不含 execute 函数）。
/// LLM 调用工具时只需看到 name/description/parameters 三元组。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolDefinition {
    /// 工具名称（唯一标识，LLM 调用时使用）
    pub name: String,
    /// 工具描述（LLM 据此判断何时调用）
    pub description: String,
    /// 参数 JSON Schema（OpenAI/Anthropic 工具规范格式）
    ///
    /// 示例：
    /// ```json
    /// {
    ///   "type": "object",
    ///   "properties": {
    ///     "path": { "type": "string", "description": "文件路径" }
    ///   },
    ///   "required": ["path"]
    /// }
    /// ```
    pub parameters: serde_json::Value,
}

// ─── Tool trait ────────────────────────────────────────────

/// 工具接口 — 所有工具实现此 trait
///
/// 实现示例：
/// - `ReadFileTool`：读取本地文件
/// - `WriteFileTool`：写入本地文件
/// - `RunCommandTool`：执行 shell 命令
/// - `SearchCodebaseTool`：调用检索引擎
///
/// # 注册到 ToolBus
/// ```rust,ignore
/// let mut bus = SimpleToolBus::new();
/// bus.register(Arc::new(ReadFileTool::new())).await;
/// ```
#[async_trait]
pub trait Tool: Send + Sync {
    /// 工具名称（唯一标识）
    fn name(&self) -> &str;

    /// 工具描述（供 LLM 判断何时调用）
    fn description(&self) -> &str;

    /// 参数 JSON Schema
    fn parameters(&self) -> serde_json::Value;

    /// 执行工具
    ///
    /// # 参数
    /// - `args`：LLM 生成的调用参数（已解析为 JSON Value）
    ///
    /// # 返回
    /// 工具执行结果（JSON Value，将被序列化为字符串回传给 LLM）
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError>;

    /// 生成工具定义快照（默认实现，供 ToolBus::list_all 使用）
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── ToolBus trait ────────────────────────────────────────────

/// 工具总线 — 工具注册/查询/调用的统一入口
///
/// 阶段 1.3 提供基础接口，阶段 1.4 扩展 MCP 批量注册/按服务器注销/别名解析。
///
/// ## 别名解析
/// `call_tool` / `get_by_name` / `unregister` 应在内部先调用 `resolve_alias`
/// 把旧工具名（如 `fs_read`）映射为新名（如 `read_file`）。
/// 默认实现通过 [`crate::alias::resolve_alias`] 完成，无需各自实现。
#[async_trait]
pub trait ToolBus: Send + Sync {
    /// 注册工具（同名工具会被覆盖）
    async fn register(&self, tool: Arc<dyn Tool>);

    /// 注销工具（自动解析别名）
    async fn unregister(&self, name: &str);

    /// 按名称查询工具定义（自动解析别名）
    async fn get_by_name(&self, name: &str) -> Option<ToolDefinition>;

    /// 列出所有工具定义（供 LLM 作为 tools 参数）
    async fn list_all(&self) -> Vec<ToolDefinition>;

    /// 调用工具（自动解析别名）
    ///
    /// # 参数
    /// - `name`：工具名称（可为旧别名，会自动映射）
    /// - `args`：调用参数（JSON Value）
    ///
    /// # 返回
    /// 工具执行结果
    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError>;

    /// 已注册工具数量
    async fn count(&self) -> usize;

    // ─── 阶段 1.4 扩展方法（带默认实现，向后兼容） ───────────────────────────

    /// 批量注册 MCP 服务器工具
    ///
    /// 将同一 `server_id` 下的多个工具一起注册，并记录归属关系，
    /// 便于后续 [`unregister_mcp_server`] 按服务器注销。
    ///
    /// 默认实现：逐个调用 `register`，不记录 server_id 归属
    /// （会导致 `unregister_mcp_server` 无法工作，建议具体实现覆写）。
    async fn register_mcp_tools(&self, _server_id: String, tools: Vec<Arc<dyn Tool>>) {
        for tool in tools {
            self.register(tool).await;
        }
    }

    /// 按服务器 ID 注销所有 MCP 工具
    ///
    /// 默认实现：无操作。具体实现需在 `register_mcp_tools` 中记录
    /// `server_id → [tool_name]` 映射，此处按映射批量删除。
    async fn unregister_mcp_server(&self, _server_id: &str) {}

    /// 解析工具名别名
    ///
    /// 默认实现调用全局 [`crate::alias::resolve_alias`]，
    /// 把旧名（如 `fs_read`）映射为新名（如 `read_file`）。
    /// 若需自定义别名表，可覆写此方法。
    fn resolve_alias(&self, name: &str) -> String {
        resolve_alias_global(name).to_string()
    }
}

// ─── SimpleToolBus 实现 ────────────────────────────────────────────

/// 默认工具总线 — 基于 `HashMap` 的简单实现
///
/// 阶段 1.3：基础工具注册/调用
/// 阶段 1.4：扩展 MCP 批量注册/按服务器注销/别名自动解析
///
/// # 字段
/// - `tools`：工具名 → 工具实例的映射
/// - `mcp_servers`：MCP 服务器 ID → 工具名列表的映射（用于按服务器注销）
pub struct SimpleToolBus {
    tools: RwLock<HashMap<String, Arc<dyn Tool>>>,
    mcp_servers: RwLock<HashMap<String, Vec<String>>>,
}

impl SimpleToolBus {
    /// 创建空的工具总线
    pub fn new() -> Self {
        Self {
            tools: RwLock::new(HashMap::new()),
            mcp_servers: RwLock::new(HashMap::new()),
        }
    }

    /// 从已有工具列表创建（不含 MCP 服务器归属信息）
    pub fn with_tools(tools: Vec<Arc<dyn Tool>>) -> Self {
        let mut map = HashMap::with_capacity(tools.len());
        for t in tools {
            map.insert(t.name().to_string(), t);
        }
        Self {
            tools: RwLock::new(map),
            mcp_servers: RwLock::new(HashMap::new()),
        }
    }
}

impl Default for SimpleToolBus {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ToolBus for SimpleToolBus {
    async fn register(&self, tool: Arc<dyn Tool>) {
        let name = tool.name().to_string();
        self.tools.write().await.insert(name, tool);
    }

    async fn unregister(&self, name: &str) {
        // 先解析别名，再删除
        let resolved = self.resolve_alias(name);
        self.tools.write().await.remove(&resolved);
    }

    async fn get_by_name(&self, name: &str) -> Option<ToolDefinition> {
        // 先解析别名
        let resolved = self.resolve_alias(name);
        self.tools
            .read()
            .await
            .get(&resolved)
            .map(|t| t.definition())
    }

    async fn list_all(&self) -> Vec<ToolDefinition> {
        self.tools
            .read()
            .await
            .values()
            .map(|t| t.definition())
            .collect()
    }

    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // 先解析别名（旧名 → 新名）
        let resolved = self.resolve_alias(name);
        let tool = self
            .tools
            .read()
            .await
            .get(&resolved)
            .cloned()
            // 错误信息用原始 name（便于排查调用方传了什么）
            .ok_or_else(|| ToolError::NotFound(name.to_string()))?;
        tool.execute(args).await
    }

    async fn count(&self) -> usize {
        self.tools.read().await.len()
    }

    // ─── 阶段 1.4：MCP 批量注册/按服务器注销 ───────────────────────────

    async fn register_mcp_tools(&self, server_id: String, tools: Vec<Arc<dyn Tool>>) {
        let mut names = Vec::with_capacity(tools.len());
        // 先注册所有工具，收集工具名列表
        {
            let mut tool_map = self.tools.write().await;
            for tool in tools {
                let name = tool.name().to_string();
                names.push(name.clone());
                tool_map.insert(name, tool);
            }
        }
        // 再记录 server_id → [tool_name] 归属关系（避免同时持有两个写锁）
        // 若同 server_id 重复注册，覆盖旧记录（旧工具已被新工具覆盖注册）
        self.mcp_servers.write().await.insert(server_id, names);
    }

    async fn unregister_mcp_server(&self, server_id: &str) {
        let names = self.mcp_servers.write().await.remove(server_id);
        if let Some(names) = names {
            let mut tools = self.tools.write().await;
            for name in names {
                tools.remove(&name);
            }
        }
    }
}

// ─── WhitelistToolBus：按白名单过滤的工具总线包装器 ────────────────

/// 按白名单过滤工具视图的 ToolBus 包装器
///
/// 用于子 Agent 编排：当 `SubAgentSpec.tools_whitelist` 指定时，把子 Agent
/// 看到的工具集限制为白名单内的工具，实现子 Agent 工具隔离（阶段 1.4 扩展点）。
///
/// # 行为
/// - `list_all` / `get_by_name` / `call_tool` / `count` 仅对白名单内工具生效
/// - `register` / `unregister` / `register_mcp_tools` / `unregister_mcp_server`
///   透传到内层总线（子 Agent 通常不注册工具，透传保证完整性）
/// - 白名单为空集合时等价于"无任何工具"
pub struct WhitelistToolBus {
    inner: Arc<dyn ToolBus>,
    allowed: RwLock<HashSet<String>>,
}

impl WhitelistToolBus {
    /// 用白名单工具名集合包装内层总线
    pub fn new(inner: Arc<dyn ToolBus>, whitelist: Vec<String>) -> Self {
        Self {
            inner,
            allowed: RwLock::new(whitelist.into_iter().collect()),
        }
    }
}

#[async_trait]
impl ToolBus for WhitelistToolBus {
    async fn register(&self, tool: Arc<dyn Tool>) {
        self.inner.register(tool).await;
    }

    async fn unregister(&self, name: &str) {
        self.inner.unregister(name).await;
    }

    async fn get_by_name(&self, name: &str) -> Option<ToolDefinition> {
        let resolved = self.resolve_alias(name);
        if self.allowed.read().await.contains(&resolved) {
            self.inner.get_by_name(&resolved).await
        } else {
            None
        }
    }

    async fn list_all(&self) -> Vec<ToolDefinition> {
        let allowed = self.allowed.read().await;
        self.inner
            .list_all()
            .await
            .into_iter()
            .filter(|def| allowed.contains(&def.name))
            .collect()
    }

    async fn call_tool(
        &self,
        name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let resolved = self.resolve_alias(name);
        if self.allowed.read().await.contains(&resolved) {
            self.inner.call_tool(&resolved, args).await
        } else {
            Err(ToolError::NotFound(name.to_string()))
        }
    }

    async fn count(&self) -> usize {
        let allowed = self.allowed.read().await;
        self.inner
            .list_all()
            .await
            .into_iter()
            .filter(|def| allowed.contains(&def.name))
            .count()
    }

    async fn register_mcp_tools(&self, server_id: String, tools: Vec<Arc<dyn Tool>>) {
        self.inner.register_mcp_tools(server_id, tools).await;
    }

    async fn unregister_mcp_server(&self, server_id: &str) {
        self.inner.unregister_mcp_server(server_id).await;
    }
}

// ─── 工具错误 ────────────────────────────────────────────

/// 工具错误
#[derive(Debug, thiserror::Error)]
pub enum ToolError {
    #[error("工具不存在: {0}")]
    NotFound(String),

    #[error("参数解析失败: {0}")]
    ArgsParse(String),

    #[error("工具执行失败: {0}")]
    Execution(String),

    #[error("工具超时")]
    Timeout,

    #[error("工具被中止")]
    Aborted,

    #[error("其他错误: {0}")]
    Other(String),
}

// ─── 测试用的 Echo 工具 ────────────────────────────────────────────

/// Echo 工具 — 测试用，原样返回输入参数
pub struct EchoTool;

#[async_trait]
impl Tool for EchoTool {
    fn name(&self) -> &str {
        "echo"
    }

    fn description(&self) -> &str {
        "回显输入参数（测试用）"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "要回显的消息"
                }
            },
            "required": ["message"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_and_get_by_name() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(EchoTool)).await;

        let def = bus.get_by_name("echo").await.expect("应找到 echo 工具");
        assert_eq!(def.name, "echo");
        assert_eq!(def.description, "回显输入参数（测试用）");
    }

    #[tokio::test]
    async fn get_by_name_missing_returns_none() {
        let bus = SimpleToolBus::new();
        let result = bus.get_by_name("nonexistent").await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn list_all_returns_all_definitions() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(EchoTool)).await;
        let list = bus.list_all().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "echo");
    }

    #[tokio::test]
    async fn call_tool_returns_args_unchanged() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(EchoTool)).await;

        let args = serde_json::json!({"message": "hello"});
        let result = bus.call_tool("echo", args.clone()).await.expect("应执行成功");
        assert_eq!(result, args);
    }

    #[tokio::test]
    async fn call_missing_tool_returns_not_found_error() {
        let bus = SimpleToolBus::new();
        let result = bus.call_tool("missing", serde_json::json!({})).await;
        assert!(result.is_err());
        match result {
            Err(ToolError::NotFound(name)) => assert_eq!(name, "missing"),
            _ => panic!("应为 NotFound 错误"),
        }
    }

    #[tokio::test]
    async fn unregister_removes_tool() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(EchoTool)).await;
        assert_eq!(bus.count().await, 1);

        bus.unregister("echo").await;
        assert_eq!(bus.count().await, 0);
        assert!(bus.get_by_name("echo").await.is_none());
    }

    #[tokio::test]
    async fn register_same_name_overwrites() {
        let bus = SimpleToolBus::new();
        bus.register(Arc::new(EchoTool)).await;
        bus.register(Arc::new(EchoTool)).await;
        // 同名覆盖，仍然只有 1 个
        assert_eq!(bus.count().await, 1);
    }

    #[tokio::test]
    async fn with_tools_initializes_from_list() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool)];
        let bus = SimpleToolBus::with_tools(tools);
        assert_eq!(bus.count().await, 1);
    }

    #[test]
    fn tool_definition_serializes_to_json() {
        let def = ToolDefinition {
            name: "echo".to_string(),
            description: "回显".to_string(),
            parameters: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_string(&def).unwrap();
        assert!(json.contains("\"name\":\"echo\""));
        assert!(json.contains("\"description\":\"回显\""));
    }

    // ─── WhitelistToolBus 单元测试 ────────────────────────────────

    #[tokio::test]
    async fn whitelist_filters_list_all_and_count() {
        let inner = SimpleToolBus::new();
        inner.register(Arc::new(EchoTool)).await;
        inner.register(Arc::new(EchoTool)).await; // 第二个同名，覆盖，仍 1 个
        // 再注册一个额外工具占位，验证白名单过滤
        inner.register(Arc::new(PlaceholderTool("extra"))).await;

        let wl = WhitelistToolBus::new(Arc::new(inner), vec!["echo".to_string()]);
        let list = wl.list_all().await;
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "echo");
        assert_eq!(wl.count().await, 1);
    }

    #[tokio::test]
    async fn whitelist_blocks_non_whitelisted_tool() {
        let inner = SimpleToolBus::new();
        inner.register(Arc::new(EchoTool)).await;
        inner.register(Arc::new(PlaceholderTool("extra"))).await;

        let wl = WhitelistToolBus::new(Arc::new(inner), vec!["extra".to_string()]);
        // 白名单内可调用
        assert!(wl.call_tool("extra", serde_json::json!({})).await.is_ok());
        // 白名单外 get_by_name 返回 None
        assert!(wl.get_by_name("echo").await.is_none());
        // 白名单外 call_tool 返回 NotFound
        match wl.call_tool("echo", serde_json::json!({})).await {
            Err(ToolError::NotFound(name)) => assert_eq!(name, "echo"),
            _ => panic!("应返回 NotFound"),
        }
    }

    #[tokio::test]
    async fn whitelist_empty_means_no_tools() {
        let inner = SimpleToolBus::new();
        inner.register(Arc::new(EchoTool)).await;
        let wl = WhitelistToolBus::new(Arc::new(inner), vec![]);
        assert_eq!(wl.count().await, 0);
        assert!(wl.list_all().await.is_empty());
    }
}

#[cfg(test)]
/// 测试用占位工具 — 用于验证白名单过滤（不被白名单包含时不可见）
struct PlaceholderTool(&'static str);

#[async_trait]
impl Tool for PlaceholderTool {
    fn name(&self) -> &str {
        self.0
    }
    fn description(&self) -> &str {
        "占位工具（测试用）"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        Ok(args)
    }
}
