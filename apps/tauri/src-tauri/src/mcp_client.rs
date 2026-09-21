//! MCP 客户端 Hub（H2 重建 P2，2026-08-30 · Rust 原生 rmcp 路线）
//!
//! - [`McpHub`]：连接管理器（stdio / streamable-http 双传输），持有每 server 的
//!   链路状态机（M1/M6：Connected / Reconnecting / Failed）+ 活跃代际句柄，
//!   工具快照供 new_agent 时注入会话 tool_bus；
//! - [`RmcpCaller`]：rmcp `Peer` 适配为 kernel 的 `McpCaller` trait；
//! - 连接生命周期 = 应用生命周期（拍板：长任务/桌面刷新不断连）；
//!   意外断开走指数退避重连（M1，dsh 同款参数），超限注销工具并停连；
//! - 状态/工具变化经 [`McpEventSink`] 外发（命令层转 Tauri 事件 + 会话同步）。
//!
//! 工具名契约：`mcp__{server_id}__{tool_name}`（kernel McpTool 规则；M3 双下划线分隔 +
//! 段清洗 + 超长截断；归属走 `Tool::mcp_server_id` 不再反解析）。
//! 已连接工具对新会话生效（与技能/规则同策略）；活跃会话经热注入/按服务器注销同步。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use http::header::{HeaderName, HeaderValue};
use rmcp::model::{CallToolRequestParams, ContentBlock, ReadResourceRequestParams};
use rmcp::service::{
    MaybeSendFuture, NotificationContext, Peer, RoleClient, RunningService,
    RunningServiceCancellationToken,
};
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, ConfigureCommandExt,
    StreamableHttpClientTransport, TokioChildProcess,
};
use rmcp::{ClientHandler, ServiceExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

use agent_runtime::env_scrub::sensitive_inherited_env_keys;
use agent_runtime::mcp::{McpCaller, McpError, McpToolAdapter, McpToolInfo};
use agent_runtime::tool::{Tool, ToolError};

// ─── 连接配置（前端 McpPanel ↔ SQLite 持久化 ↔ 连接层三方可序列化） ──────────

/// MCP 服务器连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConnectionConfig {
    /// 唯一 id（工具名前缀 `mcp__{id}__` 的来源；M3 后归属走 Tool::mcp_server_id，不反解析）
    pub id: String,
    /// 显示名
    pub name: String,
    /// 传输方式：`stdio` | `http`
    #[serde(default = "default_transport")]
    pub transport: String,
    /// stdio：可执行命令（如 npx / uvx）
    #[serde(default)]
    pub command: Option<String>,
    /// stdio：命令参数（如 ["-y", "@modelcontextprotocol/server-filesystem", path]）
    #[serde(default)]
    pub args: Vec<String>,
    /// http：服务器 URL（streamable-http endpoint）
    #[serde(default)]
    pub url: Option<String>,
    /// http：自定义请求头（鉴权等）
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    /// 是否启用（禁用时保存配置但不断连）
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_transport() -> String {
    "stdio".into()
}
fn default_true() -> bool {
    true
}

/// Windows 下 stdio 命令解析：npx/uvx 等在 Windows 以 `.cmd` 批处理形式安装，
/// `CreateProcess` 不认无扩展名命令也不直接执行批处理——按 PATH 搜索解析为
/// 绝对路径（优先 `.cmd`，其次 `.exe`）。非 Windows 或已带扩展名时原样返回。
fn resolve_windows_command(command: &str) -> String {
    if cfg!(windows) && std::path::Path::new(command).extension().is_none() {
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path_var) {
                for ext in [".cmd", ".exe"] {
                    let candidate = dir.join(format!("{command}{ext}"));
                    if candidate.is_file() {
                        return candidate.to_string_lossy().into_owned();
                    }
                }
            }
        }
    }
    command.to_string()
}

/// M4（2026-09-17 三域对齐 dsh）：跨 server 工具全名冲突检测——
/// 已有连接的工具全名 vs 新连接工具全名，返回冲突全名（空 = 无冲突）。
/// 抽为纯函数便于单测（不依赖真实服务器）；调用方据此拒绝整代注册。
fn find_cross_conflicts(existing: &[String], incoming: &[String]) -> Vec<String> {
    let existing: std::collections::HashSet<&String> = existing.iter().collect();
    let mut conflicts: Vec<String> = incoming
        .iter()
        .filter(|n| existing.contains(n))
        .cloned()
        .collect();
    conflicts.sort();
    conflicts.dedup();
    conflicts
}

// ─── 内部连接状态 ────────────────────────────────────────────

/// rmcp 客户端处理器（M2：拦截 `tools/list_changed` 通知；其余走默认实现）
struct McpClientHandler {
    server_id: String,
    /// 清单变更回调（Hub 注入：触发工具代际刷新）
    on_list_changed: Arc<dyn Fn(String) + Send + Sync>,
}

impl ClientHandler for McpClientHandler {
    fn on_tool_list_changed(
        &self,
        _context: NotificationContext<RoleClient>,
    ) -> impl std::future::Future<Output = ()> + MaybeSendFuture + '_ {
        let id = self.server_id.clone();
        let cb = self.on_list_changed.clone();
        async move {
            cb(id);
        }
    }
}

type ClientService = RunningService<RoleClient, McpClientHandler>;

/// M6（2026-09-17 三域对齐 dsh）：连接状态机（状态查询与事件同源）
#[derive(Debug, Clone, PartialEq)]
enum McpLinkState {
    /// 已连接（当前代际可用）
    Connected,
    /// 重连中（第 attempt 次尝试；旧代际句柄保留，工具暂留可调、调用会返回连接错误）
    Reconnecting { attempt: u32 },
    /// 重连超限 / 首次连接失败——保留原因供前端展示
    Failed { error: String },
}

impl McpLinkState {
    /// 线上格式（前端状态分组直用）
    fn as_str(&self) -> &'static str {
        match self {
            McpLinkState::Connected => "connected",
            McpLinkState::Reconnecting { .. } => "reconnecting",
            McpLinkState::Failed { .. } => "failed",
        }
    }
}

