//! 终端工具（terminal tools）：execute_command / detect_shells / 持久化 Shell 会话（PTY），详细见 docs/details/注释/agent-commands/terminal.md
//!
//! PTY 化说明（P0 系统触达面，2026-09-01）：持久化 Shell 会话从「管道仿真」升级为
//! 「真伪终端」（portable-pty；Windows 走 ConPTY）。单次命令 execute_command 保持管道
//! 实现不变（零回归）；shell_session_* 会话族使用 PTY——可运行 vim/REPL/TUI 等交互式程序。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_runtime::tool::{Tool, ToolError};
use agent_runtime::tool_context::ToolContext;
use async_trait::async_trait;
use portable_pty::{Child, MasterPty, PtySize};
use regex::Regex;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::sync::mpsc;

/// 默认单次命令执行超时（毫秒）
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// 持久化会话单次命令读取超时（毫秒）
const DEFAULT_SESSION_TIMEOUT_MS: u64 = 30_000;
/// 会话输出缓冲字节上限（7.1 真终端化：超出从头部丢弃保最新；64KiB 覆盖长输出 + 滚动窗口）
const SESSION_OUTPUT_BUF_MAX: usize = 64 * 1024;
/// 会话不存在错误文案（poll/resize 复用）
const TERM_SESSION_MISSING: &str = "会话不存在或已销毁";

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
    // P1：先剔除继承密钥（sanitize），再应用显式 env 注入（显式传入可覆盖）
    sanitize_env(&mut cmd);
    if let Some(map) = env {
        for (k, v) in map {
            if let Some(v) = v.as_str() {
                cmd.env(k, v);
            }
        }
    }
    // P1：execute_command 改 spawn + wait_with_output（Job 整树回收），需显式 piped
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
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

/// 受限执行（P1 补充，2026-09-04）：剔除继承自宿主 shell 的密钥环境变量——
/// 防 Agent 命令把宿主凭证带入/泄漏（如 `gh` 读 GH_TOKEN、`aws` 读 AWS_*）。
/// 显式注入（`env` 参数 / cmd.env）在 sanitize **之后**执行，仍可覆盖（调用方显式传入的 key 不受影响）。
const SENSITIVE_ENV_KEYS: &[&str] = &[
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "DEEPSEEK_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "HUGGING_FACE_HUB_TOKEN",
    "HF_TOKEN",
    "REPLICATE_API_TOKEN",
];

fn sanitize_env(cmd: &mut tokio::process::Command) {
    for k in SENSITIVE_ENV_KEYS {
        cmd.env_remove(k);
    }
}

/// 受限执行（P1，2026-09-04，方向 3 沙箱主业）：
/// 子进程挂入 `KILL_ON_JOB_CLOSE` Job——工具结束（正常/超时/取消）Drop Job 时
/// Windows 自动终止残留子进程树（`cmd.exe` 派生进程、`wsl.exe` 内部 bash 等）。
/// 非 Windows 为空操作（保持原 kill 行为）。Job 挂接失败不阻塞执行（尽力而为）。
fn spawn_with_job(
    cmd: &mut tokio::process::Command,
) -> Result<(tokio::process::Child, crate::job::WinJob), std::io::Error> {
    let job = crate::job::WinJob::new().map_err(std::io::Error::other)?;
    let child = cmd.spawn()?;
    if let Err(e) = job.assign(child.id().unwrap_or(0)) {
        tracing::warn!("Job object 挂接失败（残留子进程可能无法整树回收）: {e}");
    }
    Ok((child, job))
}

// ─── 会话管理器 ────────────────────────────────────────────

