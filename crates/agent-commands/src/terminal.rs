//! 终端工具（terminal tools）：execute_command / detect_shells / 持久化 Shell 会话（PTY），详细见 docs/details/注释/agent-commands/terminal.md
//!
//! PTY 化说明（P0 系统触达面，2026-09-01）：持久化 Shell 会话从「管道仿真」升级为
//! 「真伪终端」（portable-pty；Windows 走 ConPTY）。单次命令 execute_command 保持管道
//! 实现不变（零回归）；shell_session_* 会话族使用 PTY——可运行 vim/REPL/TUI 等交互式程序。

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use agent_runtime::tool::{RiskLevel, SideEffectScope, Tool, ToolDescriptor, ToolError};
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

/// E3-1（2026-09-18，观测期）：沙箱戳记并入命令类工具的审计元信息（`__meta.sandbox`）。
/// `None`（面板 / 无 ctx 入口）不落字段；观测期**不改变任何执行行为**（强制落 E3-2/E3-3，
/// 设计见 docs/plans/2026-09-18-工作区与环境对齐dsh/03-E3真沙箱设计方案.md）。
fn attach_sandbox_meta(meta: &mut serde_json::Value, ctx: &ToolContext) {
    if let Some(spec) = &ctx.sandbox {
        if let Some(obj) = meta.as_object_mut() {
            obj.insert("sandbox".to_string(), serde_json::json!(spec.mode.as_str()));
        }
    }
}

/// E3-1 观测：命令 / 会话类工具读取沙箱戳记记一行日志（E3-2/E3-3 起强制已生效）
fn observe_sandbox(ctx: &ToolContext, tool: &str) {
    if let Some(spec) = &ctx.sandbox {
        tracing::info!(
            target: "sandbox",
            tool,
            mode = spec.mode.as_str(),
            root = %spec.root.display(),
            "E3 沙箱：工具携带戳记（命令族 E3-2 / PTY E3-3 已强制）"
        );
    }
}

/// E3-4（2026-09-18）：系统拒绝写访问的常见字样（一期从简，设计 §4.6 不做逐后端方言精确分类）
const DENIAL_MARKERS: [&str; 4] = [
    "拒绝访问",           // Windows cmd / powershell 中文
    "access is denied",  // Windows 英文
    "access denied",     // 简写变体
    "permission denied", // MSYS / WSL 类通道
];

/// 系统拒绝写访问字样匹配
fn sandbox_denial(stderr: &str) -> bool {
    let s = stderr.to_lowercase();
    DENIAL_MARKERS.iter().any(|m| s.contains(m))
}

/// E3-4：受限命令被系统拒绝时，返回「沙箱拒绝」提示（含当前模式）；未命中返回 `None`
///
/// 判定：文件写边界已启用（Windows）+ 携带沙箱戳记 + 非零退出 + stderr 命中拒绝字样。
/// 提示并入结果 `sandbox_hint`（模型与用户同见），元信息落 `__meta.sandbox_denied`。
fn sandbox_deny_hint(ctx: &ToolContext, exit_code: Option<i32>, stderr: &str) -> Option<String> {
    // 文件写边界仅 Windows 本期启用（设计 §4.8）——Unix 的 Permission denied 非本沙箱所致
    if !crate::sandbox::supported() {
        return None;
    }
    let spec = ctx.sandbox.as_ref()?;
    if !matches!(exit_code, Some(code) if code != 0) || !sandbox_denial(stderr) {
        return None;
    }
    Some(format!(
        "沙箱拒绝：该命令的写操作被操作系统拒绝（工作区外路径，或只读档下的任何写）。\
         当前沙箱模式 {}（写边界 = 工作区 + 私有 temp）；这不是命令语法问题——\
         请改用工作区内路径，或调整会话档位。",
        spec.mode.as_str()
    ))
}