/// 重连退避参数（对齐 dsh：500ms→30s 指数退避、最多 10 次、稳定 60s 重置预算）
const RECONNECT_BASE_MS: u64 = 500;
const RECONNECT_MAX_MS: u64 = 30_000;
const RECONNECT_MAX_ATTEMPTS: u32 = 10;
const RECONNECT_STABLE_RESET_MS: u64 = 60_000;

/// 第 attempt 次重连的退避毫秒（500ms 起倍增，封顶 30s）
fn reconnect_backoff_ms(attempt: u32) -> u64 {
    let shift = attempt.saturating_sub(1).min(6);
    (RECONNECT_BASE_MS << shift).min(RECONNECT_MAX_MS)
}

/// Hub 事件（经 [`McpEventSink`] 外发）：状态变化 → 前端；工具集变化 → 会话同步
#[derive(Debug, Clone)]
pub enum McpHubEvent {
    /// 连接状态变化（含失败原因）
    Status(McpStatusEntry),
    /// 服务器工具集变化（重连成功 / 清单变更 / 超限注销）——
    /// 调用方据此热注入会话（removed=false）或按服务器注销（removed=true）
    ToolsChanged { server_id: String, removed: bool },
}

/// 状态/工具事件回调（命令层 setup 注入；Hub 不依赖 Tauri）
pub type McpEventSink = Arc<dyn Fn(McpHubEvent) + Send + Sync>;

/// 单服务器链路（状态机 + 当前代际句柄 + 监督任务协作件）
struct ServerLink {
    config: McpConnectionConfig,
    state: McpLinkState,
    /// 当前代际调用句柄（Connected 时有值；重连期间保留旧代际供“最后一次已知工具”）
    peer: Option<Peer<RoleClient>>,
    /// 当前代际工具缓存
    tools: Vec<McpToolInfo>,
    /// 当前代际取消句柄（手动停止用；换代时替换）
    cancel: Option<RunningServiceCancellationToken>,
    /// 手动停止标志（监督任务据此停止重连）
    manual: Arc<AtomicBool>,
    /// 监督任务退出通知（stop_link 有界等待用；无监督任务的链路创建时即触发）
    exited: Arc<tokio::sync::Notify>,
    /// 链路代际号（防旧监督任务干扰同 id 新链路）
    generation: u64,
    /// M7：server instructions（initialize 响应携带；并入 mcp_note 提示段）
    instructions: Option<String>,
}

/// 一次成功连接的全部产物
struct ConnectedParts {
    service: ClientService,
    peer: Peer<RoleClient>,
    tools: Vec<McpToolInfo>,
    cancel: RunningServiceCancellationToken,
    /// M7：server instructions（initialize 响应携带）
    instructions: Option<String>,
}

/// rmcp `Peer` → kernel `McpCaller` 适配
///
/// M5/M1 重构（2026-09-17 三域对齐 dsh）：由持有 `Arc<RunningService>` 改为持有
/// 可克隆的 `Peer` 句柄——服务本体移交监督任务独占（退出检测 + 重连），手动停止
/// 经取消句柄 + 停止信号（见 [`McpHub::stop_link`]）；工具执行与发现都经它发起。
struct RmcpCaller {
    peer: Peer<RoleClient>,
}

#[async_trait::async_trait]
impl McpCaller for RmcpCaller {
    async fn call_tool(&self, name: &str, args: Value) -> Result<Value, McpError> {
        // 3.1 的 CallToolRequestParams 为 #[non_exhaustive]，走 new + 字段赋值
        let mut params = CallToolRequestParams::new(name.to_owned());
        params.arguments = args.as_object().cloned();
        let result = self
            .peer
            .call_tool(params)
            .await
            .map_err(|e| McpError::Server(e.to_string()))?;

        if result.is_error.unwrap_or(false) {
            return Err(McpError::Server(extract_text(&result.content)));
        }

        // 结构化结果优先（3.x structured_content），否则提取 content 文本
        if let Some(v) = result.structured_content {
            return Ok(v);
        }
        let text = extract_text(&result.content);
        Ok(serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }

    async fn list_tools(&self) -> Result<Vec<McpToolInfo>, McpError> {
        let resp = self
            .peer
            .list_tools(Default::default())
            .await
            .map_err(|e| McpError::Server(e.to_string()))?;
        Ok(resp
            .tools
            .into_iter()
            .map(|t| McpToolInfo {
                name: t.name.to_string(),
                description: t.description.map(|d| d.to_string()).unwrap_or_default(),
                input_schema: Value::Object((*t.input_schema).clone()),
            })
            .collect())
    }
}

/// 提取 CallToolResult.content 的全部文本（非文本块跳过）
fn extract_text(content: &[ContentBlock]) -> String {
    let mut texts = Vec::new();
    for c in content {
        if let ContentBlock::Text(t) = c {
            texts.push(t.text.clone());
        }
    }
    texts.join("\n")
}

/// M7：server instructions 截断（提示段每 server 上限 600 字符，防单 server 巨文撑爆提示词）
fn truncate_instructions(text: &str) -> String {
    const MAX: usize = 600;
    if text.chars().count() <= MAX {
        return text.to_string();
    }
    let mut out: String = text.chars().take(MAX).collect();
    out.push('…');
    out
}

// ─── M7：MCP resources 三工具（2026-09-17 三域对齐 dsh） ────────────────

/// resources 工具种类
#[derive(Clone, Copy, PartialEq, Eq)]
enum McpResourceToolKind {
    /// `list_mcp_resources`：列出指定 server 的资源
    List,
    /// `list_mcp_resource_templates`：列出资源模板
    ListTemplates,
    /// `read_mcp_resource`：读取指定 URI 的资源内容
    Read,
}

/// 枢纽级 resources 工具：`server` 参数显式指定（对齐 dsh），
/// 任一 server 在线时随快照进入会话工具面（组名见 `MCP_HUB_TOOL_GROUP`）
struct McpResourceTool {
    hub: Arc<McpHub>,
    kind: McpResourceToolKind,
}

impl McpResourceTool {
    fn tool_name(kind: McpResourceToolKind) -> &'static str {
        match kind {
            McpResourceToolKind::List => "list_mcp_resources",
            McpResourceToolKind::ListTemplates => "list_mcp_resource_templates",
            McpResourceToolKind::Read => "read_mcp_resource",
        }
    }

