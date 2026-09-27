//! E1（2026-09-25）：**单一可见根** —— `%USERPROFILE%\WorldSea\`。
//!
//! 口径（用户拍板「1A」，见 docs/plans/2026-09-25-E1-目录口径批计划.md）：
//! - 用户可见根 = `%USERPROFILE%\WorldSea`（也正是 C4 起的 **dsh 默认工作区**）→
//!   「dsh 沙箱可写根 ⊇ 产品域创作数据」成立（沙箱只放行 cwd + tmp），文件类工具可直写创作数据；
//! - 根下四子目录：`worlddata\`（默认项目实体）· `agent\`（默认项目 Agent 工作区）·
//!   `rules\`（全局规则）· `skills\`（个人技能导入区）；旧 `~/.WorldSea\` 退役；
//! - **一次性搬迁**：旧根各子目录 → 新根（旧存在且新不存在才拷；**只拷不删**，留痕日志）；
//!   `WORLDSEA_NO_DATA_MIGRATE=1` 关闭（反证/测试用）。

use std::path::{Path, PathBuf};

/// 可见根目录名（`%USERPROFILE%\WorldSea`）。
pub const ROOT_DIR_NAME: &str = "WorldSea";
/// 退役旧根目录名（`~/.WorldSea`）。
const LEGACY_DIR_NAME: &str = ".WorldSea";
/// 需要随根迁移的子目录（只有这四个属用户侧创作数据）。
const LEGACY_SUBDIRS: [&str; 4] = ["worlddata", "agent", "rules", "skills"];

/// 用户主目录（`USERPROFILE`，POSIX `HOME` 兜底）。
pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| "无法定位用户主目录（USERPROFILE / HOME 均未设置）".to_string())
}

/// 单一可见根（不创建）。
pub fn user_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(ROOT_DIR_NAME))
}

/// 一次性搬迁（幂等；只拷不删）。返回迁过的子目录名（供日志）。
/// `WORLDSEA_NO_DATA_MIGRATE=1` 时直接返回空（反证/测试开关）。
pub fn migrate_legacy_home_root() -> Vec<String> {
    if std::env::var_os("WORLDSEA_NO_DATA_MIGRATE").is_some() {
        println!("[WORLDSEA-DATA] 旧根搬迁已按 WORLDSEA_NO_DATA_MIGRATE 跳过（反证模式：新根维持空态）");
        return Vec::new();
    }
    let (Ok(home), Ok(root)) = (home_dir(), user_root()) else {
        return Vec::new();
    };
    match migrate_under(&root, &home.join(LEGACY_DIR_NAME)) {
        Ok(migrated) => {
            for name in &migrated {
                println!("[WORLDSEA-DATA] 旧根搬迁：~/{LEGACY_DIR_NAME}/{name} → {ROOT_DIR_NAME}/{name}（只拷不删）");
            }
            migrated
        }
        Err(error) => {
            eprintln!("[WORLDSEA-DATA] 旧根搬迁失败（新根仍可用）：{error}");
            Vec::new()
        }
    }
}

/// 搬迁内核（可测）：把 `legacy/<sub>` 复制到 `root/<sub>`（旧存在且新不存在才拷）。
pub fn migrate_under(root: &Path, legacy: &Path) -> Result<Vec<String>, String> {
    let mut migrated = Vec::new();
    for name in LEGACY_SUBDIRS {
        let from = legacy.join(name);
        let to = root.join(name);
        if !from.is_dir() || to.exists() {
            continue;
        }
        copy_dir(&from, &to).map_err(|e| format!("复制 {from:?} → {to:?} 失败：{e}"))?;
        migrated.push(name.to_string());
    }
    Ok(migrated)
}

/// 递归复制目录（不删源、不覆盖已存在文件）。
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let path = entry?.path();
        let Some(name) = path.file_name() else { continue };
        let target = to.join(name);
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else if !target.exists() {
            std::fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "data_root_tests.rs"]
mod tests;
