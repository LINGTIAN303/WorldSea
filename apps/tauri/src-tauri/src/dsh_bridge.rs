// `worldsea` 协议层代理宿主——Tauri 原生 desktop 载体的 UI 面；转发细节在 `dsh_proxy.rs`，管道客户端在 `dsh_pipe.rs`，页面流桥命令在 `dsh_stream.rs`，完整口径（含自定义协议落形）详见 docs/details/注释/tauri/dsh-bridge.md。
// - UI origin 与传输面分离：页面走壳注册的自定义协议；传输面默认走 IPC 管道（零 TCP），`WORLDSEA_TCP_HOST=1` 切回 legacy 对照口；
// - 零注入复刻 index：壳只在 `<head>` 后补注入脚本（传输基址单点；管道模式改注入 `openStream` 钩子——传输形态换掉，接缝不变）；
// - 转发 `/api` 按 Electron 桌面版同构：删掉页面的 origin/cookie/sec-fetch-*，补壳侧凭据（带 303 换来的 `dsh-auth-*` cookie）；
// - 〔自定义协议落形〕wry 在 Windows 走 workaround：`worldsea://localhost/…` ⇄ `http://worldsea.localhost/…`（authority 必须 localhost）。

use std::sync::{Arc, RwLock};
use std::time::Duration;

use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder, WebviewWindow};

use crate::dsh_inject::TransportInject;
use crate::dsh_pipe::PipeClient;
use crate::dsh_proxy::{failure_response, proxy, ProxyCfg, Upstream};
use crate::dsh_relay::WsRelay;

/// 页面导航目标（Windows workaround 形态；macOS/Linux 对应 `worldsea://localhost/`）。
pub const APP_URL: &str = "http://worldsea.localhost/";

/// 一次装配的桥状态：转发开关（含传输面）+ 管道客户端（流桥命令使用）+ legacy 的 WS 中转（保持回收语义）。
pub(crate) struct BridgeInner {
    cfg: ProxyCfg,
    summary: String,
    pipe: Option<Arc<PipeClient>>,
    /// legacy 模式下的 WS 中转（随状态 drop 回收）；管道模式为 None。
    _relay: Option<WsRelay>,
    /// 账号登录回调口（随状态 drop 停监听；反证开关关闭时为 None）。
    _oauth: Option<crate::dsh_oauth::OauthCallback>,
}

impl BridgeInner {
    /// 桥已卸下时的占位装配：转发一律失败，调用方据此回退直连。
    fn unavailable() -> Self {
        Self {
            cfg: ProxyCfg::off(),
            summary: "桥未装配".to_string(),
            pipe: None,
            _relay: None,
            _oauth: None,
        }
    }
}

/// 桥状态外壳：**可热替换**。
///
/// 宿主崩溃重启后必须换成新的 `BridgeInner`（新管道路径、新 cookie、新 token），
/// 但 Tauri 的 `app.manage` 对同一类型二次注册会 panic（"state for type ... is
/// already being managed"）。故托管给 Tauri 的是这个外壳，重启只替换里面的
/// `RwLock` 内容。读写比极高（每请求一次读、重启一次写），锁开销可忽略。
pub struct DshBridge {
    inner: RwLock<Option<BridgeInner>>,
}

impl DshBridge {
    /// 用一次装配结果造桥。
    pub fn new(inner: BridgeInner) -> Self {
        Self { inner: RwLock::new(Some(inner)) }
    }

    /// 重启时替换装配结果（旧值 drop 即回收 WS 中继）。
    pub fn replace(&self, inner: BridgeInner) {
        if let Ok(mut guard) = self.inner.write() {
            *guard = Some(inner);
        }
    }

    /// 取出内部装配（供 `attach` 在已有外壳时热替换用）。
    fn into_inner(self) -> BridgeInner {
        match self.inner.into_inner() {
            Ok(Some(inner)) => inner,
            // 桥已被卸下：交一个不可用的空装配，调用方随即回退直连
            _ => BridgeInner::unavailable(),
        }
    }

    /// 诊断摘要（管道模式报路径；legacy 报宿主端口与中继端口；token 只留在壳内）。
    pub fn describe(&self) -> String {
        self.with(|b| b.summary.clone()).unwrap_or_else(|| "桥未装配".to_string())
    }

    /// 管道客户端（流桥命令用）；非管道模式或桥已卸下时为 None。
    pub fn pipe(&self) -> Option<Arc<PipeClient>> {
        self.with(|b| b.pipe.clone()).flatten()
    }

