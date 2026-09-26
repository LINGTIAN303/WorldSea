/**
 * Skills Store Tauri 命令层（Task 24 阶段2/4）
 *
 * 纯逻辑（校验/解压/导入/版本读取）已迁移到 worldsea-skills-store crate，
 * 可独立单元测试（解决 Tauri lib DLL 链接导致 cargo test 无法运行的问题）。
 * 本文件仅负责 Tauri 命令封装：AppHandle → 路径转换 + 调用纯逻辑函数。
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
 *         "pathInArchive": "my-skill",
 *         "sha256": "abc123..."
 *       }
 *     ]
 *   }
 *
 * 安装流程：下载 zip → sha256 校验 → 解压 pathInArchive 子目录到 app_data_dir/skills/<id>/
 * 本地导入：前端解析 Claude Code/Cursor/WorldSea 格式 → 生成 skill.yaml + SKILL.md → 写入 <id>/
 */

use tauri::{AppHandle, Manager};
// 纯逻辑函数与数据结构来自独立 crate（可独立 cargo test）
use worldsea_skills_store::{
    extract_skill_zip, read_skill_version, validate_skill_id, verify_sha256, write_skill_files,
    InstallResult, InstalledMeta,
};

/**
 * 获取 skills 根目录（E1 起：`<可见根>/skills` = `%USERPROFILE%\WorldSea\skills`），确保目录存在。
 *
 * 2026-09-03 迁移：个人技能导入区从 app_data/skills 迁至用户主目录（当时 `~/.WorldSea/skills`；E1 起为 `WorldSea/skills`）
 * （跟随用户跨项目）。首次进入时若旧 app_data/skills 有存量则一次性复制（幂等），
 * 旧目录保留留痕不删除。install/import_local/list/uninstall/注册表扫描的唯一目录来源。
 */
fn skills_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    // E1（2026-09-25）：个人技能导入区随「单一可见根」= `%USERPROFILE%\WorldSea\skills`
    // （旧 `~/.WorldSea/skills` 由 data_root::migrate_legacy_home_root 在启动期一次性搬入）
    let dir = crate::data_root::sub("skills")?;
    ensure_home_skills_migrated(app, &dir)?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("创建 skills 目录失败: {e}"))?;
    Ok(dir)
}

/** 幂等迁移：旧 app_data/skills 有存量且目标不存在时，递归复制到 ~/.WorldSea/skills */
fn ensure_home_skills_migrated(app: &AppHandle, home_skills: &std::path::Path) -> Result<(), String> {
    let legacy = app
        .path()
        .app_data_dir()
        .map(|d| d.join("skills"))
        .unwrap_or_default();
    if !legacy.is_dir() || home_skills.exists() {
        return Ok(()); // 无存量 / 已迁移：no-op
    }
    std::fs::create_dir_all(home_skills)
        .map_err(|e| format!("创建技能目录失败: {e}"))?;
    for entry in std::fs::read_dir(&legacy).map_err(|e| format!("读取旧技能目录失败: {e}"))? {
        let e = entry.map_err(|e| format!("读取旧技能条目失败: {e}"))?.path();
        let Some(name) = e.file_name() else { continue };
        let tgt = home_skills.join(name);
        if tgt.exists() {
            continue;
        }
        if e.is_dir() {
            copy_dir_all(&e, &tgt).map_err(|e| format!("迁移技能目录失败: {e}"))?;
        } else if let Err(e) = std::fs::copy(&e, &tgt) {
            tracing::warn!("[skills] 迁移技能文件失败（跳过）: {e}");
        }
    }
    // T20 清理（2026-09-03 用户拍板）：迁移确认完成 → 移除旧路径痕迹（幂等）
    let _ = std::fs::remove_dir_all(&legacy);
    Ok(())
}

/** 递归复制目录（std 无内置，仅复制普通文件与目录结构） */
fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let e = entry?;
        let tgt = dst.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_dir_all(&e.path(), &tgt)?;
        } else {
            std::fs::copy(e.path(), tgt)?;
        }
    }
    Ok(())
}

/**
 * 下载 skills-manifest.json 文本
 *
 * 前端负责解析 JSON 并展示技能列表。
 * url 指向仓库的 skills-manifest.json raw URL（如 GitHub raw URL）。
 */
