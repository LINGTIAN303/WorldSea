/**
 * WorldSmith Skills Store 纯逻辑库（Task 24 阶段4 + 方向3）
 *
 * 从 src-tauri/skills_store.rs 提取的纯 Rust 逻辑，无 Tauri 依赖，
 * 可通过 `cargo test` 独立运行单元测试（解决 Tauri lib DLL 链接限制）。
 *
 * 提供能力：
 * - sha256 校验（verify_sha256 / sha256_hex）
 * - zip 解压（extract_skill_zip，含 zip slip 防护）
 * - 技能版本读取（read_skill_version / extract_field）
 * - 路径规范化（dest_clean，防路径穿越）
 * - 本地导入写入（write_skill_files，支持覆盖更新）
 *
 * src-tauri 的 Tauri 命令调用本库函数，仅做 AppHandle → Path 转换。
 */

use serde::Serialize;
use sha2::{Sha256, Digest};
use std::fs;
use std::path::{Path, PathBuf};
/// Skills Store 错误（轻量字符串消息）
///
/// 原依赖 `worldsmith_core::error::CoreError`——端分离后该 crate 不存在，
/// 改为本地最小实现（保留 `storage` 构造器与类型名，最小化移植改动）；
/// 调用层（src-tauri）映射为自己的错误类型（String）。
#[derive(Debug)]
pub struct CoreError(String);

impl CoreError {
    /// 原 worldsmith-core 的 storage 错误构造（保留同名）
    pub fn storage(msg: impl Into<String>) -> Self {
        Self(msg.into())
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for CoreError {}

/// 调用层（src-tauri）命令错误为 String，`?` 自动转换（纯逻辑错误即消息）
impl From<CoreError> for String {
    fn from(e: CoreError) -> Self {
        e.0
    }
}

use zip::ZipArchive;

/** 安装/导入结果 */
#[derive(Debug, Clone, Serialize)]
pub struct InstallResult {
    pub skill_id: String,
    pub version: String,
    pub file_count: usize,
}

/** 已安装技能元信息 */
#[derive(Debug, Clone, Serialize)]
pub struct InstalledMeta {
    pub id: String,
    pub version: String,
    pub install_dir: String,
}

/** 计算 bytes 的 sha256（小写十六进制） */
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/** 校验 bytes 的 sha256 是否与 expected（小写十六进制，大小写不敏感）匹配 */
pub fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), CoreError> {
    let hash_hex = sha256_hex(bytes);
    if hash_hex != expected.to_lowercase() {
        return Err(CoreError::storage(format!(
            "SHA256 校验失败：期望 {expected}，实际 {hash_hex}"
        )));
    }
    Ok(())
}

/** 从文本中提取 `field: value` 字段值（去行内注释 → 去引号） */
pub fn extract_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("{}:", field);
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            let val = trimmed[prefix.len()..].trim();
            // 先去行内注释（# 后，但不在引号内——简易处理）
            let val = val.split('#').next().unwrap_or(val).trim();
            // 再去首尾引号
            let val = val.trim_matches('"').trim_matches('\'');
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/** 从技能目录读取版本号（skill.yaml 优先，降级 SKILL.md frontmatter，再降级默认 1.0.0） */
pub fn read_skill_version(dir: &Path) -> String {
    let yaml_path = dir.join("skill.yaml");
    if let Ok(content) = fs::read_to_string(&yaml_path) {
        if let Some(v) = extract_field(&content, "version") {
            return v;
        }
    }
    let md_path = dir.join("SKILL.md");
    if let Ok(content) = fs::read_to_string(&md_path) {
        if let Some(v) = extract_field(&content, "version") {
            return v;
        }
    }
    "1.0.0".to_string()
}

/**
 * 清理相对路径 rel，返回 base/清洗后的rel（防止 zip slip 路径穿越）
 *
 * 遍历 rel 的 components，只保留 Normal，跳过 ParentDir/RootDir 等可疑组件。
 * 注意：rel 必须是相对路径（如 zip 内的条目名），不是完整路径。
 */
pub fn dest_clean(rel: &Path, base: &Path) -> PathBuf {
    let mut safe = PathBuf::new();
    for comp in rel.components() {
        use std::path::Component;
        match comp {
            Component::Normal(s) => safe.push(s),
            Component::CurDir => {}
            _ => {} // 跳过 ParentDir 和 RootDir 等可疑组件
        }
    }
    base.join(safe)
}

/**
 * 解压 zip bytes 中指定子目录到 dest_dir
 *
 * @param bytes zip 文件内容
 * @param path_in_archive zip 内技能目录路径（空字符串表示 zip 根直接是技能文件）
 * @param dest_dir 目标目录（已存在则先删除再解压，用于更新场景）
 * @returns 写入的文件数（不含目录）
 *
 * 安全：dest_clean 移除 `..` 组件 + starts_with 二次校验，防 zip slip 路径穿越
 */
pub fn extract_skill_zip(bytes: &[u8], path_in_archive: &str, dest_dir: &Path) -> Result<usize, CoreError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor)
        .map_err(|e| CoreError::storage(format!("打开 zip 失败: {e}")))?;

    // 更新场景：目标目录已存在则先删除
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir)
            .map_err(|e| CoreError::storage(format!("删除旧版本失败: {e}")))?;
    }
    fs::create_dir_all(dest_dir)
        .map_err(|e| CoreError::storage(format!("创建技能目录失败: {e}")))?;

    let prefix = path_in_archive.trim_end_matches('/');
    let prefix_len = prefix.len();
    let mut file_count = 0usize;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| CoreError::storage(format!("读取 zip 条目失败: {e}")))?;
        let name = file.name().to_string();

        // 计算 zip 内相对路径
        let rel: &str = if prefix.is_empty() {
            name.as_str()
        } else if name.starts_with(prefix) && (name.len() == prefix_len || name.as_bytes()[prefix_len] == b'/') {
            name[prefix_len..].trim_start_matches('/')
        } else {
            continue; // 不在目标子目录内，跳过
        };
        if rel.is_empty() { continue; }

        // 安全检查：防止路径穿越（zip slip 攻击）
        // dest_clean 接收 rel（相对路径），清洗 .. 组件后 join 到 dest_dir
        let canonical_dest = dest_clean(Path::new(rel), dest_dir);
        if !canonical_dest.starts_with(dest_dir) {
            continue; // 跳过路径穿越条目
        }

        if file.is_dir() {
            fs::create_dir_all(&canonical_dest)
                .map_err(|e| CoreError::storage(format!("创建目录失败: {e}")))?;
        } else {
            if let Some(parent) = canonical_dest.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| CoreError::storage(format!("创建父目录失败: {e}")))?;
            }
            let mut out = fs::File::create(&canonical_dest)
                .map_err(|e| CoreError::storage(format!("创建文件失败: {e}")))?;
            std::io::copy(&mut file, &mut out)
                .map_err(|e| CoreError::storage(format!("写入文件失败: {e}")))?;
            file_count += 1;
        }
    }

    Ok(file_count)
}