/// E3-4：把沙箱模式并入对象结果的 `__meta`（PTY 会话类工具的审计元信息）
///
/// 命令族两站点沿用既有 [`attach_sandbox_meta`]；此处供 create / exec 等结果后置并入
/// （无戳记 / 非 Windows 不改动——Unix 本期不启用文件写边界，设计 §4.8）。
fn attach_result_sandbox_meta(mut result: serde_json::Value, ctx: &ToolContext) -> serde_json::Value {
    if !crate::sandbox::supported() {
        return result;
    }
    let Some(spec) = ctx.sandbox.as_ref() else {
        return result;
    };
    if let Some(obj) = result.as_object_mut() {
        if !obj.contains_key("__meta") {
            obj.insert("__meta".to_string(), serde_json::json!({}));
        }
        if let Some(meta) = obj.get_mut("__meta").and_then(|m| m.as_object_mut()) {
            meta.insert("sandbox".to_string(), serde_json::json!(spec.mode.as_str()));
        }
    }
    result
}

/// E3-2（2026-09-18）：启动命令子进程——受限通路（Windows + 沙箱戳记）或普通通路
///
/// 受限通路 **fail-closed**（D3 拍板）：沙箱构造 / 授予 / 启动任一失败 → 拒绝执行，绝不静默裸跑。
/// - `plain_cmd`：普通通路命令（调用方自建，形态各自保持既有语义：cmd / powershell / sh）；
/// - `confined_cmdline`：受限通路的完整命令行；`None` 时按 `cmd.exe /D /S /C` 形态构造。
fn spawn_command_child(
    mut plain_cmd: tokio::process::Command,
    cwd: Option<&str>,
    env_list: Option<Vec<(String, String)>>,
    ctx: &ToolContext,
    command: &str,
    confined_cmdline: Option<String>,
) -> Result<crate::sandbox::CommandChild, ToolError> {
    #[cfg(windows)]
    if let Some(spec) = ctx.sandbox.as_ref() {
        let cmdline = confined_cmdline.unwrap_or_else(|| crate::sandbox::win::cmdline_for_cmd(command));
        let cwd_path = cwd.map(std::path::Path::new);
        return crate::sandbox::win::spawn_confined_command(
            spec,
            &cmdline,
            cwd_path,
            env_list.unwrap_or_default(),
        )
        .map(crate::sandbox::CommandChild::Confined)
        .map_err(|e| {
            ToolError::Execution(format!(
                "沙箱不可用（E3 受限执行 fail-closed：已拒绝执行该命令）：{e}"
            ))
        });
    }
    #[cfg(not(windows))]
    let _ = (ctx, command, confined_cmdline); // Unix 本期不启用文件写边界（设计 §4.8）
    // 普通通路（面板 / Unix / 无戳记）：P1 Job 整树回收
    if let Some(env_list) = env_list {
        for (k, v) in env_list {
            plain_cmd.env(k, v);
        }
    }
    let (child, job) = spawn_with_job(&mut plain_cmd)
        .map_err(|e| ToolError::Execution(format!("命令启动失败: {e}")))?;
    Ok(crate::sandbox::CommandChild::plain(child, job))
}

/// E3-3 受限 PTY 会话位平台别名（非 Windows 恒为 `()`——Unix 本期不启用文件写边界，设计 §4.8）
#[cfg(windows)]
type PtyBits = crate::sandbox::win::PtySessionBits;
#[cfg(not(windows))]
type PtyBits = ();

/// E3-3（2026-09-18）：按沙箱戳记构造受限 PTY 会话位（Windows；`None` = 面板 / 非 Windows 普通通路）
///
/// **fail-closed**（D3）：构造失败（令牌派生 / 工作区授予 / temp 建立任一环节）→ 拒绝创建会话，
/// 绝不退回不受限 PTY（未受限的 PTY 会成为边界旁路）。
#[cfg(windows)]
fn confined_pty_bits(ctx: &ToolContext) -> Result<Option<PtyBits>, ToolError> {
    let Some(spec) = ctx.sandbox.as_ref() else {
        return Ok(None);
    };
    crate::sandbox::win::pty_session_bits(spec).map(Some).map_err(|e| {
        ToolError::Execution(format!(
            "沙箱不可用（E3-3 PTY 受限挂载 fail-closed：已拒绝创建会话）：{e}"
        ))
    })
}

/// 是否 WSL/bash 形态 shell（D9 裁定：受限模式下 WSL 服务拒绝受限令牌，该通道 fail-closed）
#[cfg(windows)]
fn is_wsl_shell(shell: &str) -> bool {
    let s = shell.to_ascii_lowercase();
    s.contains("wsl") || s.contains("bash")
}

