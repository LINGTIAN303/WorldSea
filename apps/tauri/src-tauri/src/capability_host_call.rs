// host 侧发起能力调用的 **loopback 入口**（路径 A，2026-11-17）。
//
// 为什么需要这个端点：能力桥两端都建好了——Rust 侧有注册表/ACL/超时/回执认领，
// 提供方窗有 `__WORLDSEA_CAPABILITY_CALL__` 伺服——但 Agent 的工具跑在 dsh 的 **host 进程**
// （Node），它没有任何通往 webview 的 IPC 通道，也没有窗口身份（ACL 按窗口 label 判）。
//
// 三条候选通道的取舍：
// - `worldsea.localhost` 自定义协议：由 wry 伺服，**只有 webview 能访问**，host 的 HTTP 客户端够不到；
// - `dsh_pipe`：方向固定为 Rust → host（Rust 是客户端），反向不成立；
// - 故起一条**仅回环、单路径、带随机令牌**的 HTTP 端点，供 host 调用。
//   这与 `dsh_oauth.rs` 的回调监听同一形态（本机其它进程无法借它做通用代理）。
//
// 安全口径（三条，缺一即拒）：
// 1. 只绑 `127.0.0.1`，只接受 `POST /capability`，其余路径 404；
// 2. 必须带 `X-WorldSea-Token` 且等于本进程随机令牌（令牌只经 env 交给宿主，不落盘、不进页面）；
// 3. 请求体上限 64 KiB，超限即断（避免被当作大载荷通道）。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

/// 唯一路径。
const CALL_PATH: &str = "/capability";
/// 请求体上限（能力参数是结构化小对象，64 KiB 已远超实际需要）。
const MAX_BODY: usize = 64 * 1024;
/// 单连接读超时：防止半开连接长期占线程。
const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// accept 轮询间隔（非阻塞 listener）。
const ACCEPT_TICK: Duration = Duration::from_millis(50);

/// 端点句柄：持有端口与令牌；`Drop` 即停监听。
pub struct HostCallEndpoint {
    port: u16,
    token: String,
    stop: Arc<AtomicBool>,
}

impl HostCallEndpoint {
    /// 监听端口（注入给宿主用）。
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 本进程随机令牌（注入给宿主用；不进页面、不落盘）。
    pub fn token(&self) -> &str {
        &self.token
    }
}

impl Drop for HostCallEndpoint {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 当前已装配端点的 (端口, 令牌)（供 host spawn 时注入 env）。
///
/// 用全局持有而非随参数传递：端点由 `lib.rs` 的 setup 起一次，而 host 可能因崩溃
/// 重启多次（`dsh_restart`），每次 spawn 都要拿到同一份端点信息——重启不该换端点。
static CURRENT: std::sync::Mutex<Option<(u16, String)>> = std::sync::Mutex::new(None);

/// 登记当前端点（由 `lib.rs` setup 调；重复登记覆盖）。
pub fn set_current(port: u16, token: String) {
    if let Ok(mut guard) = CURRENT.lock() {
        *guard = Some((port, token));
    }
}

/// 读当前端点；未起（或已被反证开关关掉）时返回 `None`。
pub fn current_endpoint() -> Option<(u16, String)> {
    CURRENT.lock().ok().and_then(|guard| guard.clone())
}

/// 反证开关：关掉端点（证明它是必要条件，不是装饰）。
pub fn disabled() -> bool {
    std::env::var_os("WORLDSEA_NO_HOST_CALL_ENDPOINT").is_some()
}

/// 清单提供函数签名（读 `capabilities` 模块的注册表；注入以避免本模块依赖 Tauri）。
pub type ListProvider = Arc<dyn Fn() -> Value + Send + Sync>;

/// 清单提供者（由 `app_setup` 注入；未注入时返回空数组）。
static LIST_PROVIDER: std::sync::Mutex<Option<ListProvider>> = std::sync::Mutex::new(None);

/// 登记清单提供者（`app_setup` 调一次）。
pub fn set_list_provider(provider: ListProvider) {
    if let Ok(mut guard) = LIST_PROVIDER.lock() {
        *guard = Some(provider);
    }
}

/// 取能力清单（`__list` 动作用）。
fn handler_list() -> Value {
    match LIST_PROVIDER.lock() {
        Ok(guard) => match guard.as_ref() {
            Some(provider) => provider(),
            None => json!([]),
        },
        Err(_) => json!([]),
    }
}

/// 处理函数签名：`(id, args, caller)` → 结果。由 `lib.rs` 装配时注入，
/// 使本模块不直接依赖 Tauri 的 AppHandle（便于单测）。
pub type Handler = Arc<dyn Fn(String, Option<Value>, Option<String>) -> Result<Value, String> + Send + Sync>;

/// 起端点：绑定空闲回环端口，逐连接派生线程。
pub fn start(handler: Handler) -> Result<HostCallEndpoint, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("host 调用口绑定失败：{e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("host 调用口设置非阻塞失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("host 调用口读取端口失败：{e}"))?
        .port();
    let token = random_token();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let token_thread = token.clone();