/**
 * 本地导入：写入 skill.yaml + SKILL.md 到 dest_dir（Task 24 阶段4）
 *
 * 用于多平台互通：前端解析 Claude Code SKILL.md / Cursor .mdc / WorldSmith skill.yaml，
 * 生成标准 skill.yaml + SKILL.md 文本，调用本函数写入技能目录。
 *
 * @param dest_dir 目标技能目录（已存在则先删除再写入，支持覆盖更新）
 * @param skill_yaml skill.yaml manifest 文本
 * @param skill_md SKILL.md 提示词文本（None 或空字符串则不写 SKILL.md）
 * @returns 写入的文件数（1 或 2）
 */
pub fn write_skill_files(dest_dir: &Path, skill_yaml: &str, skill_md: Option<&str>) -> Result<usize, CoreError> {
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir)
            .map_err(|e| CoreError::storage(format!("删除旧版本失败: {e}")))?;
    }
    fs::create_dir_all(dest_dir)
        .map_err(|e| CoreError::storage(format!("创建技能目录失败: {e}")))?;

    let mut count = 0usize;
    fs::write(dest_dir.join("skill.yaml"), skill_yaml)
        .map_err(|e| CoreError::storage(format!("写入 skill.yaml 失败: {e}")))?;
    count += 1;

    if let Some(md) = skill_md {
        if !md.is_empty() {
            fs::write(dest_dir.join("SKILL.md"), md)
                .map_err(|e| CoreError::storage(format!("写入 SKILL.md 失败: {e}")))?;
            count += 1;
        }
    }
    Ok(count)
}