/// 启动一个 PTY 会话（P1/2-1 平台分流，见 `crate::pty` 模块）
///
/// 返回 `(child, master, writer, out_rx)`：
/// - `child`：PTY 子进程句柄（用于 kill/wait）
/// - `master`：PTY 主端（保留，供 resize 等后续扩展用）
/// - `writer`：创建时一次性 take 的 master writer（PTY 限制仅能 take 一次，故创建时持有）
/// - `out_rx`：异步输出通道——后台线程从 master reader 阻塞读取后推送，
///   上层用 `collect_output` 超时收集（解同步读 ↔ tokio 异步的隔阂）
///
/// Windows 优先自研 passthrough backend（PSEUDOCONSOLE_PASSTHROUGH_MODE 0x8，
/// raw VT 字节流，见 `pty/conpty_passthrough`）；失败/非 Windows 回落 portable-pty。
async fn spawn_pty_session(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: PtySize,
) -> Result<
    (
        Box<dyn Child + Send + Sync>,
        Box<dyn MasterPty + Send>,
        Box<dyn std::io::Write + Send>,
        mpsc::Receiver<Vec<u8>>,
    ),
    String,
> {
    let session = crate::pty::open_pty(shell, cwd, env_list, pty_size).await?;
    Ok((session.child, session.master, session.writer, session.out_rx))
}

/// 持久化 Shell 会话状态（PTY 版：portable-pty，Windows 走 ConPTY）
///
/// 数据流：`child` 为 PTY 子进程；`master` 保留（resize/后续扩展）；
/// `writer` 为创建时一次性 take 的 master writer（portable-pty 限制 take 仅一次）；
/// 输出由后台线程从 master reader 阻塞读取 → 推入 `out_rx`，创建会话时 spawn 的
/// 转发 task 把字节写入 `buf`（会话输出缓冲）——`exec` 游标窗口收集与前端 `poll`
/// 增量拉取双读解耦（7.1 真终端化，2026-09-01）。
struct ShellSession {
    child: Box<dyn Child + Send + Sync>,
    #[allow(dead_code)] // 保留 master：供 resize 等后续扩展用
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    /// 会话输出缓冲（原始 ANSI/VT 字节流；exec 与 poll 共用）
    buf: Arc<SessionOutputBuf>,
    /// 受限进程（P1，2026-09-04）：PTY 会话 Job——会话销毁/超时 Drop 时整树回收残留
    #[allow(dead_code)]
    _job: crate::job::WinJob,
    shell_path: String,
    cwd: String,
}

/// 会话输出缓冲：累积 PTY 原始字节流（含 ANSI/VT 序列）
///
/// - 字节上限 `max_len`（超出从头部丢弃，保最新）——防无限增长
/// - 游标式增量读取：调用方自记绝对偏移 `pos`，`read_from` 返回其后的新字节
///   + 新偏移；若 `pos` 已被裁剪（truncated=true），从最旧重读并通知调用方重置偏移
#[derive(Debug)]
pub struct SessionOutputBuf {
    buf: std::sync::Mutex<Vec<u8>>,
    /// buf[0] 对应的绝对字节偏移（裁剪后前移）
    base: std::sync::atomic::AtomicUsize,
    max_len: usize,
}

impl SessionOutputBuf {
    /// 创建输出缓冲（max_len 为字节上限）
    pub fn new(max_len: usize) -> Self {
        Self {
            buf: std::sync::Mutex::new(Vec::new()),
            base: std::sync::atomic::AtomicUsize::new(0),
            max_len,
        }
    }

    /// 追加一段输出（超出上限时从头部丢弃最旧字节，保最新）
    pub fn push(&self, mut bytes: Vec<u8>) {
        if bytes.is_empty() {
            return;
        }
        let mut b = self.buf.lock().unwrap();
        if bytes.len() >= self.max_len {
            // 单次即超上限：只保留最后 max_len 字节（丢弃全部旧内容）
            let keep = bytes.split_off(bytes.len() - self.max_len);
            *b = keep;
            self.base.store(0, std::sync::atomic::Ordering::Relaxed);
            return;
        }
        b.append(&mut bytes);
        if b.len() > self.max_len {
            let cut = b.len() - self.max_len;
            b.drain(0..cut);
            let base = self.base.load(std::sync::atomic::Ordering::Relaxed);
            self.base.store(base + cut, std::sync::atomic::Ordering::Relaxed);
        }
    }

