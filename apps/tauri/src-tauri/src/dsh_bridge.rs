// C1-a（2026-09-24）：`worldsea` 协议层代理宿主（候选 A）——Tauri 原生 desktop 载体的 UI 面。
//
// 口径（见 docs/plans/2026-09-24-C1-Tauri原生desktop载体批计划.md §三/§四）：
// - UI origin 与传输面分离：页面走壳注册的自定义协议，`/api` 与 mux WS 仍回 loopback（刻意保留）；
// - **零注入复刻 index**：index 直接取宿主渲染结果（`__DSH_BOOT__` 等由宿主注入），
//   壳只在 `<head>` 后补一条 `__DSH_TRANSPORT__`（只合并不覆盖，裁定 ④ 的「传输基址单点」）；
// - 转发 `/api` 时按 Electron 桌面版同构处理：删掉页面的 origin/cookie/sec-fetch-*，补壳侧凭据
//   （带 303 换来的 `dsh-auth-*` cookie；Host 由转发 URL 决定 = 宿主 authority，cookie 与之绑定）；
// - **不触 dsh/**（fork 台账保持空）；协议名 `worldsea`，Windows 落形见〔自定义协议落形〕。
//
// 〔自定义协议落形〕wry 在 Windows 走 workaround（wry custom_protocol_workaround）：
//   `worldsea://localhost/…` ⇄ `http://worldsea.localhost/…`。故 authority 必须是 `localhost`
//   （否则会落到真实 TLD 且非安全上下文）；页面导航目标 = workaround 形态，处理器收到的
//   request URI 已被 wry 还原成 `worldsea://localhost/…`。

use std::time::Duration;

use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder, WebviewWindow};

use crate::dsh_relay::WsRelay;

/// 页面导航目标（Windows workaround 形态；macOS/Linux 对应 `worldsea://localhost/`）。
pub const APP_URL: &str = "http://worldsea.localhost/";

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

/// 桥状态：宿主端口 + 宿主 cookie + WS 中转（随状态 drop 回收）。
pub struct DshBridge {
    host_port: u16,
    cookie: String,
    relay: WsRelay,
    /// 反证开关：`WORLDSEA_NO_TRANSPORT_INJECT=1` 时不注入 streamBaseUrl（WS 必须失败）
    inject_transport: bool,
    /// 诊断开关：`WORLDSEA_SHELL_DIAG=1` 时注入 console 钩子并把页面错误落到壳日志（/__diag）
    diag: bool,
    client: reqwest::blocking::Client,
}

impl DshBridge {
    /// 注入脚本的传输基址（末端带 `/`，把 relay 随机前缀带进 mux 路径）。
    fn stream_base_url(&self) -> String {
        self.relay.base_url()
    }

    /// 诊断摘要（不含 relay 随机前缀；只报到端口）。
    pub fn describe(&self) -> String {
        format!(
            "host=127.0.0.1:{} relay_port={} 页面={}（token 只留在壳内）",
            self.host_port,
            self.relay.port(),
            APP_URL
        )
    }
}

/// 绑定桥：303 换 cookie → 起 WS 中转 → 造转发客户端。全部失败都返回可读原因（调用方回退直连）。
pub fn prepare(ready_url: &str) -> Result<DshBridge, String> {
    let host_port = parse_port(ready_url)?;
    let cookie = exchange_cookie(ready_url)?;
    let diag = std::env::var_os("WORLDSEA_SHELL_DIAG").is_some();
    let relay = crate::dsh_relay::start(host_port, cookie.clone(), diag)?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("转发客户端构建失败：{e}"))?;
    let inject_transport = std::env::var_os("WORLDSEA_NO_TRANSPORT_INJECT").is_none();
    if !inject_transport {
        eprintln!("[DSH-SHELL] bridge: streamBaseUrl 注入已按 WORLDSEA_NO_TRANSPORT_INJECT 关闭（反证模式）");
    }
    let diag = std::env::var_os("WORLDSEA_SHELL_DIAG").is_some();
    if diag {
        println!("[DSH-SHELL] bridge: 页内诊断已开（console 钩子 → [DSH-SHELL] page(diag)；中转落档握手原文）");
    }
    Ok(DshBridge { host_port, cookie, relay, inject_transport, diag, client })
}

/// 从就绪 URL 取宿主端口（`http://127.0.0.1:<port>/?token=…`）。
fn parse_port(ready_url: &str) -> Result<u16, String> {
    let rest = ready_url
        .strip_prefix("http://127.0.0.1:")
        .ok_or_else(|| format!("就绪 URL 形态不符：{ready_url}"))?;
    let port = rest.split(['/', '?']).next().unwrap_or("");
    port.parse::<u16>().map_err(|e| format!("解析宿主端口失败（{port}）：{e}"))
}

