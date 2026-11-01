//! 盘符枚举命令：自绘文件选择器的根导航（左侧轨「此电脑」）。
//!
//! Windows 走 `GetLogicalDrives` 取位掩码 + `GetDriveTypeW` 判介质类型；
//! 非 Windows 返回单一根 `/`。**只读**，不触碰 `fs_commands` 的写守卫。
//! 命令面口径见 docs/details/注释/tauri/fs-commands.md。

use serde::Serialize;

/// 盘符条目（前端根导航项）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveEntry {
    /// 显示名（`C:` / `/`）
    pub name: String,
    /// 可拼接的绝对路径前缀（`C:/` / `/`，恒正斜杠）
    pub path: String,
    /// 介质类型：fixed / removable / network / cdrom / ram / unknown
    pub kind: String,
}

/// 盘符类型码 → 前端可读标签（与 Win32 `GetDriveTypeW` 返回值对应）
fn kind_of(drive_type: u32) -> &'static str {
    match drive_type {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "cdrom",
        6 => "ram",
        _ => "unknown",
    }
}

/// 位掩码 → 盘符序列（纯函数，供非 Windows 分支与单测共用）
fn drives_from_mask(mask: u32) -> Vec<DriveEntry> {
    (0..26)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let letter = (b'A' + i as u8) as char;
            DriveEntry {
                name: format!("{letter}:"),
                path: format!("{letter}:/"),
                kind: "unknown".to_string(),
            }
        })
        .collect()
}

/// 枚举盘符（Windows 实现；同步以便单测直调）
#[cfg(windows)]
fn enumerate_drives() -> Result<Vec<DriveEntry>, String> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};

    let mask = unsafe { GetLogicalDrives() };
    if mask == 0 {
        return Err("枚举盘符失败（GetLogicalDrives 返回 0）".into());
    }
    let mut out = drives_from_mask(mask);
    for entry in &mut out {
        // GetDriveTypeW 接收根路径（`C:\`）
        let root: Vec<u16> = format!("{}\\", entry.name)
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
        entry.kind = kind_of(drive_type).to_string();
    }
    Ok(out)
}

/// 枚举盘符（非 Windows：单一根）
#[cfg(not(windows))]
fn enumerate_drives() -> Result<Vec<DriveEntry>, String> {
    Ok(vec![DriveEntry {
        name: "/".to_string(),
        path: "/".to_string(),
        kind: "fixed".to_string(),
    }])
}

/// 枚举本机盘符（自绘文件选择器根导航）
#[tauri::command]
pub async fn cmd_fs_drives() -> Result<Vec<DriveEntry>, String> {
    enumerate_drives()
}

#[cfg(test)]
#[path = "fs_drives_tests.rs"]
mod tests;
