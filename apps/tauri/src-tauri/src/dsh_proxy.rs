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
    /// 上游传输面：C2 默认 IPC 管道（零 TCP）；legacy TCP 为 `WORLDSEA_TCP_HOST=1` 对照口。
    pub upstream: Upstream,
    /// 注入页面的传输写法（互斥三态；见 [`TransportInject`]）。
    pub transport: TransportInject,
    /// 反证开关：`WORLDSEA_NO_SHELL_BRIDGE=1` 时不注入壳桥（`__WORLDSEA_SHELL__`；
    /// 依赖它的「打开设置」必须显式降级，见 menu.rs 的缺桥提示）
    pub inject_shell_bridge: bool,
    /// C6：无边框窗口栏注入（`WORLDSEA_NO_TITLEBAR=1` 反证关；`WORLDSEA_FRAMED=1` 原生边框态亦关）
    pub titlebar: bool,
    /// 诊断开关：`WORLDSEA_SHELL_DIAG=1`
    pub diag: bool,
    /// 测试钩子：命中该前缀直接 404（验「资源失败 → 非白屏」降级链）
    pub deny_path: Option<String>,
    /// 逃生口：`WORLDSEA_BRIDGE_OPEN=1` 关闭路径白名单（白名单误伤时的退路）
    pub open_paths: bool,
    /// C4-b：工作区不可供给时的横幅文案（`None` = 可供给或已按 `WORLDSEA_NO_WORKSPACE_NOTICE=1` 关闭）
    pub workspace_notice: Option<String>,
}

/// 上游传输面（两种形态产出同构的「状态 / 头 / 体」）。
pub(crate) enum Upstream {
    /// C1 现役形态（legacy 对照口，冻结）：loopback TCP + 壳 cookie。
    Tcp { port: u16, cookie: String, client: reqwest::blocking::Client },
    /// C2 默认：IPC 管道（cookie 同样由壳持有；`Host` 由管道客户端合成 `127.0.0.1`）。
    Pipe { client: std::sync::Arc<crate::dsh_pipe::PipeClient>, cookie: String },
}

use crate::dsh_inject::{inject_shell_scripts, TransportInject};