/// 303 换 cookie：把带 token 的 URL 抓一次（不跟随重定向），取 `set-cookie` 的首段
/// （`dsh-auth-<authority 哈希>=<签名值>`）。留在壳内存里，页面永不接触 token。
fn exchange_cookie(ready_url: &str) -> Result<String, String> {
    let response = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("cookie 交换客户端构建失败：{e}"))?
        .get(ready_url)
        .send()
        .map_err(|e| format!("cookie 交换请求失败：{e}"))?;
    let status = response.status().as_u16();
    let cookie = response
        .headers()
        .get(reqwest::header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or(v).trim().to_string());
    let Some(cookie) = cookie else {
        return Err(format!("cookie 交换未拿到 set-cookie（状态 {status}）"));
    };
    if status != 303 {
        return Err(format!("cookie 交换状态非 303：{status}"));
    }
    Ok(cookie)
}

/// B2+C1 装配：桥成功 → 记桥状态 + 导航到壳协议页；桥失败或显式 `WORLDSEA_LEGACY_DIRECT=1`
/// → 回退直连 loopback（B2/B3 行为），两条路都不静默。
pub fn attach(app: &tauri::AppHandle, window: Option<&WebviewWindow>, ready_url: &str) {
    let legacy = std::env::var_os("WORLDSEA_LEGACY_DIRECT").is_some();
    let bridged = if legacy {
        println!("[DSH-SHELL] WORLDSEA_LEGACY_DIRECT=1：跳过桥，回退直连 loopback");
        false
    } else {
        match prepare(ready_url) {
            Ok(bridge) => {
                println!("[DSH-SHELL] bridge ready: {}", bridge.describe());
                app.manage(bridge);
                if let Some(window) = window {
                    navigate_to_app(window);
                }
                true
            }
            Err(e) => {
                eprintln!("[DSH-SHELL] 桥准备失败（回退直连 loopback）：{e}");
                false
            }
        }
    };
    if !bridged {
        if let Some(window) = window {
            crate::dsh_shell::navigate_to_dsh(window, ready_url);
        }
    }
}

/// 把窗口导航到壳协议页面（UI origin = `worldsea://localhost` / 其 Windows workaround 形态）。
pub fn navigate_to_app(window: &WebviewWindow) {
    match APP_URL.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                crate::dsh_shell::show_error(window, "无法加载 dsh 界面", &format!("窗口导航失败：{e}"));
            }
        }
        Err(e) => crate::dsh_shell::show_error(window, "无法加载 dsh 界面", &format!("URL 解析失败：{e}")),
    }
}

/// 协议处理器入口：转后台线程做阻塞转发（responder 可在任意线程应答）。
pub fn handle_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        let response = match app.try_state::<DshBridge>() {
            Some(bridge) => proxy(&bridge, &request),
            None => plain_response(503, "bridge not ready"),
        };
        responder.respond(response);
    });
}