/** 校验 skill_id 合法性（非空、无路径分隔符、无 .. 穿越） */
pub fn validate_skill_id(skill_id: &str) -> Result<(), CoreError> {
    if skill_id.is_empty() || skill_id.contains('/') || skill_id.contains('\\') || skill_id.contains("..") {
        return Err(CoreError::storage(format!("非法 skill_id: {skill_id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    /** 构造测试 zip（目录名以 / 结尾用 add_directory，否则 start_file + 内容） */
    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let buf = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(buf);
        let opts = SimpleFileOptions::default();
        for (name, data) in entries {
            if name.ends_with('/') {
                zip.add_directory(*name, opts).unwrap();
            } else {
                zip.start_file(*name, opts).unwrap();
                zip.write_all(data).unwrap();
            }
        }
        let buf = zip.finish().unwrap();
        buf.into_inner()
    }

    #[test]
    fn test_extract_skill_zip_normal() {
        let bytes = make_zip(&[
            ("SKILL.md", b"---\nname: test\nversion: 1.0.0\n---\nbody"),
            ("references/", b""),
            ("references/ref.md", b"reference content"),
        ]);
        let dest = TempDir::new().unwrap();
        let count = extract_skill_zip(&bytes, "", dest.path()).unwrap();
        assert_eq!(count, 2);
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("references/ref.md").exists());
        let content = std::fs::read_to_string(dest.path().join("SKILL.md")).unwrap();
        assert!(content.contains("name: test"));
    }

    #[test]
    fn test_extract_skill_zip_path_in_archive() {
        let bytes = make_zip(&[
            ("repo-main/skills/my-skill/SKILL.md", b"---\nname: my\n---\nbody"),
            ("repo-main/skills/my-skill/references/x.md", b"ref"),
            ("repo-main/README.md", b"readme"),
            ("repo-main/skills/other/SKILL.md", b"other"),
        ]);
        let dest = TempDir::new().unwrap();
        let count = extract_skill_zip(&bytes, "repo-main/skills/my-skill", dest.path()).unwrap();
        assert_eq!(count, 2);
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("references/x.md").exists());
        assert!(!dest.path().join("README.md").exists());
        assert!(!dest.path().join("other").exists());
    }

    #[test]
    fn test_extract_skill_zip_update_scenario() {
        let bytes1 = make_zip(&[("SKILL.md", b"---\nversion: 1.0.0\n---\nv1")]);
        let dest = TempDir::new().unwrap();
        extract_skill_zip(&bytes1, "", dest.path()).unwrap();
        std::fs::write(dest.path().join("old-file.txt"), b"old").unwrap();

        let bytes2 = make_zip(&[("SKILL.md", b"---\nversion: 2.0.0\n---\nv2")]);
        extract_skill_zip(&bytes2, "", dest.path()).unwrap();
        let content = std::fs::read_to_string(dest.path().join("SKILL.md")).unwrap();
        assert!(content.contains("version: 2.0.0"));
        assert!(!dest.path().join("old-file.txt").exists());
    }

    #[test]
    fn test_extract_skill_zip_slip_protection() {
        let bytes = make_zip(&[
            ("SKILL.md", b"---\nname: test\n---\nbody"),
            ("../../../evil.txt", b"evil"),
            ("../sibling.txt", b"sibling"),
        ]);
        let dest = TempDir::new().unwrap();
        let dest_parent = dest.path().parent().unwrap().to_path_buf();
        let count = extract_skill_zip(&bytes, "", dest.path()).unwrap();
        assert_eq!(count, 3);
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("evil.txt").exists());
        assert!(dest.path().join("sibling.txt").exists());
        assert!(!dest_parent.join("evil.txt").exists());
        assert!(!dest_parent.join("sibling.txt").exists());
    }

    #[test]
    fn test_verify_sha256_success() {
        let expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
        assert!(verify_sha256(b"hello world", expected).is_ok());
    }

    #[test]
    fn test_verify_sha256_failure() {
        let wrong = "0000000000000000000000000000000000000000000000000000000000000000";
        assert!(verify_sha256(b"hello world", wrong).is_err());
    }

    #[test]
    fn test_verify_sha256_case_insensitive() {
        let expected_upper = "B94D27B9934D3E08A52E52D7DA7DABFAC484EFE37A5380EE9088F7ACE2EFCDE9";
        assert!(verify_sha256(b"hello world", expected_upper).is_ok());
    }

    #[test]
    fn test_read_skill_version_from_yaml() {
        let dest = TempDir::new().unwrap();
        std::fs::write(dest.path().join("skill.yaml"), "id: test\nname: 测试\nversion: 2.3.1\n").unwrap();
        assert_eq!(read_skill_version(dest.path()), "2.3.1");
    }

    #[test]
    fn test_read_skill_version_from_md() {
        let dest = TempDir::new().unwrap();
        std::fs::write(dest.path().join("SKILL.md"), "---\nname: test\nversion: 1.5.0\n---\nbody").unwrap();
        assert_eq!(read_skill_version(dest.path()), "1.5.0");
    }

    #[test]
    fn test_read_skill_version_default() {
        let dest = TempDir::new().unwrap();
        assert_eq!(read_skill_version(dest.path()), "1.0.0");
    }

    #[test]
    fn test_extract_field() {
        let content = "id: test\nname: 测试\nversion: \"1.2.3\"  # 注释\n";
        assert_eq!(extract_field(content, "version"), Some("1.2.3".to_string()));
        assert_eq!(extract_field(content, "id"), Some("test".to_string()));
        assert_eq!(extract_field(content, "nonexistent"), None);
    }

    #[test]
    fn test_dest_clean_strips_parent_dir() {
        let base = std::path::Path::new("/base");
        // rel 含 .. 路径穿越组件（模拟 zip slip 恶意条目）
        let rel = std::path::Path::new("../../../evil.txt");
        let cleaned = dest_clean(rel, base);
        // ParentDir 组件被跳过，只剩 Normal("evil.txt")，仍在 base 内
        assert!(cleaned.starts_with(base));
        assert_eq!(cleaned.file_name(), Some(std::ffi::OsStr::new("evil.txt")));
    }

    #[test]
    fn test_sha256_hex_known_value() {
        // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    // ── write_skill_files 测试（本地导入，Task 24 阶段4）──

    #[test]
    fn test_write_skill_files_yaml_and_md() {
        let dest = TempDir::new().unwrap();
        let dest_path = dest.path().join("my-skill");
        let yaml = "id: my-skill\nname: 我的技能\nversion: 1.0.0\n";
        let md = "# 我的技能\n\n提示词正文";
        let count = write_skill_files(&dest_path, yaml, Some(md)).unwrap();
        assert_eq!(count, 2);
        assert!(dest_path.join("skill.yaml").exists());
        assert!(dest_path.join("SKILL.md").exists());
        let yaml_content = std::fs::read_to_string(dest_path.join("skill.yaml")).unwrap();
        assert!(yaml_content.contains("我的技能"));
        let md_content = std::fs::read_to_string(dest_path.join("SKILL.md")).unwrap();
        assert!(md_content.contains("提示词正文"));
        // 版本可正确读取
        assert_eq!(read_skill_version(&dest_path), "1.0.0");
    }

    #[test]
    fn test_write_skill_files_only_yaml() {
        let dest = TempDir::new().unwrap();
        let dest_path = dest.path().join("yaml-only");
        let yaml = "id: yaml-only\nversion: 2.0.0\n";
        // skill_md 为 None
        let count = write_skill_files(&dest_path, yaml, None).unwrap();
        assert_eq!(count, 1);
        assert!(dest_path.join("skill.yaml").exists());
        assert!(!dest_path.join("SKILL.md").exists());
    }

    #[test]
    fn test_write_skill_files_empty_md_skipped() {
        let dest = TempDir::new().unwrap();
        let dest_path = dest.path().join("empty-md");
        let yaml = "id: empty-md\nversion: 1.0.0\n";
        // 空字符串 SKILL.md 应被跳过
        let count = write_skill_files(&dest_path, yaml, Some("")).unwrap();
        assert_eq!(count, 1);
        assert!(!dest_path.join("SKILL.md").exists());
    }

    #[test]
    fn test_write_skill_files_overwrite_existing() {
        let dest = TempDir::new().unwrap();
        let dest_path = dest.path().join("overwrite");
        // 第一次写入 v1
        write_skill_files(&dest_path, "id: overwrite\nversion: 1.0.0\n", Some("# v1")).unwrap();
        // 模拟旧版本额外文件
        std::fs::write(dest_path.join("old-file.txt"), b"old").unwrap();
        // 第二次写入 v2（覆盖）
        write_skill_files(&dest_path, "id: overwrite\nversion: 2.0.0\n", Some("# v2")).unwrap();
        let version = read_skill_version(&dest_path);
        assert_eq!(version, "2.0.0");
        // 旧文件应被删除（目录被重建）
        assert!(!dest_path.join("old-file.txt").exists());
        let md = std::fs::read_to_string(dest_path.join("SKILL.md")).unwrap();
        assert!(md.contains("# v2"));
    }

    #[test]
    fn test_validate_skill_id_legal() {
        assert!(validate_skill_id("my-skill").is_ok());
        assert!(validate_skill_id("my_skill_123").is_ok());
    }

    #[test]
    fn test_validate_skill_id_illegal() {
        assert!(validate_skill_id("").is_err());
        assert!(validate_skill_id("a/b").is_err());
        assert!(validate_skill_id("a\\b").is_err());
        assert!(validate_skill_id("..").is_err());
        assert!(validate_skill_id("a/../b").is_err());
    }
}
