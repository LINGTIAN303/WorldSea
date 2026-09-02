//! MCP 客户端 Hub（H2 重建 P2，2026-08-30 · Rust 原生 rmcp 路线）
//!
//! - [`McpHub`]：连接管理器（stdio / streamable-http 双传输），持有活跃连接与
//!   工具快照（供 new_agent 时注入会话 tool_bus）；
//! - [`RmcpCaller`]：rmcp `RunningService` 适配为 kernel 的 `McpCaller` trait
//!   （kernel 的 McpTool/McpToolAdapter/ToolBus 集成与测试全部现成）；
//! - 连接生命周期 = 应用生命周期（拍板：长任务/桌面刷新不断连）。
//!
//! 工具名契约：`mcp_{server_id}_{tool_name}`（kernel McpTool 既有规则）。
//! 已连接工具对新会话生效（与技能/规则同策略）；已有会话不热更新（v1）。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use http::header::{HeaderName, HeaderValue};
use rmcp::model::{CallToolRequestParams, ContentBlock};
use rmcp::service::{RunningService, RoleClient};
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, ConfigureCommandExt,
    StreamableHttpClientTransport, TokioChildProcess,
};
use rmcp::ServiceExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

use agent_runtime::mcp::{McpCaller, McpError, McpToolAdapter, McpToolInfo};
use agent_runtime::tool::Tool;

// ─── 连接配置（前端 McpPanel ↔ SQLite 持久化 ↔ 连接层三方可序列化） ──────────

/// MCP 服务器连接配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConnectionConfig {
    /// 唯一 id（工具名前缀 `mcp_{id}_` 的来源）
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

// ─── 内部连接状态 ────────────────────────────────────────────

type ClientService = RunningService<RoleClient, ()>;

struct McpConnection {
    config: McpConnectionConfig,
    service: Arc<ClientService>,
    tools: Vec<McpToolInfo>,
}

/// rmcp `RunningService` → kernel `McpCaller` 适配
struct RmcpCaller {
    service: Arc<ClientService>,
}

#[async_trait::async_trait]
impl McpCaller for RmcpCaller {
    async fn call_tool(&self, name: &str, args: Value) -> Result<Value, McpError> {
        // 3.1 的 CallToolRequestParams 为 #[non_exhaustive]，走 new + 字段赋值
        let mut params = CallToolRequestParams::new(name.to_owned());
        params.arguments = args.as_object().cloned();
        let result = self
            .service
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
            .service
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

// ─── Hub ────────────────────────────────────────────

/// MCP 连接 Hub：管理活跃连接 + 已连接工具快照
///
/// `tools_snapshot` 用同步 Mutex 存放（供 `tools_for_bus` 的同步 provider 闭包读取，
/// 规避 async 锁在同步上下文不可用的问题）；connect/disconnect 成功后原子更新。
pub struct McpHub {
    connections: RwLock<HashMap<String, McpConnection>>,
    tools_snapshot: Mutex<Vec<Arc<dyn Tool>>>,
}

impl McpHub {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            tools_snapshot: Mutex::new(Vec::new()),
        }
    }

