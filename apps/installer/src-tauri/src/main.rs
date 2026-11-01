// WorldSea 安装/卸载向导（Tauri 小壳）
// 单文件安装器：主程序经 include_bytes! 编译期嵌入，安装时释放，无外置 payload。
// 分发形态：单个 worldsea-installer.exe。主程序由 scripts/build-installer.ps1 构建链先行产出。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod winintegration;
// Windows Shell 集成（右键菜单 / 卸载登记项 / 目录占用统计）
mod shell_integration;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::sleep;
use std::time::{Duration, Instant};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::Emitter;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;
use winintegration as win;

const APP_ID: &str = "com.worldsea.desktop"; // 与主程序 identifier 一致（数据目录）
pub(crate) const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\WorldSea";
pub(crate) const CONTEXT_MENU_KEY: &str = r"Software\Classes\Directory\shell\WorldSea";
const MAIN_EXE: &str = "worldsea-tauri-app.exe";
pub(crate) const UNINSTALLER_NAME: &str = "Uninstall WorldSea.exe";
// 版本单源为本 crate Cargo.toml，编译期注入（tauri.conf.json 不再声明 version）
pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");

static CANCELLED: AtomicBool = AtomicBool::new(false);

/// 进度事件载荷：state = active / done
#[derive(Clone, serde::Serialize)]
struct Progress {
    index: usize,
    total: usize,
    text: String,
    state: String,
}

fn app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(APP_ID)
}

/// 内嵌主程序（编译期嵌入，构建链保证 src-tauri/payload/ 先就位，缺失则本 crate 编译失败）
const MAIN_EXE_BYTES: &[u8] = include_bytes!("../payload/worldsea-tauri-app.exe");
/// 内嵌 Agent 运行时（dsh 部署树 + node.exe，build-dsh-runtime.ps1 产物；同一构建链保证就位）
const RUNTIME_ZIP_BYTES: &[u8] = include_bytes!("../payload/dsh-runtime.zip");
/// 内嵌工作台前端产物（workspace-dist，构建链保证就位）
const WORKSPACE_DIST_ZIP_BYTES: &[u8] = include_bytes!("../payload/workspace-dist.zip");

fn start_menu_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(r"Microsoft\Windows\Start Menu\Programs"))
}

fn emit_progress(app: &tauri::AppHandle, index: usize, total: usize, text: &str, state: &str) {
    let _ = app.emit(
        "installer://progress",
        Progress { index, total, text: text.into(), state: state.into() },
    );
}

fn emit_failed(app: &tauri::AppHandle, msg: &str) {
    let _ = app.emit("installer://failed", msg.to_string());
}

/// 执行一个步骤：active → 闭包任务 → done；任务失败时发 failed 事件并返回 false
fn step(
    app: &tauri::AppHandle,
    index: usize,
    total: usize,
    text: &str,
    task: impl FnOnce() -> Result<(), String>,
) -> bool {
    if CANCELLED.load(Ordering::Relaxed) {
        return false;
    }
    emit_progress(app, index, total, text, "active");
    if let Err(e) = task() {
        emit_failed(app, &format!("{text} 失败：{e}"));
        return false;
    }
    sleep(Duration::from_millis(120)); // 让用户能读到每一行日志
    emit_progress(app, index, total, text, "done");
    true
}

#[tauri::command]
fn get_mode() -> String {
    // 卸载模式判定：显式参数，或自身是部署到安装目录的卸载器（文件名含 uninstall）。
    // 用户双击 "Uninstall WorldSea.exe" 时无参数，应直接进入卸载流程。
    let arg_uninstall = std::env::args().any(|a| a.eq_ignore_ascii_case("--uninstall"));
    let is_uninstaller = std::env::current_exe()
        .ok()
        .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase().contains("uninstall")))
        .unwrap_or(false);
    if arg_uninstall || is_uninstaller { "uninstall".into() } else { "install".into() }
}

#[tauri::command]
fn get_default_install_dir() -> String {
    std::env::var("LOCALAPPDATA")
        .map(|base| Path::new(&base).join("WorldSea").display().to_string())
        .unwrap_or_else(|_| "C:\\Program Files\\WorldSea".into())
}

#[tauri::command]
fn get_data_dir() -> String {
    app_data_dir().display().to_string()
}

/// 已安装位置：从注册表 InstallLocation 读取（卸载模式用）；未安装返回空串
#[tauri::command]
fn get_install_location() -> String {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(UNINSTALL_KEY)
        .and_then(|k| k.get_value::<String, _>("InstallLocation"))
        .unwrap_or_default()
}

