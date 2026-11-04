// 壳错误页：把「可辨认失败态」呈现为壳协议页，不静默白屏。
//
// **为什么必须是壳协议页而不是 `data:` URL**：Tauri 的 `is_local_url`
// （tauri-2.11.5 `webview/mod.rs:1698`）白名单只含 `tauri://`、`devUrl`/`frontendDist`
// 相对路径、以及用户注册的自定义协议——`data:` 不在其中。`data:` 页里既没有
// `__TAURI_INTERNALS__`（壳命令全不可用），也拿不到壳注入的窗口栏脚本，
// 于是错误页上「⋯」菜单不存在、手动恢复无从谈起（真机走查实测）。
//
// 改走 `worldsea://shell-error` 后：页面落在壳协议 origin 内 → 注入面可用 →
// 窗口栏与「视图 → 重新启动 Agent 内核」菜单都能用。
//
// 内容经 `__WORLDSEA_SHELL_ERROR__` 传递（标题/详情由壳写在 URL query 上），
// 由协议处理器渲染成 HTML——避免把长文本塞进 URL 主体。

use tauri::WebviewWindow;

/// 错误页在壳协议下的路径（`worldsea://localhost/shell-error`）。
pub const SHELL_ERROR_PATH: &str = "/shell-error";

/// 可辨认失败态：把窗口导航到壳协议错误页（不静默白屏）。
///
/// 标题与详情经 query 传给协议处理器；处理器渲染 HTML 并注入壳脚本，
/// 故错误页与正常 Agent 页同源，窗口栏与菜单都可用。
pub fn show_error(window: &WebviewWindow, title: &str, detail: &str) {
    let url = error_page_url(title, detail);
    match url.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                tracing::error!("dsh shell: 错误页导航失败：{e}");
            }
        }
        Err(e) => tracing::error!("dsh shell: 错误页 URL 解析失败：{e}"),
    }
}

/// 错误页 URL（`worldsea://localhost/shell-error?title=…&detail=…`）。
///
/// 与 `dsh_bridge::APP_URL` 同 authority（Windows wry workaround 要求 localhost）。
pub fn error_page_url(title: &str, detail: &str) -> String {
    format!(
        "{}shell-error?title={}&detail={}",
        crate::dsh_bridge::APP_URL,
        percent_encode_pub(title),
        percent_encode_pub(detail)
    )
}

/// 从 query 还原标题与详情（协议处理器用）。
///
/// 只认 `title` / `detail` 两个键；缺失时给空串而不是报错——错误页本身
/// 不能因为参数不全再失败一次。
pub fn parse_error_query(query: &str) -> (String, String) {
    let mut title = String::new();
    let mut detail = String::new();
    for pair in query.split('&') {
        let Some((key, value)) = pair.split_once('=') else { continue };
        let decoded = percent_decode(value);
        match key {
            "title" => title = decoded,
            "detail" => detail = decoded,
            _ => {}
        }
    }
    (title, detail)
}

/// 渲染错误页响应：HTML + 壳注入脚本（窗口栏、壳桥、主题）。
///
/// **注入窗口栏是本函数存在的理由**：错误页若没有窗口栏，「⋯」菜单就不存在，
/// 用户没法用「视图 → 重新启动 Agent 内核」恢复。故这里复用正常页面的注入面，
/// 只是不带传输桥与 dsh 相关常量（那时宿主本来就不在）。
pub fn error_page_response(query: &str) -> http::Response<Vec<u8>> {
    let (title, detail) = parse_error_query(query);
    let html = crate::app_prefs::error_page_html_with_restart(&title, &detail);
    let titlebar = !std::env::var_os("WORLDSEA_FRAMED").is_some()
        && std::env::var_os("WORLDSEA_NO_TITLEBAR").is_none();
    let html = crate::dsh_inject::inject_error_page_scripts(&html, titlebar);
    http::Response::builder()
        .status(200)
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-store")
        .body(html.into_bytes())
        .expect("error page response")
}

/// data URL / query 的最小百分号编码（保留 URL 中无需转义的可见 ASCII）。
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

/// 百分号解码（只处理 `%XX`；非法转义原样保留，不 panic）。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_digit(bytes[i + 1]), hex_digit(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 单个十六进制位；非法返回 None（让调用方原样保留字符）。
fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_url_points_at_the_shell_scheme_not_a_data_url() {
        // 真机缺陷的根因锁：data: URL 不在 Tauri 的 is_local_url 白名单，
        // 页面拿不到 __TAURI_INTERNALS__，窗口栏与菜单全不可用。
        let url = error_page_url("Agent 内核已停止运行", "自动重启 3 次均失败");
        assert!(url.starts_with(crate::dsh_bridge::APP_URL), "必须是壳协议 URL：{url}");
        assert!(url.contains("shell-error"), "必须带错误页路径：{url}");
        assert!(!url.starts_with("data:"), "不得回退成 data: URL");
    }

    #[test]
    fn query_round_trips_chinese_and_punctuation() {
        let title = "Agent 内核已停止运行";
        let detail = "自动重启 3 次均失败，已停手以免反复崩溃。\n最后一次错误：dsh 在打印就绪 URL 前退出";
        let url = error_page_url(title, detail);
        let query = url.split_once('?').expect("URL 应带 query").1;
        let (got_title, got_detail) = parse_error_query(query);
        assert_eq!(got_title, title);
        assert_eq!(got_detail, detail);
    }

    #[test]
    fn missing_or_malformed_query_never_fails_the_page() {
        // 错误页不能因为参数不全再失败一次：缺失给空串，非法转义原样保留。
        let (title, detail) = parse_error_query("");
        assert_eq!((title.as_str(), detail.as_str()), ("", ""));
        let (title, detail) = parse_error_query("title=A%20B&detail=100%25");
        assert_eq!(title, "A B");
        assert_eq!(detail, "100%");
        let (title, _) = parse_error_query("title=bad%zz");
        assert_eq!(title, "bad%zz", "非法转义必须原样保留，不能吞字符");
    }

    #[test]
    fn percent_decode_keeps_plus_and_unknown_keys() {
        let (title, detail) = parse_error_query("title=a+b&other=c");
        assert_eq!(title, "a+b", "query 编码用 %20 而非 +，故 + 应原样保留");
        assert_eq!(detail, "", "未知键不进入结果");
    }
}