    /// 连接 MCP 服务器（stdio / http 按配置分派），成功后刷新工具发现与快照。
    /// 已连接的同 id 先断开重建。
    pub async fn connect(&self, config: McpConnectionConfig) -> Result<Vec<McpToolInfo>, String> {
        // 幂等：同 id 已连接则先断开
        if self.connections.read().await.contains_key(&config.id) {
            self.disconnect(&config.id).await?;
        }

        let service: Arc<ClientService> = match config.transport.as_str() {
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
                    }),
                )
                .map_err(|e| format!("启动 MCP 子进程失败: {e}"))?;
                Arc::new(
                    ()
                        .serve(transport)
                        .await
                        .map_err(|e| format!("MCP 初始化握手失败: {e}"))?,
                )
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
                Arc::new(
                    ()
                        .serve(transport)
                        .await
                        .map_err(|e| format!("MCP 连接失败: {e}"))?,
                )
            }
            other => return Err(format!("不支持的传输方式: {other}")),
        };

        let caller = Arc::new(RmcpCaller {
            service: service.clone(),
        });
        let tools = caller.list_tools().await.map_err(|e| e.to_string())?;

        let id = config.id.clone();
        self.connections.write().await.insert(
            id,
            McpConnection {
                config,
                service,
                tools: tools.clone(),
            },
        );
        self.refresh_snapshot();
        Ok(tools)
    }

    /// 断开连接（清理快照与连接表项）
    ///
    /// 注：rmcp `RunningService::cancel` 需要所有权（服务 Arc 被 caller 共享无法取出），
    /// v1 采用 drop 语义——快照移除后 service 引用计数归零即停；子进程随句柄关闭退出。
    /// 优雅关停（cancel）待后续版本调整持有方式。
    pub async fn disconnect(&self, id: &str) -> Result<(), String> {
        let conn = self.connections.write().await.remove(id);
        match conn {
            Some(conn) => {
                drop(conn.service); // Arc 计数归零 → rmcp service 停止
                self.refresh_snapshot();
                Ok(())
            }
            None => Err(format!("MCP 连接不存在: {id}")),
        }
    }

    /// 查询某连接的工具清单（连接时缓存）
    pub async fn tools_of(&self, id: &str) -> Option<Vec<McpToolInfo>> {
        self.connections.read().await.get(id).map(|c| c.tools.clone())
    }

    /// 连接状态列表（前端面板渲染）
    pub async fn status(&self) -> Vec<McpStatusEntry> {
        self.connections
            .read()
            .await
            .values()
            .map(|c| McpStatusEntry {
                id: c.config.id.clone(),
                name: c.config.name.clone(),
                connected: true,
                tool_count: c.tools.len() as u32,
            })
            .collect()
    }

    /// 刷新已连接工具快照（同步可读，供 new_agent 的 provider 闭包消费）
    fn refresh_snapshot(&self) {
        let mut tools: Vec<Arc<dyn Tool>> = Vec::new();
        if let Ok(map) = self.connections.try_read() {
            for conn in map.values() {
                let caller = Arc::new(RmcpCaller {
                    service: conn.service.clone(),
                });
                tools.extend(McpToolAdapter::adapt_all(
                    conn.tools.clone(),
                    conn.config.id.clone(),
                    caller,
                ));
            }
        }
        if let Ok(mut snap) = self.tools_snapshot.lock() {
            *snap = tools;
        }
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
    pub connected: bool,
    pub tool_count: u32,
}

// ─── e2e：连接真实 MCP 服务器闭环验证（2026-09-01） ──────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::net::TcpStream;

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
    ///   `cargo test -p worldsmith-tauri-app --lib -- --ignored mcp_e2e`
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

        // 3) 快照注入：tools_for_bus 得到带 mcp_{server_id}_ 前缀的工具
        let bus_tools = hub.tools_for_bus();
        assert_eq!(bus_tools.len(), 3, "快照应有 3 个工具");
        let bus_names: Vec<String> = bus_tools.iter().map(|t| t.name().to_string()).collect();
        for expected in ["mcp_local_echo", "mcp_local_add", "mcp_local_get_env"] {
            assert!(bus_names.iter().any(|n| n == expected), "缺 {expected}: {bus_names:?}");
        }

        // 4) 工具调用：add(2,3) → 结构化结果 {sum:5}（RmcpCaller 结构化返回优先）
        let add_tool = bus_tools
            .iter()
            .find(|t| t.name() == "mcp_local_add")
            .expect("add 工具应在快照中");
        let result = add_tool
            .execute(serde_json::json!({ "a": 2, "b": 3 }))
            .await
            .expect("调用 add 工具应成功");
        assert_eq!(result["sum"], 5, "add 结构化结果应为 5，实得 {result}");
        // echo 文本返回验证
        let echo_tool = bus_tools
            .iter()
            .find(|t| t.name() == "mcp_local_echo")
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
        //    tool_names 断言会话拿到带 mcp_{server_id}_ 前缀的 MCP 工具（产品闭环收口）
        let mut svc = agent_commands::AgentCommandService::new();
        svc.set_mcp_tools_provider(Arc::new({
            let hub = hub.clone();
            move || hub.tools_for_bus()
        }));
        let info = svc
            .new_session(None, None, None, None, None)
            .await
            .expect("new_session 应成功");
        let session_tools = svc
            .tool_names(&info.id)
            .await
            .expect("tool_names 应成功");
        for expected in ["mcp_local_echo", "mcp_local_add", "mcp_local_get_env"] {
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
        for expected in ["mcp_local_echo", "mcp_local_add", "mcp_local_get_env"] {
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
