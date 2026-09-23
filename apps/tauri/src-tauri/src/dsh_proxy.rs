// C1-b（2026-09-24）：协议转发核心——路径/方法闸门、缓存策略、index 插桩、失败降级。
// 从 dsh_bridge.rs 拆出（它留桥状态与装配）：本文件只管「一次请求怎么转发、什么时候不转发」。
//
// 口径（见 docs/plans/2026-09-24-C1-Tauri原生desktop载体批计划.md §五 C1-b）：
// - 闸门在壳侧先过一遍（白名单 404 / 越权 405 / 越界 403），宿主自己仍会按其静态伺服语义再判一次；
// - MIME 与静态伺服语义由**宿主**负责（index 走 frontend-static 的 fallback 座），壳只透传 content-type；
// - index 与 /plugins/* 强制 `no-store`（每进程内容，见 C1-a 事实 12）；
// - index 取宿主渲染结果 → **零注入复刻**，壳只在 `<head>` 后补注入脚本（顺序契约见 inject_shell_scripts）；
// - 入口级失败（桥未就绪 / 转发失败）给**HTML 错误页**；子资源失败保留宿主状态码并落档。

/// 一次转发的目标与开关（由 DshBridge 组装；测试可直接构造）。
pub(crate) struct ProxyCfg {
    pub host_port: u16,
    pub cookie: String,
    /// 注入给页面的传输基址（= WS 中转的 `http://127.0.0.1:<port>/<随机前缀>/`）
    pub relay_base: String,
    /// 反证开关：`WORLDSEA_NO_TRANSPORT_INJECT=1` 时不注入 streamBaseUrl
    pub inject_transport: bool,
    /// 诊断开关：`WORLDSEA_SHELL_DIAG=1`
    pub diag: bool,
    /// 测试钩子：命中该前缀直接 404（验「资源失败 → 非白屏」降级链）
    pub deny_path: Option<String>,
    /// 逃生口：`WORLDSEA_BRIDGE_OPEN=1` 关闭路径白名单（白名单误伤时的退路）
    pub open_paths: bool,
}

/// 允许的方法：协议面只服务页面自用（读 + RPC 的 POST 写）。其余一律 405。
const ALLOWED_METHODS: [&str; 3] = ["GET", "HEAD", "POST"];

/// 路径白名单前缀（`/` 与 `/index.html` 另按精确匹配放行）。
/// 清单**枚举自 dsh 源码**的全部注册路由 + dist 根内文件：
/// - `webServer.register`：`/plugins`（前缀，模块包 + `/plugins/events` HMR 事件）、`/open-in-app/apps`（精确）、
///   `/open-in-app/icon`（前缀）、`/oauth/callback`（账户 OAuth 回调）；
/// - `connection.fetch.register`：`/api/file`（落在 `/api` 下）；
/// - `frontend-static` 兜底座：dist 根的 `assets/`、`favicon*.svg`、`manifest.webmanifest`、`preview*`、index。
/// 新增宿主路由时的动作：加进本表 + 补 `allowlist_covers_enumerated_host_routes` 用例；
/// 漏掉会在壳日志留 `404（路径白名单外）` 行，可用 `WORLDSEA_BRIDGE_OPEN=1` 先放行排查。
const ALLOWED_PREFIXES: [&str; 8] = [
    "/assets/",
    "/plugins/",
    "/api/",
    "/favicon",
    "/manifest.webmanifest",
    "/preview",
    "/open-in-app/",
    "/oauth/callback",
];

/// 不转发给页面的响应头：`set-cookie` 会把宿主凭据塞进页面 cookie jar（壳自己持有即可），
/// 其余是 hop-by-hop / 编码类头（转发体已由壳侧解码为明文）。
const WITHHELD_RESPONSE_HEADERS: [&str; 10] = [
    "set-cookie",
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "te",
    "trailer",
    "upgrade",
    "proxy-authenticate",
];

/// 转发时**透传**的请求头（白名单制：其余一概不带，避免把页面的 origin/凭据类语义带进宿主）。
const PASSABLE_REQUEST_HEADERS: [&str; 5] = [
    "content-type",
    "accept",
    "range",
    "if-none-match",
    "if-modified-since",
];

/// 路径是否在白名单内（`open` = 逃生口放行全部）。
pub(crate) fn path_allowed(path_only: &str, open: bool) -> bool {
    if open {
        return true;
    }
    if path_only == "/" || path_only == "/index.html" {
        return true;
    }
    ALLOWED_PREFIXES.iter().any(|prefix| path_only.starts_with(prefix))
}

/// 路径是否含越界段（`.` / `..`；percent 编码形态由宿主侧 URL 归一化负责，壳这里挡明文）。
pub(crate) fn has_traversal(path_only: &str) -> bool {
    path_only.split('/').any(|segment| segment == "." || segment == "..")
}

/// 需要强制 no-store 的路径：index（含每进程注入）与 /plugins/*（按启动修订命名）。
pub(crate) fn needs_no_store(path_only: &str) -> bool {
    path_only == "/" || path_only == "/index.html" || path_only.starts_with("/plugins/")
}

