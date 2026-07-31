//! PTY（伪终端）进程管理命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖 PTY 进程的启动/写入/调整大小/销毁命令。
//! 所有命令通过 `State<AppState>` 注入获取全局 pty_processes map。
//! PTY 输出通过 Tauri event `pty-output-{id}` 推送到前端，
//! 同时通过 mpsc channel 供 `cmd_shell_session_exec` 同步读取。

use std::io::{BufRead, BufReader, Write};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{Emitter, State};

use worldsmith_core::error::CoreError;

use crate::state::{AppState, PtyProcess};

#[tauri::command]
pub fn cmd_pty_spawn(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    shell: Option<String>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), CoreError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::InvalidArgument(format!("PTY open failed: {}", e)))?;

    let mut cmd = CommandBuilder::new(shell.unwrap_or_else(|| {
        if cfg!(target_os = "windows") {
            "cmd.exe".to_string()
        } else {
            "sh".to_string()
        }
    }));
    if let Some(cwd) = cwd {
        cmd.cwd(cwd);
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

    // 创建输出 channel，供 cmd_shell_session_exec 直接读取
    let (output_tx, output_rx): (
        std::sync::mpsc::Sender<String>,
        std::sync::mpsc::Receiver<String>,
    ) = std::sync::mpsc::channel();

    let output_tx_clone = output_tx.clone();
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buf_reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = app_handle.emit(&format!("pty-output-{}", pty_id), &line);
                    // 同时发送到 channel，供 session_exec 读取
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

    // 将 output_rx 存到全局 map 中供 session_exec 使用
    {
        let mut rx_map = state
            .pty_output_receivers
            .lock()
            .map_err(|e| CoreError::Lock(e.to_string()))?;
        rx_map.insert(id.clone(), output_rx);
    }

    Ok(())
}

#[tauri::command]
pub fn cmd_pty_write(state: State<AppState>, id: String, data: String) -> Result<(), CoreError> {
    let mut processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes
        .get_mut(&id)
        .ok_or_else(|| CoreError::InvalidArgument("PTY not found".to_string()))?;
    pty.writer
        .write_all(data.as_bytes())
        .map_err(|e| CoreError::InvalidArgument(format!("PTY write failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_pty_resize(state: State<AppState>, id: String, cols: u16, rows: u16) -> Result<(), CoreError> {
    let processes = state
        .pty_processes
        .lock()
        .map_err(|e| CoreError::Lock(e.to_string()))?;
    let pty = processes
        .get(&id)
        .ok_or_else(|| CoreError::InvalidArgument("PTY not found".to_string()))?;
    pty.master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| CoreError::InvalidArgument(format!("PTY resize failed: {}", e)))?;
    Ok(())
}

#[tauri::command]
pub fn cmd_pty_kill(state: State<AppState>, id: String) -> Result<(), CoreError> {
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
