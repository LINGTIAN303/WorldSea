//! 本机 Office 格式转换（ppt/pptx → PDF），供「文档格式预览」使用。
//!
//! ## 为什么走本机转换
//! PPTX 的**纯前端渲染还原度差、排版易崩**，业界正解是本机 LibreOffice headless 转 PDF，
//! 再由前端用 pdfjs 渲染（项目已装 pdfjs-dist）。桌面端天然可行 —— 但前提是用户机器装了
//! LibreOffice，故**必须先探测、未装则明确降级**（禁止静默失败）。
//!
//! ## 两个命令
//! - [`cmd_office_available`]：本机是否可用（结果进程内缓存，避免每次开文件都扫盘）
//! - [`cmd_pptx_to_pdf`]：转换并返回 **PDF 缓存路径**（前端随后按普通 PDF 读取渲染）
//!
//! ## 缓存策略
//! 缓存目录 `{app_data}/worldsea/office_cache/{key}/`，`key` = 源路径 + mtime + size 的
//! 哈希 —— 同一文件重复打开直接命中（LibreOffice 首次启动通常数秒，缓存能明显改善手感）；
//! 源文件改动（mtime/size 变）自动换 key，不会读到过期产物。每次转换顺带清理超过
//! [`CACHE_MAX_AGE_DAYS`] 天的旧目录。
//!
//! 注：`key` 用标准库 `DefaultHasher`，跨 Rust 版本不保证稳定 —— 升级后最多是缓存全失效
//! （重转一次），不影响正确性。

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime};

use tauri::Manager;

/// 转换超时：正常几秒完成；首次启动 LibreOffice / 大文件会慢，给足余量后即杀进程报错
const CONVERT_TIMEOUT: Duration = Duration::from_secs(60);
/// 子进程轮询间隔
const POLL_INTERVAL: Duration = Duration::from_millis(120);
/// 缓存保留期（天）：在下一次转换时顺带清理超期目录
const CACHE_MAX_AGE_DAYS: u64 = 7;

/// PATH 中探测的可执行名（Windows 带扩展名）
const SOFFICE_NAMES: &[&str] = &["soffice", "soffice.exe", "libreoffice"];

/// 常见安装位置兜底（PATH 未配置时的典型落点）
#[cfg(target_os = "windows")]
const SOFFICE_FALLBACKS: &[&str] = &[
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
];
#[cfg(target_os = "macos")]
const SOFFICE_FALLBACKS: &[&str] = &[
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/local/bin/soffice",
    "/opt/homebrew/bin/soffice",
];
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const SOFFICE_FALLBACKS: &[&str] = &["/usr/bin/soffice", "/usr/local/bin/soffice"];

/// 进程内缓存探测结果：`None` 表示未找到
static SOFFICE: OnceLock<Option<String>> = OnceLock::new();

/// 在 PATH 与常见安装位置中定位 LibreOffice 可执行文件
fn find_soffice() -> Option<String> {
    // 1) 常见安装位置（命中快、结果稳定）
    for p in SOFFICE_FALLBACKS {
        if Path::new(p).is_file() {
            return Some((*p).to_string());
        }
    }
    // 2) PATH 扫描
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in SOFFICE_NAMES {
                let cand = dir.join(name);
                if cand.is_file() {
                    return Some(cand.to_string_lossy().into_owned());
                }
            }
        }
    }
    None
}

/// 本机是否具备 LibreOffice（结果进程内缓存）
#[tauri::command]
pub async fn cmd_office_available() -> Result<bool, String> {
    Ok(SOFFICE.get_or_init(find_soffice).is_some())
}

/// 缓存目录：`{app_data}/worldsea/office_cache`
fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    let dir = base.join("worldsea").join("office_cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建转换缓存目录失败: {e}"))?;
    Ok(dir)
}

