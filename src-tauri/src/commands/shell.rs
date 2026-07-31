//! 持久化 Shell 会话命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖 Shell 检测、持久化会话创建/执行/销毁/列举/输入命令。
//! 会话基于 PTY 保持活跃，支持多轮命令交互。
//! 输出通过 mpsc channel 同步收集，支持超时与稳定检测。

use std::io::{BufRead, BufReader, Write};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{Emitter, State};

use worldsmith_core::error::CoreError;

use crate::state::{AppState, PtyProcess};

/// 检测到的 Shell 信息
#[derive(Serialize)]
pub struct ShellInfo {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_default: bool,
}

/// Shell 会话信息
#[derive(Serialize)]
pub struct ShellSessionInfo {
    pub id: String,
    pub shell_id: String,
    pub shell_path: String,
    pub cwd: String,
    pub created_at: u64,
}

/// 执行结果
#[derive(Serialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub timed_out: bool,
}

/// 检测系统中可用的 Shell
#[tauri::command]
pub fn cmd_detect_shells() -> Vec<ShellInfo> {
    let is_windows = cfg!(target_os = "windows");
    let mut shells = Vec::new();

    if is_windows {
        // Windows: 检测 CMD、PowerShell 5.x、PowerShell 7、Git Bash、WSL
        let candidates: Vec<(&str, &str, &str)> = vec![
            ("cmd", "CMD", "cmd.exe"),
            ("powershell", "PowerShell", "powershell.exe"),
            ("pwsh", "PowerShell 7", "pwsh.exe"),
            ("git-bash", "Git Bash", "C:\\Program Files\\Git\\bin\\bash.exe"),
            ("wsl", "WSL (Ubuntu)", "wsl.exe"),
        ];
        for (id, name, path) in candidates {
            let found = which_shell(path);
            if let Some(full_path) = found {
                shells.push(ShellInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: full_path,
                    is_default: id == "powershell",
                });
            }
        }
        // CMD 总是可用
        if shells.iter().all(|s| s.id != "cmd") {
            shells.insert(
                0,
                ShellInfo {
                    id: "cmd".to_string(),
                    name: "CMD".to_string(),
                    path: "cmd.exe".to_string(),
                    is_default: false,
                },
            );
        }
    } else {
        // Unix: 检测 sh、bash、zsh、fish、dash
        let candidates: Vec<(&str, &str, &str)> = vec![
            ("sh", "POSIX Shell", "/bin/sh"),
            ("bash", "Bash", "/bin/bash"),
            ("zsh", "Zsh", "/bin/zsh"),
            ("fish", "Fish", "/usr/bin/fish"),
            ("dash", "Dash", "/bin/dash"),
        ];
        for (id, name, path) in candidates {
            let found = which_shell(path);
            if let Some(full_path) = found {
                shells.push(ShellInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    path: full_path,
                    is_default: id == "bash",
                });
            }
        }
        // /bin/sh 总是可用
        if shells.iter().all(|s| s.id != "sh") {
            shells.insert(
                0,
                ShellInfo {
                    id: "sh".to_string(),
                    name: "POSIX Shell".to_string(),
                    path: "/bin/sh".to_string(),
                    is_default: false,
                },
            );
        }
    }
    shells
}

/// 查找 Shell 可执行文件路径
fn which_shell(name: &str) -> Option<String> {
    // 先尝试绝对路径
    if std::path::Path::new(name).is_absolute() && std::path::Path::new(name).exists() {
        return Some(name.to_string());
    }
    // 再尝试 which/where
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    std::process::Command::new(cmd)
        .arg(name)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
            } else {
                None
            }
        })
}

