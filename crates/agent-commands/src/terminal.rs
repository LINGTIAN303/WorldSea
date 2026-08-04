//! # 终端工具（terminal tools）
//!
//! 注册到 Agent 的工具总线，使 LLM 可在 ReAct 循环中执行 shell 命令。
//!
//! 功能对齐 TS 端 `packages/agent-runtime/src/tools/terminal-tools.ts`：
//! - `execute_command`：单次命令执行（返回 stdout/stderr/exit_code）
//! - `detect_shells`：检测可用 Shell
//! - `shell_session_create` / `shell_session_exec` / `shell_session_input` /
//!   `shell_session_destroy` / `shell_session_list`：持久化 Shell 会话
//!
//! ## 设计
//! - 所有工具共享一个 [`ShellSessionManager`]（全局会话注册表），
//!   因此持久化会话在多个 Agent 会话间保持有效。
//! - 会话管理用 `tokio::sync::Mutex` + `HashMap`，进程用 `tokio::process`。
//! - Windows 默认 `cmd.exe`，Unix 默认 `/bin/sh`。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use agent_runtime::tool::{Tool, ToolError};
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

/// 单次命令执行工具（对齐 TS 端 `execute_command`）
pub struct ExecuteCommandTool;

impl ExecuteCommandTool {
    async fn run(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 command 参数".into()))?
            .to_string();
        if command.trim().is_empty() {
            return Err(ToolError::ArgsParse("command 不能为空".into()));
        }
        let cwd = args.get("cwd").and_then(|v| v.as_str());
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let env_list = parse_env(&args);

        let mut cmd = build_command(&command, cwd, None);
        if let Some(env_list) = env_list {
            for (k, v) in env_list {
                cmd.env(k, v);
            }
        }

        let output = match tokio::time::timeout(Duration::from_millis(timeout_ms), cmd.output()).await {
            Ok(Ok(o)) => o,
            Ok(Err(e)) => return Err(ToolError::Execution(format!("命令启动失败: {e}"))),
            Err(_) => return Err(ToolError::Execution("命令执行超时".into())),
        };

        let stdout = clean_ansi(&String::from_utf8_lossy(&output.stdout));
        let stderr = clean_ansi(&String::from_utf8_lossy(&output.stderr));
        Ok(serde_json::json!({
            "stdout": if stdout.is_empty() { "(命令已执行，无输出)" } else { &stdout },
            "stderr": stderr,
            "exit_code": output.status.code(),
        }))
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
        self.run(args).await
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
mod tests {
    use super::*;

    #[test]
    fn clean_ansi_removes_escape_sequences() {
        let input = "\x1b[31mred\x1b[0m normal \x1b]0;title\x07done";
        let cleaned = clean_ansi(input);
        assert_eq!(cleaned, "red normal done");
    }

    #[test]
    fn clean_ansi_removes_control_chars() {
        let input = "a\x00b\x1fc";
        let cleaned = clean_ansi(input);
        assert_eq!(cleaned, "abc");
    }

    #[tokio::test]
    async fn execute_command_returns_output() {
        let tool = ExecuteCommandTool;
        let args = serde_json::json!({
            "command": if cfg!(target_os = "windows") { "echo hello" } else { "echo hello" }
        });
        let result = tool.execute(args).await.expect("应执行成功");
        assert_eq!(result["exit_code"], 0);
        let stdout = result["stdout"].as_str().unwrap();
        assert!(stdout.contains("hello"));
    }

    #[tokio::test]
    async fn execute_command_missing_args_errors() {
        let tool = ExecuteCommandTool;
        let result = tool.execute(serde_json::json!({})).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn session_lifecycle_create_exec_destroy() {
        let manager = ShellSessionManager::new();
        let create = ShellSessionCreateTool::new(manager.clone());
        let exec = ShellSessionExecTool::new(manager.clone());
        let destroy = ShellSessionDestroyTool::new(manager.clone());

        let created = create
            .execute(serde_json::json!({}))
            .await
            .expect("创建会话应成功");
        let session_id = created["session_id"].as_str().unwrap().to_string();

        let exec_res = exec
            .execute(serde_json::json!({
                "session_id": session_id,
                "command": if cfg!(target_os = "windows") { "echo hello" } else { "echo hello" },
                "timeout_ms": 5000
            }))
            .await
            .expect("执行应成功");
        assert_eq!(exec_res["ok"], true);

        let destroyed = destroy
            .execute(serde_json::json!({ "session_id": session_id }))
            .await
            .expect("销毁应成功");
        assert_eq!(destroyed["ok"], true);
    }
}