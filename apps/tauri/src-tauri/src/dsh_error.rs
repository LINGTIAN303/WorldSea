// 壳错误页导航：把「可辨认失败态」呈现为内联 HTML（data URL），不静默白屏。
// HTML 模板与色板单点在 `app_prefs::error_page_html`；本模块只负责 URL 编码与导航。
// 口径见 docs/plans/2026-09-23-dsh接管Agent面-大重构准备.md §六。

use tauri::WebviewWindow;

/// 可辨认失败态：把窗口导航到内联错误页（不静默白屏）。
pub fn show_error(window: &WebviewWindow, title: &str, detail: &str) {
    let html = crate::app_prefs::error_page_html(title, detail);
    let url = format!("data:text/html;charset=utf-8,{}", percent_encode_pub(&html));
    match url.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                tracing::error!("dsh shell: 错误页导航失败：{e}");
            }
        }
        Err(e) => tracing::error!("dsh shell: 错误页 URL 解析失败：{e}"),
    }
}

/// data URL 的最小百分号编码（保留 URL 中无需转义的可见 ASCII）。
pub(crate) fn percent_encode_pub(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\''
            | b'(' | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
