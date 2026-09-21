//! E3 沙箱决议层（E3-1 决议地基，2026-09-18，方向 3 沙箱主业）
//!
//! 内部「文件写效应」策略词汇（引擎侧；**不是**用户可见档位——用户语义仍为三档
//! `plan / interact / autopilot`）。设计见
//! [03-E3真沙箱设计方案](../../../docs/plans/2026-09-18-工作区与环境对齐dsh/03-E3真沙箱设计方案.md)。
//!
//! # 词汇边界（对齐 dsh）
//! 只限【文件写效应】；读 / 网络 / 进程可见性不在词表内。
//!
//! # 阶段
//! - **E3-1（本模块）**：决议纯函数 + `ToolContext.sandbox` 戳记（**仅观测**，不改变执行行为）。
//! - E3-2 / E3-3：执行层强制（Windows 受限令牌 + 工作区 / 私有 temp ACL 授予）；
//!   失败关闭（沙箱不可用 → Agent 路径拒绝执行）在 E3-2 落地。

use std::path::{Path, PathBuf};

use crate::permission_rules::SecurityLevel;

/// 沙箱文件效应模式（内部词汇；由三档派生，不暴露给用户）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxMode {
    /// 只读：不授予任何写能力（plan 档；命令即便被放行也无写权限）
    ReadOnly,
    /// 工作区写：写 = 工作区根 + 私有 temp（interact / autopilot 档）
    WorkspaceWrite,
}

impl SandboxMode {
    /// 稳定字符串（日志 / 审计元信息 / 测试锚点）
    pub fn as_str(&self) -> &'static str {
        match self {
            SandboxMode::ReadOnly => "read_only",
            SandboxMode::WorkspaceWrite => "workspace_write",
        }
    }
}

/// 单次工具执行的沙箱策略（E2 预设位预留：将来具名预设在此 resolver 之上加命名映射，
/// 执行层零改动——见设计方案 §4.7）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxSpec {
    /// 文件效应模式
    pub mode: SandboxMode,
    /// 工作区根（workspace-write 的可写边界；read-only 下也携带，供审计与后续改造）
    pub root: PathBuf,
}

/// 决议纯函数：由档位 + 工作区派生沙箱策略（E3-1 拍板口径 D2）
///
/// # 规则
/// - `workdir = None` → `None`（不启用戳记；Agent 命令路径已由 W3 `require_workdir` 拒绝，
///   面板路径不持有 ctx）
/// - `plan` → [`SandboxMode::ReadOnly`]；`interact` / `autopilot` → [`SandboxMode::WorkspaceWrite`]
pub fn sandbox_policy(level: SecurityLevel, workdir: Option<&Path>) -> Option<SandboxSpec> {
    let root = workdir?;
    let mode = match level {
        SecurityLevel::Plan => SandboxMode::ReadOnly,
        SecurityLevel::Interact | SecurityLevel::Autopilot => SandboxMode::WorkspaceWrite,
    };
    Some(SandboxSpec {
        mode,
        root: root.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_maps_to_read_only() {
        let spec = sandbox_policy(SecurityLevel::Plan, Some(Path::new("/ws"))).expect("应派生策略");
        assert_eq!(spec.mode, SandboxMode::ReadOnly);
        assert_eq!(spec.root, PathBuf::from("/ws"));
    }

    #[test]
    fn interact_and_autopilot_map_to_workspace_write() {
        for level in [SecurityLevel::Interact, SecurityLevel::Autopilot] {
            let spec = sandbox_policy(level, Some(Path::new("/ws")))
                .unwrap_or_else(|| panic!("{level:?} 应派生策略"));
            assert_eq!(spec.mode, SandboxMode::WorkspaceWrite, "{level:?}");
        }
    }

    #[test]
    fn no_workdir_means_no_spec() {
        for level in [
            SecurityLevel::Plan,
            SecurityLevel::Interact,
            SecurityLevel::Autopilot,
        ] {
            assert!(sandbox_policy(level, None).is_none(), "{level:?}");
        }
    }

    #[test]
    fn mode_str_is_stable() {
        // 稳定字符串是日志与审计元信息的对外锚点
        assert_eq!(SandboxMode::ReadOnly.as_str(), "read_only");
        assert_eq!(SandboxMode::WorkspaceWrite.as_str(), "workspace_write");
    }
}