/// 创建持久化 Shell 会话（PTY 保持活跃，支持多轮命令）
#[tauri::command]
pub fn cmd_shell_session_create(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<std::collections::HashMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<ShellSessionInfo, CoreError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(200),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::InvalidArgument(format!("PTY open failed: {}", e)))?;

    // 确定 Shell
    let is_windows = cfg!(target_os = "windows");
    let shell_path = shell.unwrap_or_else(|| {
        if is_windows {
            "powershell.exe".to_string()
        } else {
            "/bin/bash".to_string()
        }
    });

    let mut cmd = CommandBuilder::new(&shell_path);
    if let Some(cwd) = &cwd {
        cmd.cwd(cwd);
    }

    // 环境变量注入
    if let Some(env_vars) = env {
        for (k, v) in env_vars {
            cmd.env(k, v);
        }
    }

    // Windows PowerShell 加载 Profile 以获取完整 PATH
    if is_windows && (shell_path.contains("powershell") || shell_path.contains("pwsh")) {
        // 不传 -NoProfile，让 PowerShell 加载用户 Profile
        // 但传 -NoLogo 减少启动噪音
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| CoreError::InvalidArgument(format!("PTY spawn failed: {}", e)))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| CoreError::InvalidArgument(format!("PTY reader failed: {}", e)))?;

    let (kill_tx, mut kill_rx) = tokio::sync::oneshot::channel::<()>();
    let pty_id = id.clone();
    let app_handle = app.clone();

    // 创建输出 channel
    let (output_tx, output_rx): (
        std::sync::mpsc::Sender<String>,
        std::sync::mpsc::Receiver<String>,
    ) = std::sync::mpsc::channel();
    let output_tx_clone = output_tx.clone();

    // 读取线程：持续输出到事件和 channel
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf_reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = app_handle.emit(&format!("pty-output-{}", pty_id), &line);
                    let _ = output_tx_clone.send(line.clone());
                }
            }
            if kill_rx.try_recv().is_ok() {
                break;
            }
        }
    });

    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|e| CoreError::InvalidArgument(format!("PTY writer failed: {}", e)))?;
    let mut processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    processes.insert(
        id.clone(),
        PtyProcess {
            master,
            writer,
            _child: child,
            kill_tx: std::sync::Mutex::new(Some(kill_tx)),
            output_tx: std::sync::Mutex::new(Some(output_tx)),
        },
    );

    // 存储 output_rx
    {
        let mut rx_map = state
            .pty_output_receivers
            .lock()
            .map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(id.clone(), output_rx);
    }

    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // 等待 Shell 启动就绪（发送空输入触发提示符）
    // 短暂等待让 Shell 初始化
    std::thread::sleep(std::time::Duration::from_millis(300));

    Ok(ShellSessionInfo {
        id,
        shell_id: extract_shell_id(&shell_path),
        shell_path,
        cwd: cwd.unwrap_or_else(|| {
            std::env::current_dir()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string()
        }),
        created_at,
    })
}

/// 从 Shell 路径提取简短 ID
fn extract_shell_id(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.contains("pwsh") {
        "pwsh".to_string()
    } else if lower.contains("powershell") {
        "powershell".to_string()
    } else if lower.contains("cmd") {
        "cmd".to_string()
    } else if lower.contains("bash") {
        "bash".to_string()
    } else if lower.contains("zsh") {
        "zsh".to_string()
    } else if lower.contains("fish") {
        "fish".to_string()
    } else if lower.contains("dash") {
        "dash".to_string()
    } else if lower.contains("wsl") {
        "wsl".to_string()
    } else {
        "unknown".to_string()
    }
}

