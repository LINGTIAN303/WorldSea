//! 文件系统命令层：供 entity-core 的 FileStorageBackend 使用（JSON 文件落盘存储实体/关系/文件），
//! 对应前端 cmd_fs_write / cmd_fs_read / cmd_fs_list / cmd_fs_delete；纯文件操作，路径由前端构造（应用数据目录下）。
//! 定位（兜底防线）：**应用层直通**——消费方路径来自可信前端，故不做 workdir 边界；Agent 工具侧的边界
//! （workdir 词法边界 + 受保护目录写守卫）在 packages/agent-runtime/src/tools/workspace-boundary.ts 执行，
//! 本层仅保留敏感目录写防护作全链路最后兜底；目录口径裁定（用户 2026-09-25）见 docs/details/注释/tauri/fs-commands.md。

use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// 判断路径是否命中敏感目录（~/.ssh、~/.gnupg、/etc、/usr、/bin、/sbin）。
/// 组件级前缀匹配，避免 `/etcetera` 误命中 `/etc`。
fn sensitive_dir_reason(p: &Path) -> Option<String> {
    // 用户主目录下的密钥/配置目录
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    if let Some(home) = home {
        for (name, label) in [(".ssh", "~/.ssh"), (".gnupg", "~/.gnupg")] {
            let sensitive = home.join(name);
            if p == sensitive || p.starts_with(&sensitive) {
                return Some(format!("敏感目录 {label}"));
            }
        }
    }
    // 系统目录（绝对路径前缀，Unix 风格）
    for sys in ["/etc", "/usr", "/bin", "/sbin"] {
        let sp = Path::new(sys);
        if p == sp || p.starts_with(sp) {
            return Some(format!("系统目录 {sys}"));
        }
    }
    None
}

/// 写类命令入口防护：命中敏感目录直接拒绝（覆盖 write/mkdir/copy/rename/delete 的源与目标）。
pub(crate) fn ensure_write_allowed(p: &Path) -> Result<(), String> {
    if let Some(reason) = sensitive_dir_reason(p) {
        return Err(format!("拒绝写入{reason}"));
    }
    Ok(())
}

/// 目录条目（对应前端 listDir / search 返回结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// 最后修改时间（unix 毫秒字符串；元数据不可用时为 None）
    pub modified: Option<String>,
}

/// 文件/目录元数据（对应前端 cmd_fs_stat 期望结构）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStat {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<String>,
}

/// 原子写：先写同目录临时文件再 rename 覆盖（2026-10-26 GIF 丢失排查加固）。
/// 进程被强杀（更新/重编 taskkill /F）若恰逢 fs::write 会留下截断 JSON——
/// 前端 loadIndex 解析失败即静默丢实体（GIF「重构建时丢失」的高嫌疑机制）。
/// 同目录 .tmp + rename（std 在 Windows 带 REPLACE_EXISTING）：崩溃只留 .tmp 残留（无害），
/// 目标文件要么旧要么新。tmp 命名用「原路径 + .tmp 后缀」（不用 with_extension——
/// 会把 assets 的 .png 等误改为 .json.tmp）。
fn atomic_write(path: &Path, bytes: Vec<u8>) -> Result<(), String> {
    let tmp: PathBuf = {
        let mut s = path.as_os_str().to_os_string();
        s.push(".tmp");
        PathBuf::from(s)
    };
    fs::write(&tmp, &bytes).map_err(|e| format!("临时文件写入失败: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// 写入文本文件（可递归创建父目录；原子写防强杀截断）
#[tauri::command]
pub async fn cmd_fs_write(
    path: String,
    content: String,
    create_dirs: Option<bool>,
    encoding: Option<String>,
) -> Result<(), String> {
    ensure_write_allowed(Path::new(&path))?;
    if create_dirs.unwrap_or(false) {
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
    }
    // encoding = "base64"：content 为裸 base64 字符串，解码后写二进制 —— 与 cmd_fs_read 的
    // encoding=base64 对称（前端把图片资产转 base64 后落盘 {entityDataDir}/assets/）。缺省行为不变（UTF-8 文本）。
    if encoding.as_deref() == Some("base64") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(content.as_bytes())
            .map_err(|e| format!("base64 解码失败: {e}"))?;
        atomic_write(Path::new(&path), bytes)
    } else {
        atomic_write(Path::new(&path), content.into_bytes())
    }
}

/// 读取文件内容
///
/// `encoding`：
/// - `None` / `"utf-8"`：读为文本（`read_to_string`，非法 UTF-8 报错 → 前端判定二进制）
/// - `"base64"`：读为裸 base64 字符串（前端按扩展名拼 `data:{mime};base64,...` 展示图片/二进制）
#[tauri::command]
pub async fn cmd_fs_read(
    path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    if encoding.as_deref() == Some("base64") {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
    } else {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    }
}

/// 在系统文件资源管理器中打开指定路径（目录或文件）——「打开项目文件夹」/「用默认程序打开」。
/// Windows 用 `explorer`（无需等待退出）；macOS 用 `open`；Linux 用 `xdg-open`；
/// 传文件路径时由系统按默认关联程序打开（pptx 等无内置渲染器的格式走此降级出口）。
/// 接受**正斜杠**路径：Windows 的 explorer 对 `/` 解析异常，故统一归一化为反斜杠
/// （此前由调用方各自 replace 兜底，集中到本命令后调用方可直接传前端统一格式）。
#[tauri::command]
pub async fn cmd_open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let native = path.replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(&native)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开系统文件夹失败: {e}"))?;
        Ok(())
    }
}

