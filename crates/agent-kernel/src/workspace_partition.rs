//! 工作区分区语义（方向 2：Agent 工作区演进 M1）
//!
//! 详细见 docs/details/注释/agent-commands/fs.md 与
//! .trae/documents/工作区分区与子Agent隔离实施计划.md
//!
//! # 分区约定（workdir 内一级子目录，2026-09-03 用户拍板）
//! - `agent-tmp/`：临时区，Agent 全权（写免确认、可随意清理；git 不入库约定）
//!   - `agent-tmp/sub-{id}/`：子 Agent 个人临时目录（编排创建时预建 + 引导注入）
//! - `agent-out/`：成果区，收官产物（写规则沿用现有 L1/L2/L3 permission 体系）
//! - `entities/`、`.worldsea/`：项目数据区（E1 写保护，见 agent-commands::fs_tools）
//! - 未绑定项目时兜底草稿区：`~/.worldsea/workspace`（既有，勿动）
//!
//! # 与 E1 的关系
//! E1 只保护 `entities`/`.worldsea` 两个一级目录，与 `agent-tmp`（另一级目录）
//! 天然互斥。`agent-tmp` 免确认仅跳过 HITL 审批；`ensure_not_protected` 在 FS
//! 真实写入链路独立执行，本模块不削弱 E1。

use std::path::{Path, PathBuf};

/// 临时区目录名：Agent 全权（写免确认、可清理）
pub const AGENT_TMP_DIR: &str = "agent-tmp";

/// 成果区目录名：收官产物（写规则沿用现有权限）
pub const AGENT_OUT_DIR: &str = "agent-out";

/// 子 Agent 个人临时目录：`{workdir}/agent-tmp/sub-{id}`
///
/// 目录引导模式下该路径注入子 Agent system_prompt；强隔离模式下由调用方传给
/// `SubAgentSpec.temp_dir`。
pub fn sub_agent_tmp_dir(workdir: &Path, sub_agent_id: &str) -> PathBuf {
    workdir
        .join(AGENT_TMP_DIR)
        .join(format!("sub-{sub_agent_id}"))
}

/// 判定解析后的路径是否落在 workdir 的 agent-tmp 一级子目录内（大小写不敏感）
///
/// 结构镜像 `agent_commands::fs_tools::is_protected_project_path`（strip_prefix 后
/// 取首组件比对）。调用方应先做词法归一化（处理 `.`/`..`）再判定，避免
/// `agent-tmp/../entities/...` 逃逸；归一化见 `agent_kernel::tool_context::normalize_path`。
pub fn is_within_agent_tmp(workdir: &Path, resolved: &Path) -> bool {
    let Ok(rel) = resolved.strip_prefix(workdir) else {
        return false;
    };
    let Some(first) = rel.components().next() else {
        return false;
    };
    first.as_os_str().to_string_lossy().to_lowercase() == AGENT_TMP_DIR
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wd() -> PathBuf {
        PathBuf::from("/proj")
    }

    #[test]
    fn within_agent_tmp_hit() {
        assert!(is_within_agent_tmp(&wd(), &PathBuf::from("/proj/agent-tmp/x.md")));
        // 大小写不敏感（Windows 文件系统）
        assert!(is_within_agent_tmp(&wd(), &PathBuf::from("/proj/AGENT-TMP/x.md")));
        // 临时区根本身也命中（对其写/删同样危险，保持一致语义）
        assert!(is_within_agent_tmp(&wd(), &PathBuf::from("/proj/agent-tmp")));
    }

    #[test]
    fn within_agent_tmp_miss() {
        assert!(!is_within_agent_tmp(&wd(), &PathBuf::from("/proj/out.md")));
        assert!(!is_within_agent_tmp(&wd(), &PathBuf::from("/proj/agent-out/x.md")));
        assert!(!is_within_agent_tmp(&wd(), &PathBuf::from("/proj/entities/x.json")));
        assert!(!is_within_agent_tmp(&wd(), &PathBuf::from("/other/agent-tmp/x.md")));
        // 前缀相似但非 agent-tmp 目录（组件级比对，避免 /agent-tmp2 误命中）
        assert!(!is_within_agent_tmp(&wd(), &PathBuf::from("/proj/agent-tmp2/x.md")));
    }

    #[test]
    fn sub_dir_shape() {
        assert_eq!(
            sub_agent_tmp_dir(&wd(), "coder"),
            PathBuf::from("/proj/agent-tmp/sub-coder")
        );
    }
}