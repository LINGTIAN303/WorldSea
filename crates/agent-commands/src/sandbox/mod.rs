//! E3 真沙箱（E3-2）：命令文件效应边界——Windows 受限令牌 + 工作区 / 私有 temp ACL 授予。
//!
//! 详细见 docs/details/注释/agent-commands/sandbox.md；设计见
//! [03-E3真沙箱设计方案](../../../docs/plans/2026-09-18-工作区与环境对齐dsh/03-E3真沙箱设计方案.md)
//! （§三 机制选型 / §4.5 ACL 生命周期 / D1 拍板：受限令牌路线）。
//!
//! # 阶段（E3-4 收口，2026-09-18）
//! - **E3-1**：决议地基（kernel 纯函数 + `ToolContext.sandbox` 戳记，仅观测）；
//! - **E3-2**：命令族受限（受限令牌 / ACL 授予 / 受限 spawn / TMP-TEMP 重写 / fail-closed / 每工作区缓存）；
//! - **E3-3**：PTY 受限挂载（受限令牌挂 ConPTY + 会话级 temp 生命周期 + 回落定案「受限路径不回落」）；
//! - **E3-4**：收口（沙箱拒绝提示 + 审计元信息对外可见 + 文档；**工作区 ACE 撤销入口按 dsh 口径不交付**——
//!   常驻 ACE 是复用缓存，dsh 未交付清理命令，见注释文档 §5）。
//! - Unix 文件写边界挂后续（设计 §4.8；本期仅 pgroup 进程树回收补账）。
//!
//! # 词汇边界
//! 只限【文件写效应】：读 / 网络 / 进程可见性不在约束范围（对齐 dsh `WRITE_RESTRICTED` 语义）。

#[cfg(windows)]
pub mod win;

/// 平台是否支持受限执行（E3-2 仅 Windows；Unix 走 pgroup 进程树回收，文件写边界挂后续）
pub const fn supported() -> bool {
    cfg!(windows)
}

use std::time::Duration;

/// 命令子进程等待结果
pub enum WaitOutcome {
    /// 已退出（`None` = 未取得退出码）
    Exited(Option<i32>),
    /// 超时（进程仍在，调用方决定 kill）
    TimedOut,
}

/// 命令子进程统一形状（受限 / 普通两条通路；两通路均挂 P1 Job——Drop 时整树回收）
///
/// - `Plain`：既有通路（面板 / Unix / 无沙箱戳记），tokio 子进程 + Job；
/// - `Confined`：E3-2 受限通路（Windows），受限令牌 + 私有 Job（挂起创建期挂接）。
pub enum CommandChild {
    #[cfg(windows)]
    Confined(crate::sandbox::win::ConfinedChild),
    Plain {
        child: tokio::process::Child,
        /// 持有即回收：Drop 关闭 Job（`KILL_ON_JOB_CLOSE`）→ 整树终止残留子进程
        #[allow(dead_code)]
        job: crate::job::WinJob,
    },
}

impl CommandChild {
    pub fn plain(child: tokio::process::Child, job: crate::job::WinJob) -> Self {
        Self::Plain { child, job }
    }

    /// 取 stdout 读端（`None` = 已被取走）
    pub fn take_stdout(&mut self) -> Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>> {
        match self {
            Self::Plain { child, .. } => {
                child.stdout.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)
            }
            #[cfg(windows)]
            Self::Confined(c) => c
                .take_stdout()
                .map(|f| Box::new(tokio::fs::File::from_std(f)) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        }
    }

    /// 取 stderr 读端（`None` = 已被取走）
    pub fn take_stderr(&mut self) -> Option<Box<dyn tokio::io::AsyncRead + Unpin + Send>> {
        match self {
            Self::Plain { child, .. } => {
                child.stderr.take().map(|s| Box::new(s) as Box<dyn tokio::io::AsyncRead + Unpin + Send>)
            }
            #[cfg(windows)]
            Self::Confined(c) => c
                .take_stderr()
                .map(|f| Box::new(tokio::fs::File::from_std(f)) as Box<dyn tokio::io::AsyncRead + Unpin + Send>),
        }
    }

    /// 等待退出（含超时）
    pub async fn wait_timeout(&mut self, timeout: Duration) -> Result<WaitOutcome, String> {
        match self {
            Self::Plain { child, .. } => match tokio::time::timeout(timeout, child.wait()).await {
                Ok(Ok(st)) => Ok(WaitOutcome::Exited(st.code())),
                Ok(Err(e)) => Err(format!("命令等待失败: {e}")),
                Err(_) => Ok(WaitOutcome::TimedOut),
            },
            #[cfg(windows)]
            Self::Confined(c) => match c.wait_timeout(timeout).await? {
                Some(code) => Ok(WaitOutcome::Exited(Some(code))),
                None => Ok(WaitOutcome::TimedOut),
            },
        }
    }

    /// 终止主进程（残留子树由 Job 回收）
    pub async fn kill(&mut self) {
        match self {
            Self::Plain { child, .. } => {
                let _ = child.kill().await;
            }
            #[cfg(windows)]
            Self::Confined(c) => c.kill(),
        }
    }
}