    std::thread::spawn(move || {
        println!("[WORLDSEA-CAP] host 调用口：127.0.0.1:{port}{CALL_PATH}（仅此一条路径，需令牌）");
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    // Windows 坑（同 WS 中转 / oauth 回调）：accept 出来的套接字继承 listener 的非阻塞态。
                    let _ = stream.set_nonblocking(false);
                    let handler = handler.clone();
                    let token = token_thread.clone();
                    std::thread::spawn(move || {
                        if let Err(error) = handle_conn(stream, &*handler, &token) {
                            eprintln!("[WORLDSEA-CAP] host 调用口连接结束：{error}");
                        }
                    });
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(ACCEPT_TICK);
                }
                Err(error) => {
                    eprintln!("[WORLDSEA-CAP] host 调用口 accept 失败：{error}");
                    break;
                }
            }
        }
    });

    Ok(HostCallEndpoint { port, token, stop })
}

/// 随机令牌：32 位十六进制。用时间 + 地址熵，不引额外依赖。
fn random_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    let addr = &nanos as *const u128 as usize as u128;
    let mixed = nanos ^ (pid << 64) ^ (addr << 32);
    format!("{mixed:032x}")
}

/// 处理一条连接：解析请求行与头 → 校验路径/令牌 → 读体 → 交给 handler → 回 JSON。
fn handle_conn(mut stream: TcpStream, handler: &(dyn Fn(String, Option<Value>, Option<String>) -> Result<Value, String> + Send + Sync), token: &str) -> Result<(), String> {
    stream.set_read_timeout(Some(READ_TIMEOUT)).ok();
    stream.set_write_timeout(Some(READ_TIMEOUT)).ok();

    let mut reader = BufReader::new(stream.try_clone().map_err(|e| format!("克隆连接失败：{e}"))?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| format!("读请求行失败：{e}"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    // 逐行读头直到空行（头总量上限与体上限同量级，足够）
    let mut content_length = 0usize;
    let mut provided_token: Option<String> = None;
    let mut header_bytes = 0usize;
    loop {
        let mut line = String::new();
        let read = reader.read_line(&mut line).map_err(|e| format!("读头失败：{e}"))?;
        if read == 0 {
            break;
        }
        header_bytes += read;
        if header_bytes > 16 * 1024 {
            return reply(&mut stream, 431, json!({ "error": "HEADERS_TOO_LARGE" }));
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, value)) = trimmed.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name == "content-length" {
                content_length = value.parse().unwrap_or(0);
            } else if name == "x-worldsea-token" {
                provided_token = Some(value.to_string());
            }
        }
    }

    if method != "POST" || path != CALL_PATH {
        return reply(&mut stream, 404, json!({ "error": "NOT_FOUND", "hint": format!("仅 POST {CALL_PATH}") }));
    }
    match provided_token {
        Some(value) if value == token => {}
        _ => {
            println!("[WORLDSEA-CAP] 拒：host 调用口令牌不匹配");
            return reply(&mut stream, 403, json!({ "error": "FORBIDDEN_TOKEN" }));
        }
    }
    if content_length == 0 || content_length > MAX_BODY {
        return reply(&mut stream, 400, json!({ "error": "BAD_BODY_SIZE", "limit": MAX_BODY }));
    }

    let mut body = vec![0u8; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|e| format!("读体失败：{e}"))?;

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(value) => value,
        Err(error) => {
            return reply(&mut stream, 400, json!({ "error": "BAD_JSON", "detail": error.to_string() }))
        }
    };
    let id = parsed.get("id").and_then(Value::as_str).unwrap_or("").to_string();
    if id.is_empty() {
        return reply(&mut stream, 400, json!({ "error": "MISSING_ID" }));
    }
    // `__list` = 端点自带的清单动作：只读 Rust 注册表、无副作用、不经能力桥。
    // 之所以做在这里而不是做成一条能力：清单是「发现面」，让主窗代发一圈没有意义，
    // 且它会占用一个能力 id、还要维护 handler。
    if id == "__list" {
        return reply(&mut stream, 200, json!({ "ok": true, "result": handler_list() }));
    }
    let args = parsed.get("args").cloned().filter(|v| !v.is_null());
    let caller = parsed.get("caller").and_then(Value::as_str).map(str::to_string);

    match handler(id, args, caller) {
        Ok(value) => reply(&mut stream, 200, json!({ "ok": true, "result": value })),
        Err(error) => reply(&mut stream, 200, json!({ "ok": false, "error": error })),
    }
}

