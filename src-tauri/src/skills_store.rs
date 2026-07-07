/**
 * Skills Store 命令（Task 24 阶段2）
 *
 * 实现技能包的下载、校验、解压、卸载、版本查询。
 *
 * 技能源仓库规范（skills-manifest.json）：
 *   {
 *     "name": "技能集名称",
 *     "skills": [
 *       {
 *         "id": "my-skill",
 *         "name": "我的技能",
 *         "version": "1.0.0",
 *         "downloadUrl": "https://.../skill.zip",
 *         "pathInArchive": "my-skill",   // zip 内技能目录路径，空字符串表示 zip 根直接是技能文件
 *         "sha256": "abc123..."           // zip 的 sha256 校验值
 *       }
 *     ]
 *   }
 *
 * 安装流程：下载 zip → sha256 校验 → 解压 pathInArchive 子目录到 app_data_dir/skills/<id>/
 * 安全：sha256 不匹配拒绝安装；更新时先删旧目录再解压
 */

use serde::Serialize;
use sha2::{Sha256, Digest};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use worldsmith_core::error::CoreError;
use zip::ZipArchive;

/** 安装结果 */
#[derive(Serialize)]
pub struct InstallResult {
    pub skill_id: String,
    pub version: String,
    pub file_count: usize,
}

/** 已安装技能元信息 */
#[derive(Serialize)]
pub struct InstalledMeta {
    pub id: String,
    pub version: String,
    pub install_dir: String,
}

/** 获取 skills 根目录（app_data_dir/skills），确保目录存在 */
fn skills_dir(app: &AppHandle) -> Result<PathBuf, CoreError> {
    let data_dir = app.path().app_data_dir()
        .map_err(|e| CoreError::storage(format!("获取 app data 目录失败: {e}")))?;
    let dir = data_dir.join("skills");
    fs::create_dir_all(&dir)
        .map_err(|e| CoreError::storage(format!("创建 skills 目录失败: {e}")))?;
    Ok(dir)
}

/**
 * 下载 skills-manifest.json 文本
 *
 * 前端负责解析 JSON 并展示技能列表。
 * url 指向仓库的 skills-manifest.json raw URL（如 GitHub raw URL）。
 */
#[tauri::command]
pub fn cmd_skills_download_manifest(url: String) -> Result<String, CoreError> {
    let resp = reqwest::blocking::get(&url)
        .map_err(|e| CoreError::storage(format!("下载 manifest 失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(CoreError::storage(format!(
            "下载 manifest 失败：HTTP {}", resp.status()
        )));
    }
    let text = resp.text()
        .map_err(|e| CoreError::storage(format!("读取 manifest 内容失败: {e}")))?;
    Ok(text)
}

/**
 * 安装技能：下载 zip → sha256 校验 → 解压指定子目录
 *
 * @param download_url  zip 下载 URL
 * @param path_in_archive  zip 内技能目录路径（空字符串表示 zip 根直接是技能文件）
 * @param sha256_expected  zip 的预期 sha256（小写十六进制）
 * @param skill_id  技能 id（作为安装目录名）
 */
#[tauri::command]
pub fn cmd_skills_install(
    app: AppHandle,
    download_url: String,
    path_in_archive: String,
    sha256_expected: String,
    skill_id: String,
) -> Result<InstallResult, CoreError> {
    if skill_id.is_empty() || skill_id.contains('/') || skill_id.contains('\\') || skill_id.contains("..") {
        return Err(CoreError::storage(format!("非法 skill_id: {skill_id}")));
    }

    let dest_dir = skills_dir(&app)?.join(&skill_id);

    // 1. 下载 zip
    let resp = reqwest::blocking::get(&download_url)
        .map_err(|e| CoreError::storage(format!("下载技能包失败: {e}")))?;
    if !resp.status().is_success() {
        return Err(CoreError::storage(format!(
            "下载技能包失败：HTTP {}", resp.status()
        )));
    }
    let bytes = resp.bytes()
        .map_err(|e| CoreError::storage(format!("读取技能包内容失败: {e}")))?
        .to_vec();

    // 2. sha256 校验
    verify_sha256(&bytes, &sha256_expected)?;

    // 3. 解压（提取为纯函数 extract_skill_zip，便于单元测试覆盖 zip slip 防护等逻辑）
    let file_count = extract_skill_zip(&bytes, &path_in_archive, &dest_dir)?;

    // 4. 读取安装的技能版本
    let version = read_skill_version(&dest_dir);

    Ok(InstallResult {
        skill_id,
        version,
        file_count,
    })
}