    fn description_of(kind: McpResourceToolKind) -> &'static str {
        match kind {
            McpResourceToolKind::List => {
                "列出指定 MCP 服务器提供的资源（resources）。先调用本工具了解可读资源，再用 read_mcp_resource 读取；server 参数为已连接服务器 id（见「MCP 环境」注记）。"
            }
            McpResourceToolKind::ListTemplates => {
                "列出指定 MCP 服务器的资源模板（resource templates，URI 含参数占位）。server 参数为已连接服务器 id。"
            }
            McpResourceToolKind::Read => {
                "读取指定 MCP 服务器上某个 URI 的资源内容（配合 list_mcp_resources 使用）。"
            }
        }
    }

    fn parameters_of(kind: McpResourceToolKind) -> Value {
        match kind {
            McpResourceToolKind::Read => serde_json::json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string", "description": "已连接的 MCP 服务器 id" },
                    "uri": { "type": "string", "description": "资源 URI（来自 list_mcp_resources / list_mcp_resource_templates）" }
                },
                "required": ["server", "uri"]
            }),
            _ => serde_json::json!({
                "type": "object",
                "properties": {
                    "server": { "type": "string", "description": "已连接的 MCP 服务器 id" }
                },
                "required": ["server"]
            }),
        }
    }
}

#[async_trait::async_trait]
impl Tool for McpResourceTool {
    fn name(&self) -> &str {
        Self::tool_name(self.kind)
    }

    fn description(&self) -> &str {
        Self::description_of(self.kind)
    }

    fn parameters(&self) -> Value {
        Self::parameters_of(self.kind)
    }

    fn mcp_server_id(&self) -> Option<&str> {
        // 枢纽级：不属于单个 server（按组注册/注销；不计入服务器清单）
        Some(agent_runtime::mcp::MCP_HUB_TOOL_GROUP)
    }

    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let server = args
            .get("server")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if server.is_empty() {
            return Err(ToolError::Execution("缺少 server 参数".into()));
        }
        let Some(peer) = self.hub.peer_of(&server).await else {
            let available = self.hub.connected_server_ids().await;
            return Err(ToolError::Execution(format!(
                "MCP 服务器「{server}」未连接；当前已连接：{}",
                if available.is_empty() {
                    "（无）".to_string()
                } else {
                    available.join("、")
                }
            )));
        };
        match self.kind {
            McpResourceToolKind::List => {
                let result = peer
                    .list_resources(None)
                    .await
                    .map_err(|e| ToolError::Execution(format!("MCP 资源列表获取失败: {e}")))?;
                Ok(serde_json::to_value(result).unwrap_or(Value::Null))
            }
            McpResourceToolKind::ListTemplates => {
                let result = peer
                    .list_resource_templates(None)
                    .await
                    .map_err(|e| ToolError::Execution(format!("MCP 资源模板获取失败: {e}")))?;
                Ok(serde_json::to_value(result).unwrap_or(Value::Null))
            }
            McpResourceToolKind::Read => {
                let uri = args
                    .get("uri")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if uri.is_empty() {
                    return Err(ToolError::Execution("缺少 uri 参数".into()));
                }
                let result = peer
                    .read_resource(ReadResourceRequestParams::new(uri))
                    .await
                    .map_err(|e| ToolError::Execution(format!("MCP 资源读取失败: {e}")))?;
                Ok(serde_json::to_value(result).unwrap_or(Value::Null))
            }
        }
    }
}

// ─── Hub ────────────────────────────────────────────

/// MCP 连接 Hub：管理服务器链路（状态机 + 代际）+ 已连接工具快照
///
/// M1/M6（2026-09-17 三域对齐 dsh）重构要点：
/// - 每 server 一条 [`ServerLink`]（状态机 + 当前代际 peer/cancel + 监督协作件）；
/// - 连接成功后启动监督任务（`RunningService::waiting` 监视退出）——意外退出走
///   指数退避重连，超限注销工具并停连（Failed）；
/// - 状态/工具变化经 [`McpEventSink`] 外发（命令层转 Tauri 事件 + 会话同步）。
///
/// `tools_snapshot` 仍用同步 Mutex（供 `tools_for_bus` 的同步 provider 闭包读取，
/// 规避 async 锁在同步上下文不可用的问题）。
pub struct McpHub {
    links: RwLock<HashMap<String, ServerLink>>,
    tools_snapshot: Mutex<Vec<Arc<dyn Tool>>>,
    /// M7：server instructions 快照（同步可读，供 mcp_note 提示段同步 provider 消费）
    notes_snapshot: Mutex<Vec<(String, String)>>,
    /// 状态/工具事件回调（命令层 setup 注入；未注入时事件静默丢弃）
    event_sink: Mutex<Option<McpEventSink>>,
    /// 链路代际序号（每条新链路取号，防旧监督任务干扰同 id 新链路）
    generation_seq: std::sync::atomic::AtomicU64,
}

