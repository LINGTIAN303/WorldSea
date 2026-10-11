//! Windows Job object 整树回收（LSP 子进程防孤儿）
//!
//! 自 `agent-commands::job` 打捞（2026-09-27 E8：agent-commands crate 退场，
//! 本模块为其唯一存活消费者——`lsp_commands` 挂 Job Object 防 LSP 子进程孤儿）。
//! 原职责覆盖命令工具子进程树回收；Drop 关闭 Job 句柄 → Windows 自动终止该
//! Job 内全部残留子进程。非 Windows 平台为空操作。
//!
//! 背景：`tokio::process::Command::kill()` 只杀主进程，Windows 上子进程树会残留。

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
#[cfg(windows)]
use windows_sys::Win32::System::Threading::OpenProcess;

/// Windows Job 句柄包装（KILL_ON_JOB_CLOSE）；Drop 关闭时整树回收
#[cfg(windows)]
pub struct WinJob {
    job: HANDLE,
}

// Job 句柄可跨线程使用/关闭（CloseHandle 线程安全）——工具 future 跨 await 持有需 Send
#[cfg(windows)]
unsafe impl Send for WinJob {}

#[cfg(windows)]
impl WinJob {
    pub fn new() -> Result<Self, String> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err("CreateJobObjectW 失败".into());
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
            let r = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                size,
            );
            if r == 0 {
                CloseHandle(job);
                return Err("SetInformationJobObject 失败".into());
            }
            Ok(Self { job })
        }
    }

    /// 将指定 pid 的进程挂入 Job（进程需已创建；竞态窗口极小，assign 失败仅告警不阻塞）
    pub fn assign(&self, pid: u32) -> Result<(), String> {
        unsafe {
            let proc = OpenProcess(windows_sys::Win32::System::Threading::PROCESS_SET_QUOTA
                | windows_sys::Win32::System::Threading::PROCESS_TERMINATE, FALSE, pid);
            if proc.is_null() {
                return Err(format!("OpenProcess({pid}) 失败"));
            }
            let r = AssignProcessToJobObject(self.job, proc);
            CloseHandle(proc);
            if r == 0 {
                return Err(format!("AssignProcessToJobObject({pid}) 失败"));
            }
            Ok(())
        }
    }
}

#[cfg(windows)]
impl Drop for WinJob {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.job);
        }
    }
}

/// 非 Windows 占位（空操作，保持原有 kill 行为）
#[cfg(not(windows))]
pub struct WinJob;

#[cfg(not(windows))]
impl WinJob {
    pub fn new() -> Result<Self, String> {
        Ok(WinJob)
    }
    #[allow(unused_variables)]
    pub fn assign(&self, pid: u32) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winjob_create_and_drop_no_panic() {
        // 跨平台：Windows 真实 Create/Close Job（KILL_ON_JOB_CLOSE），Unix 空实现；均不 panic
        let job = WinJob::new().expect("WinJob::new 应成功");
        drop(job);
    }

    #[cfg(windows)]
    #[test]
    fn winjob_assign_invalid_pid_fails() {
        // 不存在的 pid（u32::MAX）→ OpenProcess 失败 → assign 返回 Err（不 panic）
        let job = WinJob::new().unwrap();
        assert!(job.assign(u32::MAX).is_err());
    }
}
