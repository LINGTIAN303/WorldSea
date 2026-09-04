//! [HTTP-BRIDGE] 临时模块：RPC 命令注册表 + 分发
//!
//! 把 `#[tauri::command]` 函数暴露为 `POST /rpc { cmd, args }` 可调用：
//! handler 用 `app.state::<T>()` 取 managed state，直接调用原命令函数（`app` 参数传 clone）。
//! 桌面端（Tauri IPC）路径不变；本模块仅供浏览器 HTTP 模式使用。
//! 移除：删除本文件（含 registry 与全部 handler），还原 lib.rs/commands.rs 标记处。
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{Value, from_value, to_value};
use tauri::{AppHandle, Manager};

use crate::{
    algo_commands, commands, entity_commands, frontend_tool_bridge, fs_commands,
    project_commands, router_commands, search_commands, secure_store,
};

pub type RpcResult = Result<Value, String>;
type Handler =
    Arc<dyn Fn(AppHandle, Value) -> Pin<Box<dyn Future<Output = RpcResult> + Send>> + Send + Sync>;

pub struct Registry {
    map: HashMap<&'static str, Handler>,
}

impl Registry {
    pub fn new() -> Self {
        Self { map: HashMap::new() }
    }
    pub fn register(&mut self, name: &'static str, h: Handler) {
        self.map.insert(name, h);
    }
    pub fn get(&self, name: &str) -> Option<&Handler> {
        self.map.get(name)
    }
}