/// 写一条 JSON 响应并关连接。
fn reply(stream: &mut TcpStream, status: u16, body: Value) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        431 => "Request Header Fields Too Large",
        _ => "Error",
    };
    let text = body.to_string();
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        text.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(text.as_bytes()))
        .and_then(|_| stream.flush())
        .map_err(|e| format!("回包失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 起端点并直连发一条请求，验三条安全口径与成功路径。
    #[test]
    fn endpoint_requires_token_and_returns_handler_result() {
        let handler: Handler = Arc::new(|id, _args, caller| {
            if id == "world.demo" {
                Ok(json!({ "echo": id, "caller": caller }))
            } else {
                Err("CAPABILITY_UNKNOWN: 未登记".to_string())
            }
        });
        let endpoint = start(handler).expect("端点应能起");
        let port = endpoint.port();
        let token = endpoint.token().to_string();

        // 1) 无令牌 → 403
        let unauthorized = post(port, CALL_PATH, None, json!({ "id": "world.demo" }));
        assert!(unauthorized.contains("403"), "无令牌应 403：{unauthorized}");

        // 2) 错路径 → 404
        let wrong_path = post(port, "/other", Some(&token), json!({ "id": "world.demo" }));
        assert!(wrong_path.contains("404"), "错路径应 404：{wrong_path}");

        // 3) 正确令牌 + 正确路径 → 200 且回 handler 结果
        let ok = post(port, CALL_PATH, Some(&token), json!({ "id": "world.demo", "caller": "main" }));
        assert!(ok.contains("200"), "应 200：{ok}");
        assert!(ok.contains("world.demo"), "应回显 id：{ok}");
        assert!(ok.contains("\"caller\":\"main\""), "应透传 caller：{ok}");

        // 4) handler 报错 → 仍 200（业务错误走 body，不是 HTTP 错误）
        let business_error = post(port, CALL_PATH, Some(&token), json!({ "id": "world.nope" }));
        assert!(business_error.contains("200"), "业务错误应 200：{business_error}");
        assert!(business_error.contains("CAPABILITY_UNKNOWN"), "应带错误码：{business_error}");
    }

    /// 发一条 POST，返回整条响应文本（含状态行）。
    fn post(port: u16, path: &str, token: Option<&str>, body: Value) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("应能连上端点");
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
        let text = body.to_string();
        let mut head = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
            text.len()
        );
        if let Some(value) = token {
            head.push_str(&format!("X-WorldSea-Token: {value}\r\n"));
        }
        head.push_str("Connection: close\r\n\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(text.as_bytes()).unwrap();
        stream.flush().unwrap();

        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap_or(0);
        response
    }
}
