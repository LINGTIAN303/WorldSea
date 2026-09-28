// dsh_proxy 的测试（假上游整链 + 闸门纯函数）。路径含 tests → arch:check 走 1200 行档。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use crate::dsh_inject::TransportInject;
use crate::dsh_pipe::test_host::{self, Reply, SeenRequest};

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
        upstream: Upstream::Tcp {
            port: host_port,
            cookie: "dsh-auth-x=v1.a.b".to_string(),
            client: client(),
        },
        transport: TransportInject::StreamBase("http://127.0.0.1:9/dead-secret/".to_string()),
        inject_shell_bridge: true,
        titlebar: true,
        diag: false,
        capabilities: true,
        deny_path: None,
        open_paths: false,
        workspace_notice: None,
    }
}

/// 管道模式的 cfg：假管道宿主当上游（哑 TCP 对），核装配走 OpenStream 注入面。
/// 返回（配置, 假宿主柄, 客户端）——客户端供「断链后等存活翻转」这类断言使用。
fn pipe_cfg(
    respond: Arc<dyn Fn(&SeenRequest) -> Reply + Send + Sync>,
) -> (ProxyCfg, FakeHostHandles, std::sync::Arc<crate::dsh_pipe::PipeClient>) {
    let host = test_host::spawn(respond);
    let handles = FakeHostHandles { seen: host.seen.clone(), closer: host.closer.try_clone().unwrap() };
    let client = std::sync::Arc::new(
        crate::dsh_pipe::PipeClient::over_streams_for_tests(host.reader, host.writer).expect("假宿主握手应成功"),
    );
    (
        ProxyCfg {
            upstream: Upstream::Pipe { client: client.clone(), cookie: "dsh-auth-x=v1.a.b".to_string() },
            transport: TransportInject::OpenStream,
            inject_shell_bridge: true,
            titlebar: true,
            diag: false,
            capabilities: true,
            deny_path: None,
            open_paths: false,
            workspace_notice: None,
        },
        handles,
        client,
    )
}

struct FakeHostHandles {
    seen: Arc<Mutex<Vec<SeenRequest>>>,
    closer: TcpStream,
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
    let response = proxy(&cfg(port), &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
    let text = body_text(&response);
    let transport = text.find("worldsea-shell:transport").expect("缺传输注入");
    let base = text.find("<base href=\"./\">").expect("宿主 <base> 丢了");
    // 针取**宿主行专属串**（不是裸键名）：A 批（能力伺服）起，壳注入脚本也会提到同一键名，
    // 裸针会被提前命中 → 顺序断言假红（2026-09-25 实测踩到）。
    let boot = text.find(r#"globalThis["__DSH_BOOT__"]=[]"#).expect("宿主 head 行丢了");
    let ready = text.find("__DSH_BOOT_READY__ ??= Promise.withResolvers()").expect("宿主尾行丢了");
    // 顺序契约：壳脚本 → 宿主 <base> → 宿主 head 行 → 宿主尾行（原样保留且相对顺序不变）
    assert!(transport < base, "壳脚本必须先于宿主 <base>：{text}");
    assert!(base < boot, "宿主行顺序被破坏：{text}");
    assert!(boot < ready, "宿主行顺序被破坏：{text}");
    assert!(text.contains("streamBaseUrl: \"http://127.0.0.1:9/dead-secret/\""));
    assert!(text.contains("worldsea-shell:boot-watchdog"), "安全网必须常驻注入");
}

/// C4-b：工作区不可供给时 index 带出横幅脚本与文案；可供给（None）时不带。
#[test]
fn index_carries_workspace_notice_only_when_warned() {
    let (port, _seen) = fake_upstream();
    let plain = body_text(&proxy(&cfg(port), &req("GET", "/")));
    assert!(!plain.contains("worldsea-shell:workspace-notice"), "可供给不应注入横幅");

    let mut warned = cfg(port);
    warned.workspace_notice = Some(r"工作区不可供给：D:\A（修复：icacls ...）".to_string());
    let text = body_text(&proxy(&warned, &req("GET", "/")));
    assert!(text.contains("worldsea-shell:workspace-notice"), "缺横幅注入：{text}");
    assert!(text.contains("__WORLDSEA_WORKSPACE_NOTICE__"), "缺文案赋值：{text}");
    assert!(text.contains(r"D:\\A"), "文案未按 JSON 转义带入：{text}");
    assert!(text.contains("cmd_fix_workspace_acl"), "横幅脚本应带修复入口");
}

#[test]
fn asset_passthrough_keeps_upstream_cache_and_untouched_body() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("GET", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("max-age=600"));
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/javascript; charset=utf-8"));
    assert_eq!(body_text(&response), "console.log('asset')");
}

#[test]
fn plugin_bundle_forced_no_store() {
    let (port, _seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("GET", "/plugins/ui-chat/client.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
}

#[test]
fn unknown_prefix_rejected_by_allowlist_without_forwarding() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("GET", "/etc/passwd"));
    assert_eq!(response.status().as_u16(), 404);
    assert!(seen.lock().unwrap().is_empty(), "白名单外路径不得转发到宿主");
    // 同名路径在逃生口下会转发
    let mut open = cfg(port);
    open.open_paths = true;
    let response = proxy(&open, &req("GET", "/etc/passwd"));
    assert_eq!(response.status().as_u16(), 404); // 宿主自己的 404
    assert_eq!(seen.lock().unwrap().len(), 1, "逃生口应放行到宿主");
}

#[test]
fn traversal_rejected_403_without_forwarding() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("GET", "/assets/../secret"));
    assert_eq!(response.status().as_u16(), 403);
    assert!(seen.lock().unwrap().is_empty(), "越界路径不得转发到宿主");
}