#[tauri::command]
pub fn cmd_skills_download_manifest(url: String) -> Result<String, String> {
    let resp = reqwest::blocking::get(&url)
        .map_err(|e| format!("下载 manifest 失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "下载 manifest 失败：HTTP {}", resp.status()
        ));
    }
    let text = resp.text()
        .map_err(|e| format!("读取 manifest 内容失败: {e}"))?;
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
) -> Result<InstallResult, String> {
    validate_skill_id(&skill_id)?;
    let dest_dir = skills_dir(&app)?.join(&skill_id);

    // 1. 下载 zip
    let resp = reqwest::blocking::get(&download_url)
        .map_err(|e| format!("下载技能包失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "下载技能包失败：HTTP {}", resp.status()
        ));
    }
    let bytes = resp.bytes()
        .map_err(|e| format!("读取技能包内容失败: {e}"))?
        .to_vec();

    // 2. sha256 校验（纯逻辑，来自 worldsea-skills-store）
    verify_sha256(&bytes, &sha256_expected)?;

    // 3. 解压（纯逻辑，含 zip slip 防护）
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
pub fn cmd_skills_uninstall(app: AppHandle, skill_id: String) -> Result<bool, String> {
    validate_skill_id(&skill_id)?;
    let dir = skills_dir(&app)?.join(&skill_id);
    if !dir.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&dir)
        .map_err(|e| format!("卸载技能失败: {e}"))?;
    Ok(true)
}

/**
 * 获取已安装技能版本列表
 *
 * 扫描 app_data_dir/skills/ 下所有子目录，读取各自版本号。
 * 用于前端检测更新（对比 remote manifest 的 version）。
 */
#[tauri::command]
pub fn cmd_skills_get_installed_versions(app: AppHandle) -> Result<Vec<InstalledMeta>, String> {
    let dir = skills_dir(&app)?;
    let mut result = Vec::new();

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("读取 skills 目录失败: {e}"))?;

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

/**
 * 本地导入技能（Task 24 阶段4：多平台互通）
 *
 * 前端解析 Claude Code SKILL.md / Cursor .mdc / WorldSea skill.yaml 后，
 * 生成标准 skill.yaml（manifest）+ SKILL.md（提示词）文本，调用本命令写入技能目录。
 *
 * 已存在同名技能则覆盖（先删后写，支持更新场景）。
 *
 * @param skill_id  技能 id（作为目录名，校验合法性）
 * @param skill_yaml  skill.yaml manifest 文本（None 或空则不写；新流程应为 None）
 * @param skill_md  SKILL.md 提示词文本（None 或空则不写 SKILL.md）
 * @param sidecar  worldsea.skill.json 文本（None 或空则不写；D2 私有字段承载）
 */
#[tauri::command]
pub fn cmd_skills_import_local(
    app: AppHandle,
    skill_id: String,
    skill_yaml: Option<String>,
    skill_md: Option<String>,
    sidecar: Option<String>,
) -> Result<InstallResult, String> {
    validate_skill_id(&skill_id)?;
    let dest_dir = skills_dir(&app)?.join(&skill_id);

    // 写入技能文件（纯逻辑，三类文件各写、含覆盖更新；三者皆空报错）
    let file_count = write_skill_files(
        &dest_dir,
        skill_yaml.as_deref(),
        skill_md.as_deref(),
        sidecar.as_deref(),
    )?;

    let version = read_skill_version(&dest_dir);
    Ok(InstallResult {
        skill_id,
        version,
        file_count,
    })
}

/**
 * 获取已安装 Skills 的根目录路径（app_data_dir/skills），并确保目录存在
 *
 * 供前端 manifest.ts 扫描已安装技能（路径 + cmd_fs_list/cmd_fs_read 读取
 * skill.yaml/SKILL.md/instructions.md），及 loader.ts 懒加载 references/assets 使用。
 */
#[tauri::command]
pub fn cmd_skills_get_dir(app: AppHandle) -> Result<String, String> {
    let dir = skills_dir(&app)?;
    Ok(dir.to_string_lossy().to_string())
}