    /// 壳自身经管道调 dsh 的 API（与页面同链路：自动带 cookie、Host 由管道客户端合成）。
    /// 用途 = 「壳代表自己」的调用（如主题真源同步）；legacy TCP 模式返回错误，调用方降级即可。
    pub fn call_api(&self, method: &str, path: &str, body: Option<Vec<u8>>) -> Result<(u16, String), String> {
        self.with(|inner| {
            let Upstream::Pipe { client, cookie } = &inner.cfg.upstream else {
                return Err("legacy（WORLDSEA_TCP_HOST=1）模式：壳内 API 调用暂不支持".to_string());
            };
            let headers = vec![
                ("cookie".to_string(), cookie.clone()),
                ("content-type".to_string(), "application/json".to_string()),
                ("accept-encoding".to_string(), "identity".to_string()),
            ];
            let response = client.request(method, path, &headers, body.as_deref())?;
            Ok((response.status, String::from_utf8_lossy(&response.body).to_string()))
        })
        .unwrap_or_else(|| Err("桥未装配".to_string()))
    }

    /// 转发配置（协议层代理用）。
    pub fn with_cfg<T>(&self, f: impl FnOnce(&ProxyCfg) -> T) -> Option<T> {
        self.with(|b| f(&b.cfg))
    }

    /// 读当前装配并应用 `f`；锁中毒或桥已卸下时返回 None（调用方按「桥不可用」降级，不 panic）。
    fn with<T>(&self, f: impl FnOnce(&BridgeInner) -> T) -> Option<T> {
        self.inner.read().ok().and_then(|guard| guard.as_ref().map(f))
    }
}