/// 清理 ANSI 转义码与不可打印字符（对齐 TS 端 execute_command 的清理逻辑）
///
/// `pub(crate)`（批次 C·S1）：定时唤醒的后台输出捕获同口径清理。
pub(crate) fn clean_ansi(input: &str) -> String {
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
///
/// E1（2026-09-18 工作区与环境对齐 dsh）：口径由「15 项显式名单」升级为
/// **启发式通配**（键名含 KEY / PASSWORD / SECRET / TOKEN 即剔除），判定与
/// collector 统一在 `agent_runtime::env_scrub`（工具执行 / PTY / MCP stdio 同源）；
/// 原名单成员全部被启发式覆盖（回归锚点见 kernel env_scrub 单测）。
fn sanitize_env(cmd: &mut tokio::process::Command) {
    for k in agent_runtime::env_scrub::sensitive_inherited_env_keys() {
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
///
/// E3-3（2026-09-18）：`confined` 为受限会话位时以受限令牌挂载 ConPTY（Windows 专用通路、
/// 不回落）；`None` 保持既有普通通路语义（面板 / 非 Windows）。
async fn spawn_pty_session(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: PtySize,
    confined: Option<&PtyBits>,
) -> Result<
    (
        Box<dyn Child + Send + Sync>,
        Box<dyn MasterPty + Send>,
        Box<dyn std::io::Write + Send>,
        mpsc::Receiver<Vec<u8>>,
    ),
    String,
> {
    #[cfg(not(windows))]
    let _ = confined; // Unix 本期不启用文件写边界（设计 §4.8）
    #[cfg(windows)]
    let session =
        crate::pty::open_pty(shell, cwd, env_list, pty_size, confined.map(|b| b.raw_token())).await?;
    #[cfg(not(windows))]
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
    /// E3-3：本会话是否受限（受限模式下 exec/input 拒绝驱动非受限会话——防「面板会话被借用」旁路）
    confined: bool,
    /// E3-3：会话级私有 temp（受限 WorkspaceWrite；销毁时撤销 ACE + 删目录）
    #[cfg(windows)]
    confined_temp: Option<crate::sandbox::win::SessionTemp>,
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

    // ─── 游标读取（批次 C·S1，2026-09-20：定时唤醒的后台输出捕获） ───────

    /// 会话输出缓冲当前末尾偏移（游标锚点；会话不存在 → `None`）
    pub async fn session_cursor(&self, session_id: &str) -> Option<usize> {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).map(|s| s.buf.end())
    }

    /// 从偏移读取指定会话的增量输出（会话不存在 → `None`）
    ///
    /// 与 `collect_output` 同源读取（`SessionOutputBuf::read_from`：不等待新输出、
    /// 不独占通道），返回 `(data, new_pos, truncated)`。
    pub async fn read_session_from(
        &self,
        session_id: &str,
        pos: usize,
    ) -> Option<(String, usize, bool)> {
        let sessions = self.sessions.lock().await;
        let s = sessions.get(session_id)?;
        Some(s.buf.read_from(pos))
    }

    /// 会话是否存在（watch 列表设定时校验）
    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.lock().await.contains_key(session_id)
    }

    /// 现有会话 id 列表（校验失败时给出可用清单）
    pub async fn session_ids(&self) -> Vec<String> {
        self.sessions.lock().await.keys().cloned().collect()
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
///   `workdir=None` 的**无 ctx 入口**（终端面板 `TerminalService.execute_command`）→
///   返回 None 沿用当前进程 cwd（用户驱动的面板不受 Agent fail-safe 约束）
/// - 无工作区 fail-safe 守卫在**工具入口**（`execute_with_ctx`，W3）——Agent 路径拒绝、面板路径放行
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
        // E3-1 观测：命令携带沙箱戳记（不改行为）
        observe_sandbox(ctx, "execute_command");
        let timeout_ms = args
            .get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(DEFAULT_TIMEOUT_MS);
        let env_list = parse_env(&args);

        let started = Instant::now();
        // E3-2：受限通路（Windows + 沙箱戳记，fail-closed）或普通通路（P1 Job 整树回收）
        let plain_cmd = build_command(&command, cwd.as_deref(), None);
        let mut child =
            spawn_command_child(plain_cmd, cwd.as_deref(), env_list, ctx, &command, None)?;
        // execute_command 非流式：take 管道后后台收集，主进程 wait/kill（&mut）不 move
        let stdout_pipe = child.take_stdout().ok_or_else(|| ToolError::Execution("无法获取 stdout 管道".into()))?;
        let stderr_pipe = child.take_stderr().ok_or_else(|| ToolError::Execution("无法获取 stderr 管道".into()))?;
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
        let exit_code = match child.wait_timeout(Duration::from_millis(timeout_ms)).await {
            Ok(crate::sandbox::WaitOutcome::Exited(code)) => code,
            Ok(crate::sandbox::WaitOutcome::TimedOut) => {
                child.kill().await; // 超时终止主进程；残留子进程由 Job Drop 整树回收
                return Err(ToolError::Execution("命令执行超时".into()));
            }
            Err(e) => return Err(ToolError::Execution(e)),
        };
        let duration_ms = started.elapsed().as_millis() as u64;
        let stdout = clean_ansi(&out_task.await.unwrap_or_default().join("\n"));
        let stderr = clean_ansi(&err_task.await.unwrap_or_default().join("\n"));
        let mut meta = serde_json::json!({
            "op": "cmd",
            "command": &command,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
        });
        // E3-1 观测：审计元信息携带沙箱模式（None 不落字段）
        attach_sandbox_meta(&mut meta, ctx);
        // E3-4：沙箱拒绝识别（受限通路 + 非零退出 + 系统拒绝字样）→ 结果附提示与当前模式
        let deny_hint = sandbox_deny_hint(ctx, exit_code, &stderr);
        let mut value = serde_json::json!({
            "stdout": if stdout.is_empty() { "(命令已执行，无输出)" } else { &stdout },
            "stderr": stderr,
            "exit_code": exit_code,
        });
        if let Some(hint) = deny_hint {
            meta["sandbox_denied"] = serde_json::json!(true);
            value["sandbox_hint"] = serde_json::json!(hint);
        }
        Ok(with_meta(value, meta))
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "dev", self.description(), SideEffectScope::System, RiskLevel::Moderate)
            .with_input_schema(self.parameters())
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        // execute 走默认上下文（workdir=None），保持旧行为（cwd 缺省为当前进程 cwd）——
        // 终端面板 `TerminalService.execute_command` 走此入口（用户驱动，不受 Agent fail-safe）
        self.run(args, &ToolContext::default()).await
    }
    async fn execute_with_ctx(
        &self,
        ctx: &ToolContext,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, ToolError> {
        // W3（2026-09-18 工作区与环境对齐 dsh）：Agent 执行路径 fail-safe——
        // 会话无工作区时拒绝（旧语义沿用进程 cwd，属边界消失，已收口）；
        // 覆写以读取 ctx.workdir：cwd 缺省注入工作区，越界 cwd 拒绝
        crate::fs_tools::require_workdir(ctx)?;
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "dev", self.description(), SideEffectScope::System)
            .with_input_schema(self.parameters())
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
        // E3-1 观测：命令携带沙箱戳记（不改行为）
        observe_sandbox(ctx, self.tool_name());

        // D9（2026-09-18 裁定）：受限模式下 bash（Windows 经 WSL）通道不可用——WSL 服务拒绝受限令牌
        // （R4 实测 `E_ACCESSDENIED`，补探加入 INTERACTIVE 仍拒）；按 D3 口径 fail-closed 明确报错
        #[cfg(windows)]
        if ctx.sandbox.is_some() && matches!(self.flavor, ShellFlavor::Bash) {
            return Err(ToolError::Execution(
                "受限模式不支持 bash（Windows 经 WSL）通道（WSL 服务拒绝受限令牌）；\
                 请改用 powershell 或 execute_command。"
                    .into(),
            ));
        }
        // 受限通路的命令行形态：powershell 走 argv（与普通通路同参），bash 走 cmd 形态（上方已拦）
        #[cfg(windows)]
        let confined_cmdline = Some(match self.flavor {
            ShellFlavor::PowerShell => crate::sandbox::win::cmdline_from_argv(&[
                "powershell.exe".to_string(),
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-Command".to_string(),
                command.clone(),
            ]),
            ShellFlavor::Bash => crate::sandbox::win::cmdline_for_cmd(&command),
        });
        #[cfg(not(windows))]
        let confined_cmdline: Option<String> = None;

        let started = Instant::now();

        // 流式读取（2026-09-02 系统工具流式事件）：
        // stdout 管道逐行读取 → 同步 sink.delta 推送 ToolCallDelta（前端工具段实时显示），
        // 同时累积 clean 文本作为最终 stdout 给 LLM；stderr 单独收集不推送。
        // 取消：工具 future 被 drop（AgentLoop 中止）→ 子进程随 Job Drop 整树回收；
        // 超时：下面 wait_timeout 超时 → kill 主进程。
        // E3-2（2026-09-18）：受限通路（Windows + 沙箱戳记，fail-closed）或普通通路（P1 Job）
        let plain_cmd = self.build_command(&command, cwd.as_deref());
        let mut child = spawn_command_child(
            plain_cmd,
            cwd.as_deref(),
            None,
            ctx,
            &command,
            confined_cmdline,
        )?;
        let stdout = child.take_stdout().ok_or_else(|| ToolError::Execution("无法获取 stdout 管道".into()))?;
        let stderr = child.take_stderr().ok_or_else(|| ToolError::Execution("无法获取 stderr 管道".into()))?;
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

        let exit_code = match child.wait_timeout(Duration::from_millis(timeout_ms)).await {
            Ok(crate::sandbox::WaitOutcome::Exited(code)) => code,
            Ok(crate::sandbox::WaitOutcome::TimedOut) => {
                child.kill().await; // 超时终止子进程（stdout 管道关闭 → 读任务自然结束）
                return Err(ToolError::Execution(format!("命令执行超时（>{}ms）", timeout_ms)));
            }
            Err(e) => return Err(ToolError::Execution(e)),
        };
        let stdout = out_task.await.unwrap_or_default().join("\n");
        let stderr = err_task.await.unwrap_or_default().join("\n");
        let duration_ms = started.elapsed().as_millis() as u64;
        let mut meta = serde_json::json!({
            "op": self.tool_name(),
            "command": &command,
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "timed_out": false,
        });
        // E3-1 观测：审计元信息携带沙箱模式（None 不落字段）
        attach_sandbox_meta(&mut meta, ctx);
        // E3-4：沙箱拒绝识别（受限通路 + 非零退出 + 系统拒绝字样）→ 结果附提示与当前模式
        let deny_hint = sandbox_deny_hint(ctx, exit_code, &stderr);
        let mut value = serde_json::json!({
            "stdout": if stdout.is_empty() { "(命令已执行，无输出)" } else { &stdout },
            "stderr": stderr,
            "exit_code": exit_code,
        });
        if let Some(hint) = deny_hint {
            meta["sandbox_denied"] = serde_json::json!(true);
            value["sandbox_hint"] = serde_json::json!(hint);
        }
        Ok(with_meta(value, meta))
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
    fn descriptor(&self) -> ToolDescriptor {
        // C2：合并式 shell 执行工具（bash / powershell 两 flavor 同名族）——进程执行
        // → 不可绕过确认（位次 5）；副作用面 = 系统
        ToolDescriptor::guarded(
            self.name(),
            "dev",
            self.description(),
            SideEffectScope::System,
            RiskLevel::Moderate,
        )
        .with_input_schema(self.parameters())
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.execute_with_ctx(&ToolContext::default(), args).await
    }
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        // W3（2026-09-18 工作区与环境对齐 dsh）：Agent 执行路径 fail-safe（无工作区拒绝）
        crate::fs_tools::require_workdir(ctx)?;
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

    /// 会话创建主实现：普通通路（面板 / 非 Windows，`confined=None`）与受限通路
    /// （Agent + Windows 沙箱戳记：受限令牌 / TMP/TEMP 覆盖 / 会话级 temp）
    #[allow(unused_mut)] // 非 Windows：confined 恒为 None::<()>，无取 temp 的可变路径
    async fn create_session(
        &self,
        args: serde_json::Value,
        mut confined: Option<PtyBits>,
    ) -> Result<serde_json::Value, ToolError> {
        let shell = args
            .get("shell")
            .and_then(|v| v.as_str())
            .unwrap_or(default_shell())
            .to_string();
        // D9（2026-09-18 裁定）：受限模式下 wsl/bash 会话不可用（WSL 服务拒绝受限令牌）→ fail-closed
        #[cfg(windows)]
        if confined.is_some() && is_wsl_shell(&shell) {
            return Err(ToolError::Execution(
                "受限模式不支持 bash（Windows 经 WSL）会话（WSL 服务拒绝受限令牌）；\
                 请改用 cmd / powershell 会话。"
                    .into(),
            ));
        }
        let cwd = args
            .get("cwd")
            .and_then(|v| v.as_str())
            .filter(|c| !c.is_empty())
            .map(|c| c.to_string())
            .unwrap_or_else(default_session_cwd);
        let mut env_list = parse_env(&args).unwrap_or_default();
        // E3-3：受限会话附加 TMP/TEMP 重写（WorkspaceWrite 指向会话级私有 temp；ReadOnly 为空）
        #[cfg(windows)]
        if let Some(bits) = &confined {
            env_list.extend(bits.env().iter().cloned());
        }

        // PTY 化：portable-pty 打开伪终端（Windows = ConPTY），子进程挂 PTY 而非管道
        let pty_size = PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        };

        // 先落 spawn 结果（避免 match 暂存借用与下方取 temp 的可变借用冲突）
        let spawned = spawn_pty_session(&shell, &cwd, &env_list, pty_size, confined.as_ref()).await;
        let (child, master, writer, mut out_rx) = match spawned {
            Ok(v) => v,
            Err(e) => {
                // E3-3：启动失败即回收会话级 temp（授予不残留）
                #[cfg(windows)]
                if let Some(temp) = confined.as_mut().and_then(|b| b.take_temp()) {
                    temp.revoke_and_remove();
                }
                return Err(ToolError::Execution(format!("PTY 会话启动失败: {e}")));
            }
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
            confined: confined.is_some(),
            // E3-3：会话级 temp 移交给会话（销毁时撤销 ACE + 删目录）
            #[cfg(windows)]
            confined_temp: confined.as_mut().and_then(|b| b.take_temp()),
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "dev", self.description(), SideEffectScope::System, RiskLevel::Moderate)
            .with_input_schema(self.parameters())
    }
    /// W3（2026-09-18 工作区与环境对齐 dsh）：无工作区 fail-safe + cwd 与命令工具同口径——
    /// 缺省注入工作区、显式越界拒绝（PTY 会话默认落在工作区内）
    ///
    /// E3-3（2026-09-18）：受限模式下以受限令牌挂载 ConPTY（构造失败 fail-closed 拒绝创建）
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        crate::fs_tools::require_workdir(ctx)?;
        // E3-1 观测：PTY 会话创建携带沙箱戳记（不改行为；面板路径经 execute() 无 ctx 不落）
        observe_sandbox(ctx, "shell_session_create");
        let mut args = args;
        match args.get("cwd").and_then(|v| v.as_str()).filter(|c| !c.is_empty()) {
            Some(cwd) => {
                if !ctx.is_within_workdir(cwd) {
                    return Err(ToolError::Execution(format!(
                        "拒绝在 workspace 之外创建终端会话，cwd 越界: {cwd}"
                    )));
                }
            }
            None => {
                if let Some(wd) = &ctx.workdir {
                    args["cwd"] = serde_json::Value::String(wd.to_string_lossy().to_string());
                }
            }
        }
        // E3-3：受限会话位（Windows + 沙箱戳记；构造失败 fail-closed 拒绝）
        #[cfg(windows)]
        let bits = confined_pty_bits(ctx)?;
        #[cfg(not(windows))]
        let bits = None;
        // E3-4：审计元信息（受限时结果落 __meta.sandbox；面板/非 Windows 不动）
        Ok(attach_result_sandbox_meta(self.create_session(args, bits).await?, ctx))
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        // 面板路径（无 ctx）：不受限普通通路（用户驱动）
        self.create_session(args, None).await
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "dev", self.description(), SideEffectScope::System, RiskLevel::Moderate)
            .with_input_schema(self.parameters())
    }
    /// W3（2026-09-18 工作区与环境对齐 dsh）：无工作区 fail-safe（PTY 命令执行同命令类口径）
    ///
    /// E3-3（2026-09-18）：受限模式下可驱动受限会话（命令在受限 shell 内执行），
    /// 但拒绝驱动非受限会话（防「面板会话被借用」边界旁路）
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        crate::fs_tools::require_workdir(ctx)?;
        // E3-4：审计元信息（受限时结果落 __meta.sandbox）
        Ok(attach_result_sandbox_meta(self.run(args, ctx.sandbox.is_some()).await?, ctx))
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.run(args, false).await
    }
}

