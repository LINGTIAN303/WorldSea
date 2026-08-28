//! 终端工具（terminal tools）：execute_command / detect_shells / 持久化 Shell 会话，详细见 docs/details/注释/agent-commands/terminal.md

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_runtime::tool::{Tool, ToolError};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use regex::Regex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use std::process::Stdio;

/// 默认单次命令执行超时（毫秒）
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// 持久化会话单次命令读取超时（毫秒）
const DEFAULT_SESSION_TIMEOUT_MS: u64 = 30_000;

/// 把 `__meta` 操作元数据合并进结果 value（前端 ToolRow 读它展示语义操作段）
///
/// 与 fs_tools::with_meta 同一约定：object 直接加 `__meta` 键；纯字符串包
/// `{ value, __meta }`。见前端 toolSemantics.ts。
fn with_meta(result: serde_json::Value, meta: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = result.as_object() {
        let mut obj = obj.clone();
        obj.insert("__meta".to_string(), meta);
        serde_json::Value::Object(obj)
    } else {
        serde_json::json!({ "value": result, "__meta": meta })
    }
}

/// 清理 ANSI 转义码与不可打印字符（对齐 TS 端 execute_command 的清理逻辑）
fn clean_ansi(input: &str) -> String {
    // CSI 序列（ESC [ ... 字母）与 OSC 序列（ESC ] ... BEL/ST）
    let csi = Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]").unwrap();
    let osc = Regex::new(r"\x1b\].*?(\x07|\x1b\\)").unwrap();
    let ctrl = Regex::new(r"[\x00-\x08\x0B\x0C\x0E-\x1F]").unwrap();
    let out = csi.replace_all(input, "");
    let out = osc.replace_all(&out, "");
    ctrl.replace_all(&out, "").into_owned()
}

/// 默认 shell 路径（按平台）
fn default_shell() -> &'static str {
    if cfg!(target_os = "windows") {
        "cmd.exe"
    } else {
        "/bin/sh"
    }
}

/// 构建执行单次命令的 `Command`（按平台选择 shell）
fn build_command(
    command: &str,
    cwd: Option<&str>,
    env: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Command {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd.exe");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(command);
        c
    };
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    if let Some(map) = env {
        for (k, v) in map {
            if let Some(v) = v.as_str() {
                cmd.env(k, v);
            }
        }
    }
    cmd
}

/// 解析 `env` 参数为 `(k, v)` 字符串映射
fn parse_env(args: &serde_json::Value) -> Option<Vec<(String, String)>> {
    args.get("env")?.as_object().map(|map| {
        map.iter()
            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
            .collect()
    })
}

// ─── 会话管理器 ────────────────────────────────────────────

/// 持久化 Shell 会话状态
struct ShellSession {
    child: Child,
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    shell_path: String,
    cwd: String,
}

/// 持久化 Shell 会话注册表（全局共享，跨 Agent 会话保持）
#[derive(Clone, Default)]
pub struct ShellSessionManager {
    sessions: Arc<Mutex<HashMap<String, ShellSession>>>,
}

impl ShellSessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// 在限定时间内同时读取 stdout/stderr，超时返回已收集内容
    async fn read_output(
        stdout: &mut ChildStdout,
        stderr: &mut ChildStderr,
        timeout: Duration,
    ) -> (String, String) {
        let mut out = String::new();
        let mut err = String::new();
        let _ = tokio::time::timeout(timeout, async {
            let mut out_buf = [0u8; 4096];
            let mut err_buf = [0u8; 4096];
            loop {
                tokio::select! {
                    r = stdout.read(&mut out_buf) => match r {
                        Ok(0) | Err(_) => break,
                        Ok(n) => out.push_str(&String::from_utf8_lossy(&out_buf[..n])),
                    },
                    r = stderr.read(&mut err_buf) => match r {
                        Ok(0) | Err(_) => break,
                        Ok(n) => err.push_str(&String::from_utf8_lossy(&err_buf[..n])),
                    },
                }
            }
        })
        .await;
        (out, err)
    }
}

// ─── 单次命令执行 ─────────────────────────────────────────