/// 参数包装：sessionId / 名称等（与前端 invoke 参数 camelCase 对齐）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionArgs {
    session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunIdArgs {
    run_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactIdArgs {
    artifact_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTitleArgs {
    session_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionPinnedArgs {
    session_id: String,
    pinned: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewSessionArgs {
    system_prompt: Option<String>,
    provider_config: Option<agent_runtime::llm::config::ProviderConfig>,
    scenario_id: Option<String>,
    workdir: Option<String>,
    entity_storage_root: Option<String>,
    project_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteerArgs {
    session_id: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrimArgs {
    session_id: String,
    up_to_index: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfirmArgs {
    session_id: String,
    confirm_id: String,
    approved: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LevelArgs {
    session_id: String,
    level: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryListArgs {
    session_id: String,
    keyword: Option<String>,
    limit: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryRecallArgs {
    session_id: String,
    query: String,
    top_k: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryChunkArgs {
    session_id: String,
    hook_id: String,
    chunk_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderConfigArgs {
    session_id: String,
    config: agent_runtime::llm::config::ProviderConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyPoolArgs {
    session_id: String,
    keys: Vec<String>,
}

/// 编排运行参数（plan/tot/got/supervisor/multi 共用：session_id + input + options）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrchRunArgs {
    session_id: String,
    input: String,
}

/// 注册全部核心命令（Agent 空间真实调试所需；桌面专用命令不在 HTTP 面）。
/// 各 handler 用运行期分发的 `app` 参数取 State，无需在此捕获 AppHandle。
pub fn register_core(reg: &mut Registry) {
    use commands as c;

    // ── 会话 / 场景 ──
    reg.register("new_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: NewSessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::new_session(st, a.system_prompt, a.provider_config, a.scenario_id, a.workdir, a.entity_storage_root, a.project_id)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("list_scenarios", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::AgentCommandService>();
            c::list_scenarios(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    // 模式注册表（C0-15 / M1-8）：命令菜单数据源，浏览器端同可达
    reg.register("list_patterns", Arc::new(move |_app, _args| {
        Box::pin(async move {
            let r = c::list_patterns();
            Ok(to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("list_sessions", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::AgentCommandService>();
            c::list_sessions(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    // ── run 注册表（B22 / FIX-1 / M1-9）──
    reg.register("get_run", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: RunIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_run(st, a.run_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("get_artifact", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ArtifactIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_artifact(st, a.artifact_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("list_session_runs", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::list_session_runs(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("delete_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::delete_session(st, a.session_id).await.map(|_| Value::Null)
        })
    }));
    reg.register("update_session_title", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionTitleArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::update_session_title(st, a.session_id, a.title).await.map(|_| Value::Null)
        })
    }));
    reg.register("set_session_pinned", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionPinnedArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::set_session_pinned(st, a.session_id, a.pinned).await.map(|_| Value::Null)
        })
    }));

    // ── 对话主链路 ──
    reg.register("send_message", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let p: agent_commands::SendMessageParams = match from_value(unwrap_params(args)) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            // 双克隆：app_cmd 传给命令（move），app_state 仅供取 State（借用分离）
            let app_cmd = app.clone();
            let app_state = app.clone();
            let st = app_state.state::<agent_commands::AgentCommandService>();
            c::send_message(app_cmd, st, p).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("abort", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::abort(st, a.session_id).await.map(|_| Value::Null)
        })
    }));
    reg.register("steer", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SteerArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::steer(st, a.session_id, a.text).await.map(|_| Value::Null)
        })
    }));
    reg.register("clear_history", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::clear_history(st, a.session_id).await.map(|_| Value::Null)
        })
    }));
    reg.register("trim_context", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: TrimArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::trim_context(st, a.session_id, a.up_to_index).await.map(|_| Value::Null)
        })
    }));
    reg.register("get_state", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_state(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("get_messages", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_messages(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("is_streaming", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::is_streaming(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("get_heartbeat", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_heartbeat(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 模型 / 供应商 / 安全 ──
    reg.register("update_model", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let p: agent_commands::UpdateModelParams = match from_value(unwrap_params(args)) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::update_model(st, p).await.map(|_| Value::Null)
        })
    }));
    reg.register("update_thinking_level", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LevelArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::update_thinking_level(st, a.session_id, a.level).await.map(|_| Value::Null)
        })
    }));
    reg.register("get_provider_config", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::get_provider_config(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("set_provider_config", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ProviderConfigArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::set_provider_config(st, a.session_id, a.config).await.map(|_| Value::Null)
        })
    }));
    reg.register("set_api_key_pool", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ApiKeyPoolArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::set_api_key_pool(st, a.session_id, a.keys).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_agent_confirm", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ConfirmArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_confirm(st, a.session_id, a.confirm_id, a.approved).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_agent_set_security_level", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LevelArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_set_security_level(st, a.session_id, a.level).await.map(|_| Value::Null)
        })
    }));
    // 诊断：会话工具名清单（MCP 注入链路验证，2026-08-30）
    reg.register("cmd_agent_tool_names", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_tool_names(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    // 动态刷新会话 system prompt（H5 风险点③，2026-08-30 · 硬约束：新命令必须同步桥接层）
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct UpdateSystemPromptArgs {
        session_id: String,
        system_prompt: Option<String>,
    }
    reg.register("cmd_agent_update_system_prompt", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: UpdateSystemPromptArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_update_system_prompt(st, a.session_id, a.system_prompt).await.map(|_| Value::Null)
        })
    }));

    // ── MCP（H2 重建 2026-08-30 · 硬约束：新命令必须同步桥接层）──
    #[derive(Deserialize)]
    struct McpConnectArgs {
        config: crate::mcp_client::McpConnectionConfig,
    }
    #[derive(Deserialize)]
    struct McpIdArgs {
        id: String,
    }
    reg.register("cmd_mcp_status", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<crate::mcp_commands::McpState>();
            crate::mcp_commands::cmd_mcp_status(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_mcp_saved", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<crate::mcp_commands::McpState>();
            crate::mcp_commands::cmd_mcp_saved(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_mcp_connect", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: McpConnectArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<crate::mcp_commands::McpState>();
            let svc = app.state::<agent_commands::AgentCommandService>();
            crate::mcp_commands::cmd_mcp_connect(st, svc, a.config).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_mcp_disconnect", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: McpIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<crate::mcp_commands::McpState>();
            let svc = app.state::<agent_commands::AgentCommandService>();
            crate::mcp_commands::cmd_mcp_disconnect(st, svc, a.id).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_mcp_list_tools", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: McpIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<crate::mcp_commands::McpState>();
            crate::mcp_commands::cmd_mcp_list_tools(st, a.id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_mcp_save", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: McpConnectArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<crate::mcp_commands::McpState>();
            crate::mcp_commands::cmd_mcp_save(st, a.config).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_mcp_delete", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: McpIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<crate::mcp_commands::McpState>();
            let svc = app.state::<agent_commands::AgentCommandService>();
            crate::mcp_commands::cmd_mcp_delete(st, svc, a.id).await.map(|_| Value::Null)
        })
    }));

    // ── Skills Store（商城六命令 · 风险点② 补桥 2026-08-30）──
    // 全部为同步 fn（含 reqwest::blocking 下载与 fs IO）——不可在 tokio 上下文直呼，
    // 统一 spawn_blocking 到阻塞线程池（download_manifest/install 尤其必须，否则 panic）。
    #[derive(Deserialize)]
    struct SkillsUrlArgs {
        url: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SkillsInstallArgs {
        download_url: String,
        #[serde(default)]
        path_in_archive: String,
        #[serde(default)]
        sha256_expected: String,
        skill_id: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SkillsIdArgs {
        skill_id: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SkillsImportArgs {
        skill_id: String,
        skill_yaml: String,
        skill_md: Option<String>,
    }
    reg.register("cmd_skills_download_manifest", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: SkillsUrlArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_download_manifest(a.url)
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_skills_install", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SkillsInstallArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_install(
                    app2,
                    a.download_url,
                    a.path_in_archive,
                    a.sha256_expected,
                    a.skill_id,
                )
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_skills_uninstall", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SkillsIdArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_uninstall(app2, a.skill_id)
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_skills_get_installed_versions", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_get_installed_versions(app2)
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_skills_import_local", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SkillsImportArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_import_local(app2, a.skill_id, a.skill_yaml, a.skill_md)
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_skills_get_dir", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                crate::skills_store::cmd_skills_get_dir(app2)
            })
            .await
            .map_err(|e| format!("spawn_blocking 失败: {e}"))?
            .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 编排：tot / got / supervisor / multi（plan 已随 B 轨退役移除，2026-09-04）──
    reg.register("orchestrator_run_tot", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: OrchRunArgs = match from_value(args.clone()) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let opt: Option<agent_commands::ToTExecuteOptions> = args_opt_field(args, "options");
            let app_cmd = app.clone();
            let app_state = app.clone();
            let st = app_state.state::<agent_commands::AgentCommandService>();
            c::orchestrator_run_tot(app_cmd, st, a.session_id, a.input, opt).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("orchestrator_run_got", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: OrchRunArgs = match from_value(args.clone()) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let opt: Option<agent_commands::GoTExecuteOptions> = args_opt_field(args, "options");
            let app_cmd = app.clone();
            let app_state = app.clone();
            let st = app_state.state::<agent_commands::AgentCommandService>();
            c::orchestrator_run_got(app_cmd, st, a.session_id, a.input, opt).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("orchestrator_run_supervisor", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: OrchRunArgs = match from_value(args.clone()) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let opt: agent_commands::SupervisorExecuteOptions = args_opt_field(args, "options").ok_or_else(|| "缺少 options 参数".to_string())?;
            let app_cmd = app.clone();
            let app_state = app.clone();
            let st = app_state.state::<agent_commands::AgentCommandService>();
            c::orchestrator_run_supervisor(app_cmd, st, a.session_id, a.input, opt).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("orchestrator_run_multi", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: OrchRunArgs = match from_value(args.clone()) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let opt: agent_commands::MultiAgentExecuteOptions = args_opt_field(args, "options").ok_or_else(|| "缺少 options 参数".to_string())?;
            let app_cmd = app.clone();
            let app_state = app.clone();
            let st = app_state.state::<agent_commands::AgentCommandService>();
            c::orchestrator_run_multi(app_cmd, st, a.session_id, a.input, opt).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 记忆 ──
    reg.register("memory_list", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: MemoryListArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::memory_list(st, a.session_id, a.keyword, a.limit).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("memory_recall", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: MemoryRecallArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::memory_recall(st, a.session_id, a.query, a.top_k).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("memory_archive", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::memory_archive(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("memory_load_chunk", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: MemoryChunkArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::memory_load_chunk(st, a.session_id, a.hook_id, a.chunk_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("memory_boundary", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            let st = app.state::<agent_commands::AgentCommandService>();
            c::memory_boundary(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 终端（args 透传 Value；detect_shells 无参数）──
    reg.register("terminal_execute_command", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_execute_command(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_detect_shells", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_detect_shells(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_create_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_create_session(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_exec_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_exec_session(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_input_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_input_session(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_destroy_session", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_destroy_session(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_list_sessions", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_list_sessions(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // 7.1 真终端：增量拉取 / resize（浏览器端与桌面端一致）
    reg.register("terminal_poll_output", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_poll_output(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("terminal_resize", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::TerminalService>();
            c::terminal_resize(st, unwrap_args(args)).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // 剩余命令集（subagent / group / tool_result / diag / router / loop / longtask / secure / search / entity·kv·file）
    register_extra(reg);
}

// ─────────────────────────────────────────────────────────────
// 以下为补齐命令集（[HTTP-BRIDGE] 临时）：subagent / group / tool_result / diag /
// router / loop_control / long_task / secure_store / search / entity·kv·file
// ─────────────────────────────────────────────────────────────

/// 实体命令统一注册（State<Arc<EntityDb>> + 单参结构体）
macro_rules! ent1 {
    ($reg:expr, $name:literal, $args:ty, $field:ident, $cmd:path) => {{
        $reg.register($name, Arc::new(move |app, args| {
            let app = app.clone();
            Box::pin(async move {
                let a: $args = from_value(args).map_err(|e| e.to_string())?;
                let st = app.state::<Arc<entity_commands::EntityDb>>();
                $cmd(st, a.$field).await.map(|r| to_value(r).unwrap_or(Value::Null))
            })
        }));
    }};
}

/// 实体无参命令
macro_rules! ent0 {
    ($reg:expr, $name:literal, $cmd:path) => {{
        $reg.register($name, Arc::new(move |app, _args| {
            let app = app.clone();
            Box::pin(async move {
                let st = app.state::<Arc<entity_commands::EntityDb>>();
                $cmd(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
            })
        }));
    }};
}

/// Loop Control 单 task_id 命令
macro_rules! loop_cmd {
    ($reg:expr, $name:literal, $cmd:path) => {{
        $reg.register($name, Arc::new(move |app, args| {
            let app = app.clone();
            Box::pin(async move {
                let a: LoopTaskArg = from_value(args).map_err(|e| e.to_string())?;
                let st = app.state::<Arc<agent_commands::LoopControlRegistry>>();
                $cmd(st, a.task_id).await
                    .map(|r| to_value(r).unwrap_or(Value::Null))
                    .map_err(|e| e.to_string())
            })
        }));
    }};
}

/// Long Task 单 task_id 命令
macro_rules! long_cmd {
    ($reg:expr, $name:literal, $cmd:path) => {{
        $reg.register($name, Arc::new(move |app, args| {
            let app = app.clone();
            Box::pin(async move {
                let a: LongTaskIdArg = from_value(args).map_err(|e| e.to_string())?;
                let st = app.state::<agent_commands::LongTaskRepository>();
                $cmd(st, a.task_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
            })
        }));
    }};
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdArg {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyArg {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyValueArg {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityTypeArg {
    entity_type: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityIdArg {
    entity_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityJsonArg {
    entity_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChangesArg {
    id: String,
    changes_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntitiesJsonArg {
    entities_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationJsonArg {
    relation_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationsJsonArg {
    relations_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileJsonArg {
    file_json: String,
    content_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubAgentIdArg {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubAgentSpecArg {
    spec: agent_runtime::supervisor::SubAgentSpec,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonStrArg {
    json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateTitleArgs {
    session_id: String,
    first_message: String,
    first_reply: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveWorkdirArg {
    path: String,
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkdirIdArg {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateWorkdirArg {
    session_id: String,
    workdir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsWriteArg {
    path: String,
    content: String,
    create_dirs: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsPathArg {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsReadArg {
    path: String,
    encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsListArg {
    path: String,
    recursive: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsCopyArg {
    src: String,
    dest: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsSearchArg {
    path: String,
    pattern: String,
    search_type: Option<String>,
    max_results: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdArg {
    project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SubAgentClearArg {
    session_id: String,
    sub_agent_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupParticipantArg {
    group_id: String,
    participant_id: String,
    system_prompt: Option<String>,
    provider_config: Option<agent_runtime::llm::config::ProviderConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GroupArg {
    group_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolResultArg {
    call_id: String,
    ok: bool,
    result: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagArg {
    label: String,
    payload: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopCreateArg {
    task_id: String,
    config: Option<agent_runtime::loop_control::LoopControlConfig>,
    session_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopTaskArg {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoopTokensArg {
    task_id: String,
    tokens: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LongTaskRecordArg {
    record: agent_runtime::long_task::LongTaskRecord,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LongTaskIdArg {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LongTaskHeartbeatArg {
    task_id: String,
    last_heartbeat_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LongTaskStatusArg {
    task_id: String,
    status: agent_runtime::long_task::LongTaskStatus,
    ended_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouterTargetsArg {
    session_id: String,
    targets: Vec<agent_runtime::router::RouteTarget>,
    use_llm: Option<bool>,
    fallback_target_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RouterRouteArg {
    session_id: String,
    input: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecureKeyArg {
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecureSetArg {
    key: String,
    value: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchConfigArg {
    config: search_commands::SearchConfig,
}

// ── cmd_algo_* 参数（graphJson 等 JSON 字符串；config 可选）──
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphJsonConfigArgs {
    graph_json: String,
    config_json: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphAlgorithmArgs {
    graph_json: String,
    algorithm_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphPathArgs {
    graph_json: String,
    source: String,
    target: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphJsonArgs {
    graph_json: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageRankArgs {
    graph_json: String,
    damping: Option<f64>,
    max_iterations: Option<usize>,
    tolerance: Option<f64>,
}

/// 补齐注册：subagent / group / tool_result / diag / router / loop / longtask / secure / search / entity·kv·file / algo
fn register_extra(reg: &mut Registry) {
    use commands as c;

    // ── 工作区目录实体 + LLM 会话标题生成（Phase 4/5）──
    reg.register("cmd_list_workdirs", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_list_workdirs(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_save_workdir", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SaveWorkdirArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_save_workdir(st, a.path, a.label).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_delete_workdir", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: WorkdirIdArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_delete_workdir(st, a.id).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_agent_generate_title", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: GenerateTitleArgs = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_generate_title(app.clone(), st, a.session_id, a.first_message, a.first_reply)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_update_session_workdir", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: UpdateWorkdirArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_update_session_workdir(st, a.session_id, a.workdir)
                .await
                .map(|_| Value::Null)
        })
    }));

    // ── 文件系统命令（cmd_fs_*：纯文件操作，无 State）──
    reg.register("cmd_fs_write", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsWriteArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_write(a.path, a.content, a.create_dirs)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_fs_read", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsReadArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_read(a.path, a.encoding)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_fs_list", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsListArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_list(a.path, a.recursive)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_fs_delete", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsPathArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_delete(a.path)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_open_in_explorer", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsPathArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_open_in_explorer(a.path)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_fs_stat", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsPathArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_stat(a.path)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_fs_mkdir", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsPathArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_mkdir(a.path)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_fs_copy", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsCopyArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_copy(a.src, a.dest)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_fs_rename", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsCopyArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_rename(a.src, a.dest)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_fs_search", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: FsSearchArg = from_value(args).map_err(|e| e.to_string())?;
            fs_commands::cmd_fs_search(a.path, a.pattern, a.search_type, a.max_results)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 项目命令（cmd_switch_project / cmd_get_app_data_dir / cmd_delete_project_db）──
    reg.register("cmd_switch_project", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: ProjectIdArg = from_value(args).map_err(|e| e.to_string())?;
            project_commands::cmd_switch_project(a.project_id)
                .await
                .map(|_| Value::Null)
        })
    }));
    reg.register("cmd_get_app_data_dir", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            project_commands::cmd_get_app_data_dir(app)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_get_home_dir", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            project_commands::cmd_get_home_dir(app)
                .await
                .map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_delete_project_db", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ProjectIdArg = from_value(args).map_err(|e| e.to_string())?;
            project_commands::cmd_delete_project_db(a.project_id, app)
                .await
                .map(|_| Value::Null)
        })
    }));

    // ── 子 Agent ──
    reg.register("subagent_list_specs", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_list_specs(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_register_spec", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SubAgentSpecArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_register_spec(st, a.spec).await.map(|_| Value::Null)
        })
    }));
    reg.register("subagent_remove_spec", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SubAgentIdArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_remove_spec(st, a.id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_export_specs", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_export_specs(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_import_specs", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: JsonStrArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_import_specs(st, a.json).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_list_instances", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_list_instances(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_clear_instance", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SubAgentClearArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_clear_instance(st, a.session_id, a.sub_agent_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("subagent_clear_instances", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::subagent_clear_instances(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── 群聊参与者 ──
    reg.register("create_group_session_participant", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: GroupParticipantArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::create_group_session_participant(st, a.group_id, a.participant_id, a.system_prompt, a.provider_config)
                .await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("list_group_session_participants", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: GroupArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::list_group_session_participants(st, a.group_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("delete_group_session_participants", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: GroupArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::AgentCommandService>();
            c::delete_group_session_participants(st, a.group_id).await.map(|_| Value::Null)
        })
    }));

    // ── FrontendToolBridge 回传 / 诊断 ──
    reg.register("cmd_agent_tool_result", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ToolResultArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<frontend_tool_bridge::FrontendToolBridge>>();
            c::cmd_agent_tool_result(st, a.call_id, a.ok, a.result).map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_diag_log", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: DiagArg = match from_value(args) { Ok(v) => v, Err(e) => return Err(e.to_string()) };
            c::cmd_diag_log(a.label, a.payload).map(|_| Value::Null)
        })
    }));

    // ── Loop Control ──
    reg.register("cmd_loop_control_create", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LoopCreateArg = from_value(args).map_err(|e| e.to_string())?;
            let app_cmd = app.clone();
            let s1 = app.clone();
            let s2 = app.clone();
            let st_reg = s1.state::<Arc<agent_commands::LoopControlRegistry>>();
            let st_svc = s2.state::<agent_commands::AgentCommandService>();
            c::cmd_loop_control_create(app_cmd, st_reg, st_svc, a.task_id, a.config, a.session_id)
                .await.map(|r| to_value(r).unwrap_or(Value::Null)).map_err(|e| e.to_string())
        })
    }));
    loop_cmd!(reg, "cmd_loop_control_check", c::cmd_loop_control_check);
    loop_cmd!(reg, "cmd_loop_control_record_turn", c::cmd_loop_control_record_turn);
    loop_cmd!(reg, "cmd_loop_control_record_tool_call", c::cmd_loop_control_record_tool_call);
    loop_cmd!(reg, "cmd_loop_control_update_activity", c::cmd_loop_control_update_activity);
    loop_cmd!(reg, "cmd_loop_control_reset_counters", c::cmd_loop_control_reset_counters);
    loop_cmd!(reg, "cmd_loop_control_get_config", c::cmd_loop_control_get_config);
    loop_cmd!(reg, "cmd_loop_control_get_status", c::cmd_loop_control_get_status);
    loop_cmd!(reg, "cmd_loop_control_destroy", c::cmd_loop_control_destroy);
    reg.register("cmd_loop_control_record_tokens", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LoopTokensArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<agent_commands::LoopControlRegistry>>();
            c::cmd_loop_control_record_tokens(st, a.task_id, a.tokens).await.map(|_| Value::Null).map_err(|e| e.to_string())
        })
    }));
    reg.register("cmd_loop_control_list_tasks", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<Arc<agent_commands::LoopControlRegistry>>();
            c::cmd_loop_control_list_tasks(st).await.map(|r| to_value(r).unwrap_or(Value::Null)).map_err(|e| e.to_string())
        })
    }));

    // ── Long Task ──
    reg.register("cmd_long_task_save", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LongTaskRecordArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::LongTaskRepository>();
            c::cmd_long_task_save(st, a.record).await.map(|_| Value::Null)
        })
    }));
    long_cmd!(reg, "cmd_long_task_load", c::cmd_long_task_load);
    long_cmd!(reg, "cmd_long_task_delete", c::cmd_long_task_delete);
    reg.register("cmd_long_task_list_running", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::LongTaskRepository>();
            c::cmd_long_task_list_running(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_long_task_list_all", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<agent_commands::LongTaskRepository>();
            c::cmd_long_task_list_all(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_long_task_update_heartbeat", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LongTaskHeartbeatArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::LongTaskRepository>();
            c::cmd_long_task_update_heartbeat(st, a.task_id, a.last_heartbeat_at).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_long_task_update_status", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: LongTaskStatusArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<agent_commands::LongTaskRepository>();
            c::cmd_long_task_update_status(st, a.task_id, a.status, a.ended_at).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── Router ──
    reg.register("router_create", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: RouterTargetsArg = from_value(args).map_err(|e| e.to_string())?;
            let s1 = app.clone();
            let s2 = app.clone();
            let st = s1.state::<agent_commands::AgentCommandService>();
            let reg_state = s2.state::<router_commands::RouterRegistry>();
            router_commands::router_create(st, reg_state, a.session_id, a.targets, a.use_llm, a.fallback_target_id)
                .await.map(|_| Value::Null)
        })
    }));
    reg.register("router_route", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: RouterRouteArg = from_value(args).map_err(|e| e.to_string())?;
            let s1 = app.clone();
            let s2 = app.clone();
            let st = s1.state::<agent_commands::AgentCommandService>();
            let reg_state = s2.state::<router_commands::RouterRegistry>();
            router_commands::router_route(st, reg_state, a.session_id, a.input)
                .await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("router_set_targets", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: RouterTargetsArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<router_commands::RouterRegistry>();
            router_commands::router_set_targets(st, a.session_id, a.targets, a.use_llm, a.fallback_target_id)
                .await.map(|_| Value::Null)
        })
    }));
    reg.register("router_get_state", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<router_commands::RouterRegistry>();
            router_commands::router_get_state(st, a.session_id).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("router_destroy", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SessionArgs = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<router_commands::RouterRegistry>();
            router_commands::router_destroy(st, a.session_id).await.map(|_| Value::Null)
        })
    }));
    reg.register("router_list_sessions", Arc::new(move |app, _args| {
        let app = app.clone();
        Box::pin(async move {
            let st = app.state::<router_commands::RouterRegistry>();
            router_commands::router_list_sessions(st).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));

    // ── Secure Store / Search ──
    // 注意：manage 的是 Arc<SecureStore>（SecureStore::new 返回 Arc<Self>），
    // state 取键必须同为 Arc<SecureStore>——取裸类型会 panic（存量 bug，2026-08-29 修）
    reg.register("cmd_secure_store", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SecureSetArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<std::sync::Arc<secure_store::SecureStore>>();
            secure_store::cmd_secure_store(st, a.key, a.value).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_secure_load", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SecureKeyArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<std::sync::Arc<secure_store::SecureStore>>();
            secure_store::cmd_secure_load(st, a.key).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_secure_delete", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SecureKeyArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<std::sync::Arc<secure_store::SecureStore>>();
            secure_store::cmd_secure_delete(st, a.key).await.map(|_| Value::Null)
        })
    }));
    reg.register("set_search_config", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: SearchConfigArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<search_commands::SearchProviderChain>>();
            search_commands::set_search_config(st, a.config).await.map(|_| Value::Null)
        })
    }));

    // ── Entity / Relation / KV / File（State<Arc<EntityDb>>）──
    use entity_commands as e;
    // 无参命令
    ent0!(reg, "cmd_get_all_entities", e::cmd_get_all_entities);
    ent0!(reg, "cmd_clear_entities", e::cmd_clear_entities);
    ent0!(reg, "cmd_count_entities_by_type", e::cmd_count_entities_by_type);
    ent0!(reg, "cmd_get_all_relations", e::cmd_get_all_relations);
    ent0!(reg, "cmd_clear_relations", e::cmd_clear_relations);
    ent0!(reg, "cmd_kv_get_all", e::cmd_kv_get_all);
    ent0!(reg, "cmd_get_all_files", e::cmd_get_all_files);
    // 单参命令
    ent1!(reg, "cmd_get_entity", IdArg, id, e::cmd_get_entity);
    ent1!(reg, "cmd_get_entities_by_type", EntityTypeArg, entity_type, e::cmd_get_entities_by_type);
    ent1!(reg, "cmd_put_entity", EntityJsonArg, entity_json, e::cmd_put_entity);
    ent1!(reg, "cmd_delete_entity", IdArg, id, e::cmd_delete_entity);
    ent1!(reg, "cmd_import_entities", EntitiesJsonArg, entities_json, e::cmd_import_entities);
    ent1!(reg, "cmd_get_relations_by_entity", EntityIdArg, entity_id, e::cmd_get_relations_by_entity);
    ent1!(reg, "cmd_put_relation", RelationJsonArg, relation_json, e::cmd_put_relation);
    ent1!(reg, "cmd_delete_relation", IdArg, id, e::cmd_delete_relation);
    ent1!(reg, "cmd_delete_relations_by_entity", EntityIdArg, entity_id, e::cmd_delete_relations_by_entity);
    ent1!(reg, "cmd_import_relations", RelationsJsonArg, relations_json, e::cmd_import_relations);
    ent1!(reg, "cmd_kv_get", KeyArg, key, e::cmd_kv_get);
    ent1!(reg, "cmd_kv_delete", KeyArg, key, e::cmd_kv_delete);
    ent1!(reg, "cmd_get_file", IdArg, id, e::cmd_get_file);
    ent1!(reg, "cmd_get_file_by_path", PathArg, path, e::cmd_get_file_by_path);
    ent1!(reg, "cmd_get_files_by_entity", EntityIdArg, entity_id, e::cmd_get_files_by_entity);
    ent1!(reg, "cmd_delete_file", IdArg, id, e::cmd_delete_file);
    ent1!(reg, "cmd_get_file_content", IdArg, id, e::cmd_get_file_content);
    // 多参命令（id+changes）
    reg.register("cmd_update_entity", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ChangesArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<entity_commands::EntityDb>>();
            e::cmd_update_entity(st, a.id, a.changes_json).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_update_relation", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ChangesArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<entity_commands::EntityDb>>();
            e::cmd_update_relation(st, a.id, a.changes_json).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_update_file", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: ChangesArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<entity_commands::EntityDb>>();
            e::cmd_update_file(st, a.id, a.changes_json).await.map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_kv_set", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: KeyValueArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<entity_commands::EntityDb>>();
            e::cmd_kv_set(st, a.key, a.value).await.map(|_| Value::Null)
        })
    }));
    reg.register("cmd_put_file", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let a: FileJsonArg = from_value(args).map_err(|e| e.to_string())?;
            let st = app.state::<Arc<entity_commands::EntityDb>>();
            e::cmd_put_file(st, a.file_json, a.content_json).await.map(|_| Value::Null)
        })
    }));

    // ── 图布局 / 图分析算法（cmd_algo_*：纯函数，无需 app state）──
    reg.register("cmd_algo_force_layout", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonConfigArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_force_layout(a.graph_json, a.config_json)
        })
    }));
    reg.register("cmd_algo_radial_layout", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonConfigArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_radial_layout(a.graph_json, a.config_json)
        })
    }));
    reg.register("cmd_algo_tree_layout", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonConfigArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_tree_layout(a.graph_json, a.config_json)
        })
    }));
    reg.register("cmd_algo_grid_layout", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonConfigArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_grid_layout(a.graph_json, a.config_json)
        })
    }));
    reg.register("cmd_algo_layout_unified", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphAlgorithmArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_layout_unified(a.graph_json, a.algorithm_json)
        })
    }));
    reg.register("cmd_algo_dijkstra_path", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphPathArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_dijkstra_path(a.graph_json, a.source, a.target)
        })
    }));
    reg.register("cmd_algo_connected_components", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_connected_components(a.graph_json)
        })
    }));
    reg.register("cmd_algo_pagerank", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: PageRankArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_pagerank(a.graph_json, a.damping, a.max_iterations, a.tolerance)
        })
    }));
    reg.register("cmd_algo_community_detection", Arc::new(move |_app, args| {
        Box::pin(async move {
            let a: GraphJsonArgs = from_value(args).map_err(|e| e.to_string())?;
            algo_commands::cmd_algo_community_detection(a.graph_json)
        })
    }));

    // ── v2 权限规则引擎（方向3 P0，2026-09-03）：白名单 / 上锁名单（无 state，纯文件） ──
    reg.register("cmd_perm_rules_get", Arc::new(move |_app, _args| {
        Box::pin(async move {
            c::cmd_perm_rules_get().map(|r| to_value(r).unwrap_or(Value::Null))
        })
    }));
    reg.register("cmd_perm_rule_add_allow_command", Arc::new(move |_app, args| {
        Box::pin(async move {
            let p = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string();
            c::cmd_perm_rule_add_allow_command(p).map(|_| Value::Null)
        })
    }));
    reg.register("cmd_perm_rule_remove_allow_command", Arc::new(move |_app, args| {
        Box::pin(async move {
            let p = args.get("pattern").and_then(|v| v.as_str()).unwrap_or("").to_string();
            c::cmd_perm_rule_remove_allow_command(p).map(|_| Value::Null)
        })
    }));
    reg.register("cmd_perm_rule_add_allow_path", Arc::new(move |_app, args| {
        Box::pin(async move {
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            c::cmd_perm_rule_add_allow_path(p).map(|_| Value::Null)
        })
    }));
    reg.register("cmd_perm_rule_remove_allow_path", Arc::new(move |_app, args| {
        Box::pin(async move {
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            c::cmd_perm_rule_remove_allow_path(p).map(|_| Value::Null)
        })
    }));
    reg.register("cmd_perm_rule_add_lock", Arc::new(move |_app, args| {
        Box::pin(async move {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let read_ok = args.get("readOk").and_then(|v| v.as_bool()).unwrap_or(true);
            let command_ok = args.get("commandOk").and_then(|v| v.as_bool()).unwrap_or(false);
            let write_ok = args.get("writeOk").and_then(|v| v.as_bool()).unwrap_or(false);
            c::cmd_perm_rule_add_lock(path, read_ok, command_ok, write_ok).map(|_| Value::Null)
        })
    }));
    reg.register("cmd_perm_rule_remove_lock", Arc::new(move |_app, args| {
        Box::pin(async move {
            let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
            c::cmd_perm_rule_remove_lock(p).map(|_| Value::Null)
        })
    }));
    // A7 安全级别（补齐桥接：旧有命令行存在但 rpc 未注册）
    reg.register("cmd_agent_set_security_level", Arc::new(move |app, args| {
        let app = app.clone();
        Box::pin(async move {
            let sid = args.get("sessionId").or_else(|| args.get("session_id")).and_then(|v| v.as_str()).unwrap_or("").to_string();
            let level = args.get("level").and_then(|v| v.as_str()).unwrap_or("interact").to_string();
            let st = app.state::<agent_commands::AgentCommandService>();
            c::cmd_agent_set_security_level(st, sid, level).await.map(|_| Value::Null)
        })
    }));
}