    /// 当前缓冲末尾的绝对偏移（= base + len）
    pub fn end(&self) -> usize {
        let b = self.buf.lock().unwrap();
        self.base.load(std::sync::atomic::Ordering::Relaxed) + b.len()
    }

    /// 从偏移 `pos` 读取增量
    ///
    /// # 返回
    /// `(data, new_pos, truncated)`：
    /// - `data`：pos 之后的新字节（utf8 lossy；可能跨命令边界含有 ANSI 序列）
    /// - `new_pos`：下次应传入的偏移（= base + len）
    /// - `truncated`：`pos` 已早于最旧字节（被裁剪）→ 从最旧重读，调用方需重置偏移
    pub fn read_from(&self, pos: usize) -> (String, usize, bool) {
        let b = self.buf.lock().unwrap();
        let base = self.base.load(std::sync::atomic::Ordering::Relaxed);
        let start = if pos < base {
            // 调用方偏移已被裁剪：从最旧重读
            base
        } else {
            pos
        };
        let rel = start - base;
        let truncated = pos < base && !b.is_empty();
        let data = if rel >= b.len() {
            String::new()
        } else {
            String::from_utf8_lossy(&b[rel..]).into_owned()
        };
        (data, base + b.len(), truncated)
    }
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

    /// 收集会话输出缓冲增量直到超时（7.1：游标窗口收集，从调用时偏移读起）
    ///
    /// 与旧实现（消费 out_rx）的区别：不再独占通道——PTY 字节先落 `buf`，
    /// exec 窗口与前端 poll（真终端流）可同时读同一会话输出。
    async fn collect_output(buf: &SessionOutputBuf, timeout: Duration) -> String {
        let deadline = Instant::now() + timeout;
        let mut out = String::new();
        let mut pos = buf.end();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            let (data, new_pos, _truncated) = buf.read_from(pos);
            if !data.is_empty() {
                out.push_str(&data);
            }
            pos = new_pos;
            // 轮询节奏 50ms（等待不超过剩余时限）
            tokio::time::sleep(remaining.min(Duration::from_millis(50))).await;
        }
        out
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
        // 受限执行（P1）：spawn 挂 Job（KILL_ON_JOB_CLOSE），超时 kill 主进程 + Drop 整树回收
        let (mut child, _job) = spawn_with_job(&mut cmd)
            .map_err(|e| ToolError::Execution(format!("命令启动失败: {e}")))?;
        // execute_command 非流式：take 管道后后台收集，主进程 wait/kill（&mut）不 move
        let stdout_pipe = child.stdout.take().ok_or_else(|| ToolError::Execution("无法获取 stdout 管道".into()))?;
        let stderr_pipe = child.stderr.take().ok_or_else(|| ToolError::Execution("无法获取 stderr 管道".into()))?;
        let out_task = tokio::task::spawn(async move {
            let mut r = tokio::io::BufReader::new(stdout_pipe).lines();
            let mut buf = Vec::new();
            while let Ok(Some(line)) = r.next_line().await {
                buf.push(line);
            }
            buf
        });
        let err_task = tokio::task::spawn(async move {
            let mut r = tokio::io::BufReader::new(stderr_pipe).lines();
            let mut buf = Vec::new();
            while let Ok(Some(line)) = r.next_line().await {
                buf.push(line);
            }
            buf
        });
        let wait = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await;
        let status = match wait {
            Ok(Ok(st)) => st,
            Ok(Err(e)) => return Err(ToolError::Execution(format!("命令等待失败: {e}"))),
            Err(_) => {
                let _ = child.kill().await; // 超时终止主进程；残留子进程由 _job Drop 整树回收
                return Err(ToolError::Execution("命令执行超时".into()));
            }
        };
        let duration_ms = started.elapsed().as_millis() as u64;
        let stdout = clean_ansi(&out_task.await.unwrap_or_default().join("\n"));
        let stderr = clean_ansi(&err_task.await.unwrap_or_default().join("\n"));
        let exit_code = status.code();
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

// ─── bash / powershell（系统 Shell 工具，2026-09-02）──────────────
//
// 对齐 Claude Code 的 Bash 工具语义，替代曾用于 Agent 的 execute_command：
// - 流式输出：stdout/stderr 管道逐段读取，执行中同步累积（非一次性阻塞）；
//   最终仍返回完整 clean 文本给 LLM（ANSI/VT 剥离）。
// - 超时：timeout_ms（默认 30s），超时返回错误并终止子进程。
// - 取消：工具 future 被 drop（AgentLoop 取消/中止）时 tokio 自动 kill 子进程。
// - Windows：bash → wsl bash -lc（无 WSL 时提示）；powershell → powershell.exe。

/// Shell 变体（bash / powershell）
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ShellFlavor {
    Bash,
    PowerShell,
}

/// bash / powershell 系统 Shell 工具（一个结构体两个实例）
pub struct ShellExecTool {
    flavor: ShellFlavor,
}

impl ShellExecTool {
    pub fn bash() -> Self {
        Self { flavor: ShellFlavor::Bash }
    }
    pub fn powershell() -> Self {
        Self { flavor: ShellFlavor::PowerShell }
    }

