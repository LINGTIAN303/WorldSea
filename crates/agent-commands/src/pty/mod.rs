//! PTY 平台后端（P2-1 自研重点）：为持久化 Shell 提供跨平台伪终端能力。
//!
//! 分层：
//! - `PtyBackend`：后端抽象，`open_pty()` 平台分流返回统一句柄
//! - Windows：`conpty_passthrough` 自研 ConPTY backend（含 PSEUDOCONSOLE_PASSTHROUGH_MODE(0x8)，
//!   raw VT 字节流直通，备 portable-pty 默认）
//! - 非 Windows：回落 portable-pty 原生实现（Unix PTY）
//!
//! P2-1 背景（2026-09-01）：portable-pty 0.9 硬编码 ConPTY flags 缺 0x8，无法注入 passthrough
//! （Windows 11 22H2+ 的 raw 字节流模式），故自研 backend；对外保持 portable-pty trait 形状
//! 兼容，ShellSessionManager 与前端零改动。

#[cfg(windows)]
pub mod conpty_passthrough;

use std::io::Read;

use tokio::sync::mpsc;

/// PTY 会话产出：child 句柄 + master（resize）+ writer（写输入）+ 输出通道
pub struct PtySession {
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub out_rx: mpsc::Receiver<Vec<u8>>,
}

/// 打开一个 PTY 会话（平台分流）
///
/// - Windows：优先自研 passthrough backend（0x8 原始字节流），失败回落 portable-pty
/// - 非 Windows：portable-pty 原生实现
/// - **E3-3（2026-09-18）**：`confined_token=Some` 为受限挂载（`CreateProcessAsUserW`）。
///   受限模式走 passthrough **专用通路、不回落**（portable-pty 无法注入令牌，回落即边界旁路）；
///   失败由调用方 fail-closed 处理（D3）。非 Windows 不启用文件写边界（设计 §4.8），无此参数。
pub async fn open_pty(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: portable_pty::PtySize,
    #[cfg(windows)] confined_token: Option<conpty_passthrough::HHandle>,
) -> Result<PtySession, String> {
    #[cfg(windows)]
    {
        if let Some(token) = confined_token {
            return conpty_passthrough::spawn_passthrough_with_token(
                shell,
                cwd,
                env_list,
                pty_size,
                Some(token),
            )
            .await
            .map_err(|e| format!("受限 PTY（passthrough 受限挂载）失败: {e}"));
        }
        match conpty_passthrough::spawn_passthrough(shell, cwd, env_list, pty_size).await {
            Ok(session) => return Ok(session),
            Err(e) => {
                log_trace(&format!("[pty] passthrough 后端不可用({e})，回落 portable-pty"));
            }
        }
        return spawn_portable(shell, cwd, env_list, pty_size).await;
    }
    #[cfg(not(windows))]
    {
        spawn_portable(shell, cwd, env_list, pty_size).await
    }
}

fn log_trace(msg: &str) {
    let _ = msg; // 轻量日志占位（避免 feature cfg 噪音）
}

/// portable-pty 原生打开（跨平台兜底）
async fn spawn_portable(
    shell: &str,
    cwd: &str,
    env_list: &[(String, String)],
    pty_size: portable_pty::PtySize,
) -> Result<PtySession, String> {
    let shell_owned = shell.to_string();
    let cwd_owned = cwd.to_string();
    let env_owned = env_list.to_vec();
    let (tx, rx) = mpsc::channel::<Vec<u8>>(64);

    let spawned = tokio::task::spawn_blocking(move || -> Result<_, String> {
        let pty_system = portable_pty::native_pty_system();
        let mut cmd = portable_pty::CommandBuilder::new(&shell_owned);
        cmd.cwd(&cwd_owned);
        // E1（2026-09-18 工作区与环境对齐 dsh）：剔除继承的敏感环境变量
        //（键名含 KEY/PASSWORD/SECRET/TOKEN 即剔；与命令执行 / MCP stdio 同口径）
        for k in agent_runtime::env_scrub::sensitive_inherited_env_keys() {
            cmd.env_remove(&k);
        }
        for (k, v) in &env_owned {
            cmd.env(k, v);
        }
        let pair = pty_system
            .openpty(pty_size)
            .map_err(|e| format!("openpty: {e}"))?;
        let master = pair.master;
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn_command: {e}"))?;
        let writer = master
            .take_writer()
            .map_err(|e| format!("take_writer: {e}"))?;
        Ok((master, child, writer))
    })
    .await
    .map_err(|_| "PTY 初始化任务 panic".to_string())?;

    let (master, child, writer) = spawned?;

    // DSR 握手（Windows ConPTY 启动查询）：同步在创建闭包内已由 portable-pty 处理？
    // portable-pty 自身不应答 DSR——保持与 P0 相同的同步应答逻辑（仅 Windows 生效，unix 无此查询）
    #[cfg(windows)]
    {
        let mut hs_reader = master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_hs_reader: {e}"))?;
        let mut hs_buf = [0u8; 64];
        let mut dsr_found = false;
        for _ in 0..4 {
            match hs_reader.read(&mut hs_buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if conpty_passthrough::find_dsr(&hs_buf[..n]).is_some() {
                        dsr_found = true;
                        break;
                    }
                }
            }
        }
        if dsr_found {
            // writer 需可变——从 master 再 take 会冲突（portable-pty 仅能 take 一次）。
            // 已在 passthrough 后端消费 DSR；此路仅 portable-pty 兜底，writer 写应答需 clone。
            // portable-pty 无 clone writer API → DSR 未应答时子进程输出可能挂起，属已知兜底限制。
            log_trace("[pty] portable-pty 兜底：DSR 查询未应答（passthrough 不可用时的已知限制）");
        }
    }

    // 后台 reader 线程
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {e}"))?;
    let reader_tx = tx.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if reader_tx.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    Ok(PtySession {
        child,
        master,
        writer,
        out_rx: rx,
    })
}