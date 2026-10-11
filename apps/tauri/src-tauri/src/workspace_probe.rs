// C4-a（2026-09-24）：工作区「可供给性」探针——无副作用判定 dsh 的 Windows ACL 沙箱能否在该目录完成供给。
//
// 依据（dsh 上游 packages/sandbox/sandbox-windows-acl/README.zh.md「已验证边界」）：供给是一次
// 「DACL + Low 完整性标签」的 SetNamedSecurityInfoW 合并应用，要求调用者在目录上有 **WRITE_OWNER**
// （所有者只隐式拿到 READ_CONTROL / WRITE_DAC）；只授予 Modify 的目录会被拒（Win32 5 = ACCESS_DENIED），
// 于是该工作区里**每条命令都在沙箱初始化阶段失败**（前台后台一视同仁）。
//
// 探测方式：以 `WRITE_OWNER` 为期望访问打开目录句柄（`FILE_FLAG_BACKUP_SEMANTICS` 才能开目录）——
// **只做访问检查，不改任何 ACL**。非 Windows 平台无此前置（POSIX 走 group/setsid 语义），直接视为可供给。

use std::path::Path;

/// 探测结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WorkspaceProbe {
    /// 可供给（Windows 上具备 WRITE_OWNER）。
    Ready,
    /// 目录不存在（或不是目录）。
    Missing,
    /// 缺 WRITE_OWNER：沙箱供给会被拒，该工作区里命令跑不起来。
    NoWriteOwner,
    /// 其他失败（携带可读细节）。
    Failed(String),
}

impl WorkspaceProbe {
    /// 是否可供给（装配侧据此决定是否出提示）。
    pub(crate) fn is_ready(&self) -> bool {
        matches!(self, WorkspaceProbe::Ready)
    }

    /// 一句话标签（日志行用）。
    pub(crate) fn label(&self) -> &'static str {
        match self {
            WorkspaceProbe::Ready => "可供给",
            WorkspaceProbe::Missing => "目录不存在",
            WorkspaceProbe::NoWriteOwner => "不可供给（缺 WRITE_OWNER）",
            WorkspaceProbe::Failed(_) => "探测失败",
        }
    }

    /// 面向日志/横幅的说明：目录 + 结论细节 +（不可供给时）修复命令与后果。
    pub(crate) fn describe(&self, dir: &Path) -> String {
        match self {
            WorkspaceProbe::Ready => dir.display().to_string(),
            WorkspaceProbe::Missing => format!("{}（请检查 WORLDSEA_WORKSPACE 指向）", dir.display()),
            WorkspaceProbe::NoWriteOwner => format!(
                "{}（dsh 沙箱需要目录上的 WRITE_OWNER；修复：{}。\
                 授权后 dsh 会在该目录常驻能力 ACE、删除拒绝与 Low 完整性标签）",
                dir.display(),
                fix_command(dir)
            ),
            WorkspaceProbe::Failed(detail) => format!("{}（探测失败：{detail}）", dir.display()),
        }
    }
}

/// 当前 trustee 名（`DOMAIN\user` 形态；icacls 的授权对象写法）。
pub(crate) fn current_user() -> String {
    let user = std::env::var("USERNAME").unwrap_or_else(|_| "%USERNAME%".to_string());
    match std::env::var("USERDOMAIN") {
        Ok(domain) if !domain.is_empty() => format!("{domain}\\{user}"),
        _ => user,
    }
}

/// 一次性修复命令（横幅文案与「修复工作区权限…」菜单共用）。
pub(crate) fn fix_command(dir: &Path) -> String {
    format!("icacls \"{}\" /grant \"{}:(OI)(CI)F\"", dir.display(), current_user())
}

/// 探测一个目录是否可被 dsh 的 ACL 沙箱供给。
pub(crate) fn check(dir: &Path) -> WorkspaceProbe {
    if !dir.is_dir() {
        return WorkspaceProbe::Missing;
    }
    #[cfg(windows)]
    {
        match open_with_write_owner(dir) {
            Ok(()) => WorkspaceProbe::Ready,
            Err(5) => WorkspaceProbe::NoWriteOwner,
            Err(code) => WorkspaceProbe::Failed(format!("CreateFileW(WRITE_OWNER) 失败（Win32 {code}）")),
        }
    }
    #[cfg(not(windows))]
    {
        WorkspaceProbe::Ready
    }
}

/// 以 `WRITE_OWNER` 打开目录句柄：开得成=具备该权限；`ACCESS_DENIED (5)`=没有。
/// 与 `dsh_pipe_io.rs` 的 `PeekNamedPipe` 同一手写 FFI 模式（不新增依赖）。
#[cfg(windows)]
fn open_with_write_owner(dir: &Path) -> Result<(), u32> {
    use std::os::windows::ffi::OsStrExt;

    const WRITE_OWNER: u32 = 0x0008_0000;
    const READ_CONTROL: u32 = 0x0002_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const INVALID_HANDLE_VALUE: isize = -1;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut core::ffi::c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: isize,
        ) -> isize;
        fn CloseHandle(object: isize) -> i32;
        fn GetLastError() -> u32;
    }

    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            WRITE_OWNER | READ_CONTROL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            0,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(unsafe { GetLastError() });
    }
    unsafe { CloseHandle(handle) };
    Ok(())
}

#[cfg(test)]
#[path = "workspace_probe_tests.rs"]
mod tests;