    fn tool_name(&self) -> &'static str {
        match self.flavor {
            ShellFlavor::Bash => "bash",
            ShellFlavor::PowerShell => "powershell",
        }
    }

    fn build_command(&self, command: &str, cwd: Option<&str>) -> tokio::process::Command {
        #[cfg(windows)]
        {
            let mut c = match self.flavor {
                ShellFlavor::Bash => {
                    let mut c = tokio::process::Command::new("wsl.exe");
                    c.arg("bash").arg("-lc").arg(command);
                    c
                }
                ShellFlavor::PowerShell => {
                    let mut c = tokio::process::Command::new("powershell.exe");
                    c.arg("-NoProfile").arg("-NonInteractive").arg("-Command").arg(command);
                    c
                }
            };
            if let Some(d) = cwd {
                c.current_dir(d);
            }
            c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
            c
        }
        #[cfg(not(windows))]
        {
            let mut c = match self.flavor {
                ShellFlavor::Bash => {
                    let mut c = tokio::process::Command::new("/bin/bash");
                    c.arg("-lc").arg(command);
                    c
                }
                ShellFlavor::PowerShell => {
                    let mut c = tokio::process::Command::new("pwsh");
                    c.arg("-NoProfile").arg("-NonInteractive").arg("-Command").arg(command);
                    c
                }
            };
            if let Some(d) = cwd {
                c.current_dir(d);
            }
            // P1：剔除继承密钥（bash/powershell 无显式 env 注入，全量 sanitize）
            sanitize_env(&mut c);
            c.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
            c
        }
    }