impl McpHub {
    pub fn new() -> Self {
        Self {
            links: RwLock::new(HashMap::new()),
            tools_snapshot: Mutex::new(Vec::new()),
            notes_snapshot: Mutex::new(Vec::new()),
            event_sink: Mutex::new(None),
            generation_seq: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// 注入事件回调（命令层 setup 时调用一次）
    pub fn set_event_sink(&self, sink: McpEventSink) {
        if let Ok(mut slot) = self.event_sink.lock() {
            *slot = Some(sink);
        }
    }

    /// 外发事件（无回调时静默丢弃）
    fn emit(&self, ev: McpHubEvent) {
        let sink = self.event_sink.lock().ok().and_then(|s| s.clone());
        if let Some(sink) = sink {
            sink(ev);
        }
    }

    /// 取新链路代际号
    fn next_generation(&self) -> u64 {
        self.generation_seq.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// 连接 MCP 服务器（stdio / http 按配置分派）。同 id 幂等：先停旧链路再重建。
    ///
    /// 失败时登记 Failed 链路（前端可见原因）并返回 Err——启动重连（auto_connect_all）
    /// 也经此路径，失败不再静默。
    pub async fn connect(
        self: &Arc<Self>,
        config: McpConnectionConfig,
    ) -> Result<Vec<McpToolInfo>, String> {
        self.stop_link(&config.id).await;

        let existing = self.existing_tool_names(&config.id).await;
        let generation = self.next_generation();
        match self.connect_once(&config, &existing).await {
            Ok(parts) => {
                let manual = Arc::new(AtomicBool::new(false));
                let exited = Arc::new(tokio::sync::Notify::new());
                {
                    let mut links = self.links.write().await;
                    links.insert(
                        config.id.clone(),
                        ServerLink {
                            config: config.clone(),
                            state: McpLinkState::Connected,
                            peer: Some(parts.peer),
                            tools: parts.tools.clone(),
                            cancel: Some(parts.cancel),
                            manual: manual.clone(),
                            exited: exited.clone(),
                            generation,
                            instructions: parts.instructions.clone(),
                        },
                    );
                }
                self.refresh_snapshot();
                self.emit_status(&config.id).await;
                // M1：监督任务——监视服务退出（意外断开走重连）；退出时通知 stop_link
                let hub = Arc::clone(self);
                let id = config.id.clone();
                tokio::spawn(async move {
                    hub.supervise(id, generation, manual, parts.service).await;
                    exited.notify_one();
                });
                Ok(parts.tools)
            }
            Err(e) => {
                // 首次连接失败：登记 Failed 链路（保留原因供前端展示），不启动监督
                let exited = Arc::new(tokio::sync::Notify::new());
                exited.notify_one(); // 无监督任务：stop_link 的等待立即返回
                {
                    let mut links = self.links.write().await;
                    links.insert(
                        config.id.clone(),
                        ServerLink {
                            config: config.clone(),
                            state: McpLinkState::Failed { error: e.clone() },
                            peer: None,
                            tools: Vec::new(),
                            cancel: None,
                            manual: Arc::new(AtomicBool::new(true)),
                            exited,
                            generation,
                            instructions: None,
                        },
                    );
                }
                self.refresh_snapshot();
                self.emit_status(&config.id).await;
                Err(e)
            }
        }
    }

    /// 单次连接（不做幂等清理、不登记链路）：建立传输 → 握手 → 工具发现 → M4 冲突校验。
    /// `existing_names`：其他已连接服务器的工具全名（跨 server 冲突检测用，排除自身）。
    async fn connect_once(
        self: &Arc<Self>,
        config: &McpConnectionConfig,
        existing_names: &[String],
    ) -> Result<ConnectedParts, String> {
        let handler = McpClientHandler {
            server_id: config.id.clone(),
            on_list_changed: {
                let hub = Arc::clone(self);
                Arc::new(move |id: String| {
                    let hub = Arc::clone(&hub);
                    tokio::spawn(async move {
                        hub.handle_tool_list_changed(&id).await;
                    });
                })
            },
        };
        let service: ClientService = match config.transport.as_str() {
            "stdio" => {
                let command = config
                    .command
                    .as_ref()
                    .ok_or("stdio 传输缺少 command 字段")?
                    .clone();
                let args = config.args.clone();
                // Windows：npx/uvx 实为 .cmd 批处理，CreateProcess 无法直接执行，
                // 需按 PATH 解析为绝对路径（详见 resolve_windows_command）
                let resolved = resolve_windows_command(&command);
                let transport = TokioChildProcess::new(
                    tokio::process::Command::new(resolved).configure(|cmd| {
                        cmd.args(args.iter().cloned());
                        // M8 + E1（三域/环境对齐 dsh）：环境清理——MCP server 是第三方
                        // 进程，不应继承主进程的敏感环境变量（KEY/PASSWORD/SECRET/TOKEN），
                        // 其余原样继承（对齐 dsh scrubbedParentEnv）；判定与 collector
                        // 全仓同源（agent_runtime::env_scrub，命令执行 / PTY 会话共用）。
                        for k in sensitive_inherited_env_keys() {
                            cmd.env_remove(&k);
                        }
                    }),
                )
                .map_err(|e| format!("启动 MCP 子进程失败: {e}"))?;
                handler
                    .serve(transport)
                    .await
                    .map_err(|e| format!("MCP 初始化握手失败: {e}"))?
            }
            // 前端 McpPanel 历史值为 "streamable-http"，与 "http" 同义（Streamable HTTP 传输），
            // 两者都接受——此前仅匹配 "http" 导致官方预设全部落入「不支持的传输方式」
            "http" | "streamable-http" => {
                let url = config
                    .url
                    .as_ref()
                    .ok_or("http 传输缺少 url 字段")?
                    .clone();
                // T09③（2026-09-01）：headers 鉴权注入——rmcp 3.1 经 Config 构造
                // （auth_header 单 Authorization + custom_headers 多自定义头）。
                // 约定：headers 中键名大小写不敏感（HeaderName 规范化）；值为 Authorization
                // 时由 auth_header 承载（rmcp 会带 Bearer 前缀归一），其余进 custom_headers。
                let mut custom = HashMap::new();
                let mut auth_header: Option<String> = None;
                for (k, v) in &config.headers {
                    let name = k.trim();
                    if name.is_empty() {
                        continue;
                    }
                    if name.eq_ignore_ascii_case("Authorization")
                        || name.eq_ignore_ascii_case("authorization")
                    {
                        if auth_header.is_none() {
                            // rmcp 语义：作为 bearer token（不带 "Bearer " 前缀）
                            let token = match v.strip_prefix("Bearer ") {
                                Some(rest) => rest.trim().to_string(),
                                None => v
                                    .strip_prefix("bearer ")
                                    .map(|rest| rest.trim().to_string())
                                    .unwrap_or_else(|| v.clone()),
                            };
                            auth_header = Some(token);
                        }
                        continue;
                    }
                    if let Ok(hn) = name.parse::<HeaderName>() {
                        let hval = HeaderValue::from_str(v.trim())
                            .unwrap_or_else(|_| HeaderValue::from_static(""));
                        custom.insert(hn, hval);
                    }
                }
                let cfg = StreamableHttpClientTransportConfig::with_uri(url);
                let cfg = match auth_header {
                    Some(auth) => cfg.auth_header(auth),
                    None => cfg,
                };
                let cfg = if !custom.is_empty() {
                    cfg.custom_headers(custom)
                } else {
                    cfg
                };
                let transport = StreamableHttpClientTransport::from_config(cfg);
                handler
                    .serve(transport)
                    .await
                    .map_err(|e| format!("MCP 连接失败: {e}"))?
            }
            other => return Err(format!("不支持的传输方式: {other}")),
        };

        let caller = Arc::new(RmcpCaller {
            peer: service.peer().clone(),
        });
        let tools = caller.list_tools().await.map_err(|e| e.to_string())?;

        // M4（2026-09-17 三域对齐 dsh）：注册冲突检测——对齐「注册冲突整代回滚，
        // 绝不产生半套工具」：① 同 server 内清洗后重名；② 跨 server 全名撞车
        //（不同 server_id 清洗后塌缩到同一段且工具名相同才可能）。
        let intra_conflicts = agent_runtime::mcp::detect_intra_server_conflicts(&config.id, &tools);
        let incoming: Vec<String> = tools
            .iter()
            .map(|t| agent_runtime::mcp::build_full_name(&config.id, &t.name))
            .collect();
        let cross_conflicts = find_cross_conflicts(existing_names, &incoming);
        if !intra_conflicts.is_empty() || !cross_conflicts.is_empty() {
            // 拒绝整代：取消刚建立的服务（DropGuard 兜底收尾），不登记链路（绝不半套）
            service.cancellation_token().cancel();
            let mut detail = Vec::new();
            if !intra_conflicts.is_empty() {
                detail.push(format!("服务器内重名：{}", intra_conflicts.join("、")));
            }
            if !cross_conflicts.is_empty() {
                detail.push(format!("与其他服务器工具重名：{}", cross_conflicts.join("、")));
            }
            return Err(format!(
                "MCP「{}」工具名冲突（已拒绝整代注册）：{}",
                config.id,
                detail.join("；")
            ));
        }

        // M7：server instructions（initialize 响应携带；并入 mcp_note 提示段）
        let instructions = service
            .peer()
            .peer_info()
            .and_then(|info| info.instructions.clone());
        Ok(ConnectedParts {
            peer: service.peer().clone(),
            cancel: service.cancellation_token(),
            tools,
            instructions,
            service,
        })
    }

    /// M1：链路监督任务——监视当前代际退出；意外断开走指数退避重连（对齐 dsh 参数），
    /// 超限注销工具并置 Failed。代际守卫（generation）保证旧监督任务不干扰同 id 新链路。
    async fn supervise(
        self: Arc<Self>,
        id: String,
        generation: u64,
        manual: Arc<AtomicBool>,
        mut service: ClientService,
    ) {
        let mut attempt: u32 = 0;
        let mut connected_at = Instant::now();
        loop {
            let reason = service.waiting().await;
            if manual.load(Ordering::SeqCst) {
                tracing::debug!("MCP「{id}」手动停止，监督任务退出");
                return;
            }
            tracing::warn!("MCP「{id}」连接意外退出（{reason:?}），进入重连");
            // dsh：连接稳定超过阈值 → 重置退避预算
            if connected_at.elapsed().as_millis() as u64 >= RECONNECT_STABLE_RESET_MS {
                attempt = 0;
            }
            // 置「重连中」（旧代际句柄保留：工具暂留可调、调用返回连接错误）
            if !self.mark_reconnecting(&id, generation, attempt + 1).await {
                return; // 链路已换代/移除
            }

            // 重连循环（指数退避，超限停连）
            let mut next_service: Option<ClientService> = None;
            while attempt < RECONNECT_MAX_ATTEMPTS {
                attempt += 1;
                tokio::time::sleep(Duration::from_millis(reconnect_backoff_ms(attempt))).await;
                if manual.load(Ordering::SeqCst) {
                    return;
                }
                let Some(config) = self.link_config(&id, generation).await else {
                    return;
                };
                if !self.mark_reconnecting(&id, generation, attempt).await {
                    return;
                }
                let existing = self.existing_tool_names(&id).await;
                match self.connect_once(&config, &existing).await {
                    Ok(parts) => {
                        if manual.load(Ordering::SeqCst) {
                            // 停止信号与重连竞态：丢弃刚建立的连接
                            parts.cancel.cancel();
                            return;
                        }
                        match self
                            .install_generation(
                                &id,
                                generation,
                                parts.peer,
                                parts.tools,
                                parts.cancel,
                                parts.instructions,
                            )
                            .await
                        {
                            Ok(()) => {
                                tracing::info!("MCP「{id}」重连成功（第 {attempt} 次尝试）");
                                self.emit(McpHubEvent::ToolsChanged {
                                    server_id: id.clone(),
                                    removed: false,
                                });
                                next_service = Some(parts.service);
                            }
                            Err(cancel) => {
                                // 链路已换代：取消刚建立的连接并退出监督
                                cancel.cancel();
                                return;
                            }
                        }
                        break;
                    }
                    Err(e) => {
                        tracing::warn!("MCP「{id}」重连失败（第 {attempt} 次）: {e}");
                    }
                }
            }

            match next_service {
                Some(svc) => {
                    service = svc;
                    connected_at = Instant::now();
                    attempt = 0;
                }
                None => {
                    tracing::error!(
                        "MCP「{id}」重连超限（{RECONNECT_MAX_ATTEMPTS} 次），注销工具并停连"
                    );
                    if self
                        .mark_failed(
                            &id,
                            generation,
                            format!("重连超限（{RECONNECT_MAX_ATTEMPTS} 次尝试）"),
                        )
                        .await
                    {
                        self.emit(McpHubEvent::ToolsChanged {
                            server_id: id.clone(),
                            removed: true,
                        });
                    }
                    return;
                }
            }
        }
    }

    /// 停止链路（幂等）：置手动标志 → 取消当前代际 → 有界等待监督任务退出 → 移除链路
    async fn stop_link(&self, id: &str) {
        let (cancel, exited) = {
            let mut links = self.links.write().await;
            match links.get_mut(id) {
                Some(link) => {
                    link.manual.store(true, Ordering::SeqCst);
                    (link.cancel.take(), link.exited.clone())
                }
                None => return,
            }
        };
        if let Some(cancel) = cancel {
            cancel.cancel();
        }
        // M5 延续：有界等待监督任务退出（≤5s；链路失败/无监督时立即可返回）
        let _ = tokio::time::timeout(Duration::from_secs(5), exited.notified()).await;
        self.links.write().await.remove(id);
    }

    /// 读取链路配置（监督任务用，代际守卫）
    async fn link_config(&self, id: &str, generation: u64) -> Option<McpConnectionConfig> {
        let links = self.links.read().await;
        links
            .get(id)
            .filter(|l| l.generation == generation)
            .map(|l| l.config.clone())
    }

    /// 除 `exclude_id` 外所有链路的工具全名（M4 跨 server 冲突检测用）
    async fn existing_tool_names(&self, exclude_id: &str) -> Vec<String> {
        let links = self.links.read().await;
        links
            .iter()
            .filter(|(id, _)| id.as_str() != exclude_id)
            .flat_map(|(_, l)| {
                l.tools
                    .iter()
                    .map(|t| agent_runtime::mcp::build_full_name(&l.config.id, &t.name))
            })
            .collect()
    }

    /// 置「重连中」（旧代际保留）并外发状态；返回 false = 链路已换代/移除（调用方应退出）
    async fn mark_reconnecting(self: &Arc<Self>, id: &str, generation: u64, attempt: u32) -> bool {
        {
            let mut links = self.links.write().await;
            match links.get_mut(id) {
                Some(link) if link.generation == generation => {
                    link.state = McpLinkState::Reconnecting { attempt };
                }
                _ => return false,
            }
        }
        self.emit_status(id).await;
        true
    }

    /// 置「失败」（清代际句柄）并外发状态；返回 false = 链路已换代/移除
    async fn mark_failed(self: &Arc<Self>, id: &str, generation: u64, error: String) -> bool {
        {
            let mut links = self.links.write().await;
            match links.get_mut(id) {
                Some(link) if link.generation == generation => {
                    link.state = McpLinkState::Failed { error };
                    link.peer = None;
                    link.cancel = None;
                    link.tools.clear();
                }
                _ => return false,
            }
        }
        self.refresh_snapshot();
        self.emit_status(id).await;
        true
    }

    /// 装载新代际（重连成功）：更新链路 + 快照 + 状态事件。
    /// 返回 `Err(cancel)` = 链路已换代（调用方应取消刚建立的连接）
    async fn install_generation(
        self: &Arc<Self>,
        id: &str,
        generation: u64,
        peer: Peer<RoleClient>,
        tools: Vec<McpToolInfo>,
        cancel: RunningServiceCancellationToken,
        instructions: Option<String>,
    ) -> Result<(), RunningServiceCancellationToken> {
        {
            let mut links = self.links.write().await;
            match links.get_mut(id) {
                Some(link) if link.generation == generation => {
                    link.state = McpLinkState::Connected;
                    link.peer = Some(peer);
                    link.tools = tools;
                    link.cancel = Some(cancel);
                    link.instructions = instructions;
                }
                _ => return Err(cancel),
            }
        }
        self.refresh_snapshot();
        self.emit_status(id).await;
        Ok(())
    }

    /// 生成并外发某链路的状态事件（链路不存在则跳过）
    async fn emit_status(&self, id: &str) {
        let entry = {
            let links = self.links.read().await;
            links.get(id).map(|l| status_entry_of(id, l))
        };
        if let Some(entry) = entry {
            self.emit(McpHubEvent::Status(entry));
        }
    }

    /// M2（2026-09-17 三域对齐 dsh）：`tools/list_changed` 处理——重新拉取清单，
    /// 校验通过才换代（**全量或全无**：失败/冲突保留上一代）
    async fn handle_tool_list_changed(self: &Arc<Self>, id: &str) {
        let (peer, config) = {
            let links = self.links.read().await;
            match links
                .get(id)
                .and_then(|l| l.peer.clone().map(|p| (p, l.config.clone())))
            {
                Some(pair) => pair,
                None => return,
            }
        };
        let caller = RmcpCaller { peer };
        let tools = match caller.list_tools().await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!("MCP「{id}」工具清单刷新失败（保留上一代）: {e}");
                return;
            }
        };
        let intra = agent_runtime::mcp::detect_intra_server_conflicts(&config.id, &tools);
        let existing = self.existing_tool_names(&config.id).await;
        let incoming: Vec<String> = tools
            .iter()
            .map(|t| agent_runtime::mcp::build_full_name(&config.id, &t.name))
            .collect();
        let cross = find_cross_conflicts(&existing, &incoming);
        if !intra.is_empty() || !cross.is_empty() {
            tracing::warn!(
                "MCP「{id}」工具清单变更存在命名冲突（保留上一代）：{}",
                intra.into_iter().chain(cross).collect::<Vec<_>>().join("、")
            );
            return;
        }
        {
            let mut links = self.links.write().await;
            match links.get_mut(id) {
                Some(link) => link.tools = tools,
                None => return,
            }
        }
        tracing::info!("MCP「{id}」工具清单已刷新（tools/list_changed）");
        self.refresh_snapshot();
        self.emit_status(id).await;
        self.emit(McpHubEvent::ToolsChanged {
            server_id: id.to_string(),
            removed: false,
        });
    }

    /// 断开连接（手动停止，不再重连）：停监督（信号 + 取消 + 有界等待）→ 移除链路
    pub async fn disconnect(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let name = {
            let links = self.links.read().await;
            links.get(id).map(|l| l.config.name.clone())
        };
        let Some(name) = name else {
            return Err(format!("MCP 连接不存在: {id}"));
        };
        self.stop_link(id).await;
        self.refresh_snapshot();
        // M6：外发断开状态（链路已移除；前端据此刷新分组）
        self.emit(McpHubEvent::Status(McpStatusEntry {
            id: id.to_string(),
            name,
            connected: false,
            tool_count: 0,
            state: "disconnected".to_string(),
            error: None,
        }));
        Ok(())
    }

    /// 查询某连接的工具清单（连接时缓存）
    pub async fn tools_of(&self, id: &str) -> Option<Vec<McpToolInfo>> {
        self.links.read().await.get(id).map(|c| c.tools.clone())
    }

    /// 连接状态列表（前端面板渲染；含 Failed/Reconnecting 链路）
    pub async fn status(&self) -> Vec<McpStatusEntry> {
        let links = self.links.read().await;
        links
            .iter()
            .map(|(id, link)| status_entry_of(id, link))
            .collect()
    }

    /// 刷新已连接工具快照（同步可读，供 new_agent 的 provider 闭包消费）
    ///
    /// 只收「有当前代际句柄」的链路——Failed（超限注销）与首次失败不产工具；
    /// 重连中保留旧代际（最后一次已知工具，调用会返回连接错误）。
    /// M7：任一 server 在线时一并挂枢纽级 resources 三工具；instructions 快照同步刷新
    fn refresh_snapshot(self: &Arc<Self>) {
        let mut tools: Vec<Arc<dyn Tool>> = Vec::new();
        let mut notes: Vec<(String, String)> = Vec::new();
        if let Ok(map) = self.links.try_read() {
            let mut any_online = false;
            for link in map.values() {
                if let Some(peer) = &link.peer {
                    any_online = true;
                    let caller = Arc::new(RmcpCaller { peer: peer.clone() });
                    tools.extend(McpToolAdapter::adapt_all(
                        link.tools.clone(),
                        link.config.id.clone(),
                        caller,
                    ));
                }
                if let Some(instructions) = &link.instructions {
                    notes.push((link.config.id.clone(), truncate_instructions(instructions)));
                }
            }
            if any_online {
                for kind in [
                    McpResourceToolKind::List,
                    McpResourceToolKind::ListTemplates,
                    McpResourceToolKind::Read,
                ] {
                    tools.push(Arc::new(McpResourceTool {
                        hub: Arc::clone(self),
                        kind,
                    }));
                }
            }
        }
        if let Ok(mut snap) = self.tools_snapshot.lock() {
            *snap = tools;
        }
        if let Ok(mut snap) = self.notes_snapshot.lock() {
            *snap = notes;
        }
    }

    /// M7：instructions 快照（同步读；mcp_note 提示段 provider 用）
    pub fn notes_for_prompt(&self) -> Vec<(String, String)> {
        self.notes_snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    /// 指定 server 的当前代际句柄（仅 Connected；M7 resources 工具用）
    pub async fn peer_of(&self, server_id: &str) -> Option<Peer<RoleClient>> {
        let links = self.links.read().await;
        links.get(server_id).and_then(|l| {
            if matches!(l.state, McpLinkState::Connected) {
                l.peer.clone()
            } else {
                None
            }
        })
    }

    /// 已连接 server id 列表（M7 错误提示用）
    pub async fn connected_server_ids(&self) -> Vec<String> {
        let links = self.links.read().await;
        links
            .iter()
            .filter(|(_, l)| matches!(l.state, McpLinkState::Connected))
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// 已连接 server 数量（M7 枢纽级工具清理判定用）
    pub async fn connected_count(&self) -> usize {
        self.connected_server_ids().await.len()
    }

    /// 同步读取工具快照（new_agent 时注入会话 tool_bus）
    pub fn tools_for_bus(&self) -> Vec<Arc<dyn Tool>> {
        self.tools_snapshot.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

impl Default for McpHub {
    fn default() -> Self {
        Self::new()
    }
}

/// 连接状态条目（前端面板）
#[derive(Debug, Clone, Serialize)]
pub struct McpStatusEntry {
    pub id: String,
    pub name: String,
    /// 兼容字段：是否处于 Connected 状态（前端旧判据）
    pub connected: bool,
    pub tool_count: u32,
    /// M6：状态机状态（connected / reconnecting / failed / disconnected）
    pub state: String,
    /// M6：失败/重连的可读原因（无则 None）
    pub error: Option<String>,
}

/// 由链路生成状态条目（状态查询与事件同源）
fn status_entry_of(id: &str, link: &ServerLink) -> McpStatusEntry {
    McpStatusEntry {
        id: id.to_string(),
        name: link.config.name.clone(),
        connected: matches!(link.state, McpLinkState::Connected),
        tool_count: link.tools.len() as u32,
        state: link.state.as_str().to_string(),
        error: match &link.state {
            McpLinkState::Failed { error } => Some(error.clone()),
            McpLinkState::Reconnecting { attempt } => {
                Some(format!("连接中断，正在重连（第 {attempt} 次）"))
            }
            _ => None,
        },
    }
}

// ─── e2e：连接真实 MCP 服务器闭环验证（2026-09-01） ──────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::net::TcpStream;

    /// M8 + E1：敏感环境变量判定（stdio 子进程环境清理，对齐 dsh scrubbedParentEnv）
    ///
    /// E1 后判定实现已迁至 `agent_runtime::env_scrub`——本测试保留为站点级回归守卫
    /// （扩展面：kernel env_scrub 单测 + PTY 环境块单测）。
    #[test]
    fn sensitive_env_key_filtering() {
        use agent_runtime::env_scrub::is_sensitive_env_key;
        for key in [
            "OPENAI_API_KEY",
            "MY_PASSWORD",
            "DB_SECRET",
            "GITHUB_TOKEN",
            "github_token",
            "client_secret",
        ] {
            assert!(is_sensitive_env_key(key), "{key} 应判为敏感");
        }
        for key in ["PATH", "SYSTEMROOT", "HOME", "USERPROFILE", "TEMP", "NODE_PATH"] {
            assert!(!is_sensitive_env_key(key), "{key} 不应判为敏感");
        }
    }

    /// M4：跨 server 工具全名冲突检测（整代拒绝的判据）
    #[test]
    fn cross_conflict_detection() {
        let existing = vec!["mcp__a__echo".to_string(), "mcp__b__add".to_string()];
        assert!(find_cross_conflicts(&existing, &["mcp__c__x".into()]).is_empty());
        assert_eq!(
            find_cross_conflicts(&existing, &["mcp__a__echo".into(), "mcp__d__y".into()]),
            vec!["mcp__a__echo".to_string()]
        );
        // 同集合内重复也去重
        assert_eq!(
            find_cross_conflicts(&existing, &["mcp__a__echo".into(), "mcp__a__echo".into()]),
            vec!["mcp__a__echo".to_string()]
        );
    }

    /// 本地真实 MCP 服务器端口（与手动起的验证服务器错开，避免冲突）
    const E2E_PORT: &str = "18432";
    const E2E_ADDR: &str = "127.0.0.1:18432";
    const E2E_URL: &str = "http://127.0.0.1:18432/mcp";

    /// 本地服务器脚本路径：<项目根>/.trae/mcp-e2e/server.mjs（gitignore，不入库）
    fn server_script_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join(".trae")
            .join("mcp-e2e")
            .join("server.mjs")
    }

    /// 轮询等待 TCP 端口就绪（服务器启动握手前不可连接）
    async fn wait_port_ready(tries: usize) -> bool {
        for _ in 0..tries {
            if TcpStream::connect(E2E_ADDR).await.is_ok() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        false
    }

    /// Drop guard：panic 时也强制清理 node 子进程，避免端口残留
    struct KillGuard(tokio::process::Child);
    impl Drop for KillGuard {
        fn drop(&mut self) {
            let _ = self.0.start_kill();
        }
    }

    /// MCP 真实服务器闭环：连接 → 工具发现 → 快照注入 → 工具调用
    ///
    /// 运行方式：
    ///   `cargo test -p worldsea-tauri-app --lib -- --ignored mcp_e2e`
    /// 前置：node 在 PATH；本地服务器由本测试自动 spawn（node + 官方 SDK）。
    #[tokio::test]
    #[ignore = "需要 node + 官方 MCP SDK 与本地服务器，按需显式运行"]
    async fn mcp_e2e_connect_real_http_server() {
        let script = server_script_path();
        assert!(script.exists(), "缺少本地 MCP 服务器脚本: {}", script.display());

        // 1) spawn 本地真实 MCP 服务器（streamable-http，官方 SDK 实现）
        let child = tokio::process::Command::new("node")
            .arg(&script)
            .arg(E2E_PORT)
            .spawn()
            .expect("spawn node MCP 服务器失败（node 是否在 PATH？）");
        let _guard = KillGuard(child);
        assert!(
            wait_port_ready(50).await,
            "本地 MCP 服务器未在超时内就绪"
        );

        // 2) McpHub 真实连接 → 工具发现
        let hub = Arc::new(McpHub::new());
        let cfg = McpConnectionConfig {
            id: "local".into(),
            name: "本地真实测试服务器".into(),
            transport: "http".into(),
            command: None,
            args: Vec::new(),
            url: Some(E2E_URL.into()),
            // T09③ headers 鉴权注入验证：自定义头 + Authorization 两种形态都应被接受
            headers: vec![
                ("X-Test-Header".to_string(), "hello".to_string()),
                ("Authorization".to_string(), "Bearer test-token-123".to_string()),
            ],
            enabled: true,
        };
        let tools = hub
            .connect(cfg)
            .await
            .expect("连接真实 MCP 服务器应成功");
        assert_eq!(tools.len(), 3, "应发现 3 个工具");
        let names: Vec<&str> = tools.iter().map(|t| t.name.as_str()).collect();
        assert!(names.contains(&"echo"), "缺 echo 工具: {names:?}");
        assert!(names.contains(&"add"), "缺 add 工具: {names:?}");
        assert!(names.contains(&"get_env"), "缺 get_env 工具: {names:?}");

        // 3) 快照注入：tools_for_bus 得到带 mcp__{server_id}__ 前缀的工具
        let bus_tools = hub.tools_for_bus();
        assert_eq!(bus_tools.len(), 3, "快照应有 3 个工具");
        let bus_names: Vec<String> = bus_tools.iter().map(|t| t.name().to_string()).collect();
        for expected in ["mcp__local__echo", "mcp__local__add", "mcp__local__get_env"] {
            assert!(bus_names.iter().any(|n| n == expected), "缺 {expected}: {bus_names:?}");
        }

        // 4) 工具调用：add(2,3) → 结构化结果 {sum:5}（RmcpCaller 结构化返回优先）
        let add_tool = bus_tools
            .iter()
            .find(|t| t.name() == "mcp__local__add")
            .expect("add 工具应在快照中");
        let result = add_tool
            .execute(serde_json::json!({ "a": 2, "b": 3 }))
            .await
            .expect("调用 add 工具应成功");
        assert_eq!(result["sum"], 5, "add 结构化结果应为 5，实得 {result}");
        // echo 文本返回验证
        let echo_tool = bus_tools
            .iter()
            .find(|t| t.name() == "mcp__local__echo")
            .expect("echo 工具应在快照中");
        let echo_result = echo_tool
            .execute(serde_json::json!({ "text": "闭环" }))
            .await
            .expect("调用 echo 工具应成功");
        assert!(
            echo_result.to_string().contains("echo: 闭环"),
            "echo 应回显输入: {echo_result}"
        );

        // 5) 注入会话 tool_bus：AgentCommandService + 快照 provider → new_session →
        //    tool_names 断言会话拿到带 mcp__{server_id}__ 前缀的 MCP 工具（产品闭环收口）
        let mut svc = agent_commands::AgentCommandService::new();
        svc.set_mcp_tools_provider(Arc::new({
            let hub = hub.clone();
            move || hub.tools_for_bus()
        }));
        let info = svc
            // A4 双端收口（2026-09-17）后 `new_session` 增 `prompt_sections` 参数：
            // 测试路径无需段清单 → 空 Vec（行内补齐，本轮发现既有测试编译断裂）
            .new_session(None, vec![], None, None, None, None, None)
            .await
            .expect("new_session 应成功");
        let session_tools = svc
            .tool_names(&info.id)
            .await
            .expect("tool_names 应成功");
        for expected in ["mcp__local__echo", "mcp__local__add", "mcp__local__get_env"] {
            assert!(
                session_tools.iter().any(|n| n == expected),
                "会话 tool_bus 缺 {expected}: {session_tools:?}"
            );
        }

        // 5.5) T09① 工具注销：remove_mcp_server_tools 移除会话中该服务器全部工具
        //      （命令层按 server 分组记录归属 → unregister_mcp_server 批量注销）
        let affected = svc.remove_mcp_server_tools("local").await;
        assert_eq!(affected, 1, "应正好影响 1 个会话，实得 {affected}");
        let after = svc
            .tool_names(&info.id)
            .await
            .expect("注销后 tool_names 应成功");
        for expected in ["mcp__local__echo", "mcp__local__add", "mcp__local__get_env"] {
            assert!(
                !after.iter().any(|n| n == expected),
                "注销后会话仍含 {expected}: {after:?}"
            );
        }
        assert!(
            after.iter().any(|n| n == "bash"),
            "注销不应影响非 MCP 基础工具: {after:?}"
        );

        // 6) 清理：断开连接（子进程由 _guard Drop 回收）
        let _ = hub.disconnect("local").await;
    }
}