/// 方法是否允许。
pub(crate) fn method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.contains(&method)
}

/// 转发一次请求：闸门 → 目标 = 宿主 loopback + 原 path/query（补 cookie）→ index 注入 → 响应回写。
pub(crate) fn proxy(
    cfg: &ProxyCfg,
    client: &reqwest::blocking::Client,
    request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .to_string();
    let path_only = path_and_query.split('?').next().unwrap_or("/").to_string();
    let method = request.method().as_str().to_string();
    let is_api = path_only.starts_with("/api/");
    let is_index = path_only == "/" || path_only == "/index.html";
    let no_store = needs_no_store(&path_only);

    // 页内诊断（env 门控）：页面 console 钩子把错误 POST 到 /__diag，这里落档
    if path_only == "/__diag" {
        if !cfg.diag {
            return failure_response(404, false, "diag disabled", "WORLDSEA_SHELL_DIAG 未开");
        }
        let text = String::from_utf8_lossy(request.body());
        let text: String = text.chars().take(600).collect();
        println!("[DSH-SHELL] page(diag): {text}");
        return http::Response::builder()
            .status(204)
            .header("cache-control", "no-store")
            .body(Vec::new())
            .expect("diag response");
    }

    // ── 闸门（壳侧先判；宿主仍会按自己的语义再判一次）────────────────────────
    if !method_allowed(&method) {
        return with_allow_header(failure_response(
            405,
            is_index,
            "方法不被允许",
            &format!("{method} {path_only}；允许 GET/HEAD/POST"),
        ));
    }
    if has_traversal(&path_only) {
        return failure_response(403, is_index, "路径越界", &format!("拒绝含 `.`/`..` 段的路径：{path_only}"));
    }
    if let Some(deny) = &cfg.deny_path {
        if path_only.starts_with(deny.as_str()) {
            eprintln!("[DSH-SHELL] bridge: {method} {path_and_query} → 404（WORLDSEA_DENY_PATH 测试钩子）");
            return failure_response(404, is_index, "资源被测试钩子拒绝", deny);
        }
    }
    if !path_allowed(&path_only, cfg.open_paths) {
        eprintln!("[DSH-SHELL] bridge: {method} {path_and_query} → 404（路径白名单外；WORLDSEA_BRIDGE_OPEN=1 可放行）");
        return failure_response(404, is_index, "路径不在壳白名单内", &path_only);
    }

    // ── 转发 ───────────────────────────────────────────────────────────────
    let target = format!("http://127.0.0.1:{}{}", cfg.host_port, path_and_query);
    let http_method = reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
    let mut outbound = client
        .request(http_method, &target)
        .header(reqwest::header::COOKIE, &cfg.cookie)
        // 让宿主不做响应压缩：转发体保持明文，页面侧不出现 content-encoding
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in request.headers() {
        let lower = name.as_str().to_ascii_lowercase();
        if PASSABLE_REQUEST_HEADERS.contains(&lower.as_str()) {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                outbound = outbound.header(lower.as_str(), v);
            }
        }
    }
    if !request.body().is_empty() {
        outbound = outbound.body(request.body().clone());
    }

    let response = match outbound.send() {
        Ok(response) => response,
        Err(e) => {
            eprintln!("[DSH-SHELL] bridge: {method} {path_and_query} → 502（转发失败：{e}）");
            return failure_response(502, is_index, "无法连接 Agent 内核", &format!("转发到宿主失败：{e}"));
        }
    };
    let status = response.status().as_u16();
    // 壳协议的应答是**缓冲体**（Tauri `UriSchemeResponder` 无流式通道）→ SSE 类长连响应无法透传。
    // 明确降级并落档（典型：HMR 的 `/plugins/events`；壳侧已在 `apps/tauri/dsh-overlay.yml` 关掉 client-hmr）。
    if response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim_start().to_ascii_lowercase().starts_with("text/event-stream"))
    {
        eprintln!(
            "[DSH-SHELL] bridge: {method} {path_and_query} → 502（流式响应 text/event-stream：壳协议不支持流式透传）"
        );
        return failure_response(
            502,
            is_index,
            "流式响应不受支持",
            "壳协议（worldsea://）的应答是缓冲体，无法透传 text/event-stream（SSE）。",
        );
    }
    let mut upstream_length: Option<String> = None;
    let mut builder = http::Response::builder().status(status);
    for (name, value) in response.headers() {
        let lower = name.as_str().to_ascii_lowercase();
        if lower == "content-length" {
            upstream_length = value.to_str().ok().map(str::to_string);
            continue;
        }
        if WITHHELD_RESPONSE_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        // 壳要改写缓存语义时，丢弃宿主自己的 cache-control（避免出现两个同名头）
        if no_store && lower == "cache-control" {
            continue;
        }
        if let Ok(header) = http::HeaderValue::from_bytes(value.as_bytes()) {
            builder = builder.header(lower.as_str(), header);
        }
    }

    let mut body = match response.bytes() {
        Ok(bytes) => bytes.to_vec(),
        Err(e) => {
            eprintln!("[DSH-SHELL] bridge: {method} {path_and_query} → 502（读取响应失败：{e}）");
            return failure_response(502, is_index, "读取内核响应失败", &e.to_string());
        }
    };
    let injected = is_index && cfg.inject_transport;
    if injected {
        let text = String::from_utf8_lossy(&body).to_string();
        body = inject_shell_scripts(&text, &cfg.relay_base, cfg.diag).into_bytes();
    }

    if no_store {
        builder = builder.header("cache-control", "no-store");
    }
    if method == "HEAD" {
        // HEAD 无体：沿用宿主声明的长度（页面侧据此判尺寸）
        if let Some(length) = upstream_length {
            builder = builder.header("content-length", length);
        }
    } else {
        builder = builder.header("content-length", body.len().to_string());
    }

    if is_api || is_index || no_store || status >= 400 {
        println!(
            "[DSH-SHELL] bridge: {method} {path_and_query} → {status}{}",
            if injected { format!("（注入壳脚本；{}B）", body.len()) } else { String::new() }
        );
    }

    builder
        .body(body)
        .unwrap_or_else(|e| failure_response(500, is_index, "构造响应失败", &e.to_string()))
}