    async fn run_impl(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 command 参数".into()))?
            .to_string();
        if command.trim().is_empty() {
            return Err(ToolError::ArgsParse("command 不能为空".into()));
        }
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        // 任务29/E1 盲区词法防护（写操作词 × 受保护目录字样 → 拒绝并引导语义层）
        if crate::fs_tools::shell_command_touches_protected_path(ctx.workdir.as_deref(), &command) {
            return Ok(serde_json::json!({
                "ok": false,
                "error": crate::fs_tools::PROTECTED_WRITE_ERROR,
                "command": &command,
            }));
        }
        let cwd = resolve_command_cwd(&args, ctx)?;

        let mut cmd = self.build_command(&command, cwd.as_deref());
        let started = Instant::now();

        // 流式读取（2026-09-02 系统工具流式事件）：
        // stdout 管道逐行读取 → 同步 sink.delta 推送 ToolCallDelta（前端工具段实时显示），
        // 同时累积 clean 文本作为最终 stdout 给 LLM；stderr 单独收集不推送。
        // 取消：工具 future 被 drop（AgentLoop 中止）→ tokio Command 自动 kill 子进程；
        // 超时：下面 timeout(child.wait()) 触发 kill。
        // 子进程因 cmd.output() 不可用（stdout 被接管），改用 spawn + 双读任务。
        // 受限执行（P1，2026-09-04）：挂 Job（KILL_ON_JOB_CLOSE）——取消（future drop）/
        // 超时 kill 主进程后，Drop 时自动整树回收残留子进程。
        let (mut child, _job) = spawn_with_job(&mut cmd)
            .map_err(|e| ToolError::Execution(format!("命令启动失败: {e}")))?;
        let stdout = child.stdout.take().ok_or_else(|| ToolError::Execution("无法获取 stdout 管道".into()))?;
        let stderr = child.stderr.take().ok_or_else(|| ToolError::Execution("无法获取 stderr 管道".into()))?;
        let sink = ctx.tool_stream.clone();
        let out_task = tokio::task::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stdout).lines();
            let mut buf: Vec<String> = Vec::new();
            while let Ok(Some(line)) = reader.next_line().await {
                let clean = clean_ansi(&line);
                if !clean.is_empty() {
                    if let Some(s) = &sink {
                        s.delta(clean.clone());
                    }
                    buf.push(clean);
                }
            }
            buf
        });
        let err_task = tokio::task::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr).lines();
            let mut buf: Vec<String> = Vec::new();
            while let Ok(Some(line)) = reader.next_line().await {
                let clean = clean_ansi(&line);
                if !clean.is_empty() {
                    buf.push(clean);
                }
            }
            buf
        });

        let wait_result = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait()).await;
        let status = match wait_result {
            Ok(Ok(st)) => st,
            Ok(Err(e)) => return Err(ToolError::Execution(format!("命令等待失败: {e}"))),
            Err(_) => {
                let _ = child.kill().await; // 超时终止子进程（stdout 管道关闭 → 读任务自然结束）
                return Err(ToolError::Execution(format!("命令执行超时（>{}ms）", timeout_ms)));
            }
        };
        let stdout = out_task.await.unwrap_or_default().join("\n");
        let stderr = err_task.await.unwrap_or_default().join("\n");
        let duration_ms = started.elapsed().as_millis() as u64;
        let exit_code = status.code();
        Ok(with_meta(
            serde_json::json!({
                "stdout": if stdout.is_empty() { "(命令已执行，无输出)" } else { &stdout },
                "stderr": stderr,
                "exit_code": exit_code,
            }),
            serde_json::json!({
                "op": self.tool_name(),
                "command": &command,
                "exit_code": exit_code,
                "duration_ms": duration_ms,
                "timed_out": false,
            }),
        ))
    }
}

#[async_trait]
impl Tool for ShellExecTool {
    fn name(&self) -> &str {
        self.tool_name()
    }
    fn description(&self) -> &str {
        match self.flavor {
            ShellFlavor::Bash => {
                "在 WSL/Linux bash 中执行 Shell 命令（对齐主流 Agent 的 Bash 工具）。\
                 支持流式输出与超时（timeout_ms）；命令切换目录用 cd，多命令用 && 串联。\
                 相对路径基于工作区 cwd。"
            }
            ShellFlavor::PowerShell => {
                "在 Windows PowerShell 中执行命令（对齐主流 Agent 的 Shell 工具）。\
                 支持流式输出与超时（timeout_ms）；多命令用 ; 串联。相对路径基于工作区 cwd。"
            }
        }
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的命令" },
                "cwd": { "type": "string", "description": "可选：命令工作目录（相对工作区或绝对路径，越界拒绝）" },
                "timeout_ms": { "type": "number", "description": "可选：超时毫秒（默认 30000）" }
            },
            "required": ["command"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.run_impl(ctx, args).await
    }
}