/// 解析命令的工作目录（cwd）
///
/// # 规则
/// - `cwd` 参数显式传入 → 用之；若 workdir 存在且该 cwd 越界 → 拒绝
/// - `cwd` 参数缺省 → 默认取 `ctx.workdir`（shell cwd 默认注入工作区）；
///   workdir 为 None（未绑定的旧库/旧会话）→ 返回 None，沿用当前进程 cwd，向后兼容
fn resolve_command_cwd(
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<Option<String>, ToolError> {
    if let Some(cwd) = args.get("cwd").and_then(|v| v.as_str()) {
        // 显式传入的 cwd 越出 workdir → 拒绝（仅当 workdir 存在时判定）
        if ctx.workdir.is_some() && !ctx.is_within_workdir(cwd) {
            return Err(ToolError::Execution(format!(
                "拒绝在 workspace 之外执行命令，cwd 越界: {cwd}"
            )));
        }
        return Ok(Some(cwd.to_string()));
    }
    // 缺省：workdir 存在则默认注入为 cwd；否则 None（当前进程 cwd）
    if let Some(wd) = &ctx.workdir {
        return Ok(Some(wd.to_string_lossy().to_string()));
    }
    Ok(None)
}

/// 单次命令执行工具（对齐 TS 端 `execute_command`）
pub struct ExecuteCommandTool;

impl ExecuteCommandTool {
    async fn run(
        &self,
        args: serde_json::Value,
        ctx: &ToolContext,
    ) -> Result<serde_json::Value, ToolError> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 command 参数".into()))?
            .to_string();
        if command.trim().is_empty() {
            return Err(ToolError::ArgsParse("command 不能为空".into()));
        }
        // 任务29/E1 盲区词法防护：命令串同现写操作词与受保护目录字样 → 拒绝并引导语义层
        //（真实链路防护——Rust 主循环的 terminal 工具组；非完备声明见 fs_tools 模块注释）
        if crate::fs_tools::shell_command_touches_protected_path(ctx.workdir.as_deref(), &command) {
            return Ok(serde_json::json!({
                "ok": false,
                "error": crate::fs_tools::PROTECTED_WRITE_ERROR,
                "command": &command,
            }));
        }
        let cwd = resolve_command_cwd(&args, ctx)?;
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let env_list = parse_env(&args);

        let mut cmd = build_command(&command, cwd.as_deref(), None);
        if let Some(env_list) = env_list {
            for (k, v) in env_list {
                cmd.env(k, v);
            }
        }

        let started = Instant::now();
        let output = match tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return Err(ToolError::Execution(format!("命令启动失败: {e}"))),
            Err(_) => return Err(ToolError::Execution("命令执行超时".into())),
        };
        let duration_ms = started.elapsed().as_millis() as u64;

        let stdout = clean_ansi(&String::from_utf8_lossy(&output.stdout));
        let stderr = clean_ansi(&String::from_utf8_lossy(&output.stderr));
        let exit_code = output.status.code();
        Ok(with_meta(
            serde_json::json!({
                "stdout": if stdout.is_empty() { "(命令已执行，无输出)" } else { &stdout },
                "stderr": stderr,
                "exit_code": exit_code,
            }),
            serde_json::json!({
                "op": "cmd",
                "command": &command,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
            }),
        ))
    }
}

#[async_trait]
impl Tool for ExecuteCommandTool {
    fn name(&self) -> &str {
        "execute_command"
    }
    fn description(&self) -> &str {
        "在本地终端执行 shell 命令并返回输出。仅在需要系统级操作时使用（如文件系统操作、运行脚本、安装依赖等），项目数据操作请优先使用内驱工具。支持通过 env 参数注入环境变量。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的 shell 命令" },
                "cwd": { "type": "string", "description": "工作目录（可选，默认项目根目录）" },
                "env": { "type": "object", "description": "环境变量（可选）", "additionalProperties": { "type": "string" } },
                "timeout_ms": { "type": "integer", "description": "超时时间（毫秒，默认 30000）" }
            },
            "required": ["command"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        // execute 走默认上下文（workdir=None），保持旧行为（cwd 缺省为当前进程 cwd）
        self.run(args, &ToolContext::default()).await
    }
    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // 覆写以读取 ctx.workdir：cwd 缺省注入工作区，越界 cwd 拒绝
        self.run(args, ctx).await
    }
}

// ─── Shell 检测 ───────────────────────────────────────────

/// 检测可用 Shell 工具（对齐 TS 端 `detect_shells`）
pub struct DetectShellsTool;

