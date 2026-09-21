//! 工作区路径身份规范化（W1 · 2026-09-18 工作区与环境对齐 dsh）
//!
//! 详见 docs/plans/2026-09-18-工作区与环境对齐dsh/02-对照与建议清单.md §3.1 W1
//!
//! # 背景
//! 对齐 dsh「`path` 创建时 realpath 规范化一次、之后永不改写」：同一目录若以不同
//! 写法（大小写 / 短名 / `..` / 尾分隔符 / 符号链接）进入，旧行为会生成**多条
//! Workspace 实体**，导致会话分组、记忆隔离（project 分片）、文件索引（workdir
//! 指纹）三处静默分叉——身份分裂不报错、只分叉，事后排查成本高。
//!
//! # 规则（幂等）
//! - 目录存在 → `std::fs::canonicalize`（解析大小写 / 短名 / 符号链接 / `..` / 尾分隔符）
//! - 目录尚未创建 → 词法归一化（去 `.` / `..` / 重复分隔符，不访问文件系统）
//! - Windows canonicalize 产 `\\?\`（或 `\\?\UNC\`）verbatim 前缀 → 剥除
//! - **分隔符统一为 `/`**——与跨层值约定一致（如 `cmd_get_app_data_dir` 亦转 `/`），
//!   避免同一目录因 `\` / `/` 混用在前端分组等字符串比较处分叉
//!   （前端 `useSessionTree.normalizePath` 同步做分隔符归一，双侧口径一致）

use std::path::{Component, Path, PathBuf};

/// 规范化工作区根目录字符串（幂等；对已是规范形的输入零变化）
pub(crate) fn normalize_workdir(raw: &str) -> String {
    if raw.trim().is_empty() {
        return raw.to_string();
    }
    let p = Path::new(raw);
    if let Ok(canonical) = std::fs::canonicalize(p) {
        return to_slash(&strip_verbatim_prefix(&canonical.to_string_lossy()));
    }
    // 目录尚未创建：词法归一化（与 kernel `tool_context::normalize_path` 同法，
    // 纯路径运算、不依赖文件系统）
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            _ => out.push(comp.as_os_str()),
        }
    }
    to_slash(&out.to_string_lossy())
}

/// 分隔符统一为 `/`（Windows 原生 `\` → `/`；Unix 原样）
fn to_slash(s: &str) -> String {
    s.replace('\\', "/")
}

/// 剥除 Windows verbatim 前缀：`\\?\C:\x` → `C:\x`；`\\?\UNC\srv\share` → `\\srv\share`
fn strip_verbatim_prefix(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        return rest.to_string();
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ws-norm-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// 幂等：规范化结果再规范化零变化；且无 verbatim 前缀残留
    #[test]
    fn normalize_is_idempotent() {
        let d = temp_dir("idem");
        let once = normalize_workdir(&d.to_string_lossy());
        let twice = normalize_workdir(&once);
        assert_eq!(once, twice);
        assert!(!once.starts_with(r"\\?\"), "不应残留 verbatim 前缀: {once}");
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 尾分隔符 / `.` / `..` 写法归一到同一身份（目录存在时按 canonicalize 解析）
    #[test]
    fn variants_collapse_for_existing_dir() {
        let d = temp_dir("variant");
        let sub = d.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let canonical = normalize_workdir(&sub.to_string_lossy());
        // 尾分隔符
        assert_eq!(normalize_workdir(&format!("{}{}", sub.to_string_lossy(), std::path::MAIN_SEPARATOR)), canonical);
        // `sub/../sub`
        let dotted = d.join("sub").join("..").join("sub");
        assert_eq!(normalize_workdir(&dotted.to_string_lossy()), canonical);
        // `./sub`
        let cur = d.join(".").join("sub");
        assert_eq!(normalize_workdir(&cur.to_string_lossy()), canonical);
        let _ = std::fs::remove_dir_all(&d);
    }

    /// 目录尚未创建：词法归一化 `..` / `.`，不访问文件系统（结果一致）
    #[test]
    fn lexical_normalize_for_missing_dir() {
        let base = temp_dir("lex");
        let missing = base.join("not-yet").join("..").join("leaf");
        let expected = base.join("leaf");
        assert_eq!(
            normalize_workdir(&missing.to_string_lossy()),
            normalize_workdir(&expected.to_string_lossy())
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// 空串 / 空白原样返回（不产生非法路径）
    #[test]
    fn empty_input_passthrough() {
        assert_eq!(normalize_workdir(""), "");
        assert_eq!(normalize_workdir("   "), "   ");
    }

    /// 分隔符统一为 `/`（跨层值约定；与前端 useSessionTree.normalizePath 同口径）
    #[test]
    fn output_uses_forward_slashes() {
        let d = temp_dir("slash");
        let out = normalize_workdir(&d.to_string_lossy());
        assert!(!out.contains('\\'), "不应含反斜杠: {out}");
        // 词法回退分支同样转 `/`
        let missing = d.join("a").join("b");
        assert!(!normalize_workdir(&missing.to_string_lossy()).contains('\\'));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// verbatim 前缀剥除（含 UNC 形式）
    #[test]
    fn verbatim_prefix_stripped() {
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\Users\x"), r"C:\Users\x");
        assert_eq!(strip_verbatim_prefix(r"\\?\UNC\srv\share"), r"\\srv\share");
        assert_eq!(strip_verbatim_prefix(r"C:\Users\x"), r"C:\Users\x");
    }

    /// Windows：大小写不同写法归一到同一身份（canonicalize 按磁盘真实大小写解析）
    #[cfg(windows)]
    #[test]
    fn case_variants_collapse_on_windows() {
        let d = temp_dir("case");
        let lower = d.to_string_lossy().to_lowercase();
        let upper = d.to_string_lossy().to_uppercase();
        assert_eq!(normalize_workdir(&lower), normalize_workdir(&upper));
        let _ = std::fs::remove_dir_all(&d);
    }
}