#[tauri::command]
fn get_free_space_mb(path: String) -> u64 {
    win::disk_free_mb(Path::new(&path))
}

#[tauri::command]
fn perform_install(
    app: tauri::AppHandle,
    dest: String,
    scope: String,
    desktop: bool,
    startmenu: bool,
    contextmenu: bool,
) {
    CANCELLED.store(false, Ordering::Relaxed);
    std::thread::spawn(move || {
        if scope != "current" {
            emit_failed(&app, "初版暂未支持「为所有用户安装」，请选择「仅为我安装」。");
            return;
        }
        let dest = PathBuf::from(&dest);
        let main_in_dest = dest.join(MAIN_EXE);
        let total = 10usize;

        if !step(&app, 0, total, &format!("解压程序文件到 {}", dest.display()), || {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            std::fs::write(&main_in_dest, MAIN_EXE_BYTES).map_err(|e| e.to_string())?;
            Ok(())
        }) { return finish_install(&app, false); }

        if !step(&app, 1, total, "部署 Agent 运行时（dsh + node）", || {
            deploy_runtime(&dest)
        }) { return finish_install(&app, false); }

        if !step(&app, 2, total, "部署卸载器", || {
            std::fs::copy(win::self_exe(), dest.join(UNINSTALLER_NAME)).map_err(|e| e.to_string())?;
            Ok(())
        }) { return finish_install(&app, false); }

        if desktop
            && !step(&app, 3, total, "创建桌面快捷方式", || {
                let lnk = dirs::desktop_dir().ok_or("找不到桌面目录")?.join("WorldSea.lnk");
                win::create_shortcut(&main_in_dest, &lnk)
            }) { return finish_install(&app, false); }

        if startmenu
            && !step(&app, 4, total, "注册开始菜单项", || {
                let dir = start_menu_dir().ok_or("找不到开始菜单目录")?.join("WorldSea");
                std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                win::create_shortcut(&main_in_dest, &dir.join("WorldSea.lnk"))
            }) { return finish_install(&app, false); }

        if contextmenu
            && !step(&app, 5, total, "写入右键菜单集成", || shell_integration::write_context_menu(&main_in_dest))
        { return finish_install(&app, false); }

        if !step(&app, 6, total, "初始化本地数据目录 · 正在部署世界观引擎", || {
            std::fs::create_dir_all(app_data_dir()).map_err(|e| e.to_string())
        }) { return finish_install(&app, false); }

        if !step(&app, 7, total, "校验文件完整性", || {
            let meta = std::fs::metadata(&main_in_dest).map_err(|e| e.to_string())?;
            if meta.len() == 0 { Err("主程序文件为空".into()) } else { Ok(()) }
        }) { return finish_install(&app, false); }

        if !step(&app, 8, total, "部署工作台界面", || {
            deploy_workspace_dist(&dest)
        }) { return finish_install(&app, false); }

        if !step(&app, 9, total, "写入卸载信息", || {
            shell_integration::write_uninstall_registry(&dest, &main_in_dest)
        }) { return finish_install(&app, false); }

        finish_install(&app, true);
    });
}

fn finish_install(app: &tauri::AppHandle, ok: bool) {
    if CANCELLED.load(Ordering::Relaxed) {
        let _ = app.emit("installer://cancelled", ());
    } else if ok {
        let _ = app.emit("installer://done", ());
    }
}

/// 解压用 System32 的 bsdtar：PATH 里的 GNU tar（Git/MSYS）不支持 zip。
fn tar_command() -> std::process::Command {
    let tar = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| root.join("System32").join("tar.exe"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from("tar"));
    let mut cmd = std::process::Command::new(tar);
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：GUI 模式下不闪控制台窗口
    cmd
}