#[async_trait]
impl Tool for DetectShellsTool {
    fn name(&self) -> &str {
        "detect_shells"
    }
    fn description(&self) -> &str {
        "检测系统中可用的 Shell 类型。返回可用 Shell 列表（CMD、PowerShell、Bash、Zsh 等），包含路径和默认标识。在创建持久化 Shell 会话前，建议先调用此工具确认可用 Shell。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let shells: Vec<serde_json::Value> = if cfg!(target_os = "windows") {
            vec![
                serde_json::json!({ "id": "cmd", "name": "cmd", "path": "cmd.exe", "is_default": true }),
                serde_json::json!({ "id": "powershell", "name": "PowerShell", "path": "powershell.exe", "is_default": false }),
            ]
        } else {
            vec![
                serde_json::json!({ "id": "sh", "name": "sh", "path": "/bin/sh", "is_default": true }),
                serde_json::json!({ "id": "bash", "name": "bash", "path": "/bin/bash", "is_default": false }),
                serde_json::json!({ "id": "zsh", "name": "zsh", "path": "/bin/zsh", "is_default": false }),
            ]
        };
        Ok(serde_json::json!({
            "shells": shells,
            "hint": "使用 shell_session_create 创建持久化会话时，shell 参数传入 Shell 的 path 值"
        }))
    }
}

// ─── 持久化 Shell 会话 ───────────────────────────────────

/// 创建持久化会话工具（对齐 TS 端 `shell_session_create`）
pub struct ShellSessionCreateTool {
    manager: ShellSessionManager,
}

impl ShellSessionCreateTool {
    pub fn new(manager: ShellSessionManager) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ShellSessionCreateTool {
    fn name(&self) -> &str {
        "shell_session_create"
    }
    fn description(&self) -> &str {
        "创建一个持久化 Shell 会话。会话保持 Shell 进程活跃，支持多轮命令执行，工作目录和环境变量在命令间保持。适用于需要连续执行多条命令、保持上下文状态的场景（如项目构建、环境配置、交互式操作）。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "shell": { "type": "string", "description": "Shell 类型路径（可选，默认自动选择。可传入 detect_shells 返回的 path 值）" },
                "cwd": { "type": "string", "description": "初始工作目录（可选）" },
                "env": { "type": "object", "description": "环境变量（可选）", "additionalProperties": { "type": "string" } }
            }
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let shell = args
            .get("shell")
            .and_then(|v| v.as_str())
            .unwrap_or(default_shell())
            .to_string();
        let cwd = args.get("cwd").and_then(|v| v.as_str()).unwrap_or(".").to_string();
        let env_list = parse_env(&args);

        let mut cmd = Command::new(&shell);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.current_dir(&cwd);
        if let Some(env_list) = env_list {
            for (k, v) in env_list {
                cmd.env(k, v);
            }
        }

        let mut child = cmd.spawn().map_err(|e| ToolError::Execution(format!("Shell 启动失败: {e}")))?;
        let stdin = child.stdin.take().ok_or_else(|| ToolError::Execution("无法获取 stdin".into()))?;
        let stdout = child.stdout.take().ok_or_else(|| ToolError::Execution("无法获取 stdout".into()))?;
        let stderr = child.stderr.take().ok_or_else(|| ToolError::Execution("无法获取 stderr".into()))?;

        let session_id = format!("session-{}", uuid::Uuid::new_v4().simple());
        let session = ShellSession {
            child,
            stdin,
            stdout,
            stderr,
            shell_path: shell.clone(),
            cwd: cwd.clone(),
        };
        self.manager.sessions.lock().await.insert(session_id.clone(), session);

        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "shell_path": shell,
            "cwd": cwd,
            "hint": "会话已创建。使用 shell_session_exec 在此会话中执行命令，使用 shell_session_destroy 销毁会话。"
        }))
    }
}

/// 在持久化会话中执行命令工具（对齐 TS 端 `shell_session_exec`）
pub struct ShellSessionExecTool {
    manager: ShellSessionManager,
}

