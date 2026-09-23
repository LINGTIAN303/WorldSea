// dsh_bridge 的测试（拆出源码文件以满足 arch:check 的 400 行上限；路径含 tests 走 1200 行档）。
// 经 `#[path] mod tests` 挂在 dsh_bridge 内，故可直接触达其私有项。

use super::*;

#[test]
fn port_parsed_from_ready_url() {
    assert_eq!(parse_port("http://127.0.0.1:3080/?token=abc").unwrap(), 3080);
    assert_eq!(parse_port("http://127.0.0.1:65535/?token=").unwrap(), 65535);
    assert!(parse_port("http://localhost:1/?token=x").is_err());
}

#[test]
fn cache_policy_targets_index_and_plugin_bundles() {
    // 每进程内容 → 必须 no-store
    assert!(needs_no_store("/"));
    assert!(needs_no_store("/index.html"));
    assert!(needs_no_store("/plugins/ui-chat/client.js"));
    // 内容哈希命名的静态资源与本轮无关 → 允许缓存
    assert!(!needs_no_store("/assets/vendor-CCJJTK99.js"));
    assert!(!needs_no_store("/favicon.svg"));
    assert!(!needs_no_store("/api/session/modelCatalog"));
}

#[test]
fn injection_lands_inside_head_and_merges() {
    let html = "<!doctype html><html><head><meta charset=\"utf-8\"></head><body></body></html>";
    let out = inject_transport(html, "http://127.0.0.1:9999/s3cret/", false);
    let head_end = out.find("</head>").unwrap();
    let script_at = out.find("worldsea-shell:transport").unwrap();
    assert!(script_at < head_end, "注入必须落在 <head> 内、且早于其它脚本");
    assert!(out.contains("Object.assign({}, globalThis.__DSH_TRANSPORT__"));
    assert!(out.contains("streamBaseUrl: \"http://127.0.0.1:9999/s3cret/\""));
    assert!(out.contains("ownsHost: true"));
    // 未开诊断时不得出现诊断脚本
    assert!(!out.contains("worldsea-shell:diag"));
    // 原内容不被破坏
    assert!(out.contains("<meta charset=\"utf-8\">"));
    assert!(out.contains("<body></body>"));
}

#[test]
fn diag_script_only_when_enabled() {
    let html = "<head><title>t</title></head>";
    let on = inject_transport(html, "http://127.0.0.1:1/a/", true);
    assert!(on.contains("worldsea-shell:diag"));
    assert!(on.contains("unhandledrejection"));
    assert!(on.contains("'/__diag'") || on.contains("/__diag"));
    let off = inject_transport(html, "http://127.0.0.1:1/a/", false);
    assert!(!off.contains("worldsea-shell:diag"));
}

#[test]
fn injection_handles_head_with_attributes_and_missing_head() {
    let out = inject_transport("<HEAD data-x=\"1\"><body>x</body>", "http://127.0.0.1:1/a/", false);
    assert!(out.starts_with("<HEAD data-x=\"1\"><script>"));
    let bare = inject_transport("<div>裸片段</div>", "http://127.0.0.1:1/a/", false);
    assert!(bare.starts_with("<script>"));
}