impl ShellSessionExecTool {
    /// 会话执行主实现（`confined_ctx` = 受限模式入口；面板路径传 false）
    async fn run(
        &self,
        args: serde_json::Value,
        #[allow(unused_variables)] confined_ctx: bool,
    ) -> Result<serde_json::Value, ToolError> {
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
        // E3-3：受限模式不得驱动非受限会话（边界旁路收口）
        #[cfg(windows)]
        if confined_ctx && !session.confined {
            return Err(ToolError::Execution(
                "受限模式下不可向非受限会话发送命令（该会话非本模式创建，不受 E3 写边界约束）；\
                 请在本模式下用 shell_session_create 新建会话。"
                    .into(),
            ));
        }

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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "dev", self.description(), SideEffectScope::System, RiskLevel::Moderate)
            .with_input_schema(self.parameters())
    }
    /// W3（2026-09-18 工作区与环境对齐 dsh）：无工作区 fail-safe（PTY 输入同命令类口径）
    ///
    /// E3-3（2026-09-18）：受限模式下可向受限会话发送输入，但拒绝非受限会话（同 exec 旁路口径）
    async fn execute_with_ctx(&self, ctx: &ToolContext, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        crate::fs_tools::require_workdir(ctx)?;
        self.run(args, ctx.sandbox.is_some()).await
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.run(args, false).await
    }
}

