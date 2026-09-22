//! 工具与工具总线（ToolBus），详细见 docs/details/注释/agent-runtime/tool.md

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::alias::resolve_alias as resolve_alias_global;

// ─── 工具元数据契约出口（C2 ToolDescriptor；定义处 = agent-engine::contracts::tool） ───

pub use agent_engine::contracts::tool::{
    Executor, RiskLevel, SideEffectScope, ToolControl, ToolDescriptor, ToolLimits, ToolSafety,
};

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
    /// 参数 JSON Schema（OpenAI/Anthropic 工具规范格式），详细见 docs/details/注释/agent-runtime/tool.md
    pub parameters: serde_json::Value,
}

// ─── Tool trait ────────────────────────────────────────────

/// 工具接口 — 所有工具实现此 trait，详细见 docs/details/注释/agent-runtime/tool.md
///
/// C2 元数据族（工具族批）：**`descriptor()` 为必填方法**（编译期强制声明——缺声明不过编译）；
/// 各工具的 `name()` / `description()` / `parameters()` 是既有的**声明面**，
/// `descriptor()` 由它们**即时装配**（零文本搬迁、零重复声明面）；`descriptor().name` 与
/// `name()` 的一致性由注册面守卫（`ToolBus::register`）强制——漂移即 panic。
/// 安全组无隐式默认（Q1 拍板：默认值即猜测源）。
#[async_trait]
pub trait Tool: Send + Sync {
    /// 工具名称（唯一标识）
    fn name(&self) -> &str;

    /// 工具描述（供 LLM 判断何时调用）
    fn description(&self) -> &str;

    /// 参数 JSON Schema
    fn parameters(&self) -> serde_json::Value;

    /// 工具描述符（C2 必填声明；定义见 `agent_engine::contracts::tool`）
    ///
    /// 实现建议：用命名构造（`ToolDescriptor::read_only` / `writes` / `guarded` / `interactive`）
    /// 装配，并以 `self.name()` / `self.description()` / `self.parameters()` 作为身份与 Schema 来源。
    fn descriptor(&self) -> ToolDescriptor;

    /// 执行工具
    ///
    /// # 参数
    /// - `args`：LLM 生成的调用参数（已解析为 JSON Value）
    ///
    /// # 返回
    /// 工具执行结果（JSON Value，将被序列化为字符串回传给 LLM）
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError>;

    /// 带上下文执行工具（默认实现，向后兼容）
    ///
    /// # 设计背景
    /// 阶段 1.4 之前工具无法感知会话级工作区。本方法通过 [`crate::tool_context::ToolContext`]
    /// 注入 `workdir`/`project_id`，使 FS 类工具能基于工作区解析相对路径。
    ///
    /// # 默认实现
    /// 忽略 `ctx`，回落到 [`execute`]（旧工具零改动）。
    /// 需要感知上下文的工具（如 FS 工具）应**覆写**本方法。
    ///
    /// # 参数
    /// - `ctx`：工具上下文（工作区等信息，默认实现忽略）
    /// - `args`：调用参数（JSON Value）
    async fn execute_with_ctx(
        &self,
        _ctx: &crate::tool_context::ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        self.execute(args).await
    }

