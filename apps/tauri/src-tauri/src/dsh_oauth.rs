// 账号登录的浏览器回调口（OAuth loopback callback）——壳侧唯一的「浏览器可直达」落点。
//
// 动机：dsh 的 DeepSeek 账号登录走 PKCE，Platform 授权完成后把系统浏览器 302 回
// `<callbackOrigin>/oauth/callback?code=…&state=…`。该 origin 必须是浏览器能直接访问的真 HTTP 落点，
// 而壳的默认形态是**零 TCP**（宿主 `external` 不 bind，见 C2 批）——登录的最后一步因此没有落点。
// 本模块只补这一个落点：监听 `127.0.0.1` 随机端口，仅服务该一条路径，请求经壳的当前上游
// （管道 / legacy）转发给宿主自己的 `/oauth/callback` 路由，再把宿主的响应原样回给浏览器。
//
// 口径（docs/plans/2026-11-05-dsh账号登录放开批计划.md §三 A）：
// - **仅** `GET /oauth/callback`：其余路径 404、其余方法 405——监听不是通用代理；
// - 不带 cookie 转发：该路由按上游语义不要求 RPC 鉴权（只校验 state + PKCE）；
// - 单路由放宽超时：宿主 handler 要等兑换+提交完成才回包，通用的 60s 一元超时不够用；
// - `WORLDSEA_NO_OAUTH_CALLBACK=1` 关监听（反证：登录应以可辨认错误失败，不静默）。
// 回收语义：`Drop` 置停止位，accept 循环随后退出（与 `WsRelay` 同款）。

