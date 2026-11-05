// WS 凭据中转 —— UI 页 origin 是 worldsea.localhost，而 mux WebSocket 必须以「宿主 authority + dsh-auth cookie + same-origin」
// 的面貌到达宿主（否则连接被 /api 围栏 403 / 凭据 401 拒绝；围栏代码见 dsh packages/client/connection/src/api-request-trust.ts）。
// WebView 无法给 WS 握手补 Cookie/Origin 头，故壳内起一条 loopback 中转：改写握手首部后双向透传字节（不解析 WS 帧）。
// 口径（见 docs/plans/2026-09-24-C1-Tauri原生desktop载体批计划.md §三）：纯壳侧实现，不触 dsh/（fork 台账保持空）；仅服务 `/<secret>/api/remote.mux`
// ——secret 是每进程随机前缀（注入在页面的 streamBaseUrl 里），使中转不是通用代理（本机其它进程无法借它带上宿主凭据）；随壳进程退出回收（Drop 置停止位）。

use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// 握手首部上限：超限即视为异常输入（正常 WS 握手远小于此）
const MAX_HEAD_BYTES: usize = 16 * 1024;

/// WS 中转句柄：持有端口与随机前缀；Drop 即停监听。
pub struct WsRelay {
    port: u16,
    secret: String,
    stop: Arc<AtomicBool>,
}

impl WsRelay {
    /// 监听端口（诊断输出用）。
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 注入给页面的传输基址。**末尾带 `/`**：客户端以相对路径 `api/remote.mux` 解析
    /// （stream-client.ts 的 `new URL(REMOTE_STREAM_MUX_PATH.slice(1), streamBaseUrl)`），
    /// 于是随机前缀被带进路径，中转才有依据放行。
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/{}/", self.port, self.secret)
    }
}

impl Drop for WsRelay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 起中转：绑定空闲 loopback 端口，逐连接派生线程。`diag` 为真时落档握手原文（排障用）。
pub fn start(host_port: u16, cookie: String, diag: bool) -> Result<WsRelay, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("WS 中转绑定失败：{e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("WS 中转设置非阻塞失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("WS 中转读取端口失败：{e}"))?
        .port();
    let secret = random_secret();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let secret_thread = secret.clone();
    std::thread::spawn(move || {
        println!("[DSH-SHELL] relay: listening 127.0.0.1:{port} → 宿主 127.0.0.1:{host_port}");
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    // Windows 坑（2026-09-24 实测）：accept 出来的套接字**继承 listener 的非阻塞态**，
                    // 而 Unix 不继承。不改回阻塞的话，中转到隧道的 io::copy 立刻报
                    // WSAEWOULDBLOCK(10035)——表现为「握手 101 后 0 字节即断」。
                    let _ = stream.set_nonblocking(false);
                    let cookie = cookie.clone();
                    let secret = secret_thread.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle_conn(stream, host_port, &cookie, &secret, diag) {
                            eprintln!("[DSH-SHELL] relay: 连接结束：{e}");
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(e) => {
                    eprintln!("[DSH-SHELL] relay: accept 失败：{e}");
                    break;
                }
            }
        }
    });
    Ok(WsRelay { port, secret, stop })
}