/// 释放内嵌 zip 并用系统 tar.exe 解压到 dest（Windows 10 1803+ 自带 bsdtar，原生支持 zip）。
fn extract_zip(bytes: &[u8], dest: &Path, temp_name: &str) -> Result<(), String> {
    let zip = std::env::temp_dir().join(temp_name);
    std::fs::write(&zip, bytes).map_err(|e| format!("释放压缩包失败：{e}"))?;
    let out = tar_command()
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(dest)
        .output()
        .map_err(|e| format!("解压失败（tar 不可用？需 Windows 10 1803+）：{e}"))?;
    let _ = std::fs::remove_file(&zip);
    if !out.status.success() {
        return Err(format!("压缩包解压失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(())
}

/// 解压内嵌运行时到 `<dest>\dsh-runtime`。
fn deploy_runtime(dest: &Path) -> Result<(), String> {
    let runtime_dir = dest.join("dsh-runtime");
    // 重装/覆盖安装：清掉旧运行时再解压，避免半新半旧
    if runtime_dir.exists() {
        std::fs::remove_dir_all(&runtime_dir).map_err(|e| format!("清理旧运行时失败：{e}"))?;
    }
    extract_zip(RUNTIME_ZIP_BYTES, dest, "worldsea-dsh-runtime.zip")?;
    let node = runtime_dir.join("node").join("node.exe");
    let bin = runtime_dir.join(r"dsh\node_modules\@deepseek-ai\dsh\lib\bin.js");
    if !node.is_file() || !bin.is_file() {
        return Err("运行时解压后缺少关键文件（node.exe / dsh bin.js）".into());
    }
    Ok(())
}

/// 解压内嵌工作台前端产物到 `<dest>\workspace-dist`。
fn deploy_workspace_dist(dest: &Path) -> Result<(), String> {
    let dist_dir = dest.join("workspace-dist");
    if dist_dir.exists() {
        std::fs::remove_dir_all(&dist_dir).map_err(|e| format!("清理旧工作台产物失败：{e}"))?;
    }
    extract_zip(WORKSPACE_DIST_ZIP_BYTES, dest, "worldsea-workspace-dist.zip")?;
    if !dist_dir.join("index.html").is_file() {
        return Err("工作台产物解压后缺少 index.html".into());
    }
    Ok(())
}

/// 目录总字节数（递归；EstimatedSize 用，失败按 0 计）
#[tauri::command]
fn perform_uninstall(app: tauri::AppHandle, purge: bool) {
    std::thread::spawn(move || {
        let dest = win::self_exe().parent().unwrap_or(Path::new(".")).to_path_buf();
        let total = 5usize;
        let data_step = if purge {
            format!("删除作品数据 · {}", app_data_dir().display())
        } else {
            format!("保留作品数据 · {}", app_data_dir().display())
        };

        let steps_ok = step(&app, 0, total, "注销文件关联与 Shell 集成", || {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let _ = hkcu.delete_subkey_all(CONTEXT_MENU_KEY);
            Ok(())
        }) && step(&app, 1, total, "移除桌面与开始菜单快捷方式", || {
            if let Some(d) = dirs::desktop_dir() { win::remove_file_if_exists(&d.join("WorldSea.lnk")); }
            if let Some(d) = start_menu_dir() { win::remove_dir_if_exists(&d.join("WorldSea")); }
            Ok(())
        }) && step(&app, 2, total, &format!("删除程序文件 · {}", dest.display()), || {
            let self_name = win::self_exe().file_name().map(|n| n.to_os_string());
            for entry in std::fs::read_dir(&dest)
                .map_err(|e| e.to_string())?
                .flatten()
            {
                if Some(entry.file_name().as_os_str()) == self_name.as_deref() {
                    continue; // 自身在运行中，最后统一处理
                }
                let p = entry.path();
                if p.is_dir() { win::remove_dir_if_exists(&p); } else { win::remove_file_if_exists(&p); }
            }
            Ok(())
        }) && step(&app, 3, total, &data_step, || {
            if purge {
                if app_data_dir().exists() {
                    std::fs::remove_dir_all(app_data_dir()).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        }) && step(&app, 4, total, "从系统卸载列表中移除 WorldSea", || {
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let _ = hkcu.delete_subkey_all(UNINSTALL_KEY);
            Ok(())
        });

        if steps_ok {
            win::mark_self_for_deletion();
            let _ = app.emit("installer://done", ());
        } else {
            emit_failed(&app, "卸载未全部完成，可重试或手动清理残留文件。");
        }
    });
}

#[tauri::command]
fn cancel_install() {
    CANCELLED.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn open_dir(path: String) {
    let _ = std::process::Command::new("explorer").arg(&path).spawn();
}

#[tauri::command]
fn launch_app(dest: String) {
    let _ = std::process::Command::new(Path::new(&dest).join(MAIN_EXE)).spawn();
}

/// panic / 启动失败落盘 %TEMP%\worldsea-installer.log，便于无控制台的 release 版排查
fn log_error(msg: &str) {
    let text = format!("[{}] {msg}\n", Instant::now().elapsed().as_secs_f64());
    eprintln!("{text}");
    let _ = std::fs::write(std::env::temp_dir().join("worldsea-installer.log"), &text);
}

fn main() {
    std::panic::set_hook(Box::new(|info| log_error(&format!("[panic] {info}"))));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_mode,
            get_default_install_dir,
            get_data_dir,
            get_install_location,
            get_free_space_mb,
            perform_install,
            perform_uninstall,
            cancel_install,
            open_dir,
            launch_app
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| log_error(&format!("启动失败: {e}")));
}