use std::io::{BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::dsh_pipe::PipeClient;

/// 回调路径——与 dsh `deepseek-account-platform` 注册的 exact 路由逐字一致。
pub(crate) const CALLBACK_PATH: &str = "/oauth/callback";

/// 浏览器侧等待上限：宿主要在授权码兑换与授权提交完成后才回 302，故比通用一元超时宽一档。
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(120);

/// 每次 accept 的轮询间隔（与 WS 中转同口径）。
const ACCEPT_TICK: Duration = Duration::from_millis(50);

/// 转发目标：壳当前上游的**最小可克隆**视图（`Upstream` 持有转发配置，不便跨线程共享）。
#[derive(Clone)]
pub(crate) enum OauthTarget {
    /// 默认形态：IPC 管道。
    Pipe(Arc<PipeClient>),
    /// legacy 对照形态：loopback TCP。
    Tcp { port: u16, client: reqwest::blocking::Client },
}

/// 转发目标的共享槽：装配时写入，回调线程每请求现取（宿主重启换装配后自然跟随）。
pub(crate) type TargetCell = Arc<Mutex<Option<OauthTarget>>>;

/// 一次上游回调响应（状态 / 头 / 体；头里 `location` 是浏览器要跟着走的下一步）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CallbackAnswer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// 转发闭包：测试注入假上游用；生产替身是 [`forward_via`]。
pub(crate) type Forwarder = Arc<dyn Fn(&str) -> Result<CallbackAnswer, String> + Send + Sync>;

/// 回调口句柄：持有端口与停止位；`Drop` 即停监听。
pub(crate) struct OauthCallback {
    port: u16,
    stop: Arc<AtomicBool>,
}

impl OauthCallback {
    /// 监听的 loopback 端口（生产用 `origin()` 即可；本访问器供单测断言真绑过）。
    #[cfg(test)]
    pub fn port(&self) -> u16 {
        self.port
    }

    /// 注入页面的回调基址（Platform 侧 `redirect_uri` 的前缀，**不带尾斜杠**：
    /// 上游按 `${origin}/oauth/callback` 拼接）。
    pub fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

impl Drop for OauthCallback {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 反证开关：关掉监听（证明它是必要条件，不是装饰）。
pub(crate) fn disabled() -> bool {
    std::env::var_os("WORLDSEA_NO_OAUTH_CALLBACK").is_some()
}

/// 起监听：绑定空闲 loopback 端口，逐连接派生线程。
pub(crate) fn start(forward: Forwarder) -> Result<OauthCallback, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("回调口绑定失败：{e}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("回调口设置非阻塞失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("回调口读取端口失败：{e}"))?
        .port();
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    std::thread::spawn(move || {
        println!("[DSH-SHELL] oauth: listening 127.0.0.1:{port}{CALLBACK_PATH}（仅此一条路径）");
        while !stop_thread.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => {
                    // Windows 坑（同 WS 中转）：accept 出来的套接字继承 listener 的非阻塞态。
                    let _ = stream.set_nonblocking(false);
                    let forward = forward.clone();
                    std::thread::spawn(move || {
                        if let Err(e) = handle_conn(stream, &*forward) {
                            eprintln!("[DSH-SHELL] oauth: 连接结束：{e}");
                        }
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(ACCEPT_TICK),
                Err(e) => {
                    eprintln!("[DSH-SHELL] oauth: accept 失败：{e}");
                    break;
                }
            }
        }
    });
    Ok(OauthCallback { port, stop })
}

/// 装配回调口：起监听（或按反证开关跳过）并交出转发目标槽。
///
/// 目标槽由调用方在传输面就绪后填写（管道客户端 / legacy 端口），回调线程每请求现取——
/// 宿主重启换装配后自然跟随。起不来时只降级登录，不阻断启动。
/// 返回值：`(句柄, 注入用回调基址, 目标槽)`；句柄为 `None` 表示本次不服务登录回调。
pub(crate) fn install() -> (Option<OauthCallback>, Option<String>, TargetCell) {
    let target: TargetCell = Arc::new(Mutex::new(None));
    if disabled() {
        eprintln!("[DSH-SHELL] oauth: 回调口已按 WORLDSEA_NO_OAUTH_CALLBACK 关闭（反证模式：登录将以可辨认错误失败）");
        return (None, None, target);
    }
    match start(forward_via(target.clone())) {
        Ok(callback) => {
            let origin = callback.origin();
            (Some(callback), Some(origin), target)
        }
        Err(error) => {
            eprintln!("[DSH-SHELL] oauth: 回调口未能启动（登录将不可用）：{error}");
            (None, None, target)
        }
    }
}

/// 填写转发目标（传输面就绪后调用；槽已中毒时静默跳过——回调届时以「桥未装配」显式失败）。
pub(crate) fn point_at(cell: &TargetCell, target: OauthTarget) {
    if let Ok(mut slot) = cell.lock() {
        *slot = Some(target);
    }
}

/// 生产转发：按当前装配（管道 / legacy TCP）把回调送进宿主。
pub(crate) fn forward_via(cell: TargetCell) -> Forwarder {    Arc::new(move |path_and_query: &str| {
        let target = cell
            .lock()
            .map_err(|_| "转发目标锁中毒".to_string())?
            .clone()
            .ok_or_else(|| "桥未装配（宿主尚未就绪）".to_string())?;
        match target {
            OauthTarget::Pipe(client) => {
                let response = client.request_with_timeout("GET", path_and_query, &[], None, CALLBACK_TIMEOUT)?;
                Ok(CallbackAnswer {
                    status: response.status,
                    headers: response.headers,
                    body: response.body,
                })
            }
            OauthTarget::Tcp { port, client } => {
                let target = format!("http://127.0.0.1:{port}{path_and_query}");
                let response = client
                    .get(&target)
                    .header(reqwest::header::ACCEPT_ENCODING, "identity")
                    .timeout(CALLBACK_TIMEOUT)
                    .send()
                    .map_err(|e| e.to_string())?;
                let status = response.status().as_u16();
                let headers: Vec<(String, String)> = response
                    .headers()
                    .iter()
                    .filter_map(|(name, value)| {
                        value.to_str().ok().map(|text| (name.as_str().to_ascii_lowercase(), text.to_string()))
                    })
                    .collect();
                let body = response.bytes().map_err(|e| format!("读取响应失败：{e}"))?.to_vec();
                Ok(CallbackAnswer { status, headers, body })
            }
        }
    })
}

/// 请求准入判定：只有 `GET /oauth/callback`（可带 query）进入转发。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Gate {
    /// 放行：携带原始 path+query（转发的就是它）。
    Allow(String),
    /// 路径不在服务面：404（监听不是通用代理）。
    NotFound,
    /// 路径对但方法不对：405。
    MethodNotAllowed,
}

/// 准入判定（纯函数：单测与生产共用同一判据）。
pub(crate) fn gate(method: &str, path_and_query: &str) -> Gate {
    let path_only = path_and_query.split('?').next().unwrap_or(path_and_query);
    // 尾斜杠视为同一资源：`/oauth/callback/` 也放行（Platform 侧跳转不带，容错而已）
    let matched = path_only == CALLBACK_PATH || path_only == concat!("/oauth/callback/");
    if !matched {
        return Gate::NotFound;
    }
    if method != "GET" {
        return Gate::MethodNotAllowed;
    }
    Gate::Allow(path_and_query.to_string())
}

/// 处理一条回调连接：读首部 → 准入 → 转发 → 回写。
fn handle_conn(mut client: TcpStream, forward: &(dyn Fn(&str) -> Result<CallbackAnswer, String> + Send + Sync)) -> std::io::Result<()> {
    let _ = client.set_nodelay(true);
    let mut reader = BufReader::new(client.try_clone()?);
    let head = crate::dsh_relay::read_head(&mut reader)?;
    if head.is_empty() {
        return Ok(());
    }
    let head_text = String::from_utf8_lossy(&head).to_string();
    let Some((method, path, _version)) = crate::dsh_relay::parse_request_line(&head_text) else {
        return respond_text(&mut client, 400, "Bad Request", "无法解析请求行");
    };
    match gate(method, path) {
        Gate::NotFound => {
            println!("[DSH-SHELL] oauth: 拒绝 {method} {path}（仅服务 {CALLBACK_PATH}）");
            respond_text(&mut client, 404, "Not Found", "该端口只服务账号登录回调，不是通用代理。")
        }
        Gate::MethodNotAllowed => {
            println!("[DSH-SHELL] oauth: 拒绝 {method} {path}（只接受 GET）");
            respond_text(&mut client, 405, "Method Not Allowed", "账号登录回调只接受 GET。")
        }
        Gate::Allow(path_and_query) => match forward(&path_and_query) {
            Ok(answer) => relay_answer(&mut client, &answer),
            Err(error) => {
                // 转发失败必须**可辨认**：浏览器侧给可读页，壳日志留原因。
                eprintln!("[DSH-SHELL] oauth: {method} {path_and_query} → 转发失败：{error}");
                respond_note(
                    &mut client,
                    502,
                    "无法连接 Agent 内核",
                    "登录回调没能送达宿主。请回到应用查看账号状态，稍后可重试登录。",
                )
            }
        },
    }
}

/// 把上游响应回给浏览器：302 透传 `location`（浏览器据此走到 Platform 完成页）；
/// 204 换成本地可读页（宿主判定完成但没给完成页地址时，别让用户对着空白页）；
/// 其余状态原样带体。
fn relay_answer(client: &mut TcpStream, answer: &CallbackAnswer) -> std::io::Result<()> {
    let location = answer
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("location"))
        .map(|(_, value)| value.clone());
    println!(
        "[DSH-SHELL] oauth: {CALLBACK_PATH} → {} {}",
        answer.status,
        match &location {
            Some(target) => format!("location={target}"),
            None => String::from("（无 location）"),
        }
    );
    if answer.status == 204 {
        return respond_note(
            client,
            200,
            "授权已完成",
            "可以关闭此页，回到应用继续使用（账号状态已更新）。",
        );
    }
    match location {
        Some(target) if (300..400).contains(&answer.status) => {
            let head = format!(
                "HTTP/1.1 {} {}\r\nlocation: {target}\r\ncache-control: no-store\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                answer.status,
                status_reason(answer.status),
            );
            client.write_all(head.as_bytes())?;
            client.flush()
        }
        _ => {
            let content_type = answer
                .headers
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
                .map(|(_, value)| value.clone())
                .unwrap_or_else(|| "text/plain; charset=utf-8".to_string());
            let head = format!(
                "HTTP/1.1 {} {}\r\ncontent-type: {content_type}\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                answer.status,
                status_reason(answer.status),
                answer.body.len()
            );
            client.write_all(head.as_bytes())?;
            client.write_all(&answer.body)?;
            client.flush()
        }
    }
}

/// 状态码的标准短语（只覆盖回调面会出现的几个；其余给空串，浏览器照样按码处理）。
fn status_reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        302 => "Found",
        303 => "See Other",
        307 => "Temporary Redirect",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        410 => "Gone",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        504 => "Gateway Timeout",
        _ => "",
    }
}

