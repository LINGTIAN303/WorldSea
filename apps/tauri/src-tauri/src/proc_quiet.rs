//! GUI 模式下隐藏子进程的控制台窗口。
//!
//! 主程序以 `windows_subsystem = "windows"` 编译（无控制台），spawn 控制台程序
//! （node/icacls/pwsh/cmd 等）会被分配新控制台 → 闪现终端窗口；
//! 所有「stdout 已 piped/null 的后台子进程」spawn 前应调用 `hide_console`，详见 docs/details/注释/proc-quiet.md。

use std::process::Command;

pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