/// 兼容 Tauri IPC 命名参数：命令签名是 `params: SomeStruct`，桌面 invoke 用 `{ params: {...} }`
/// 包裹；HTTP RPC 也收到同样结构 → 反序列化前先解包（无 `params` 字段时原样返回）。
fn unwrap_params(args: Value) -> Value {
    if let Some(inner) = args.get("params") {
        if !inner.is_null() {
            return inner.clone();
        }
    }
    args
}

/// 兼容 Tauri IPC 命名参数（`args` 变体）：命令签名是 `args: Value` 时前端用 `{ args: {...} }`
/// 包裹（如 terminal_*），解包 `args` 字段后传入命令。
fn unwrap_args(args: Value) -> Value {
    if let Some(inner) = args.get("args") {
        if !inner.is_null() {
            return inner.clone();
        }
    }
    args
}

/// 从 args 对象取字段反序列化（缺失/空返回 None）
fn args_opt_field<T: DeserializeOwned>(args: Value, key: &str) -> Option<T> {
    let v = args.get(key)?;
    if v.is_null() { return None; }
    from_value(v.clone()).ok()
}

/// 供 mod.rs 分发：未注册命令的占位错误
pub fn desktop_only(name: &str) -> RpcResult {
    Err(format!(
        "命令 '{name}' 为桌面专用（HTTP 桥未桥接）。前端应走 mock/不可用。"
    ))
}