/// 缓存键：源路径 + mtime + size（源文件一变即换键，不会读到过期产物）
fn cache_key(src: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(src).map_err(|e| format!("读取源文件信息失败: {e}"))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let mut hasher = DefaultHasher::new();
    src.to_string_lossy().to_lowercase().hash(&mut hasher);
    mtime.hash(&mut hasher);
    meta.len().hash(&mut hasher);
    Ok(format!("{:016x}", hasher.finish()))
}

/// `-env:UserInstallation` 需要的 file URL。
///
/// 三段式 = `file:` + 空 authority（`//`）+ 绝对路径：
/// - Windows `D:\x\y` → `file:///D:/x/y`（路径不含起始斜杠，补一个）
/// - Unix `/tmp/x` → `file:///tmp/x`（路径已含起始斜杠，直接接，若再补会成四斜杠畸形 URL）
fn file_url(p: &Path) -> String {
    let s = p.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') {
        format!("file://{s}")
    } else {
        format!("file:///{s}")
    }
}

/// 清理超过保留期的缓存子目录（失败静默：清理属尽力而为，不应影响转换主流程）
fn sweep_cache(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    let max_age = Duration::from_secs(CACHE_MAX_AGE_DAYS * 24 * 60 * 60);
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let old = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| SystemTime::now().duration_since(t).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

/// 同步执行一次转换（在阻塞线程中调用）
fn run_conversion(exe: &str, src: &Path, out_dir: &Path, profile: &Path) -> Result<(), String> {
    let mut child = Command::new(exe)
        .arg("--headless")
        .arg("--norestore")
        .arg("--invisible")
        // 独立用户配置目录：避免与用户正在运行的 LibreOffice 抢占，也避免并发转换互相干扰
        .arg(format!("-env:UserInstallation={}", file_url(profile)))
        .arg("--convert-to")
        .arg("pdf")
        .arg("--outdir")
        .arg(out_dir)
        .arg(src)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 LibreOffice 失败: {e}"))?;

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(format!(
                        "LibreOffice 转换失败（退出码 {:?}）",
                        status.code()
                    ))
                }
            }
            Ok(None) => {
                if start.elapsed() > CONVERT_TIMEOUT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "LibreOffice 转换超时（超过 {} 秒），已终止",
                        CONVERT_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(e) => return Err(format!("等待 LibreOffice 结束失败: {e}")),
        }
    }
}

/// 把 ppt/pptx 转成 PDF，返回 **PDF 文件路径**（命中缓存则直接返回）
///
/// 前端随后按普通 PDF 用 `cmd_fs_read` 读取渲染 —— 转换产物落在应用数据目录内，
/// 不污染用户工作区。
#[tauri::command]
pub async fn cmd_pptx_to_pdf(
    app: tauri::AppHandle,
    src: String,
) -> Result<String, String> {
    let src_path = PathBuf::from(&src);
    if !src_path.is_file() {
        return Err(format!("源文件不存在: {src}"));
    }

    let exe = SOFFICE
        .get_or_init(find_soffice)
        .clone()
        .ok_or_else(|| "本机未检测到 LibreOffice".to_string())?;

    let root = cache_root(&app)?;
    let key = cache_key(&src_path)?;
    let out_dir = root.join(&key);

    // 缓存命中：目录已存在且含 PDF
    if let Some(hit) = first_pdf_in(&out_dir) {
        return Ok(hit.to_string_lossy().replace('\\', "/"));
    }

    std::fs::create_dir_all(&out_dir).map_err(|e| format!("创建转换输出目录失败: {e}"))?;
    let profile = root.join("profile");

    let (exe2, src2, out2, profile2) = (
        exe.clone(),
        src_path.clone(),
        out_dir.clone(),
        profile.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || run_conversion(&exe2, &src2, &out2, &profile2))
        .await
        .map_err(|e| format!("转换任务异常: {e}"))??;

    let pdf = first_pdf_in(&out_dir)
        .ok_or_else(|| "LibreOffice 未产出 PDF（可能是不受支持的格式）".to_string())?;

    // 顺带清理超期缓存（尽力而为）
    sweep_cache(&root);

    Ok(pdf.to_string_lossy().replace('\\', "/"))
}