    /// 生成工具定义快照（默认实现，供 ToolBus::list_all 使用）
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }

    /// MCP 工具所属服务器（非 MCP 工具返回 None）
    ///
    /// M3（2026-09-17 三域对齐 dsh）：MCP 归属改由本方法表达——分组注册 / 按服务器
    /// 注销 / 提示注记等调用方不再从工具名字符串反解析 server_id，命名契约与归属
    /// 信息解耦（顺带取消「server_id 不得含下划线」的隐性约束）。
    fn mcp_server_id(&self) -> Option<&str> {
        None
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

    /// 带上下文调用工具（默认实现，向后兼容）
    ///
    /// # 设计背景
    /// 与 [`Tool::execute_with_ctx`] 配套，让调用方（如 AgentLoop）在工具执行时
    /// 注入会话级工作区信息。默认实现忽略 `ctx`，回落到 [`call_tool`]（传空 ctx 语义）。
    ///
    /// # 参数
    /// - `name`：工具名称（可为旧别名，会自动映射）
    /// - `ctx`：工具上下文（工作区等信息，默认实现忽略）
    /// - `args`：调用参数（JSON Value）
    async fn call_tool_with_ctx(
        &self,
        name: &str,
        _ctx: &crate::tool_context::ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        self.call_tool(name, args).await
    }

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
    /// 默认实现：无操作（返回 0）。具体实现需在 `register_mcp_tools` 中记录
    /// `server_id → [tool_name]` 映射，此处按映射批量删除。
    ///
    /// 返回实际移除的工具数（M3：原为 `()`——调用方曾靠工具名前缀反查「是否存在」，
    /// 改按真实移除数判定，消除对命名格式的依赖）。
    async fn unregister_mcp_server(&self, _server_id: &str) -> usize {
        0
    }

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
        // C2 注册面守卫（fail loud）：声明必须有效（安全组一致）+ 名字与身份一致
        let descriptor = tool.descriptor();
        descriptor.validate().unwrap_or_else(|e| {
            panic!("工具注册被拒（声明无效）：{e}——请修正 {name} 的 descriptor() 声明")
        });
        assert_eq!(
            descriptor.name, name,
            "工具注册被拒：descriptor().name 与 name() 不一致（{name}）"
        );
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
        // 旧入口：委托给带上下文版本，传空上下文（向后兼容，无工作区约束）。
        // 注意：不直接执行，避免与 call_tool_with_ctx 形成递归。
        self.call_tool_with_ctx(name, &crate::tool_context::ToolContext::default(), args)
            .await
    }

    async fn call_tool_with_ctx(
        &self,
        name: &str,
        ctx: &crate::tool_context::ToolContext,
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
        // 真正执行入口：走 execute_with_ctx（默认回落到 execute）
        tool.execute_with_ctx(ctx, args).await
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

    async fn unregister_mcp_server(&self, server_id: &str) -> usize {
        let names = self.mcp_servers.write().await.remove(server_id);
        if let Some(names) = names {
            let mut tools = self.tools.write().await;
            let mut removed = 0usize;
            for name in names {
                if tools.remove(&name).is_some() {
                    removed += 1;
                }
            }
            return removed;
        }
        0
    }
}

// ─── WhitelistToolBus：按白名单过滤的工具总线包装器 ────────────────