/// 一次上游响应（体已在壳内缓冲——协议应答本身是缓冲体）。
struct UpstreamAnswer {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    /// `text/event-stream`（壳协议不支持流式透传，调用方显式降级）。
    sse: bool,
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

/// C3-c：index 响应的 CSP 最小子集（三条「页面根本不用」的指令；其余面见 C3 批计划 §八 取证清单）。
/// D1-a 起工作台页（`/workspace`）同口径复用——两处 index 的安全头单点定义在本文。
pub(crate) const CSP_INDEX: &str = "object-src 'none'; base-uri 'self'; form-action 'none'";

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

/// 转发一次请求：闸门 → 取上游（管道/TCP 同构）→ index 注入 → 响应回写。
pub(crate) fn proxy(cfg: &ProxyCfg, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
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

    // ── 转发（透传白名单制的请求头；页面的 origin/凭据语义一律不带）────────────
    let pass_headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            let lower = name.as_str().to_ascii_lowercase();
            if !PASSABLE_REQUEST_HEADERS.contains(&lower.as_str()) {
                return None;
            }
            value.to_str().ok().map(|text| (lower, text.to_string()))
        })
        .collect();
    let answer = match fetch_upstream(cfg, &method, &path_and_query, &pass_headers, request.body()) {
        Ok(answer) => answer,
        Err(e) => {
            eprintln!("[DSH-SHELL] bridge: {method} {path_and_query} → 502（转发失败：{e}）");
            return failure_response(502, is_index, "无法连接 Agent 内核", &format!("转发到宿主失败：{e}"));
        }
    };
    let status = answer.status;
    // 壳协议的应答是**缓冲体**（Tauri `UriSchemeResponder` 无流式通道）→ SSE 类长连响应无法透传。
    // 明确降级并落档（典型：HMR 的 `/plugins/events`；壳侧已在 `apps/tauri/dsh-overlay.yml` 关掉 client-hmr）。
    if answer.sse {
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
    for (name, value) in &answer.headers {
        let lower = name.as_str();
        if lower == "content-length" {
            upstream_length = Some(value.clone());
            continue;
        }
        if WITHHELD_RESPONSE_HEADERS.contains(&lower) {
            continue;
        }
        // 壳要改写缓存语义时，丢弃宿主自己的 cache-control（避免出现两个同名头）
        if no_store && lower == "cache-control" {
            continue;
        }
        if let Ok(header) = http::HeaderValue::from_bytes(value.as_bytes()) {
            builder = builder.header(lower, header);
        }
    }

    let mut body = answer.body;
    let injected = is_index && cfg.transport.wants_scripts();
    if is_index
        && (cfg.transport.wants_scripts()
            || cfg.inject_shell_bridge
            || cfg.titlebar
            || cfg.diag
            || cfg.workspace_notice.is_some())
    {
        let text = String::from_utf8_lossy(&body).to_string();
        body = inject_shell_scripts(
            &text,
            &cfg.transport,
            cfg.inject_shell_bridge,
            cfg.titlebar,
            cfg.diag,
            cfg.workspace_notice.as_deref(),
        )
        .into_bytes();
    }

    if no_store {
        builder = builder.header("cache-control", "no-store");
    }
    // C3-c（2026-09-24）：CSP 最小子集——只下「页面根本不用」的三条指令（无插件对象嵌入、
    // 不改写 base 源、无表单提交），其余面（script/style/connect/frame/img）待取证清单另议（C3 批计划 §八）。
    // 头由壳加（页面由壳协议伺服）：实测核对见 c3-c 验收（探针读响应头）。
    if is_index {
        builder = builder.header("content-security-policy", CSP_INDEX);
    }
    if method == "HEAD" {
        // HEAD 无体：沿用宿主声明的长度（页面侧据此判尺寸）
        body.clear();
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

/// 取一次上游响应：管道与 TCP 两种传输面同构产出（状态 / 头 / 体 / 是否 SSE）。
fn fetch_upstream(
    cfg: &ProxyCfg,
    method: &str,
    path_and_query: &str,
    pass_headers: &[(String, String)],
    body: &[u8],
) -> Result<UpstreamAnswer, String> {
    let is_sse = |headers: &[(String, String)]| {
        headers.iter().any(|(name, value)| {
            name == "content-type" && value.trim_start().to_ascii_lowercase().starts_with("text/event-stream")
        })
    };
    match &cfg.upstream {
        Upstream::Tcp { port, cookie, client } => {
            let target = format!("http://127.0.0.1:{port}{path_and_query}");
            let http_method = reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
            let mut outbound = client
                .request(http_method, &target)
                .header(reqwest::header::COOKIE, cookie)
                // 让宿主不做响应压缩：转发体保持明文，页面侧不出现 content-encoding
                .header(reqwest::header::ACCEPT_ENCODING, "identity");
            for (name, value) in pass_headers {
                if let Ok(header) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                    outbound = outbound.header(name.as_str(), header);
                }
            }
            if !body.is_empty() {
                outbound = outbound.body(body.to_vec());
            }
            let response = outbound.send().map_err(|e| e.to_string())?;
            let status = response.status().as_u16();
            let headers: Vec<(String, String)> = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value.to_str().ok().map(|text| (name.as_str().to_ascii_lowercase(), text.to_string()))
                })
                .collect();
            let sse = is_sse(&headers);
            let body = response.bytes().map_err(|e| format!("读取响应失败：{e}"))?.to_vec();
            Ok(UpstreamAnswer { status, headers, body, sse })
        }
        Upstream::Pipe { client, cookie } => {
            let mut headers = pass_headers.to_vec();
            headers.push(("cookie".to_string(), cookie.clone()));
            headers.push(("accept-encoding".to_string(), "identity".to_string()));
            let payload = if body.is_empty() { None } else { Some(body) };
            let response = client.request(method, path_and_query, &headers, payload)?;
            let sse = is_sse(&response.headers);
            Ok(UpstreamAnswer { status: response.status, headers: response.headers, body: response.body, sse })
        }
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
pub(crate) fn with_allow_header(mut response: http::Response<Vec<u8>>) -> http::Response<Vec<u8>> {
    response
        .headers_mut()
        .insert("allow", http::HeaderValue::from_static("GET, HEAD, POST"));
    response
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
#[path = "dsh_proxy_tests.rs"]
mod tests;