/// 转发一次请求：目标 = 宿主 loopback + 原 path/query；补 cookie；`/` 与 `/index.html`
/// 在响应体里补 `__DSH_TRANSPORT__` 注入。
fn proxy(bridge: &DshBridge, request: &http::Request<Vec<u8>>) -> http::Response<Vec<u8>> {
    let path_and_query = request
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .to_string();
    let path_only = path_and_query.split('?').next().unwrap_or("/").to_string();
    let method = request.method().clone();
    let target = format!("http://127.0.0.1:{}{}", bridge.host_port, path_and_query);
    let is_api = path_only.starts_with("/api/");
    let is_index = path_only == "/" || path_only == "/index.html";
    // 页内诊断（C1-a 排障用，env 门控）：页面 console 钩子把错误 POST 到 /__diag，这里落档
    if path_only == "/__diag" && bridge.diag {
        let text = String::from_utf8_lossy(request.body());
        let text: String = text.chars().take(600).collect();
        println!("[DSH-SHELL] page(diag): {text}");
        return http::Response::builder()
            .status(204)
            .header("cache-control", "no-store")
            .body(Vec::new())
            .expect("diag response");
    }
    // 不复用 WebView 的 disk cache：index 含**每进程**内容（宿主注入的 __DSH_BOOT__ 插件图 +
    // 壳注入的传输基址），/plugins/* 的 immutable 修订号每次启动都变——照 Electron 桌面版
    // 同构降级为 no-store（否则第二次启动会拿到上一轮的注入，传输指向已死的 relay 端口）。
    let no_store = needs_no_store(&path_only);

    let http_method = reqwest::Method::from_bytes(method.as_str().as_bytes())
        .unwrap_or(reqwest::Method::GET);
    let mut outbound = bridge
        .client
        .request(http_method, &target)
        .header(reqwest::header::COOKIE, &bridge.cookie)
        // 让宿主不做响应压缩：转发体保持明文，页面侧不出现 content-encoding
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    for (name, value) in request.headers() {
        let lower = name.as_str().to_ascii_lowercase();
        if matches!(lower.as_str(), "content-type" | "accept" | "range" | "if-none-match" | "if-modified-since") {
            if let Ok(v) = reqwest::header::HeaderValue::from_bytes(value.as_bytes()) {
                outbound = outbound.header(lower.as_str(), v);
            }
        }
    }
    if !request.body().is_empty() {
        outbound = outbound.body(request.body().clone());
    }

    let response = match outbound.send() {
        Ok(r) => r,
        Err(e) => return plain_response(502, &format!("转发到宿主失败：{e}")),
    };
    let status = response.status();
    let mut upstream_length: Option<String> = None;
    let mut builder = http::Response::builder().status(status.as_u16());
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
        Ok(b) => b.to_vec(),
        Err(e) => return plain_response(502, &format!("读取宿主响应失败：{e}")),
    };
    let injected = is_index && bridge.inject_transport;
    if injected {
        let text = String::from_utf8_lossy(&body).to_string();
        body = inject_transport(&text, &bridge.stream_base_url(), bridge.diag).into_bytes();
    }

    if no_store {
        builder = builder.header("cache-control", "no-store");
    }
    if method.as_str() == "HEAD" {
        if let Some(length) = upstream_length {
            builder = builder.header("content-length", length);
        }
    } else {
        builder = builder.header("content-length", body.len().to_string());
    }

    if is_api || is_index || no_store || status.as_u16() >= 400 {
        println!(
            "[DSH-SHELL] bridge: {} {} → {}{}",
            method.as_str(),
            path_and_query,
            status.as_u16(),
            if injected { format!("（注入传输基址；{}B）", body.len()) } else { String::new() }
        );
    }

    builder
        .body(body)
        .unwrap_or_else(|e| plain_response(500, &format!("构造响应失败：{e}")))
}

/// 需要强制 no-store 的路径：index（含每进程注入）与 /plugins/*（按启动修订命名）。
pub(crate) fn needs_no_store(path_only: &str) -> bool {
    path_only == "/" || path_only == "/index.html" || path_only.starts_with("/plugins/")
}

/// 在 index 的 `<head>` 之后补一条 `__DSH_TRANSPORT__`（**只合并不覆盖**）：
/// 客户端 transport 读取点见 dsh `packages/client/connection/src/client/index.ts`（apply），
/// 流通道基址读取点见 `packages/api/gateway/src/client/stream-client.ts`（remoteStreamUrl）。
/// `diag` 为真时再追加一段 console 钩子（把 error/warn 与未捕获异常 POST 到壳的 /__diag）。
pub(crate) fn inject_transport(html: &str, base_url: &str, diag: bool) -> String {
    let mut script = format!(
        "<script>/* worldsea-shell:transport */globalThis.__DSH_TRANSPORT__ = Object.assign({{}}, globalThis.__DSH_TRANSPORT__, {{ ownsHost: true, streamBaseUrl: \"{base_url}\" }})</script>"
    );
    if diag {
        script.push_str(DIAG_SCRIPT);
    }
    match find_head_end(html) {
        Some(at) => format!("{}{}{}", &html[..at], script, &html[at..]),
        None => format!("{script}{html}"),
    }
}

/// 页内诊断脚本（`WORLDSEA_SHELL_DIAG=1` 才注入）：页面错误不再只留在 WebView 里。
const DIAG_SCRIPT: &str = "<script>/* worldsea-shell:diag */(function(){try{\
var send=function(k,t){try{fetch('/__diag',{method:'POST',body:k+': '+t}).catch(function(){})}catch(e){}};\
['error','warn'].forEach(function(n){var o=console[n]?console[n].bind(console):function(){};\
console[n]=function(){var a=Array.prototype.slice.call(arguments).map(function(x){try{return typeof x==='string'?x:(x&&x.stack)||JSON.stringify(x)}catch(e){return String(x)}}).join(' ');send(n,a);o.apply(null,arguments)}});\
addEventListener('error',function(e){send('window.error',e.message+' @'+e.filename+':'+e.lineno)});\
addEventListener('unhandledrejection',function(e){send('unhandledrejection',String((e.reason&&e.reason.stack)||e.reason))});\
}catch(e){}})()</script>";

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

/// 极简文本响应（桥未就绪 / 转发失败 / 构造失败）。
fn plain_response(status: u16, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .header("cache-control", "no-store")
        .body(message.as_bytes().to_vec())
        .expect("plain response")
}

#[cfg(test)]
#[path = "dsh_bridge_tests.rs"]
mod tests;
