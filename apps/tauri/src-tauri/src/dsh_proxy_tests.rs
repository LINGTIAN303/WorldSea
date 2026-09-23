// dsh_proxy 的测试（假上游整链 + 闸门纯函数）。路径含 tests → arch:check 走 1200 行档。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use super::*;

/// 宿主渲染后的 index 形态（含 frontend-static 的 `<base>` 与宿主的 head 行）——顺序契约的基准样本。
const RENDERED_INDEX: &str = "<!doctype html><html><head><base href=\"./\"><script>globalThis[\"__DSH_BOOT__\"]=[]</script><link rel=\"stylesheet\" href=\"./assets/x.css\"></head><body><div id=\"root\"></div><script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()</script></body></html>";

/// 假上游：按路径回预置响应，并记录每个请求的首部（供断言转发配方）。
fn fake_upstream() -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen_thread = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { break };
            let seen = seen_thread.clone();
            std::thread::spawn(move || serve(stream, seen));
        }
    });
    (port, seen)
}

fn serve(stream: TcpStream, seen: Arc<Mutex<Vec<String>>>) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    loop {
        let mut head = Vec::new();
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {}
            }
            head.extend_from_slice(&line);
            if line == b"\r\n" || line == b"\n" {
                break;
            }
        }
        let text = String::from_utf8_lossy(&head).to_string();
        seen.lock().unwrap().push(text.clone());
        // 读掉请求体（POST 场景），避免污染同连接的后续请求
        let length = header_value(&text, "content-length")
            .and_then(|value| value.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if length > 0 {
            let mut body = vec![0u8; length];
            let _ = reader.read_exact(&mut body);
        }
        let request_line = text.lines().next().unwrap_or("");
        let method = request_line.split_whitespace().next().unwrap_or("GET");
        let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let (status, ctype, extra, body) = response_for(&path);
        let outgoing = format!(
            "HTTP/1.1 {status}\r\ncontent-type: {ctype}\r\n{extra}content-length: {}\r\nconnection: keep-alive\r\n\r\n",
            body.len()
        );
        let mut writer = stream.try_clone().unwrap();
        let _ = writer.write_all(outgoing.as_bytes());
        if method != "HEAD" {
            let _ = writer.write_all(body.as_bytes());
        }
        let _ = writer.flush();
    }
}

/// 上游预置响应：(状态行, content-type, 额外头, 体)。
fn response_for(path: &str) -> (&'static str, &'static str, &'static str, String) {
    if path.contains("missing") {
        return ("404 Not Found", "text/plain; charset=utf-8", "", "asset missing".to_string());
    }
    if path == "/plugins/events" {
        // SSE 流：壳协议不支持流式透传 → 代理须显式降级（502 + 可辨认说明），不得静默截断
        return ("200 OK", "text/event-stream", "", "data: hello\n\n".to_string());
    }
    if path.starts_with("/api/") {
        return ("200 OK", "application/json", "", "{\"ok\":true}".to_string());
    }
    if path == "/" || path == "/index.html" {
        return ("200 OK", "text/html; charset=utf-8", "", RENDERED_INDEX.to_string());
    }
    if path.starts_with("/assets/") {
        return (
            "200 OK",
            "text/javascript; charset=utf-8",
            "cache-control: max-age=600\r\n",
            "console.log('asset')".to_string(),
        );
    }
    if path.starts_with("/plugins/") {
        return (
            "200 OK",
            "text/javascript; charset=utf-8",
            "cache-control: public, max-age=31536000, immutable\r\n",
            "console.log('plugin')".to_string(),
        );
    }
    ("404 Not Found", "text/plain; charset=utf-8", "", "not found".to_string())
}

fn header_value(head: &str, name: &str) -> Option<String> {
    head.lines()
        .skip(1)
        .find_map(|line| {
            let (key, value) = line.split_once(':')?;
            (key.trim().eq_ignore_ascii_case(name)).then(|| value.to_string())
        })
}

fn cfg(host_port: u16) -> ProxyCfg {
    ProxyCfg {
        host_port,
        cookie: "dsh-auth-x=v1.a.b".to_string(),
        relay_base: "http://127.0.0.1:9/dead-secret/".to_string(),
        inject_transport: true,
        inject_shell_bridge: true,
        diag: false,
        deny_path: None,
        open_paths: false,
    }
}

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .unwrap()
}

fn req(method: &str, path_and_query: &str) -> http::Request<Vec<u8>> {
    http::Request::builder()
        .method(method)
        .uri(format!("worldsea://localhost{path_and_query}"))
        .body(Vec::new())
        .unwrap()
}

fn body_text(response: &http::Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(response.body()).to_string()
}

fn header(response: &http::Response<Vec<u8>>, name: &str) -> Option<String> {
    response.headers().get(name).map(|v| v.to_str().unwrap_or("").to_string())
}

/// 找空闲但没人监听的端口（模拟宿主不可达）。
fn dead_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    port
}