/// 处理一条中转连接：校验前缀 → 改写首部 → 连宿主 → 转发首部与响应 → 双向透传。
fn handle_conn(
    client: TcpStream,
    host_port: u16,
    cookie: &str,
    secret: &str,
    diag: bool,
) -> std::io::Result<()> {
    let _ = client.set_nodelay(true);
    let mut client_read = BufReader::new(client.try_clone()?);
    let head = read_head(&mut client_read)?;
    if head.is_empty() {
        return Ok(());
    }
    let head_text = String::from_utf8_lossy(&head).to_string();
    if diag {
        println!("[DSH-SHELL] relay(diag) 浏览器握手原文：\n{}", head_text.replace("\r\n", "⏎"));
    }
    let Some((method, path, version)) = parse_request_line(&head_text) else {
        let mut out = client.try_clone()?;
        return write_plain(&mut out, "400 Bad Request", "relay: malformed request line");
    };

    // 前缀闸门：路径必须是 `/<secret>/…`；再限定到 mux 一个路径上（中转只干这一件事）
    let prefix = format!("/{secret}/");
    let Some(upstream_path) = path.strip_prefix(&prefix) else {
        println!("[DSH-SHELL] relay: 拒绝 {method} {path}（前缀不匹配）");
        let mut out = client.try_clone()?;
        return write_plain(&mut out, "404 Not Found", "relay: unknown prefix");
    };
    if !upstream_path.starts_with("api/remote.mux") {
        println!("[DSH-SHELL] relay: 拒绝 {method} /{upstream_path}（仅服务 api/remote.mux）");
        let mut out = client.try_clone()?;
        return write_plain(&mut out, "404 Not Found", "relay: unsupported path");
    }

    let authority = format!("127.0.0.1:{host_port}");
    let rewritten = rewrite_head(&head_text, method, &format!("/{upstream_path}"), version, &authority, cookie);
    let mut server = TcpStream::connect(("127.0.0.1", host_port))?;
    let _ = server.set_nodelay(true);
    server.write_all(rewritten.as_bytes())?;
    server.flush()?;

    // 宿主响应首部原样回传，并落档状态行（101 = 升级成功；403/401 = 围栏/凭据拒绝）
    let mut server_read = BufReader::new(server.try_clone()?);
    let resp_head = read_head(&mut server_read)?;
    let status_line = String::from_utf8_lossy(&resp_head)
        .lines()
        .next()
        .unwrap_or("")
        .to_string();
    if diag {
        println!("[DSH-SHELL] relay(diag) 宿主响应原文：\n{}", String::from_utf8_lossy(&resp_head).replace("\r\n", "⏎"));
    }
    println!("[DSH-SHELL] relay: {method} /{upstream_path} → {status_line}");
    let mut client_write = client.try_clone()?;
    client_write.write_all(&resp_head)?;
    client_write.flush()?;

    // 首部之后全部原样透传（不解析 WS 帧；两个方向各一条线程/当前线程）
    let started = std::time::Instant::now();
    let mut c2s_src = client_read;
    let mut s2c_src = server_read;
    let mut c2s_dst = server;
    let mut s2c_dst = client_write;
    let up = std::thread::spawn(move || {
        let copied = match std::io::copy(&mut c2s_src, &mut c2s_dst) {
            Ok(n) => n,
            Err(e) => {
                eprintln!("[DSH-SHELL] relay: 上行复制失败：{e}");
                0
            }
        };
        let _ = c2s_dst.shutdown(Shutdown::Write);
        copied
    });
    let down = match std::io::copy(&mut s2c_src, &mut s2c_dst) {
        Ok(n) => n,
        Err(e) => {
            eprintln!("[DSH-SHELL] relay: 下行复制失败：{e}");
            0
        }
    };
    let _ = s2c_dst.shutdown(Shutdown::Write);
    let up = up.join().unwrap_or(0);
    // 收尾诊断：谁先停、双向字节数、持续时长——判「连上即死」用
    println!(
        "[DSH-SHELL] relay: 连接收尾（上行 {}B / 下行 {}B / 持续 {}ms）",
        up,
        down,
        started.elapsed().as_millis()
    );
    Ok(())
}

/// 读一个 HTTP 首部（含结尾空行）；EOF 或超限返回空。
/// crate 内共享：账号回调口（`dsh_oauth`）用同一份解析，避免两套首部读取各自演化。
pub(crate) fn read_head(reader: &mut impl BufRead) -> std::io::Result<Vec<u8>> {
    let mut head = Vec::new();
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(Vec::new());
        }
        head.extend_from_slice(&line);
        if head.len() > MAX_HEAD_BYTES {
            return Ok(Vec::new());
        }
        if line == b"\r\n" || line == b"\n" {
            return Ok(head);
        }
    }
}

/// 请求行 → (方法, 路径含查询, 版本)；格式不符返回 None。
pub(crate) fn parse_request_line(head_text: &str) -> Option<(&str, &str, &str)> {
    let line = head_text.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let path = parts.next()?;
    let version = parts.next()?;
    Some((method, path, version))
}

/// 改写握手首部：丢弃页面自带的 host/origin/cookie/sec-fetch-site，补上宿主 authority
/// 视角的凭据（与 Electron 桌面版 `webRequest.onBeforeSendHeaders` 同构）。
/// 其余头（Upgrade/Connection/Sec-WebSocket-Key/Version/Extensions 等）原样保留。
pub(crate) fn rewrite_head(
    head_text: &str,
    method: &str,
    upstream_path: &str,
    version: &str,
    authority: &str,
    cookie: &str,
) -> String {
    let mut out = format!("{method} {upstream_path} {version}\r\n");
    for line in head_text.lines().skip(1) {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        let Some((name, value)) = line.split_once(':') else { continue };
        let lower = name.trim().to_ascii_lowercase();
        if matches!(lower.as_str(), "host" | "origin" | "cookie" | "sec-fetch-site") {
            continue;
        }
        out.push_str(name.trim_end_matches(' '));
        out.push(':');
        out.push_str(value);
        out.push_str("\r\n");
    }
    out.push_str(&format!("Host: {authority}\r\n"));
    out.push_str(&format!("Origin: http://{authority}\r\n"));
    out.push_str(&format!("Cookie: {cookie}\r\n"));
    out.push_str("Sec-Fetch-Site: same-origin\r\n");
    out.push_str("\r\n");
    out
}

/// 写一条极简文本响应（拒绝路径用）。
fn write_plain(stream: &mut TcpStream, status: &str, message: &str) -> std::io::Result<()> {
    let body = message.as_bytes();
    let head = format!(
        "HTTP/1.1 {status}\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// 每进程随机前缀（32 hex）。用 std 的 RandomState 种子（来自系统 RNG）+ 时间/pid 派生，
/// 不引新依赖；用途是「本机其它进程无法借中转带宿主凭据」，非密码学级密钥。
fn random_secret() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = String::new();
    for _ in 0..2 {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u32(std::process::id());
        hasher.write_u128(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0),
        );
        out.push_str(&format!("{:016x}", hasher.finish()));
    }
    out
}

#[cfg(test)]
#[path = "dsh_relay_tests.rs"]
mod tests;