/// 列出目录内容（支持递归）。
///
/// `limit`：最多返回多少条（None = 不限）。用于自绘文件选择器——巨目录（System32 /
/// node_modules 等）一次性返回全量会拖慢 IPC 与前端解析，截断后由前端提示「已截断」。
/// 截断在**收集阶段**生效，避免先读全量再切片的浪费；目录条目顺序不保证，但同一目录
/// 多次调用结果稳定（readdir 顺序由文件系统决定）。
#[tauri::command]
pub async fn cmd_fs_list(
    path: String,
    recursive: Option<bool>,
    limit: Option<usize>,
) -> Result<Vec<FsEntry>, String> {
    list_dir_inner(&path, recursive.unwrap_or(false), limit).map_err(|e| e.to_string())
}

/// 删除文件或目录（目录递归删除）
#[tauri::command]
pub async fn cmd_fs_delete(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    ensure_write_allowed(p)?;
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

/// 递归收集目录条目（`limit` 在收集阶段生效，读够即停）
fn list_dir_inner(dir: &str, recursive: bool, limit: Option<usize>) -> std::io::Result<Vec<FsEntry>> {
    let mut entries = Vec::new();
    collect_entries(dir, dir, recursive, limit, &mut entries)?;
    Ok(entries)
}

/// 深度优先收集目录条目（根目录自身不返回，仅其内容）
fn collect_entries(
    root: &str,
    current: &str,
    recursive: bool,
    limit: Option<usize>,
    out: &mut Vec<FsEntry>,
) -> std::io::Result<()> {
    let current_path = Path::new(current);
    for entry in fs::read_dir(current_path)? {
        // 读够上限即返回：调用方只关心「有没有被截断」，不需要全量
        if limit.is_some_and(|max| out.len() >= max) {
            return Ok(());
        }
        let entry = entry?;
        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let entry_path = entry.path();
        let entry_display = entry_path.to_string_lossy().replace('\\', "/");
        let metadata = entry.metadata().ok();
        let size = if is_dir {
            0
        } else {
            metadata.as_ref().map(|m| m.len()).unwrap_or(0)
        };
        out.push(FsEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry_display,
            is_dir,
            size,
            modified: metadata.as_ref().and_then(meta_to_mtime),
        });
        if recursive && is_dir {
            collect_entries(root, &entry_path.to_string_lossy(), recursive, limit, out)?;
        }
    }
    Ok(())
}

/// 获取元数据的最后修改时间（unix 毫秒字符串；不可用时为 None）
pub(crate) fn meta_to_mtime(meta: &fs::Metadata) -> Option<String> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis().to_string())
}

/// 获取文件/目录元数据（元数据命令，供前端工作区面板 stat 使用）
#[tauri::command]
pub async fn cmd_fs_stat(path: String) -> Result<FsStat, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let is_dir = meta.is_dir();
    let size = if is_dir { 0 } else { meta.len() };
    Ok(FsStat {
        path,
        is_dir,
        size,
        mtime: meta_to_mtime(&meta),
    })
}

/// 创建目录（可递归创建多级目录；已存在时幂等成功）
#[tauri::command]
pub async fn cmd_fs_mkdir(path: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&path))?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// 复制文件（目标父目录需已存在；暂不支持复制目录）
#[tauri::command]
pub async fn cmd_fs_copy(src: String, dest: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&dest))?;
    let sp = Path::new(&src);
    if sp.is_dir() {
        return Err("暂不支持复制目录".to_string());
    }
    fs::copy(sp, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// 复制文件（分块 + 进度事件；形象/视频资产导入用，2026-10-25 形象图批 C）。
/// 每 8MB 块 emit `asset-copy-progress` { dest, copied, total }——大视频静默复制无反馈
/// 的解法。与 cmd_fs_copy 同防护；进度事件按 dest 区分并发任务。
#[tauri::command]
pub async fn cmd_fs_copy_progress(
    app: tauri::AppHandle,
    src: String,
    dest: String,
) -> Result<(), String> {
    use std::io::{Read, Write};
    ensure_write_allowed(Path::new(&dest))?;
    let sp = Path::new(&src);
    if sp.is_dir() {
        return Err("暂不支持复制目录".to_string());
    }
    let total = sp.metadata().map_err(|e| e.to_string())?.len();
    let mut reader = std::fs::File::open(sp).map_err(|e| e.to_string())?;
    // 分块写临时文件后原子 rename（与 cmd_fs_write 同防护：强杀不产生截断资产）
    let tmp: PathBuf = {
        let mut s = std::ffi::OsString::from(&dest);
        s.push(".tmp");
        PathBuf::from(s)
    };
    let mut writer = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 8 * 1024 * 1024];
    let mut copied: u64 = 0;
    let _ = app.emit(
        "asset-copy-progress",
        serde_json::json!({ "dest": dest, "copied": 0u64, "total": total }),
    );
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        copied += n as u64;
        let _ = app.emit(
            "asset-copy-progress",
            serde_json::json!({ "dest": dest, "copied": copied, "total": total }),
        );
    }
    writer.flush().map_err(|e| e.to_string())?;
    drop(writer);
    fs::rename(&tmp, &dest).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// 重命名/移动文件或目录（同盘移动为原子操作）
#[tauri::command]
pub async fn cmd_fs_rename(src: String, dest: String) -> Result<(), String> {
    ensure_write_allowed(Path::new(&src))?;
    ensure_write_allowed(Path::new(&dest))?;
    fs::rename(&src, &dest).map_err(|e| e.to_string())
}

#[cfg(test)]
#[path = "fs_commands_tests.rs"]
mod tests;