impl ShellSessionInputTool {
    /// 会话输入主实现（`confined_ctx` = 受限模式入口；面板路径传 false）
    async fn run(
        &self,
        args: serde_json::Value,
        #[allow(unused_variables)] confined_ctx: bool,
    ) -> Result<serde_json::Value, ToolError> {
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
        // E3-3：受限模式不得向非受限会话发送输入（边界旁路收口，同 exec 口径）
        #[cfg(windows)]
        if confined_ctx && !session.confined {
            return Err(ToolError::Execution(
                "受限模式下不可向非受限会话发送输入（该会话非本模式创建，不受 E3 写边界约束）；\
                 请在本模式下用 shell_session_create 新建会话。"
                    .into(),
            ));
        }
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::guarded(self.name(), "dev", self.description(), SideEffectScope::System, RiskLevel::Moderate)
            .with_input_schema(self.parameters())
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
            // E3-3：会话级 temp 先移出（随后 kill 会 move 会话；撤销须在进程终止后进行）
            #[cfg(windows)]
            let confined_temp = session.confined_temp.take();
            // portable-pty Child kill/wait 为同步 API → spawn_blocking 包裹
            let _ = tokio::task::spawn_blocking(move || {
                let _ = session.child.kill();
                let _ = session.child.wait();
            })
            .await;
            // E3-3：撤销会话级 temp 的写 ACE 并删除目录（best-effort；残渣惰性无害）
            #[cfg(windows)]
            if let Some(temp) = confined_temp {
                temp.revoke_and_remove();
            }
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
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(self.name(), "dev", self.description(), SideEffectScope::Session)
            .with_input_schema(self.parameters())
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
///
/// `manager` 由调用方持有（2026-09-20 批次 C：PTY 会话池提升为**可注入**——
/// 定时唤醒服务需按会话读取后台输出游标；此前每次注册自带一个新池、外部不可达）。
pub async fn register_terminal_tools(
    bus: &dyn agent_runtime::tool::ToolBus,
    manager: ShellSessionManager,
) {
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