/**
 * 卸载技能：删除 app_data_dir/skills/<skill_id>/ 目录
 *
 * @returns true 表示已删除；false 表示目录不存在（本就未安装）
 */
#[tauri::command]
pub fn cmd_skills_uninstall(app: AppHandle, skill_id: String) -> Result<bool, CoreError> {
    if skill_id.is_empty() || skill_id.contains('/') || skill_id.contains('\\') || skill_id.contains("..") {
        return Err(CoreError::storage(format!("非法 skill_id: {skill_id}")));
    }
    let dir = skills_dir(&app)?.join(&skill_id);
    if !dir.exists() {
        return Ok(false);
    }
    fs::remove_dir_all(&dir)
        .map_err(|e| CoreError::storage(format!("卸载技能失败: {e}")))?;
    Ok(true)
}

/**
 * 获取已安装技能版本列表
 *
 * 扫描 app_data_dir/skills/ 下所有子目录，读取各自版本号。
 * 用于前端检测更新（对比 remote manifest 的 version）。
 */
#[tauri::command]
pub fn cmd_skills_get_installed_versions(app: AppHandle) -> Result<Vec<InstalledMeta>, CoreError> {
    let dir = skills_dir(&app)?;
    let mut result = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| CoreError::storage(format!("读取 skills 目录失败: {e}")))?;

    for entry in entries.filter_map(|e| e.ok()) {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir { continue; }
        let install_dir = entry.file_name().to_string_lossy().to_string();
        let skill_path = entry.path();
        let version = read_skill_version(&skill_path);
        result.push(InstalledMeta {
            id: install_dir.clone(),
            version,
            install_dir,
        });
    }

    Ok(result)
}