/// 极简文本响应（拒绝路径用）。
fn respond_text(client: &mut TcpStream, status: u16, reason: &str, message: &str) -> std::io::Result<()> {
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: text/plain; charset=utf-8\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        message.len()
    );
    client.write_all(head.as_bytes())?;
    client.write_all(message.as_bytes())?;
    client.flush()
}

/// 给用户看的极简 HTML 页（授权完成 / 转发失败）——浏览器里那一下的落点。
/// 不注入主题令牌：它不属于应用页面，保持中性即可。
fn respond_note(client: &mut TcpStream, status: u16, title: &str, detail: &str) -> std::io::Result<()> {
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
<style>body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;\
font:15px/1.7 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1f2328;background:#fff}}\
@media (prefers-color-scheme:dark){{body{{color:#e6edf3;background:#0d1117}}}}\
main{{max-width:26rem;padding:2rem;text-align:center}}h1{{font-size:1.05rem;margin:0 0 .6rem}}\
p{{margin:0;opacity:.75}}</style>\
<main><h1>{title}</h1><p>{detail}</p></main>"
    );
    let head = format!(
        "HTTP/1.1 {status} {}\r\ncontent-type: text/html; charset=utf-8\r\ncache-control: no-store\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        status_reason(status),
        body.len()
    );
    client.write_all(head.as_bytes())?;
    client.write_all(body.as_bytes())?;
    client.flush()
}

#[cfg(test)]
#[path = "dsh_oauth_tests.rs"]
mod tests;