#[test]
fn index_injected_with_contract_order_and_no_store() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
    let text = body_text(&response);
    let transport = text.find("worldsea-shell:transport").expect("缺传输注入");
    let base = text.find("<base href=\"./\">").expect("宿主 <base> 丢了");
    let boot = text.find("__DSH_BOOT__").expect("宿主 head 行丢了");
    let ready = text.find("__DSH_BOOT_READY__").expect("宿主尾行丢了");
    // 顺序契约：壳脚本 → 宿主 <base> → 宿主 head 行 → 宿主尾行（原样保留且相对顺序不变）
    assert!(transport < base, "壳脚本必须先于宿主 <base>：{text}");
    assert!(base < boot, "宿主行顺序被破坏：{text}");
    assert!(boot < ready, "宿主行顺序被破坏：{text}");
    assert!(text.contains("streamBaseUrl: \"http://127.0.0.1:9/dead-secret/\""));
    assert!(text.contains("worldsea-shell:boot-watchdog"), "安全网必须常驻注入");
}

#[test]
fn asset_passthrough_keeps_upstream_cache_and_untouched_body() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("max-age=600"));
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/javascript; charset=utf-8"));
    assert_eq!(body_text(&response), "console.log('asset')");
}

#[test]
fn plugin_bundle_forced_no_store() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/plugins/ui-chat/client.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
}

#[test]
fn unknown_prefix_rejected_by_allowlist_without_forwarding() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/etc/passwd"));
    assert_eq!(response.status().as_u16(), 404);
    assert!(seen.lock().unwrap().is_empty(), "白名单外路径不得转发到宿主");
    // 同名路径在逃生口下会转发
    let mut open = cfg(port);
    open.open_paths = true;
    let response = proxy(&open, &client(), &req("GET", "/etc/passwd"));
    assert_eq!(response.status().as_u16(), 404); // 宿主自己的 404
    assert_eq!(seen.lock().unwrap().len(), 1, "逃生口应放行到宿主");
}

#[test]
fn traversal_rejected_403_without_forwarding() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/assets/../secret"));
    assert_eq!(response.status().as_u16(), 403);
    assert!(seen.lock().unwrap().is_empty(), "越界路径不得转发到宿主");
}

#[test]
fn disallowed_method_405_with_allow_header() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("PUT", "/api/session/create"));
    assert_eq!(response.status().as_u16(), 405);
    assert_eq!(header(&response, "allow").as_deref(), Some("GET, HEAD, POST"));
    assert!(seen.lock().unwrap().is_empty(), "越权方法不得转发到宿主");
}

#[test]
fn upstream_404_passes_through_with_body() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/assets/missing.js"));
    assert_eq!(response.status().as_u16(), 404);
    assert_eq!(body_text(&response), "asset missing");
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[test]
fn api_post_forwarded_with_cookie_and_without_browser_credentials() {
    let (port, seen) = fake_upstream();
    let mut request = req("POST", "/api/session/create");
    request
        .headers_mut()
        .insert("content-type", http::HeaderValue::from_static("application/json"));
    request
        .headers_mut()
        .insert("origin", http::HeaderValue::from_static("http://worldsea.localhost"));
    request
        .headers_mut()
        .insert("sec-fetch-site", http::HeaderValue::from_static("cross-site"));
    request
        .headers_mut()
        .insert("cookie", http::HeaderValue::from_static("page-cookie=leak"));
    *request.body_mut() = b"{\"rpcId\":\"1\"}".to_vec();

    let response = proxy(&cfg(port), &client(), &request);
    assert_eq!(response.status().as_u16(), 200);
    let seen = seen.lock().unwrap();
    let head = seen.first().expect("宿主未收到请求");
    assert!(head.contains("cookie: dsh-auth-x=v1.a.b"), "壳 cookie 未补：{head}");
    assert!(!head.contains("page-cookie"), "页面 cookie 不得透传：{head}");
    assert!(!head.to_lowercase().contains("origin:"), "Origin 不得透传（围栏）：{head}");
    assert!(!head.to_lowercase().contains("sec-fetch"), "Sec-Fetch-* 不得透传：{head}");
    assert!(head.contains(&format!("host: 127.0.0.1:{port}")), "Host 必须 = 宿主 authority：{head}");
}

#[test]
fn head_keeps_upstream_length_and_empty_body() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("HEAD", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert!(response.body().is_empty());
    assert_eq!(
        header(&response, "content-length").as_deref(),
        Some("console.log('asset')".len().to_string().as_str())
    );
}

#[test]
fn index_failure_returns_recognizable_html_page() {
    let response = proxy(&cfg(dead_port()), &client(), &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 502);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    let text = body_text(&response);
    assert!(text.contains("无法连接 Agent 内核"), "错误页应可辨认：{text}");
    // 子资源失败保持文本（不污染资源语义）
    let response = proxy(&cfg(dead_port()), &client(), &req("GET", "/assets/x.js"));
    assert_eq!(response.status().as_u16(), 502);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/plain; charset=utf-8"));
}

