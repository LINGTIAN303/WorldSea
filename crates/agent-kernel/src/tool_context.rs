//! 工具上下文（ToolContext）— 为工具提供会话级工作区信息
//!
//! 详细见 docs/details/注释/agent-runtime/tool.md
//!
//! # 设计背景
//! 阶段 1.4 之前的 `Tool::execute(&self, args)` 只接收参数，工具无法感知
//! 会话绑定的工作区目录（workspace）。本结构体作为「上下文注入」载体，
//! 配合 [`crate::tool::Tool::execute_with_ctx`] 默认方法，让工具（尤其是
//! FS 类工具）能基于 `workdir` 解析相对路径，而旧工具零改动（默认回落）。

use std::path::{Component, Path, PathBuf};

/// 工具上下文 — 每次工具执行时注入的会话级信息
///
/// # 字段
/// - `workdir`：会话绑定的工作区根目录（`None`=无约束，相对路径原样返回）
/// - `project_id`：关联项目 ID（可选，供多项目/多工作区场景区分）
/// - `workspace_id`：关联 Workspace 实体 id（Phase A，`None`=旧数据缺省）
///
/// # 约束
/// 需满足 `Clone + Send + Sync`（并行工具执行时 `JoinSet::spawn` 需 clone 进每个 task）。
#[derive(Clone, Debug, Default)]
pub struct ToolContext {
    /// 会话工作区根目录（`None`=不限定工作区）
    pub workdir: Option<PathBuf>,
    /// 关联项目 ID（可选）
    pub project_id: Option<String>,
    /// Workspace 实体 id（可选；Phase A，供工具/后续边界感知实体归属）
    pub workspace_id: Option<String>,
}

impl ToolContext {
    /// 解析路径：相对路径基于 `workdir` 解析，绝对路径原样返回
    ///
    /// # 规则
    /// - `path` 是绝对路径（`Path::is_absolute()`）→ 原样返回，不做修正
    /// - `path` 是相对路径且 `workdir` 存在 → `workdir.join(path)`
    /// - `path` 是相对路径且 `workdir` 为 `None` → 原样返回 `PathBuf::from(path)`
    pub fn resolve_path(&self, path: &str) -> PathBuf {
        let p = Path::new(path);
        if p.is_absolute() {
            return p.to_path_buf();
        }
        match &self.workdir {
            Some(wd) => wd.join(p),
            None => PathBuf::from(path),
        }
    }

    /// 判断给定路径是否落在 `workdir` 内
    ///
    /// # 规则
    /// - `workdir` 为 `None` → 恒返回 `true`（无约束）
    /// - 否则解析路径后做词法归一化（处理 `.`/`..`），再 `starts_with(workdir)` 判定
    ///
    /// # 说明
    /// 采用词法归一化而非 `Path::canonicalize`：后者要求路径真实存在，
    /// 对尚未创建的文件会失败；词法归一化不依赖文件系统，纯路径运算。
    pub fn is_within_workdir(&self, path: &str) -> bool {
        let Some(wd) = &self.workdir else {
            return true;
        };
        let resolved = normalize_path(&self.resolve_path(path));
        let wd = normalize_path(wd);
        resolved.starts_with(wd)
    }
}

/// 词法归一化路径：移除 `.` 与 `..`（纯路径运算，不访问文件系统）
///
/// 用于 `is_within_workdir` 的越界判定，避免 `Path::starts_with` 的
/// 词法前缀误判（如 `/workspace/../outside.md` 实际越界但前缀匹配为真）。
fn normalize_path(p: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                // 向上退一级；空路径/根目录无法再退（pop 返回 false，安全忽略）
                result.pop();
            }
            _ => result.push(comp.as_os_str()),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_relative_uses_workdir() {
        let ctx = ToolContext {
            workdir: Some(PathBuf::from("/workspace")),
            project_id: None,
            workspace_id: None,
        };
        let resolved = ctx.resolve_path("src/a.md");
        assert_eq!(resolved, PathBuf::from("/workspace/src/a.md"));
    }

    #[test]
    fn resolve_absolute_returns_as_is() {
        let ctx = ToolContext {
            workdir: Some(PathBuf::from("/workspace")),
            project_id: None,
            workspace_id: None,
        };
        let resolved = ctx.resolve_path("/etc/passwd");
        assert_eq!(resolved, PathBuf::from("/etc/passwd"));
    }

    #[test]
    fn resolve_relative_without_workdir_returns_as_is() {
        let ctx = ToolContext::default();
        let resolved = ctx.resolve_path("src/a.md");
        assert_eq!(resolved, PathBuf::from("src/a.md"));
    }

    #[test]
    fn within_workdir_true_for_inner_path() {
        let ctx = ToolContext {
            workdir: Some(PathBuf::from("/workspace")),
            project_id: None,
            workspace_id: None,
        };
        assert!(ctx.is_within_workdir("src/a.md"));
        assert!(ctx.is_within_workdir("/workspace/src/a.md"));
    }

    #[test]
    fn within_workdir_false_for_outer_path() {
        let ctx = ToolContext {
            workdir: Some(PathBuf::from("/workspace")),
            project_id: None,
            workspace_id: None,
        };
        assert!(!ctx.is_within_workdir("/etc/passwd"));
        assert!(!ctx.is_within_workdir("../outside.md"));
    }

    #[test]
    fn within_workdir_true_when_no_workdir() {
        let ctx = ToolContext::default();
        assert!(ctx.is_within_workdir("/any/path"));
    }
}