impl ShellSessionExecTool {
    pub fn new(manager: ShellSessionManager) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ShellSessionExecTool {
    fn name(&self) -> &str {
        "shell_session_exec"
    }
    fn description(&self) -> &str {
        "在持久化 Shell 会话中执行命令。会话保持工作目录和环境变量状态，支持连续执行多条命令。适用于需要上下文保持的场景。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "会话 ID（由 shell_session_create 返回）" },
                "command": { "type": "string", "description": "要执行的命令" },
                "timeout_ms": { "type": "number", "description": "超时时间（毫秒，默认 30000）" }
            },
            "required": ["session_id", "command"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 session_id 参数".into()))?
            .to_string();
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 command 参数".into()))?
            .to_string();
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_SESSION_TIMEOUT_MS);
        // 任务29/E1 盲区词法防护（shell 会话无 per-call ctx，仅规则一：写操作词 × 相对保护目录字样）
        if crate::fs_tools::shell_command_touches_protected_path(None, &command) {
            return Ok(serde_json::json!({
                "ok": false,
                "error": crate::fs_tools::PROTECTED_WRITE_ERROR,
                "session_id": &session_id,
                "command": &command,
            }));
        }

        let mut sessions = self.manager.sessions.lock().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| ToolError::Execution("会话不存在或已销毁，请使用 shell_session_create 创建新会话".into()))?;

        session
            .stdin
            .write_all(command.as_bytes())
            .await
            .map_err(|e| ToolError::Execution(format!("写入命令失败: {e}")))?;
        session
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|e| ToolError::Execution(format!("写入命令失败: {e}")))?;
        session
            .stdin
            .flush()
            .await
            .map_err(|e| ToolError::Execution(format!("刷新输入失败: {e}")))?;

        let (out, err) = ShellSessionManager::read_output(&mut session.stdout, &mut session.stderr, Duration::from_millis(timeout_ms)).await;
        let stdout = clean_ansi(&out);
        let stderr = clean_ansi(&err);

        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "stdout": if stdout.trim().is_empty() { "(命令已执行，无输出)" } else { &stdout },
            "stderr": stderr,
            "timed_out": true,
            "hint": "会话仍保持活跃，可继续执行下一条命令"
        }))
    }
}

/// 向持久化会话发送交互输入工具（对齐 TS 端 `shell_session_input`）
pub struct ShellSessionInputTool {
    manager: ShellSessionManager,
}

impl ShellSessionInputTool {
    pub fn new(manager: ShellSessionManager) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ShellSessionInputTool {
    fn name(&self) -> &str {
        "shell_session_input"
    }
    fn description(&self) -> &str {
        "向持久化 Shell 会话发送交互式输入。用于需要用户输入的命令（如 y/n 确认、密码输入、选择菜单等）。输入会自动追加换行符。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "会话 ID" },
                "data": { "type": "string", "description": "要发送的输入内容" }
            },
            "required": ["session_id", "data"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 session_id 参数".into()))?
            .to_string();
        let data = args
            .get("data")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 data 参数".into()))?
            .to_string();

        let mut sessions = self.manager.sessions.lock().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| ToolError::Execution("会话不存在或已销毁".into()))?;
        session
            .stdin
            .write_all(data.as_bytes())
            .await
            .map_err(|e| ToolError::Execution(format!("写入输入失败: {e}")))?;
        session
            .stdin
            .write_all(b"\n")
            .await
            .map_err(|e| ToolError::Execution(format!("写入输入失败: {e}")))?;
        session
            .stdin
            .flush()
            .await
            .map_err(|e| ToolError::Execution(format!("刷新输入失败: {e}")))?;

        Ok(serde_json::json!({ "ok": true, "session_id": session_id, "hint": "输入已发送，使用 shell_session_exec 查看后续输出" }))
    }
}

/// 销毁持久化会话工具（对齐 TS 端 `shell_session_destroy`）
pub struct ShellSessionDestroyTool {
    manager: ShellSessionManager,
}

impl ShellSessionDestroyTool {
    pub fn new(manager: ShellSessionManager) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ShellSessionDestroyTool {
    fn name(&self) -> &str {
        "shell_session_destroy"
    }
    fn description(&self) -> &str {
        "销毁持久化 Shell 会话，释放资源。会话销毁后无法再执行命令。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "要销毁的会话 ID" }
            },
            "required": ["session_id"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let session_id = args
            .get("session_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 session_id 参数".into()))?
            .to_string();

        let mut sessions = self.manager.sessions.lock().await;
        let removed = sessions.remove(&session_id);
        if let Some(mut session) = removed {
            let _ = session.child.kill().await;
            let _ = session.child.wait().await;
        }
        Ok(serde_json::json!({ "ok": true, "session_id": session_id, "message": "会话已销毁" }))
    }
}