/// 取目录下第一个 PDF（LibreOffice 以源文件名命名产物，此处不假设具体名字）
fn first_pdf_in(dir: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_file()
            && p.extension()
                .map(|e| e.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false)
        {
            return Some(p);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// file_url 的平台转换：LibreOffice 要求 file URL 用正斜杠三段式。
    /// 本机通常不装 LibreOffice，转换链路无法在运行时验证，故此处锁住这个易错点。
    #[test]
    fn file_url_normalizes_backslashes() {
        let url = file_url(Path::new(r"D:\WorldSea\.workbuddy\office_cache\profile"));
        assert_eq!(url, "file:///D:/WorldSea/.workbuddy/office_cache/profile");
        assert!(!url.contains('\\'), "file URL 不得残留反斜杠: {url}");
    }

    #[test]
    fn file_url_keeps_forward_slashes() {
        // Unix 绝对路径：三段式，不得出现四斜杠
        let url = file_url(Path::new("/tmp/xlsx/profile"));
        assert_eq!(url, "file:///tmp/xlsx/profile");
    }

    /// 缓存键必须随 mtime / size 变化 —— 否则源文件改了会读到过期产物。
    #[test]
    fn cache_key_changes_with_content_and_path() {
        let dir = std::env::temp_dir().join("ws_office_key_test");
        std::fs::create_dir_all(&dir).unwrap();

        let a = dir.join("a.pptx");
        std::fs::write(&a, b"first").unwrap();
        let key_a1 = cache_key(&a).unwrap();

        // 路径相同、内容长度变化 → 键必须变
        std::fs::write(&a, b"second-longer").unwrap();
        let key_a2 = cache_key(&a).unwrap();
        assert_ne!(key_a1, key_a2, "size 变化后缓存键应改变");

        // 不同路径 → 键必须不同（避免不同文件互相命中同一份缓存）
        let b = dir.join("b.pptx");
        std::fs::write(&b, b"second-longer").unwrap();
        let key_b = cache_key(&b).unwrap();
        assert_ne!(key_a2, key_b, "不同源路径应得到不同缓存键");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 源文件不存在时应报错（而非返回一个会误命中的键）
    #[test]
    fn cache_key_errors_on_missing_file() {
        let missing = std::env::temp_dir().join("ws_office_definitely_missing.pptx");
        assert!(cache_key(&missing).is_err());
    }

    /// first_pdf_in：只认 .pdf（大小写不敏感），空目录返回 None
    #[test]
    fn first_pdf_in_detects_pdf_only() {
        let dir = std::env::temp_dir().join("ws_office_pdf_scan_test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(first_pdf_in(&dir).is_none(), "空目录应返回 None");

        std::fs::write(dir.join("deck.pptx"), b"x").unwrap();
        assert!(first_pdf_in(&dir).is_none(), "非 pdf 不应被识别");

        std::fs::write(dir.join("deck.PDF"), b"x").unwrap();
        assert!(first_pdf_in(&dir).is_some(), "扩展名应大小写不敏感");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// sweep_cache：只清超期目录，且不误删文件
    #[test]
    fn sweep_cache_keeps_fresh_and_ignores_files() {
        let root = std::env::temp_dir().join("ws_office_sweep_test");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let fresh = root.join("fresh");
        std::fs::create_dir_all(&fresh).unwrap();
        std::fs::write(root.join("stray.txt"), b"x").unwrap();

        sweep_cache(&root);

        assert!(fresh.is_dir(), "未超期的目录不应被清");
        assert!(root.join("stray.txt").is_file(), "散文件不应被清");

        let _ = std::fs::remove_dir_all(&root);
    }
}
