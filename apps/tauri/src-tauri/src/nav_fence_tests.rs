// nav_fence 的测试：主框架导航放行判据与「外开」目标选择（纯函数表驱动）。

use super::*;

#[test]
fn allows_only_app_origins_and_shell_pages() {
    // 自家 UI（两种落形）
    assert!(navigation_allowed("http://worldsea.localhost/"));
    assert!(navigation_allowed("https://worldsea.localhost/sessions?x=1"));
    assert!(navigation_allowed("worldsea://localhost/"));
    // 壳自有资产页（frontendDist = shell-loading 兜底页；实测拦它会得到空窗口）
    assert!(navigation_allowed("http://tauri.localhost/"));
    assert!(navigation_allowed("tauri://localhost/index.html"));
    // legacy 回退页（直连 loopback 带 token）
    assert!(navigation_allowed("http://127.0.0.1:3080/?token=abc"));
    assert!(navigation_allowed("http://localhost:5175/"));
    // 壳错误页与空页
    assert!(navigation_allowed("data:text/html;charset=utf-8,%3Ch1%3Ex"));
    assert!(navigation_allowed("about:blank"));
}

#[test]
fn blocks_external_and_dangerous_schemes() {
    assert!(!navigation_allowed("https://example.com/"));
    assert!(!navigation_allowed("http://evil.worldsea.localhost/"));
    assert!(!navigation_allowed("http://worldsea.localhost.evil.com/"));
    assert!(!navigation_allowed("file:///C:/Windows/win.ini"));
    assert!(!navigation_allowed("javascript:alert(1)"));
    assert!(!navigation_allowed("blob:http://worldsea.localhost/aaaa"));
    assert!(!navigation_allowed("mailto:support@example.com"));
    assert!(!navigation_allowed("not a url"));
}

#[test]
fn external_target_only_http_and_mailto() {
    assert_eq!(external_target("https://example.com/x").as_deref(), Some("https://example.com/x"));
    assert_eq!(external_target("http://example.com/").as_deref(), Some("http://example.com/"));
    assert_eq!(external_target("mailto:a@b.c").as_deref(), Some("mailto:a@b.c"));
    assert_eq!(external_target("file:///C:/x"), None);
    assert_eq!(external_target("javascript:alert(1)"), None);
}
