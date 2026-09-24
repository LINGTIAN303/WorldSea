// D1-a 伺服核心的测试：前缀判定 / 越界闸门 / MIME / 缓存策略 / index 注入（含与 dsh 页不同的挂载点）。
// 夹具走临时目录（不依赖仓内已构建产物），故 CI 冷克隆也可跑。

use super::*;

/// 临时产物目录夹具：`index.html` + `assets/app.js` + `assets/style.css`。
fn fixture(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("worldsea-ws-dist-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("assets")).expect("建夹具目录");
    std::fs::write(
        root.join("index.html"),
        "<!doctype html><html><head><title>t</title></head><body><div id=\"app\"></div>\
         <script type=\"module\" src=\"./assets/app.js\"></script></body></html>",
    )
    .expect("写 index");
    std::fs::write(root.join("assets").join("app.js"), "console.log(1)").expect("写 js");
    std::fs::write(root.join("assets").join("style.css"), "body{}").expect("写 css");
    root
}

fn request(method: &str, uri: &str) -> http::Request<Vec<u8>> {
    http::Request::builder().method(method).uri(uri).body(Vec::new()).expect("构造请求")
}

fn header(response: &http::Response<Vec<u8>>, name: &str) -> Option<String> {
    response.headers().get(name).and_then(|value| value.to_str().ok()).map(str::to_string)
}

fn body_text(response: &http::Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(response.body()).to_string()
}

#[test]
fn prefix_matches_only_workspace_paths() {
    assert!(is_workspace_path("/workspace"));
    assert!(is_workspace_path("/workspace/"));
    assert!(is_workspace_path("/workspace/assets/app.js"));
    assert!(!is_workspace_path("/workspacefoo"));
    assert!(!is_workspace_path("/"));
    assert!(!is_workspace_path("/assets/app.js"));
}

#[test]
fn index_serves_injected_no_store_with_csp() {
    let root = fixture("index");
    let response = serve(&root, &request("GET", "/workspace/"));
    assert_eq!(response.status(), 200);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
    assert_eq!(
        header(&response, "content-security-policy").as_deref(),
        Some(crate::dsh_proxy::CSP_INDEX)
    );
    let text = body_text(&response);
    // 注入件：挂载点声明 + 安全网 + 空间切换桥
    assert!(text.contains("worldsea-shell:boot-root"), "{text}");
    assert!(text.contains("__WORLDSEA_BOOT_ROOT__ = 'app'"), "{text}");
    assert!(text.contains("worldsea-shell:boot-watchdog"), "{text}");
    assert!(text.contains("worldsea-shell:space-switch"), "{text}");
    // 顺序契约：注入在 <head> 后、模块脚本前（安全网先于页面代码生效）
    let injected = text.find("worldsea-shell:boot-watchdog").expect("注入存在");
    let module = text.find("assets/app.js").expect("模块脚本存在");
    assert!(injected < module, "注入必须早于模块脚本");
    // 原页内容不被改动
    assert!(text.contains("<div id=\"app\"></div>"));
}

#[test]
fn workspace_index_uses_app_mount_point_not_root() {
    // 与 dsh 页（#root）区分：工作台是旧前端口径（#app）——watchdog 认错挂载点会误报白屏
    let injected = crate::dsh_inject::inject_workspace_scripts("<html><head></head><body></body></html>");
    assert!(injected.contains("__WORLDSEA_BOOT_ROOT__ = 'app'"));
    assert!(injected.contains("worldsea-shell:boot-watchdog"));
    assert!(injected.contains("cmd_shell_space_switch"));
}

#[test]
fn workspace_index_carries_theme_source_and_writeback_bridge() {
    // E2：主题真源经壳注入（防闪脚本优先用它）；写回桥供页内设置改主题时同步壳/dsh
    let injected = crate::dsh_inject::inject_workspace_scripts("<html><head></head><body></body></html>");
    assert!(injected.contains("worldsea-shell:theme"), "缺主题注入");
    assert!(injected.contains("globalThis.__WORLDSEA_THEME__ = \""), "缺真源字符串");
    assert!(injected.contains("globalThis.__WORLDSEA_DARK__ = "), "缺亮暗标志（壳自有面用）");
    assert!(injected.contains("worldsea-shell:theme-set") && injected.contains("cmd_theme_set"), "缺写回桥");
    // 顺序：主题注入必须早于安全网（安全网按 __WORLDSEA_DARK__ 取色）
    let theme_at = injected.find("worldsea-shell:theme").expect("主题注入存在");
    let watchdog_at = injected.find("worldsea-shell:boot-watchdog").expect("安全网存在");
    assert!(theme_at < watchdog_at, "主题注入必须早于安全网");
}

#[test]
fn asset_serves_immutable_with_js_mime() {
    let root = fixture("asset");
    let response = serve(&root, &request("GET", "/workspace/assets/app.js"));
    assert_eq!(response.status(), 200);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/javascript; charset=utf-8"));
    assert_eq!(
        header(&response, "cache-control").as_deref(),
        Some("public, max-age=31536000, immutable")
    );
    assert_eq!(body_text(&response), "console.log(1)");
    // 非 assets/ 的散件不享长缓存（重构建要能即刻生效）
    let css = serve(&root, &request("GET", "/workspace/assets/style.css"));
    assert_eq!(header(&css, "content-type").as_deref(), Some("text/css; charset=utf-8"));
}

#[test]
fn index_html_alias_and_explicit_index_path() {
    let root = fixture("alias");
    let explicit = serve(&root, &request("GET", "/workspace/index.html"));
    assert_eq!(explicit.status(), 200);
    assert!(body_text(&explicit).contains("worldsea-shell:boot-watchdog"));
}

#[test]
fn missing_file_is_404_html_for_page_like_paths() {
    let root = fixture("missing");
    let script = serve(&root, &request("GET", "/workspace/assets/nope.js"));
    assert_eq!(script.status(), 404);
    assert_eq!(header(&script, "content-type").as_deref(), Some("text/plain; charset=utf-8"));
    // 页面级路径（末段无扩展名）→ HTML 错误页，不白屏
    let page = serve(&root, &request("GET", "/workspace/nope"));
    assert_eq!(page.status(), 404);
    assert_eq!(header(&page, "content-type").as_deref(), Some("text/html; charset=utf-8"));
}

#[test]
fn traversal_is_403() {
    let root = fixture("traversal");
    for uri in ["/workspace/../red.txt", "/workspace/assets/../index.html", "/workspace/./x.js"] {
        let response = serve(&root, &request("GET", uri));
        assert_eq!(response.status(), 403, "{uri} 必须被越界闸门拦下");
    }
    // `..` 作为普通名字段（非越界段）不该命中闸门 → 落到 404
    let plain = serve(&root, &request("GET", "/workspace/assets/x..js"));
    assert_eq!(plain.status(), 404);
}

#[test]
fn method_gate_allows_only_get_and_head() {
    let root = fixture("method");
    let post = serve(&root, &request("POST", "/workspace/"));
    assert_eq!(post.status(), 405);
    assert_eq!(header(&post, "allow").as_deref(), Some("GET, HEAD, POST"));
    let head = serve(&root, &request("HEAD", "/workspace/assets/app.js"));
    assert_eq!(head.status(), 200);
    assert!(head.body().is_empty(), "HEAD 无体");
    assert_eq!(header(&head, "content-length").as_deref(), Some("14"));
}

#[test]
fn mime_and_cache_maps_cover_bundle_types() {
    assert_eq!(mime_for("assets/a.js"), "text/javascript; charset=utf-8");
    assert_eq!(mime_for("assets/a.wasm"), "application/wasm");
    assert_eq!(mime_for("assets/a.svg"), "image/svg+xml");
    assert_eq!(mime_for("assets/a.css"), "text/css; charset=utf-8");
    assert_eq!(mime_for("assets/noext"), "application/octet-stream");
    assert_eq!(cache_control_for("assets/a.js"), "public, max-age=31536000, immutable");
    assert_eq!(cache_control_for("index.html"), "no-store");
    assert_eq!(cache_control_for("favicon.svg"), "no-store");
}

#[test]
fn wants_html_distinguishes_page_and_asset_requests() {
    assert!(wants_html("/workspace/"));
    assert!(wants_html("/workspace"));
    assert!(wants_html("/workspace/nope"));
    assert!(!wants_html("/workspace/assets/app.js"));
}
