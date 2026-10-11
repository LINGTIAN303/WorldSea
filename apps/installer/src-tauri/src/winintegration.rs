//! Windows 系统集成助手：磁盘空间、快捷方式、卸载注册表、自删除
//! 仅供安装器内部使用（super 模块）。

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows::core::{Interface, PCWSTR};
use windows::Win32::Storage::FileSystem::{
    GetDiskFreeSpaceExW, MoveFileExW, MOVEFILE_DELAY_UNTIL_REBOOT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    IPersistFile,
};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(Some(0)).collect()
}

fn pcw(p: &[u16]) -> PCWSTR {
    PCWSTR(p.as_ptr())
}

/// 目标所在卷的剩余空间（MB）；查询失败返回 0。
/// 目标目录可能尚未创建，向上回退到存在的父目录（最终到卷根）再查。
pub fn disk_free_mb(path: &Path) -> u64 {
    let mut probe = path.to_path_buf();
    loop {
        let mut free: u64 = 0;
        let w = wide(probe.as_os_str());
        unsafe {
            let _ = GetDiskFreeSpaceExW(pcw(&w), None, None, Some(&mut free as *mut u64));
        }
        if free > 0 {
            return free / (1024 * 1024);
        }
        match probe.parent() {
            Some(p) if p != probe => probe = p.to_path_buf(),
            _ => return 0,
        }
    }
}

/// 创建 .lnk 快捷方式（COM IShellLink；调用线程需自行 CoInitializeEx）
pub fn create_shortcut(target: &Path, lnk: &Path) -> Result<(), String> {
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("COM 初始化失败: {e}"))?;
        let link: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        let w_target = wide(target.as_os_str());
        link.SetPath(pcw(&w_target)).map_err(|e| e.to_string())?;
        if let Some(workdir) = target.parent() {
            let w_dir = wide(workdir.as_os_str());
            let _ = link.SetWorkingDirectory(pcw(&w_dir));
        }
        let persist: IPersistFile = link.cast().map_err(|e| e.to_string())?;
        let w_lnk = wide(lnk.as_os_str());
        persist.Save(pcw(&w_lnk), false.into()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn remove_file_if_exists(path: &Path) {
    let _ = std::fs::remove_file(path);
}

pub fn remove_dir_if_exists(path: &Path) {
    let _ = std::fs::remove_dir_all(path);
}

/// 当前进程自身路径
pub fn self_exe() -> std::path::PathBuf {
    std::env::current_exe().unwrap_or_default()
}

/// 把自身重命名为 .old 并标记重启后删除（卸载器自清理；失败则留在磁盘上）
pub fn mark_self_for_deletion() {
    let exe = self_exe();
    let Some(exe) = exe.file_name().map(|n| exe.with_file_name(n)) else {
        return;
    };
    let old = exe.with_extension("exe.old");
    if std::fs::rename(&exe, &old).is_ok() {
        let w = wide(old.as_os_str());
        unsafe {
            let _ = MoveFileExW(pcw(&w), PCWSTR::null(), MOVEFILE_DELAY_UNTIL_REBOOT);
        }
    }
}