#[test]
fn injection_switches_gate_each_script_independently() {
    let (port, _seen) = fake_upstream();
    // 全开：三件套齐（transport / watchdog / bridge）
    let text = body_text(&proxy(&cfg(port), &client(), &req("GET", "/")));
    assert!(text.contains("worldsea-shell:transport"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
    assert!(text.contains("worldsea-shell:bridge"));
    // 摘 transport（C1-a 反证开关）：只少这一件
    let mut no_transport = cfg(port);
    no_transport.inject_transport = false;
    let text = body_text(&proxy(&no_transport, &client(), &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:transport"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
    assert!(text.contains("worldsea-shell:bridge"));
    // 摘壳桥（C1-c 反证开关）：设置入口必须显式降级（menu.rs 的缺桥提示由 JS 侧兜底）
    let mut no_bridge = cfg(port);
    no_bridge.inject_shell_bridge = false;
    let text = body_text(&proxy(&no_bridge, &client(), &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:bridge"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
}

#[test]
fn shell_bridge_script_wires_expected_commands() {
    // 注入脚本里的命令名必须与 Rust 侧注册一致（防止改名后静默失联）
    let (port, _seen) = fake_upstream();
    let text = body_text(&proxy(&cfg(port), &client(), &req("GET", "/")));
    for command in ["cmd_shell_bridge_report", "cmd_shell_open_external", "cmd_notify"] {
        assert!(text.contains(command), "壳桥缺少命令接线：{command}");
    }
    assert!(text.contains("__WORLDSEA_SHELL__"));
    assert!(text.contains("openSettings"));
    // 设置入口的定位依赖 aria-label（侧栏折叠态只剩图标；ui-settings-general 的触发按钮带该属性）
    assert!(text.contains("aria-label"), "壳桥必须按 aria-label 定位设置入口（折叠态）");
    assert!(text.contains("设置"), "壳桥需要中英文两套文案标签");
}

#[test]
fn sse_response_degrades_explicitly() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &client(), &req("GET", "/plugins/events"));
    assert_eq!(response.status().as_u16(), 502);
    assert!(body_text(&response).contains("text/event-stream"), "降级说明须点明原因");
}

#[test]
fn deny_path_hook_returns_404_without_forwarding() {
    let (port, seen) = fake_upstream();
    let mut hook = cfg(port);
    hook.deny_path = Some("/assets/".to_string());
    let response = proxy(&hook, &client(), &req("GET", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 404);
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn diagnostics_endpoint_is_env_gated() {
    let (port, seen) = fake_upstream();
    let mut request = req("POST", "/__diag");
    *request.body_mut() = b"warn: hello".to_vec();
    let off = proxy(&cfg(port), &client(), &request);
    assert_eq!(off.status().as_u16(), 404);
    let mut on = cfg(port);
    on.diag = true;
    let response = proxy(&on, &client(), &request);
    assert_eq!(response.status().as_u16(), 204);
    assert!(seen.lock().unwrap().is_empty(), "/__diag 不得转发到宿主");
}

#[test]
fn allowlist_covers_enumerated_host_routes() {
    // 枚举自 dsh 源码（2026-09-24，rc.1）：webServer.register 全部调用点 + connection.fetch.register
    // + frontend-static 兜底座的 dist 根文件。白名单若被收窄，本用例必须报红。
    for path in [
        "/plugins/events",
        "/plugins/@deepseek-ai/dsh-client-ui-chat/client.js",
        "/open-in-app/apps",
        "/open-in-app/icon/vscode",
        "/api/file",
        "/oauth/callback",
        "/assets/index-abc.js",
        "/preview.html",
        "/preview/index.html",
        "/manifest.webmanifest",
        "/favicon.svg",
        "/favicon-dark.svg",
        "/index.html",
        "/",
    ] {
        assert!(path_allowed(path, false), "白名单缺路由：{path}");
    }
    // 反面：不在枚举清单里的路径不得放行
    assert!(!path_allowed("/open-in-app-old/apps", false));
    assert!(!path_allowed("/desktop-smoke", false));
}

#[test]
fn guard_helpers_are_pure_and_total() {
    assert!(path_allowed("/", false));
    assert!(path_allowed("/index.html", false));
    assert!(path_allowed("/assets/x.js", false));
    assert!(path_allowed("/plugins/x/client.js", false));
    assert!(path_allowed("/api/session/create", false));
    assert!(path_allowed("/anything", true));
    assert!(!path_allowed("/etc/passwd", false));
    assert!(path_allowed("/preview.html", false));
    assert!(path_allowed("/preview/index.html", false));

    assert!(has_traversal("/a/../b"));
    assert!(has_traversal("/./a"));
    assert!(!has_traversal("/a.b/c"));
    assert!(!has_traversal("/a-b/c"));

    assert!(method_allowed("GET") && method_allowed("HEAD") && method_allowed("POST"));
    assert!(!method_allowed("PUT") && !method_allowed("DELETE") && !method_allowed("OPTIONS"));

    assert!(needs_no_store("/"));
    assert!(needs_no_store("/index.html"));
    assert!(needs_no_store("/plugins/x/client.js"));
    assert!(!needs_no_store("/assets/x.js"));
    assert!(!needs_no_store("/api/x"));
}
