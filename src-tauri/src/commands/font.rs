//! 字体扫描与读取命令
//!
//! 拆分自 lib.rs（P0-2 批次5）。
//! 涵盖跨平台系统字体扫描和字体文件读取命令。
//! 字体扫描覆盖 Windows / macOS / Linux 主流字体目录。

use serde::{Deserialize, Serialize};

use worldsmith_core::error::CoreError;

/// 系统字体元信息。
///
/// 字段 pub：作为 `cmd_font_scan_system` 的返回类型需对外可见。
#[derive(Serialize, Deserialize, Clone)]
pub struct SystemFontInfo {
    pub family: String,
    pub path: String,
    pub weight: u32,
    pub style: String,
    pub format: String,
}

#[tauri::command]
pub fn cmd_font_scan_system() -> Result<Vec<SystemFontInfo>, CoreError> {
    let mut fonts = Vec::new();

    #[cfg(target_os = "windows")]
    {
        let font_dir = std::path::Path::new("C:\\Windows\\Fonts");
        if font_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(font_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_lowercase())
                        .unwrap_or_default();

                    if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                        continue;
                    }

                    let file_name = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Unknown")
                        .to_string();

                    let format = match ext.as_str() {
                        "woff2" => "woff2",
                        "woff" => "woff",
                        "otf" => "opentype",
                        _ => "truetype",
                    }
                    .to_string();

                    let family = file_name
                        .replace(['-', '_'], " ")
                        .split_whitespace()
                        .map(|w| {
                            let mut c = w.chars();
                            match c.next() {
                                None => String::new(),
                                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ");

                    let (weight, style) = parse_font_meta(&file_name);

                    fonts.push(SystemFontInfo {
                        family,
                        path: path.to_string_lossy().to_string(),
                        weight,
                        style,
                        format,
                    });
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let dirs = vec!["/Library/Fonts", "/System/Library/Fonts"];
        for dir_path in dirs {
            let font_dir = std::path::Path::new(dir_path);
            if font_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(font_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_lowercase())
                            .unwrap_or_default();
                        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                            continue;
                        }
                        let file_name = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let format = match ext.as_str() {
                            "woff2" => "woff2",
                            "woff" => "woff",
                            "otf" => "opentype",
                            _ => "truetype",
                        }
                        .to_string();
                        let family = file_name.replace(['-', '_'], " ");
                        let (weight, style) = parse_font_meta(&file_name);
                        fonts.push(SystemFontInfo {
                            family,
                            path: path.to_string_lossy().to_string(),
                            weight,
                            style,
                            format,
                        });
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let dirs = vec!["/usr/share/fonts", "/usr/local/share/fonts"];
        for dir_path in dirs {
            let font_dir = std::path::Path::new(dir_path);
            if font_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(font_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_dir() {
                            continue;
                        }
                        let ext = path
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(|e| e.to_lowercase())
                            .unwrap_or_default();
                        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
                            continue;
                        }
                        let file_name = path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Unknown")
                            .to_string();
                        let format = match ext.as_str() {
                            "woff2" => "woff2",
                            "woff" => "woff",
                            "otf" => "opentype",
                            _ => "truetype",
                        }
                        .to_string();
                        let family = file_name.replace(['-', '_'], " ");
                        let (weight, style) = parse_font_meta(&file_name);
                        fonts.push(SystemFontInfo {
                            family,
                            path: path.to_string_lossy().to_string(),
                            weight,
                            style,
                            format,
                        });
                    }
                }
            }
        }
    }

    Ok(fonts)
}

/// 从字体文件名解析字重和样式
fn parse_font_meta(file_name: &str) -> (u32, String) {
    let lower = file_name.to_lowercase();
    let weight = if lower.contains("thin") || lower.contains("hairline") {
        100
    } else if lower.contains("extralight") || lower.contains("ultralight") {
        200
    } else if lower.contains("light") {
        300
    } else if lower.contains("medium") {
        500
    } else if lower.contains("semibold") || lower.contains("demibold") || lower.contains("demi") {
        600
    } else if lower.contains("extrabold") || lower.contains("ultrabold") {
        800
    } else if lower.contains("black") || lower.contains("heavy") {
        900
    } else if lower.contains("bold") {
        700
    } else {
        400
    };
    let style = if lower.contains("italic") || lower.contains("oblique") {
        "italic".to_string()
    } else {
        "normal".to_string()
    };
    (weight, style)
}

#[tauri::command]
pub fn cmd_font_read_file(path: String) -> Result<Vec<u8>, CoreError> {
    std::fs::read(&path)
        .map_err(|e| CoreError::storage(format!("Failed to read font file '{}': {}", path, e)))
}