// ─── 持久化 Shell 会话 ───────────────────────────────────

/// 会话默认工作目录（未传 cwd 时）：跟随系统本地用户目录
///
/// 前端在「无状态打开」时传当前 Agent 工作空间目录；后端兜底用户目录
/// （Windows USERPROFILE / Unix HOME），避免落入 app 进程 cwd。
fn default_session_cwd() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string())
}

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
        let cwd = args
            .get("cwd")
            .and_then(|v| v.as_str())
            .filter(|c| !c.is_empty())
            .map(|c| c.to_string())
            .unwrap_or_else(default_session_cwd);
        let env_list = parse_env(&args);

        // PTY 化：portable-pty 打开伪终端（Windows = ConPTY），子进程挂 PTY 而非管道
        let pty_size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        let (child, master, writer, mut out_rx) =
            match spawn_pty_session(&shell, &cwd, &env_list.unwrap_or_default(), pty_size).await {
                Ok(v) => v,
                Err(e) => return Err(ToolError::Execution(format!("PTY 会话启动失败: {e}"))),
            };

        let session_id = format!("session-{}", uuid::Uuid::new_v4().simple());
        // 受限进程（P1，2026-09-04）：PTY 会话挂 Job（KILL_ON_JOB_CLOSE）——会话销毁时
        // Drop 整树回收（ConPTY 子进程、wsl 内进程等）；挂接失败仅告警不阻塞。
        let job = crate::job::WinJob::new().map_err(|e| ToolError::Execution(format!("Job 创建失败: {e}")))?;
        if let Err(e) = job.assign(child.process_id().unwrap_or(0)) {
            tracing::warn!("PTY 会话 Job 挂接失败（残留子进程可能无法整树回收）: {e}");
        }
        // 7.1：输出缓冲化——spawn 转发 task 消费 out_rx → 写入 buf；
        // exec（游标窗口）与前端 poll（增量拉取）双读同一缓冲，互不干扰。
        let buf = Arc::new(SessionOutputBuf::new(SESSION_OUTPUT_BUF_MAX));
        let task_buf = Arc::clone(&buf);
        tokio::spawn(async move {
            while let Some(bytes) = out_rx.recv().await {
                task_buf.push(bytes);
            }
        });
        let session = ShellSession {
            child,
            master,
            writer,
            buf,
            _job: job,
            shell_path: shell.clone(),
            cwd: cwd.clone(),
        };
        self.manager.sessions.lock().await.insert(session_id.clone(), session);

        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "shell_path": shell,
            "cwd": cwd,
            "pty": true,
            "hint": "会话已创建（PTY 伪终端）。使用 shell_session_exec 在此会话中执行命令，使用 shell_session_destroy 销毁会话。"
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

        // PTY 写入：使用创建时持有的 writer（portable-pty take 仅一次）
        // 7.1：输出已落 buf（后台转发 task），此处直接写命令，随后从 buf 游标窗口收集
        {
            let writer = &mut *session.writer;
            writer
                .write_all(command.as_bytes())
                .and_then(|_| writer.write_all(b"\r\n")) // PTY 规范换行：回车+换行（Windows ConPTY 必需）
                .and_then(|_| writer.flush())
                .map_err(|e| ToolError::Execution(format!("写入命令失败: {e}")))?;
        }

        // PTY 读取：单通道（无独立 stderr），超时收集（buf 游标窗口，不独占输出）
        let out = ShellSessionManager::collect_output(&session.buf, Duration::from_millis(timeout_ms)).await;
        let stdout = clean_ansi(&out);

        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "stdout": if stdout.trim().is_empty() { "(命令已执行，无输出)" } else { &stdout },
            "stderr": "",
            "pty": true,
            "timed_out": true,
            "hint": "PTY 会话仍保持活跃，可继续执行下一条命令"
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
        "向持久化 Shell 会话发送交互式输入。用于需要用户输入的命令（如 y/n 确认、密码输入、选择菜单等）。默认自动追加换行符；真终端模式（append_return=false）按原样发送原始按键流（@xterm onData）。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "session_id": { "type": "string", "description": "会话 ID" },
                "data": { "type": "string", "description": "要发送的输入内容" },
                "append_return": { "type": "boolean", "description": "是否自动追加换行符（默认 true；真终端原始输入传 false）" }
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
        let append_return = args
            .get("append_return")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        let mut sessions = self.manager.sessions.lock().await;
        let session = sessions
            .get_mut(&session_id)
            .ok_or_else(|| ToolError::Execution("会话不存在或已销毁".into()))?;
        // PTY 写入：使用创建时持有的 writer，写交互输入
        //（append_return=true 追加 \r\n：Windows ConPTY 必需；false=真终端原始按键流）
        {
            let writer = &mut *session.writer;
            let write = writer
                .write_all(data.as_bytes())
                .and_then(|_| {
                    if append_return {
                        writer.write_all(b"\r\n")
                    } else {
                        Ok(())
                    }
                })
                .and_then(|_| writer.flush());
            write.map_err(|e| ToolError::Execution(format!("写入输入失败: {e}")))?;
        }

        Ok(serde_json::json!({ "ok": true, "session_id": session_id, "pty": true, "hint": "输入已发送，使用 shell_session_exec 查看后续输出" }))
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
            // portable-pty Child kill/wait 为同步 API → spawn_blocking 包裹
            let _ = tokio::task::spawn_blocking(move || {
                let _ = session.child.kill();
                let _ = session.child.wait();
            })
            .await;
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

    /// 增量拉取会话输出（真终端轮询，7.1）
    ///
    /// 前端每次携带上次的 `offset`，返回其后的新字节流（含 ANSI/VT 序列）+ 新 offset。
    /// `truncated=true` 表示 offset 已被缓冲裁剪（从最旧重读），调用方应重置偏移。
    pub async fn poll_output(
        &self,
        session_id: &str,
        offset: usize,
    ) -> Result<serde_json::Value, ToolError> {
        let sessions = self.manager.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| ToolError::Execution(TERM_SESSION_MISSING.to_string()))?;
        let (output, new_offset, truncated) = session.buf.read_from(offset);
        Ok(serde_json::json!({
            "session_id": session_id,
            "output": output,
            "offset": new_offset,
            "truncated": truncated,
        }))
    }

    /// 调整会话终端尺寸（真终端窗口 resize，7.1）
    ///
    /// 前端容器尺寸变化时调用；PassthroughMaster::resize 已真实接线 ResizePseudoConsole。
    pub async fn resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<serde_json::Value, ToolError> {
        let sessions = self.manager.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| ToolError::Execution(TERM_SESSION_MISSING.to_string()))?;
        session
            .master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| ToolError::Execution(format!("会话 resize 失败: {e}")))?;
        Ok(serde_json::json!({
            "ok": true,
            "session_id": session_id,
            "cols": cols,
            "rows": rows,
        }))
    }
}

/// 构建并注册全部终端工具到工具总线
///
/// 调用方：`AgentCommandService::new_agent`，在创建 `SimpleToolBus` 后注册。
pub async fn register_terminal_tools(bus: &dyn agent_runtime::tool::ToolBus) {
    let manager = ShellSessionManager::new();
    bus.register(Arc::new(ShellExecTool::bash())).await;
    bus.register(Arc::new(ShellExecTool::powershell())).await;
    // 2026-09-02：execute_command 已退役，不再注册到工具总线（Agent 统一用 bash/powershell）；
    // ExecuteCommandTool 结构保留——TerminalService.execute_command（前端/HTTP 桥单次命令）仍使用。
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