/// 绑定桥：303 换 cookie → （管道模式）连宿主管道 / （legacy）起 WS 中转 → 造转发配置。
/// 全部失败都返回可读原因（调用方回退直连）。
/// `pipe_path` = 壳本次 spawn 传给宿主的 `--ipc-pipe` 值（由 `dsh_shell` 生成）；`None` = legacy TCP。
/// `dsh_home` = 壳解析后的 DSH_HOME（=宿主 env 同值）——注入面据此放 `__WORLDSEA_DSH_HOME__`。
pub fn prepare(
    ready_url: &str,
    pipe_path: Option<&str>,
    workspace_notice: Option<&str>,
    dsh_home: Option<&str>,
) -> Result<DshBridge, String> {
    let diag = diag_enabled();
    let inject_transport = std::env::var_os("WORLDSEA_NO_TRANSPORT_INJECT").is_none();
    let inject_shell_bridge = std::env::var_os("WORLDSEA_NO_SHELL_BRIDGE").is_none();
    // Agent 面能力伺服（缺省注入；`WORLDSEA_NO_CAPABILITY_BRIDGE=1` 反证关）
    let capabilities = std::env::var_os("WORLDSEA_NO_CAPABILITY_BRIDGE").is_none();
    // 无边框窗口栏（缺省注入；`WORLDSEA_NO_TITLEBAR=1` 反证关；`WORLDSEA_FRAMED=1` 原生边框态亦不注入）
    let framed = std::env::var_os("WORLDSEA_FRAMED").is_some();
    let titlebar = !framed && std::env::var_os("WORLDSEA_NO_TITLEBAR").is_none();
    let deny_path = std::env::var("WORLDSEA_DENY_PATH").ok().filter(|value| !value.is_empty());
    let open_paths = std::env::var_os("WORLDSEA_BRIDGE_OPEN").is_some();
    // 工作区不可供给的横幅文案（探测在 dsh_shell 侧完成，这里只做透传）
    let workspace_notice = workspace_notice.map(str::to_string);
    // DSH_HOME（解析在 dsh_shell 侧完成）——页面常量注入用，同样只做透传
    let dsh_home = dsh_home.map(str::to_string);
    if !inject_transport {
        eprintln!("[DSH-SHELL] bridge: 传输注入已按 WORLDSEA_NO_TRANSPORT_INJECT 关闭（反证模式：流面必须显式降级）");
    }
    if !inject_shell_bridge {
        eprintln!("[DSH-SHELL] bridge: 壳桥注入已按 WORLDSEA_NO_SHELL_BRIDGE 关闭（反证模式：设置入口必须显式降级）");
    }
    if !titlebar {
        let why = if framed { "WORLDSEA_FRAMED（原生边框态）" } else { "WORLDSEA_NO_TITLEBAR" };
        eprintln!("[DSH-SHELL] bridge: 窗口栏注入关闭（{why}）：页面顶格、无拖拽（显式缺省，非静默）");
    }
    if diag {
        println!("[DSH-SHELL] bridge: 页内诊断已开（console 钩子 → [DSH-SHELL] page(diag)）");
    }
    if !capabilities {
        eprintln!("[DSH-SHELL] bridge: 能力伺服装配已按 WORLDSEA_NO_CAPABILITY_BRIDGE 关闭（反证模式：agent 提供方缺席）");
    }
    if let Some(deny) = &deny_path {
        println!("[DSH-SHELL] bridge: 测试钩子 WORLDSEA_DENY_PATH={deny}（该前缀一律 404）");
    }
    if open_paths {
        println!("[DSH-SHELL] bridge: 路径白名单已按 WORLDSEA_BRIDGE_OPEN 关闭（逃生口）");
    }

    // 账号登录回调口：先起监听拿到基址（注入面要用），转发目标随后随传输面填（见 `dsh_oauth`）。
    let (oauth, oauth_callback_origin, oauth_target) = crate::dsh_oauth::install();

    match pipe_path {
        Some(path) => {
            let client = Arc::new(PipeClient::connect_retry(path, Duration::from_secs(15))?);
            let cookie = exchange_cookie_pipe(&client, ready_url)?;
            let transport = if inject_transport { TransportInject::OpenStream } else { TransportInject::None };
            crate::dsh_oauth::point_at(&oauth_target, crate::dsh_oauth::OauthTarget::Pipe(client.clone()));
            let cfg = ProxyCfg {
                upstream: Upstream::Pipe { client: client.clone(), cookie },
                transport,
                inject_shell_bridge,
                titlebar,
                diag,
                capabilities,
                deny_path,
                open_paths,
                workspace_notice,
                dsh_home,
                // 路径闸门的运行期依据：宿主 hello 自报的前缀表
                route_prefixes: client.route_prefixes(),
                oauth_callback_origin,
            };
            let summary = format!("mode=pipe pipe={path} 页面={APP_URL}（零 TCP；token 只留在壳内）");
            Ok(DshBridge { inner: RwLock::new(Some(BridgeInner {
                cfg,
                summary,
                pipe: Some(client),
                _relay: None,
                _oauth: oauth,
            })) })
        }
        None => {
            let host_port = parse_port(ready_url)?;
            let cookie = exchange_cookie(ready_url)?;
            let relay = crate::dsh_relay::start(host_port, cookie.clone(), diag)?;
            let client = reqwest::blocking::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .no_proxy()
                .timeout(Duration::from_secs(60))
                .build()
                .map_err(|e| format!("转发客户端构建失败：{e}"))?;
            let transport = if inject_transport {
                TransportInject::StreamBase(relay.base_url())
            } else {
                TransportInject::None
            };
            // 回调转发目标（legacy 形态）——`reqwest::blocking::Client` 可克隆，共享连接池
            crate::dsh_oauth::point_at(
                &oauth_target,
                crate::dsh_oauth::OauthTarget::Tcp { port: host_port, client: client.clone() },
            );
            let cfg = ProxyCfg {
                upstream: Upstream::Tcp { port: host_port, cookie, client },
                transport,
                inject_shell_bridge,
                titlebar,
                diag,
                capabilities,
                deny_path,
                open_paths,
                workspace_notice,
                dsh_home,
                // legacy 对照口（已冻结）：无 hello 上报通道，闸门回落到静态底集
                route_prefixes: Vec::new(),
                oauth_callback_origin,
            };
            let summary = format!(
                "mode=tcp host=127.0.0.1:{host_port} relay_port={} 页面={APP_URL}（token 只留在壳内）",
                relay.port()
            );
            Ok(DshBridge { inner: RwLock::new(Some(BridgeInner {
                cfg,
                summary,
                pipe: None,
                _relay: Some(relay),
                _oauth: oauth,
            })) })
        }
    }
}

/// 诊断开关（prepare 与 legacy 中转共用同一判定口径）。
fn diag_enabled() -> bool {
    std::env::var_os("WORLDSEA_SHELL_DIAG").is_some()
}

/// 从就绪 URL 取宿主端口（`http://127.0.0.1:<port>/?token=…`；legacy 模式用）。
fn parse_port(ready_url: &str) -> Result<u16, String> {
    let rest = ready_url
        .strip_prefix("http://127.0.0.1:")
        .ok_or_else(|| format!("就绪 URL 形态不符：{ready_url}"))?;
    let port = rest.split(['/', '?']).next().unwrap_or("");
    port.parse::<u16>().map_err(|e| format!("解析宿主端口失败（{port}）：{e}"))
}