/// 按白名单过滤工具视图的 ToolBus 包装器，详细见 docs/details/注释/agent-runtime/tool.md
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
        // 旧入口：委托给带上下文版本，传空上下文（向后兼容，无工作区约束）
        self.call_tool_with_ctx(name, &crate::tool_context::ToolContext::default(), args)
            .await
    }

    async fn call_tool_with_ctx(
        &self,
        name: &str,
        ctx: &crate::tool_context::ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let resolved = self.resolve_alias(name);
        if self.allowed.read().await.contains(&resolved) {
            self.inner.call_tool_with_ctx(&resolved, ctx, args).await
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

    async fn unregister_mcp_server(&self, server_id: &str) -> usize {
        self.inner.unregister_mcp_server(server_id).await
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

    /// S5：钩子转人工复核被拒绝（fail-closed，工具不执行）
    #[error("钩子转人工复核被拒绝: {0}")]
    HookReviewDenied(String),

    /// S5：钩子转人工复核超时 / 随轮取消（仅内核侧产生；按拒绝 fail-closed 处理）
    #[error("钩子转人工复核超时或取消（按拒绝处理）: {0}")]
    HookReviewTimeout(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl ToolError {
    /// T1（2026-09-18）：工具失败的结构化错误码（对齐 dsh 判别联合的 error code）。
    ///
    /// 供模型做「重试 / 换路 / 放弃」判断、前端做统一判据；与失败结果载荷中的
    /// `errorCode` 字段同源（经 `tool_failure_from_error` 单点映射）。
    /// 详细见 docs/details/注释/agent-runtime/agent.md（注释块 16 附：T1 判别契约）
    pub fn error_code(&self) -> &'static str {
        match self {
            ToolError::NotFound(_) => "UNKNOWN_TOOL",
            ToolError::ArgsParse(_) => "INVALID_TOOL_INPUT",
            ToolError::Execution(_) => "EXECUTION_ERROR",
            ToolError::Timeout => "TIMEOUT",
            ToolError::Aborted => "ABORTED",
            ToolError::HookReviewDenied(_) => "HOOK_REVIEW_DENIED",
            ToolError::HookReviewTimeout(_) => "HOOK_REVIEW_TIMEOUT",
            ToolError::Other(_) => "UNKNOWN",
        }
    }
}

/// 工具失败结果的统一构造——判别联合（`isError` + `errorCode` 显式）。
///
/// T1（2026-09-18）建立：保留既有 `error`（字符串）与 `tool` 字段（对模型习惯与既有
/// 消费方零破坏），新增 `isError: true` 与结构化 `errorCode`（[`ToolError::error_code`]
/// 单点映射；策略/确认/提问等非 `ToolError` 场景由调用方给码，如 POLICY_DENIED /
/// CONFIRM_* / ASK_*）。成功结果**不携带** `isError`（缺省即成功）。
///
/// Q1（2026-09-20）：自 `agent/tools.rs` 迁入本模块——agent-commands 的提问工具需
/// **跨 crate 复用同一构造**（保持「失败结果单一构造点」，防形状漂移）；公开路径
/// `agent_runtime::tool::tool_failure_payload`。
///
/// 详细见 docs/details/注释/agent-runtime/agent.md（注释块 16 附：T1 判别契约）
pub fn tool_failure_payload(tool: &str, message: impl Into<String>, code: &str) -> serde_json::Value {
    let message: String = message.into();
    serde_json::json!({
        "isError": true,
        "error": message,
        "errorCode": code,
        "tool": tool,
    })
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

    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "dev", self.description(), SideEffectScope::None)
            .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        Ok(args)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_error_codes_are_stable() {
        // T1：错误码是模型（重试/换路判断）与前端（统一判据）的对外契约，取值不可随意漂移
        assert_eq!(ToolError::NotFound("x".into()).error_code(), "UNKNOWN_TOOL");
        assert_eq!(
            ToolError::ArgsParse("x".into()).error_code(),
            "INVALID_TOOL_INPUT"
        );
        assert_eq!(
            ToolError::Execution("x".into()).error_code(),
            "EXECUTION_ERROR"
        );
        assert_eq!(ToolError::Timeout.error_code(), "TIMEOUT");
        assert_eq!(ToolError::Aborted.error_code(), "ABORTED");
        assert_eq!(ToolError::Other("x".into()).error_code(), "UNKNOWN");
    }

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

    #[test]
    fn register_rejects_invalid_or_mismatched_descriptor() {
        // C2 反证②：注册面守卫——声明与身份不一致 / 声明无效（dangerous 但非 always_ask）即 panic
        struct Mismatched(ToolDescriptor);
        #[async_trait]
        impl Tool for Mismatched {
            fn name(&self) -> &str {
                "actual_name"
            }
            fn description(&self) -> &str {
                "声明与身份不一致（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object" })
            }
            fn descriptor(&self) -> ToolDescriptor {
                self.0.clone()
            }
            async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
                Ok(args)
            }
        }

        /// 在独立 runtime 中执行注册（捕获注册期 panic）
        fn try_register(tool: Arc<dyn Tool>) -> Result<usize, String> {
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                let rt = tokio::runtime::Builder::new_current_thread()
                    .build()
                    .expect("建测试 runtime");
                rt.block_on(async {
                    let bus = SimpleToolBus::new();
                    bus.register(tool).await;
                    bus.count().await
                })
            }))
            .map_err(|e| {
                e.downcast_ref::<String>()
                    .cloned()
                    .unwrap_or_else(|| "（非字符串 panic 载荷）".to_string())
            })
        }

        // ① 名字不一致 → panic（"不一致"）
        let err = try_register(Arc::new(Mismatched(ToolDescriptor::read_only(
            "declared_name",
            "test",
            "x",
            SideEffectScope::None,
        ))))
        .unwrap_err();
        assert!(err.contains("不一致"), "应报名字不一致：{err}");

        // ② 声明无效（dangerous 但 always_ask=false）→ panic（"声明无效"）
        let mut invalid = ToolDescriptor::read_only("actual_name", "test", "x", SideEffectScope::None);
        invalid.safety.risk_level = RiskLevel::Dangerous;
        let err = try_register(Arc::new(Mismatched(invalid))).unwrap_err();
        assert!(err.contains("声明无效"), "应报声明无效：{err}");

        // ③ 合法声明 → 注册成功
        let count = try_register(Arc::new(Mismatched(ToolDescriptor::read_only(
            "actual_name",
            "test",
            "x",
            SideEffectScope::None,
        ))))
        .expect("合法声明应注册成功");
        assert_eq!(count, 1);
    }

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

#[cfg(test)]
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.0, "test", self.description(), SideEffectScope::None)
            .with_input_schema(self.parameters())
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        Ok(args)
    }
}