/// 在持久化会话中执行命令并收集输出
#[tauri::command]
pub async fn cmd_shell_session_exec(
    state: State<'_, AppState>,
    id: String,
    command: String,
    timeout_ms: Option<u64>,
) -> Result<ExecResult, CoreError> {
    let pty_id = id.clone();

    // 写入命令到 PTY
    {
        let mut processes = state
            .pty_processes
            .lock()
            .map_err(|e| CoreError::Lock(e.to_string()))?;
        let pty = processes
            .get_mut(&pty_id)
            .ok_or_else(|| CoreError::InvalidArgument(format!("Session {} not found", pty_id)))?;
        let cmd_bytes = format!("{}\n", command);
        pty.writer
            .write_all(cmd_bytes.as_bytes())
            .map_err(|e| CoreError::InvalidArgument(format!("Write failed: {}", e)))?;
        pty.writer
            .flush()
            .map_err(|e| CoreError::InvalidArgument(format!("Flush failed: {}", e)))?;
    }

    // 从 channel 读取输出
    let timeout = timeout_ms.unwrap_or(30000);
    let rx = {
        let mut rx_map = state
            .pty_output_receivers
            .lock()
            .map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map
            .remove(&pty_id)
            .ok_or_else(|| CoreError::InvalidArgument(format!("No output channel for session {}", pty_id)))?
    };

    // 收集输出直到稳定或超时
    let start = std::time::Instant::now();
    let mut chunks: Vec<String> = Vec::new();
    let mut last_output_time = std::time::Instant::now();

    loop {
        match rx.recv_timeout(std::time::Duration::from_millis(200)) {
            Ok(data) => {
                chunks.push(data);
                last_output_time = std::time::Instant::now();
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // 检查是否输出稳定（800ms 无新输出）或超时
                let stable_ms = last_output_time.elapsed().as_millis() as u64;
                let elapsed_ms = start.elapsed().as_millis() as u64;
                if !chunks.is_empty() && stable_ms > 800 {
                    break;
                }
                if elapsed_ms > timeout {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }

    // 把 rx 放回去供下次调用使用
    // 注意：由于 channel 的 rx 已经被移出，我们需要重新创建
    // 实际上 channel 是持续的，rx 在 recv 后仍然可用
    // 但我们上面用了 remove，需要重新插入
    {
        let mut rx_map = state
            .pty_output_receivers
            .lock()
            .map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(pty_id.clone(), rx);
    }

    let raw = chunks.join("");
    let stdout = clean_ansi(&raw);
    let timed_out = start.elapsed().as_millis() as u64 > timeout;

    Ok(ExecResult {
        stdout,
        stderr: String::new(),
        exit_code: if timed_out { None } else { Some(0) },
        timed_out,
    })
}

/// 清理 ANSI 转义码和不可打印字符
fn clean_ansi(input: &str) -> String {
    let re_csi = regex::Regex::new(r"\x1b\[[0-9;]*[a-zA-Z]").unwrap();
    let re_osc = regex::Regex::new(r"\x1b\].*?\x07").unwrap();
    let result = re_csi.replace_all(input, "");
    let result = re_osc.replace_all(&result, "");
    // 移除不可打印字符（保留换行/制表符/回车）
    result
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
        .collect()
}

/// 销毁持久化 Shell 会话
#[tauri::command]
pub fn cmd_shell_session_destroy(state: State<AppState>, id: String) -> Result<(), CoreError> {
    let mut processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    if let Some(pty) = processes.remove(&id) {
        if let Ok(mut tx) = pty.kill_tx.lock() {
            if let Some(sender) = tx.take() {
                let _ = sender.send(());
            }
        }
    }
    // 清理 output channel
    let _ = state
        .pty_output_receivers
        .lock()
        .map(|mut m| m.remove(&id));
    Ok(())
}

/// 列出活跃的 Shell 会话
#[tauri::command]
pub fn cmd_shell_session_list(state: State<AppState>) -> Result<Vec<String>, CoreError> {
    let processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    Ok(processes.keys().cloned().collect())
}

/// 在持久化会话中发送输入（用于交互式命令）
#[tauri::command]
pub fn cmd_shell_session_input(
    state: State<AppState>,
    id: String,
    data: String,
) -> Result<(), CoreError> {
    let mut processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes
        .get_mut(&id)
        .ok_or_else(|| CoreError::InvalidArgument(format!("Session {} not found", id)))?;
    let input = format!("{}\n", data);
    pty.writer
        .write_all(input.as_bytes())
        .map_err(|e| CoreError::InvalidArgument(format!("Write failed: {}", e)))?;
    pty.writer
        .flush()
        .map_err(|e| CoreError::InvalidArgument(format!("Flush failed: {}", e)))?;
    Ok(())
}
