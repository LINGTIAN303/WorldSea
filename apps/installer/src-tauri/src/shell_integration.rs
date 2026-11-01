//! Windows Shell 集成：右键菜单与卸载登记项（原 installer main.rs 迁出，控制单文件规模）。
//!
//! 三者都是纯注册表 / 文件系统操作，不依赖 Tauri AppHandle——放独立文件后
//! 单测可直接调用，不必启动安装器窗口。
//!
//! 常量（注册表路径、版本、卸载器名）与 main.rs 共用，集中在其顶部定义。

use std::path::Path;
use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
use winreg::RegKey;

use crate::{CONTEXT_MENU_KEY, UNINSTALLER_NAME, UNINSTALL_KEY, VERSION};

/// 递归统计目录占用（用于卸载登记项的 EstimatedSize）
pub(crate) fn dir_size_bytes(dir: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_size_bytes(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

/// 写入资源管理器右键菜单项（`用 WorldSea 打开`）
pub(crate) fn write_context_menu(main_exe: &Path) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey_with_flags(CONTEXT_MENU_KEY, KEY_WRITE)
        .map_err(|e| e.to_string())?;
    key.set_value("", &"用 WorldSea 打开").map_err(|e| e.to_string())?;
    key.set_value("Icon", &main_exe.display().to_string()).map_err(|e| e.to_string())?;
    let (cmd, _) = hkcu
        .create_subkey_with_flags(&format!("{CONTEXT_MENU_KEY}\\command"), KEY_WRITE)
        .map_err(|e| e.to_string())?;
    cmd.set_value("", &format!("\"{}\" \"%1\"", main_exe.display()))
        .map_err(|e| e.to_string())
}

/// 写入「应用和功能」卸载登记项
pub(crate) fn write_uninstall_registry(dest: &Path, main_exe: &Path) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey_with_flags(UNINSTALL_KEY, KEY_WRITE)
        .map_err(|e| e.to_string())?;
    let set_s = |name: &str, v: String| key.set_value(name, &v).map_err(|e| e.to_string());
    set_s("DisplayName", "WorldSea".into())?;
    set_s("DisplayVersion", VERSION.into())?;
    set_s("Publisher", "WorldSea".into())?;
    set_s("InstallLocation", dest.display().to_string())?;
    set_s("DisplayIcon", main_exe.display().to_string())?;
    set_s("UninstallString", format!("\"{}\" --uninstall", dest.join(UNINSTALLER_NAME).display()))?;
    // EstimatedSize 注册表要求 REG_DWORD（KB）；程序 + Agent 运行时 + 工作台产物（解压后实际占用）
    let size_kb = ((std::fs::metadata(main_exe).map(|m| m.len()).unwrap_or(0)
        + dir_size_bytes(&dest.join("dsh-runtime"))
        + dir_size_bytes(&dest.join("workspace-dist"))) / 1024) as u32;
    key.set_value("EstimatedSize", &size_kb).map_err(|e| e.to_string())?;
    key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
    Ok(())
}