/// 就绪 URL → 路径+查询（`/?token=…`）；管道模式经管道重放这一次交换。
fn ready_path_and_query(ready_url: &str) -> Result<String, String> {
    let rest = ready_url
        .strip_prefix("http://127.0.0.1:")
        .ok_or_else(|| format!("就绪 URL 形态不符：{ready_url}"))?;
    let at = rest.find('/').ok_or_else(|| format!("就绪 URL 缺路径：{ready_url}"))?;
    Ok(rest[at..].to_string())
}

/// 303 换 cookie（**管道模式**）：把带 token 的路径经管道重放一次，取 `set-cookie` 首段。
/// Host 由管道客户端合成 `127.0.0.1`——cookie 的 authority 绑定因此落在该形态上，后续请求同形。
fn exchange_cookie_pipe(client: &PipeClient, ready_url: &str) -> Result<String, String> {
    let path_and_query = ready_path_and_query(ready_url)?;
    let response = client.request("GET", &path_and_query, &[], None)?;
    let cookie = response
        .headers
        .iter()
        .find(|(name, _)| name == "set-cookie")
        .map(|(_, value)| value.split(';').next().unwrap_or(value).trim().to_string());
    let Some(cookie) = cookie else {
        return Err(format!("cookie 交换未拿到 set-cookie（状态 {}）", response.status));
    };
    if response.status != 303 {
        return Err(format!("cookie 交换状态非 303：{}", response.status));
    }
    Ok(cookie)
}

/// 303 换 cookie（**legacy TCP 模式**）：把带 token 的 URL 抓一次（不跟随重定向），取 `set-cookie` 首段
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

/// 装配：桥成功 → 记桥状态 + 导航到壳协议页；桥失败或显式 `WORLDSEA_LEGACY_DIRECT=1`
/// → 回退直连 loopback，两条路都不静默。
/// `pipe_path` 由 `dsh_shell` 生成并随 spawn 传入宿主（legacy 对照模式下为 None）。
/// `dsh_home` = 壳解析后的 DSH_HOME（注入面透传为页面常量 `__WORLDSEA_DSH_HOME__`）。
pub fn attach(
    app: &tauri::AppHandle,
    window: Option<&WebviewWindow>,
    ready_url: &str,
    pipe_path: Option<&str>,
    workspace_notice: Option<&str>,
    dsh_home: Option<&str>,
) {
    let legacy = std::env::var_os("WORLDSEA_LEGACY_DIRECT").is_some();
    let bridged = if legacy {
        println!("[DSH-SHELL] WORLDSEA_LEGACY_DIRECT=1：跳过桥，回退直连 loopback");
        false
    } else {
        match prepare(ready_url, pipe_path, workspace_notice, dsh_home) {
            Ok(bridge) => {
                println!("[DSH-SHELL] bridge ready: {}", bridge.describe());
                // 首次装配托管新外壳；重启时已有外壳，只替换内部状态
                // （`app.manage` 对同类型二次注册会 panic）。
                let inner = bridge.into_inner();
                if let Some(existing) = app.try_state::<DshBridge>() {
                    existing.replace(inner);
                    println!("[DSH-SHELL] bridge: 已热替换装配（重启路径）");
                } else {
                    app.manage(DshBridge::new(inner));
                }
                // 主题真源与 dsh 对齐（首次反向读做种子；已有真源则以真源为准写回 dsh）
                crate::app_prefs_dsh::init_after_bridge(app);
                if let Some(window) = window {
                    crate::dsh_nav::navigate_to_app(window);
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
        return;
    }
    crate::dsh_nav::schedule_reload_if_requested(window);
    crate::dsh_nav::schedule_eval_if_requested(window);
}

/// 协议处理器入口：转后台线程做阻塞转发（responder 可在任意线程应答）。
pub fn handle_request<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    // 壳自有错误页走本协议伺服，**先于桥判定**——宿主未就绪时正是要用它。
    // 走 data: URL 的话页面不在 is_local_url 白名单，拿不到 IPC 与窗口栏（真机实测）。
    if request.uri().path() == crate::dsh_error::SHELL_ERROR_PATH {
        responder.respond(crate::dsh_error::error_page_response(request.uri().query().unwrap_or("")));
        return;
    }
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        let response = match app.try_state::<DshBridge>() {
            Some(bridge) => match bridge.with_cfg(|cfg| proxy(cfg, &request)) {
                Some(response) => response,
                None => failure_response(503, true, "Agent 内核尚未就绪", "壳协议桥未装配完成，请稍后重试。"),
            },
            None => failure_response(503, true, "Agent 内核尚未就绪", "壳协议桥未装配完成，请稍后重试。"),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
#[path = "dsh_bridge_tests.rs"]
mod tests;