#[test]
fn disallowed_method_405_with_allow_header() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("PUT", "/api/session/create"));
    assert_eq!(response.status().as_u16(), 405);
    assert_eq!(header(&response, "allow").as_deref(), Some("GET, HEAD, POST"));
    assert!(seen.lock().unwrap().is_empty(), "越权方法不得转发到宿主");
}

#[test]
fn upstream_404_passes_through_with_body() {
    let (port, seen) = fake_upstream();
    let response = proxy(&cfg(port), &req("GET", "/assets/missing.js"));
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

    let response = proxy(&cfg(port), &request);
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
    let response = proxy(&cfg(port), &req("HEAD", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert!(response.body().is_empty());
    assert_eq!(
        header(&response, "content-length").as_deref(),
        Some("console.log('asset')".len().to_string().as_str())
    );
}

#[test]
fn index_failure_returns_recognizable_html_page() {
    let response = proxy(&cfg(dead_port()), &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 502);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    let text = body_text(&response);
    assert!(text.contains("无法连接 Agent 内核"), "错误页应可辨认：{text}");
    // 子资源失败保持文本（不污染资源语义）
    let response = proxy(&cfg(dead_port()), &req("GET", "/assets/x.js"));
    assert_eq!(response.status().as_u16(), 502);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/plain; charset=utf-8"));
}

#[test]
fn injection_switches_gate_each_script_independently() {
    let (port, _seen) = fake_upstream();
    // 全开：四件套齐（transport / watchdog / bridge / titlebar）
    let text = body_text(&proxy(&cfg(port), &req("GET", "/")));
    assert!(text.contains("worldsea-shell:transport"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
    assert!(text.contains("worldsea-shell:bridge"));
    assert!(text.contains("worldsea-shell:titlebar"));
    // 摘 transport（C1-a 反证开关 / C2 沿用）：只少这一件
    let mut no_transport = cfg(port);
    no_transport.transport = TransportInject::None;
    let text = body_text(&proxy(&no_transport, &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:transport"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
    assert!(text.contains("worldsea-shell:bridge"));
    // 摘壳桥（C1-c 反证开关）：设置入口必须显式降级（menu.rs 的缺桥提示由 JS 侧兜底）
    let mut no_bridge = cfg(port);
    no_bridge.inject_shell_bridge = false;
    let text = body_text(&proxy(&no_bridge, &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:bridge"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
    // 摘窗口栏（C6 反证开关 WORLDSEA_NO_TITLEBAR / WORLDSEA_FRAMED）：只少这一件
    let mut no_titlebar = cfg(port);
    no_titlebar.titlebar = false;
    let text = body_text(&proxy(&no_titlebar, &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:titlebar"));
    assert!(text.contains("worldsea-shell:bridge"));
    assert!(text.contains("worldsea-shell:boot-watchdog"));
}

#[test]
fn titlebar_script_wires_expected_commands_and_contract() {
    // C6→D1-b：窗口栏脚本的命令接线必须与 Rust 侧注册一致；dsh 适配标记与空间切换接线缺一不可
    let (port, _seen) = fake_upstream();
    let text = body_text(&proxy(&cfg(port), &req("GET", "/")));
    for command in ["cmd_shell_window_action", "cmd_shell_popup_menu", "cmd_shell_space_switch"] {
        assert!(text.contains(command), "窗口栏缺少命令接线：{command}");
    }
    assert!(text.contains("data-windows-titlebar"), "窗口栏必须置 dsh 的 Windows 形态标记（留白/圆角/连色）");
    assert!(text.contains("--dsh-windows-titlebar-height"), "窗口栏高度须经 dsh 变量驱动");
    // G1：全屏桥——F11 走的壳命令臂与 dsh 的全屏形态标记缺一不可（缺则全屏时浮层仍内缩 52px）。
    // 断言打到**调用形状**而非裸字面量：脚本头注也提到这两个词，裸 contains 会被注释满足而恒绿。
    assert!(text.contains("windowAction('toggle-fullscreen')"), "窗口栏缺少全屏切换动作接线（G1）");
    assert!(text.contains("setAttribute('data-fullscreen'"), "窗口栏必须桥接 dsh 的全屏形态标记（G1）");
    assert!(text.contains("Agent 空间"), "窗口栏切换控件文案缺位");
    // D1-b：切换不再走页内占位页（工作台是独立窗口）——旧占位页字符串必须消失
    assert!(!text.contains("worldsea-workbench"), "页内占位页应已退役（D1-b 双窗）");
    // 反证：关掉后整段脚本不存在
    let mut off = cfg(port);
    off.titlebar = false;
    let text = body_text(&proxy(&off, &req("GET", "/")));
    assert!(!text.contains("worldsea-shell:titlebar"));
    assert!(!text.contains("cmd_shell_space_switch"));
}

#[test]
fn shell_bridge_script_wires_expected_commands() {
    // 注入脚本里的命令名必须与 Rust 侧注册一致（防止改名后静默失联）
    let (port, _seen) = fake_upstream();
    let text = body_text(&proxy(&cfg(port), &req("GET", "/")));
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
    let response = proxy(&cfg(port), &req("GET", "/plugins/events"));
    assert_eq!(response.status().as_u16(), 502);
    assert!(body_text(&response).contains("text/event-stream"), "降级说明须点明原因");
}

#[test]
fn deny_path_hook_returns_404_without_forwarding() {
    let (port, seen) = fake_upstream();
    let mut hook = cfg(port);
    hook.deny_path = Some("/assets/".to_string());
    let response = proxy(&hook, &req("GET", "/assets/index-abc.js"));
    assert_eq!(response.status().as_u16(), 404);
    assert!(seen.lock().unwrap().is_empty());
}

#[test]
fn diagnostics_endpoint_is_env_gated() {
    let (port, seen) = fake_upstream();
    let mut request = req("POST", "/__diag");
    *request.body_mut() = b"warn: hello".to_vec();
    let off = proxy(&cfg(port), &request);
    assert_eq!(off.status().as_u16(), 404);
    let mut on = cfg(port);
    on.diag = true;
    let response = proxy(&on, &request);
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

// ── C2-b：管道上游（零 TCP）的转发语义 —— 与 TCP 路径同构，另验注入面与失败降级 ──

#[test]
fn pipe_index_injects_stream_hook_and_transport_line() {
    let (cfg, _handles, _client) = pipe_cfg(Arc::new(|_request| Reply::Unary {
        status: 200,
        headers: vec![("content-type".to_string(), "text/html; charset=utf-8".to_string())],
        body: RENDERED_INDEX.as_bytes().to_vec(),
    }));
    let response = proxy(&cfg, &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("no-store"));
    let text = body_text(&response);
    let stream = text.find("worldsea-shell:stream").expect("缺流桥注入");
    let transport = text.find("worldsea-shell:transport").expect("缺传输注入");
    let base = text.find("<base href=\"./\">").expect("宿主 <base> 丢了");
    // 顺序契约：流桥 → transport 行 → 宿主 <base> → 宿主行
    assert!(stream < transport, "流桥必须先于 transport 行（transport 行取 openStream）：{text}");
    assert!(transport < base, "壳脚本必须先于宿主 <base>：{text}");
    assert!(text.contains("__WORLDSEA_STREAM__"), "缺流桥全局");
    assert!(text.contains("openStream: globalThis.__WORLDSEA_STREAM__.openStream"), "缺 openStream 合入");
    assert!(!text.contains("streamBaseUrl"), "管道模式不得再注入 streamBaseUrl");
}

#[test]
fn pipe_asset_passthrough_and_credentials_recipe() {
    let (cfg, handles, _client) = pipe_cfg(Arc::new(|_request| Reply::Unary {
        status: 200,
        headers: vec![
            ("content-type".to_string(), "text/javascript; charset=utf-8".to_string()),
            ("cache-control".to_string(), "max-age=600".to_string()),
        ],
        body: b"console.log('asset')".to_vec(),
    }));
    let mut request = req("GET", "/assets/index-abc.js");
    request.headers_mut().insert("cookie", http::HeaderValue::from_static("page-cookie=leak"));
    request.headers_mut().insert("origin", http::HeaderValue::from_static("http://worldsea.localhost"));
    request.headers_mut().insert("accept", http::HeaderValue::from_static("*/*"));
    let response = proxy(&cfg, &request);
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(header(&response, "cache-control").as_deref(), Some("max-age=600"));
    assert_eq!(body_text(&response), "console.log('asset')");
    let seen = handles.seen.lock().unwrap();
    let request = seen.first().expect("假管道宿主未收到请求");
    assert_eq!(request.method, "GET");
    assert_eq!(request.url, "/assets/index-abc.js");
    assert_eq!(request.headers.get("host").map(String::as_str), Some("127.0.0.1"));
    assert_eq!(request.headers.get("cookie").map(String::as_str), Some("dsh-auth-x=v1.a.b"), "壳 cookie 未补");
    assert!(request.headers.get("accept").is_some(), "可透传头应保留");
    assert!(!request.headers.contains_key("origin"), "Origin 不得透传（围栏）");
}

#[test]
fn pipe_upstream_failure_degrades_to_error_page() {
    let (cfg, handles, client) = pipe_cfg(Arc::new(|_request| Reply::Unary {
        status: 200,
        headers: Vec::new(),
        body: Vec::new(),
    }));
    // 宿主断开 → 等客户端感知（存活翻转）→ 请求显式失败 → 入口给 HTML 错误页（非白屏）
    let _ = handles.closer.shutdown(std::net::Shutdown::Both);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while client.is_alive() {
        assert!(std::time::Instant::now() < deadline, "断链未在限时内被客户端感知");
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let response = proxy(&cfg, &req("GET", "/"));
    assert_eq!(response.status().as_u16(), 502);
    assert_eq!(header(&response, "content-type").as_deref(), Some("text/html; charset=utf-8"));
    assert!(body_text(&response).contains("无法连接 Agent 内核"));
}

#[test]
fn pipe_streaming_response_assembles_chunks() {
    let (cfg, _handles, _client) = pipe_cfg(Arc::new(|_request| Reply::Streamed {
        status: 200,
        headers: vec![("content-type".to_string(), "text/plain; charset=utf-8".to_string())],
        chunks: vec![b"part1;".to_vec(), b"part2;".to_vec(), b"part3".to_vec()],
    }));
    let response = proxy(&cfg, &req("GET", "/assets/streamed.js"));
    assert_eq!(response.status().as_u16(), 200);
    assert_eq!(body_text(&response), "part1;part2;part3");
}

#[test]
fn pipe_sse_response_degrades_explicitly() {
    let (cfg, _handles, _client) = pipe_cfg(Arc::new(|_request| Reply::Streamed {
        status: 200,
        headers: vec![("content-type".to_string(), "text/event-stream".to_string())],
        chunks: vec![b"data: x\n\n".to_vec()],
    }));
    let response = proxy(&cfg, &req("GET", "/plugins/events"));
    assert_eq!(response.status().as_u16(), 502);
    assert!(body_text(&response).contains("text/event-stream"));
}