/// 列出持久化会话工具（对齐 TS 端 `shell_session_list`）
pub struct ShellSessionListTool {
    manager: ShellSessionManager,
}

impl ShellSessionListTool {
    pub fn new(manager: ShellSessionManager) -> Self {
        Self { manager }
    }
}

#[async_trait]
impl Tool for ShellSessionListTool {
    fn name(&self) -> &str {
        "shell_session_list"
    }
    fn description(&self) -> &str {
        "列出当前活跃的持久化 Shell 会话。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({ "type": "object", "properties": {} })
    }
    async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let sessions = self.manager.sessions.lock().await;
        let items: Vec<serde_json::Value> = sessions
            .iter()
            .map(|(id, s)| serde_json::json!({ "session_id": id, "shell": s.shell_path, "cwd": s.cwd }))
            .collect();
        Ok(serde_json::json!({
            "ok": true,
            "sessions": items,
            "count": items.len(),
            "hint": if items.is_empty() { "当前无活跃会话，使用 shell_session_create 创建新会话" } else { "使用 shell_session_exec 在指定会话中执行命令" }
        }))
    }
}

// ─── 直接调用服务（供 Tauri 命令层使用） ──────────────────

/// 终端服务 — 供 Tauri 命令层直接调用，复用上方工具实现
///
/// 与 Agent 工具总线解耦：独立持有共享的 [`ShellSessionManager`]，
/// 前端直接调用 execute_command / shell_session_*，不经过 AgentLoop。
/// 由 Tauri app 端 `manage` 为状态，供 `#[tauri::command]` 调用。
#[derive(Clone, Default)]
pub struct TerminalService {
    manager: ShellSessionManager,
}

impl TerminalService {
    /// 创建空服务
    pub fn new() -> Self {
        Self::default()
    }

    /// 单次命令执行（`execute_command`）
    pub async fn execute_command(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        ExecuteCommandTool.execute(args).await
    }

    /// 检测可用 Shell（`detect_shells`）
    pub async fn detect_shells(&self) -> Result<serde_json::Value, ToolError> {
        DetectShellsTool.execute(serde_json::json!({})).await
    }

    /// 创建持久化会话（`shell_session_create`）
    pub async fn create_session(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        ShellSessionCreateTool::new(self.manager.clone()).execute(args).await
    }

    /// 在会话中执行命令（`shell_session_exec`）
    pub async fn exec_session(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        ShellSessionExecTool::new(self.manager.clone()).execute(args).await
    }

    /// 向会话发送交互输入（`shell_session_input`）
    pub async fn input_session(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        ShellSessionInputTool::new(self.manager.clone()).execute(args).await
    }

    /// 销毁会话（`shell_session_destroy`）
    pub async fn destroy_session(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        ShellSessionDestroyTool::new(self.manager.clone()).execute(args).await
    }

    /// 列出会话（`shell_session_list`）
    pub async fn list_sessions(&self) -> Result<serde_json::Value, ToolError> {
        ShellSessionListTool::new(self.manager.clone()).execute(serde_json::json!({})).await
    }
}

/// 构建并注册全部终端工具到工具总线
///
/// 调用方：`AgentCommandService::new_agent`，在创建 `SimpleToolBus` 后注册。
pub async fn register_terminal_tools(bus: &dyn agent_runtime::tool::ToolBus) {
    let manager = ShellSessionManager::new();
    bus.register(Arc::new(ExecuteCommandTool)).await;
    bus.register(Arc::new(DetectShellsTool)).await;
    bus.register(Arc::new(ShellSessionCreateTool::new(manager.clone()))).await;
    bus.register(Arc::new(ShellSessionExecTool::new(manager.clone()))).await;
    bus.register(Arc::new(ShellSessionInputTool::new(manager.clone()))).await;
    bus.register(Arc::new(ShellSessionDestroyTool::new(manager.clone()))).await;
    bus.register(Arc::new(ShellSessionListTool::new(manager))).await;
}

#[cfg(test)]
#[path = "terminal_tests.rs"]
mod tests;