/** 从技能目录读取版本号（skill.yaml 优先，降级 SKILL.md frontmatter，再降级默认 1.0.0） */
fn read_skill_version(dir: &Path) -> String {
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

/** 从文本中提取 `field: value` 字段值（去引号、去行内注释） */
fn extract_field(content: &str, field: &str) -> Option<String> {
    let prefix = format!("{}:", field);
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&prefix) {
            let val = trimmed[prefix.len()..].trim();
            // 去引号
            let val = val.trim_matches('"').trim_matches('\'');
            // 去行内注释（# 后，但不在引号内——简易处理）
            let val = val.split('#').next().unwrap_or(val).trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

/** 清理目标路径，返回规范化的路径（防止 zip slip 路径穿越） */
fn dest_clean(dest: &Path, base: &Path) -> PathBuf {
    // 简化处理：移除 dest 中的 `..` 组件
    let mut result = base.to_path_buf();
    for comp in dest.components() {
        use std::path::Component;
        match comp {
            Component::Normal(s) => result.push(s),
            Component::CurDir => {}
            _ => {} // 跳过 ParentDir 和 RootDir 等可疑组件
        }
    }
    result
}

/** 计算 bytes 的 sha256（小写十六进制） */
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/** 校验 bytes 的 sha256 是否与 expected（小写十六进制，大小写不敏感）匹配 */
fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), CoreError> {
    let hash_hex = sha256_hex(bytes);
    if hash_hex != expected.to_lowercase() {
        return Err(CoreError::storage(format!(
            "SHA256 校验失败：期望 {expected}，实际 {hash_hex}"
        )));
    }
    Ok(())
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
fn extract_skill_zip(bytes: &[u8], path_in_archive: &str, dest_dir: &Path) -> Result<usize, CoreError> {
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

        let dest = dest_dir.join(rel);
        // 安全检查：防止路径穿越（zip slip 攻击）
        let canonical_dest = dest_clean(&dest, dest_dir);
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
        assert_eq!(count, 2); // SKILL.md + ref.md（目录不计入）
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("references/ref.md").exists());
        let content = std::fs::read_to_string(dest.path().join("SKILL.md")).unwrap();
        assert!(content.contains("name: test"));
    }

    #[test]
    fn test_extract_skill_zip_path_in_archive() {
        // zip 内有 repo-main/skills/my-skill/ 前缀，只解压该子目录
        let bytes = make_zip(&[
            ("repo-main/skills/my-skill/SKILL.md", b"---\nname: my\n---\nbody"),
            ("repo-main/skills/my-skill/references/x.md", b"ref"),
            ("repo-main/README.md", b"readme"),            // 不在目标子目录，应跳过
            ("repo-main/skills/other/SKILL.md", b"other"), // 不在目标子目录，应跳过
        ]);
        let dest = TempDir::new().unwrap();
        let count = extract_skill_zip(&bytes, "repo-main/skills/my-skill", dest.path()).unwrap();
        assert_eq!(count, 2);
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("references/x.md").exists());
        // 不应包含跳过的文件
        assert!(!dest.path().join("README.md").exists());
        assert!(!dest.path().join("other").exists());
    }

    #[test]
    fn test_extract_skill_zip_update_scenario() {
        // 第一次安装 v1
        let bytes1 = make_zip(&[("SKILL.md", b"---\nversion: 1.0.0\n---\nv1")]);
        let dest = TempDir::new().unwrap();
        extract_skill_zip(&bytes1, "", dest.path()).unwrap();
        // 模拟旧版本额外文件（更新时应被删除）
        std::fs::write(dest.path().join("old-file.txt"), b"old").unwrap();

        // 更新：解压 v2（先删旧目录）
        let bytes2 = make_zip(&[("SKILL.md", b"---\nversion: 2.0.0\n---\nv2")]);
        extract_skill_zip(&bytes2, "", dest.path()).unwrap();
        let content = std::fs::read_to_string(dest.path().join("SKILL.md")).unwrap();
        assert!(content.contains("version: 2.0.0"));
        // 旧文件应被删除
        assert!(!dest.path().join("old-file.txt").exists());
    }

    #[test]
    fn test_extract_skill_zip_slip_protection() {
        // 恶意 zip：含 .. 路径穿越条目
        let bytes = make_zip(&[
            ("SKILL.md", b"---\nname: test\n---\nbody"),
            ("../../../evil.txt", b"evil"),
            ("../sibling.txt", b"sibling"),
        ]);
        let dest = TempDir::new().unwrap();
        let dest_parent = dest.path().parent().unwrap().to_path_buf();
        let count = extract_skill_zip(&bytes, "", dest.path()).unwrap();
        // 全部被 dest_clean 清理到 dest_dir 内（不逃逸）
        assert_eq!(count, 3);
        assert!(dest.path().join("SKILL.md").exists());
        assert!(dest.path().join("evil.txt").exists());
        assert!(dest.path().join("sibling.txt").exists());
        // 关键：恶意文件未逃逸到 dest_dir 的父目录
        assert!(!dest_parent.join("evil.txt").exists());
        assert!(!dest_parent.join("sibling.txt").exists());
    }

    #[test]
    fn test_verify_sha256_success() {
        // sha256("hello world") = b94d27b9...cde9
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
        // 无 manifest 文件，返回默认 1.0.0
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
        // 模拟 dest_dir.join("../../../evil.txt") 的路径
        let dest = std::path::Path::new("/base/../../../evil.txt");
        let cleaned = dest_clean(dest, base);
        // ParentDir 组件被跳过，只剩 Normal("evil.txt")，仍在 base 内
        assert_eq!(cleaned, std::path::PathBuf::from("/base/evil.txt"));
        assert!(cleaned.starts_with(base));
    }
}