/// 注入壳脚本（**只合并不覆盖**）：先 `__DSH_TRANSPORT__`（裁定 ④ 的传输基址单点），再「不白屏」安全网。
///
/// **顺序契约**（C1-b 成文）：宿主渲染的 index 里，`<base href="./">` 与 `__DSH_BOOT__` 等行紧跟 `<head>`；
/// 壳在本函数里把脚本插到**同一个位置的最前**（即 `<head>` 之后、所有宿主行与模块脚本之前），
/// 因此：① `__DSH_TRANSPORT__` 必在客户端 `apply()` 读它之前就位；② 宿主注入行原样保留、顺序不变；
/// ③ `__DSH_BOOT_READY__`（宿主尾行）壳不碰。三条都有 tests 锁定。
pub(crate) fn inject_shell_scripts(html: &str, base_url: &str, diag: bool) -> String {
    let mut scripts = format!(
        "<script>/* worldsea-shell:transport */globalThis.__DSH_TRANSPORT__ = Object.assign({{}}, globalThis.__DSH_TRANSPORT__, {{ ownsHost: true, streamBaseUrl: \"{base_url}\" }})</script>"
    );
    scripts.push_str("<script>");
    scripts.push_str(WATCHDOG_SCRIPT);
    scripts.push_str("</script>");
    if diag {
        scripts.push_str("<script>");
        scripts.push_str(DIAG_SCRIPT);
        scripts.push_str("</script>");
    }
    match find_head_end(html) {
        Some(at) => format!("{}{}{}", &html[..at], scripts, &html[at..]),
        None => format!("{scripts}{html}"),
    }
}

/// 入口级失败响应：index 给 HTML 错误页（可辨认、非白屏），其余给极简文本（不污染资源语义）。
pub(crate) fn failure_response(status: u16, wants_html: bool, title: &str, detail: &str) -> http::Response<Vec<u8>> {
    let (content_type, body) = if wants_html {
        let html = format!(
            "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>WorldSea</title></head>\
<body style=\"margin:0;padding:32px;font-family:'Segoe UI','Microsoft YaHei',system-ui;background:#111113;color:#e4e4e7\">\
<h1 style=\"font-size:18px;margin:0 0 12px\">{}</h1>\
<pre style=\"white-space:pre-wrap;word-break:break-word;color:#a1a1aa;font-size:13px;line-height:1.6\">{}</pre>\
</body></html>",
            escape_html(title),
            escape_html(detail)
        );
        ("text/html; charset=utf-8", html.into_bytes())
    } else {
        ("text/plain; charset=utf-8", detail.as_bytes().to_vec())
    };
    http::Response::builder()
        .status(status)
        .header("content-type", content_type)
        .header("cache-control", "no-store")
        .body(body)
        .expect("failure response")
}

/// 给 405 响应补 `allow`（HTTP 语义要求）。
fn with_allow_header(mut response: http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
    response
        .headers_mut()
        .insert("allow", http::HeaderValue::from_static("GET, HEAD, POST"));
    response
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// `<head …>` 开标签结束位置（大小写不敏感）；`to_ascii_lowercase` 不改字节长度，索引可直接复用。
fn find_head_end(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<head")?;
    let after_name = &lower[start + 5..];
    let is_tag = after_name.starts_with('>') || after_name.starts_with(char::is_whitespace);
    if !is_tag {
        return None;
    }
    let end = after_name.find('>')?;
    Some(start + 5 + end + 1)
}

/// 「不白屏」安全网（常驻）：入口脚本失败或长时间无渲染时就地出示错误页。
const WATCHDOG_SCRIPT: &str = include_str!("dsh_watchdog.js");
/// 页内诊断（`WORLDSEA_SHELL_DIAG=1` 才注入）：console/异常/资源错误 → 壳日志。
const DIAG_SCRIPT: &str = include_str!("dsh_diag.js");

#[cfg(test)]
#[path = "dsh_proxy_tests.rs"]
mod tests;
