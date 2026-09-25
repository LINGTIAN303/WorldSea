// C1-a/C1-b/C2-b（2026-09-24）：`worldsea` 协议层代理宿主（候选 A）——Tauri 原生 desktop 载体的 UI 面。
//
// 口径（见 docs/plans/2026-09-24-C1-*.md §三/§四/§五 与 docs/plans/2026-09-24-C2-真无端口传输批计划.md §五）：
// - UI origin 与传输面分离：页面走壳注册的自定义协议；**C2 起传输面默认走 IPC 管道（零 TCP）**，
//   `WORLDSEA_TCP_HOST=1` 可切回 C1 的 legacy 形态（loopback TCP + WS 中转；对照口，冻结）；
// - **零注入复刻 index**：index 直接取宿主渲染结果（`__DSH_BOOT__` 等由宿主注入），
//   壳只在 `<head>` 后补注入脚本（`__DSH_TRANSPORT__` 只合并不覆盖 = 裁定 ④ 的「传输基址单点」，
//   C2 起该单点改注入 `openStream` 钩子——传输形态换掉，接缝不变）；
// - 转发 `/api` 时按 Electron 桌面版同构处理：删掉页面的 origin/cookie/sec-fetch-*，补壳侧凭据
//   （带 303 换来的 `dsh-auth-*` cookie）；管道模式由 `PipeClient` 合成 `Host: 127.0.0.1`；
// - 协议名 `worldsea`，Windows 落形见〔自定义协议落形〕。
//
// 〔自定义协议落形〕wry 在 Windows 走 workaround（wry custom_protocol_workaround）：
//   `worldsea://localhost/…` ⇄ `http://worldsea.localhost/…`。故 authority 必须是 `localhost`
//   （否则会落到真实 TLD 且非安全上下文）；页面导航目标 = workaround 形态，处理器收到的
//   request URI 已被 wry 还原成 `worldsea://localhost/…`。
//
// 转发细节（闸门 / 缓存策略 / 插桩 / 失败降级）在 `dsh_proxy.rs`；管道客户端在 `dsh_pipe.rs`；
// 页面流桥命令在 `dsh_stream.rs`；本文件只管桥状态与装配。

use std::sync::Arc;
use std::time::Duration;

use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder, WebviewWindow};

use crate::dsh_inject::TransportInject;
use crate::dsh_pipe::PipeClient;
use crate::dsh_proxy::{failure_response, proxy, ProxyCfg, Upstream};
use crate::dsh_relay::WsRelay;

/// 页面导航目标（Windows workaround 形态；macOS/Linux 对应 `worldsea://localhost/`）。
pub const APP_URL: &str = "http://worldsea.localhost/";

/// 桥状态：转发开关（含传输面）+ 管道客户端（C2；流桥命令使用）+ legacy 的 WS 中转（保持回收语义）。
pub struct DshBridge {
    cfg: ProxyCfg,
    summary: String,
    pipe: Option<Arc<PipeClient>>,
    /// legacy 模式下的 WS 中转（随状态 drop 回收）；管道模式为 None。
    _relay: Option<WsRelay>,
}

impl DshBridge {
    /// 诊断摘要（管道模式报路径；legacy 报宿主端口与中继端口；token 只留在壳内）。
    pub fn describe(&self) -> String {
        self.summary.clone()
    }

    /// 管道客户端（C2 流桥命令用）；非管道模式为 None。
    pub fn pipe(&self) -> Option<Arc<PipeClient>> {
        self.pipe.clone()
    }

    /// 壳自身经管道调 dsh 的 API（与页面同链路：自动带 cookie、Host 由管道客户端合成）。
    /// 用途 = 「壳代表自己」的调用（如主题真源同步）；legacy TCP 模式返回错误，调用方降级即可。
    pub fn call_api(&self, method: &str, path: &str, body: Option<Vec<u8>>) -> Result<(u16, String), String> {
        let Upstream::Pipe { client, cookie } = &self.cfg.upstream else {
            return Err("legacy（WORLDSEA_TCP_HOST=1）模式：壳内 API 调用暂不支持".to_string());
        };
        let headers = vec![
            ("cookie".to_string(), cookie.clone()),
            ("content-type".to_string(), "application/json".to_string()),
            ("accept-encoding".to_string(), "identity".to_string()),
        ];
        let response = client.request(method, path, &headers, body.as_deref())?;
        Ok((response.status, String::from_utf8_lossy(&response.body).to_string()))
    }
}

/// 绑定桥：303 换 cookie → （管道模式）连宿主管道 / （legacy）起 WS 中转 → 造转发配置。
/// 全部失败都返回可读原因（调用方回退直连）。
/// `pipe_path` = 壳本次 spawn 传给宿主的 `--ipc-pipe` 值（由 `dsh_shell` 生成）；`None` = legacy TCP。
pub fn prepare(ready_url: &str, pipe_path: Option<&str>, workspace_notice: Option<&str>) -> Result<DshBridge, String> {
    let diag = diag_enabled();
    let inject_transport = std::env::var_os("WORLDSEA_NO_TRANSPORT_INJECT").is_none();
    let inject_shell_bridge = std::env::var_os("WORLDSEA_NO_SHELL_BRIDGE").is_none();
    // A（2026-09-25）：Agent 面能力伺服（缺省注入；`WORLDSEA_NO_CAPABILITY_BRIDGE=1` 反证关）
    let capabilities = std::env::var_os("WORLDSEA_NO_CAPABILITY_BRIDGE").is_none();
    // C6：无边框窗口栏（缺省注入；`WORLDSEA_NO_TITLEBAR=1` 反证关；`WORLDSEA_FRAMED=1` 原生边框态亦不注入）
    let framed = std::env::var_os("WORLDSEA_FRAMED").is_some();
    let titlebar = !framed && std::env::var_os("WORLDSEA_NO_TITLEBAR").is_none();
    let deny_path = std::env::var("WORLDSEA_DENY_PATH").ok().filter(|value| !value.is_empty());
    let open_paths = std::env::var_os("WORLDSEA_BRIDGE_OPEN").is_some();
    // C4-b：工作区不可供给的横幅文案（探测在 dsh_shell 侧完成，这里只做透传）
    let workspace_notice = workspace_notice.map(str::to_string);
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

    match pipe_path {
        Some(path) => {
            let client = Arc::new(PipeClient::connect_retry(path, Duration::from_secs(15))?);
            let cookie = exchange_cookie_pipe(&client, ready_url)?;
            let transport = if inject_transport { TransportInject::OpenStream } else { TransportInject::None };
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
            };
            let summary = format!("mode=pipe pipe={path} 页面={APP_URL}（零 TCP；token 只留在壳内）");
            Ok(DshBridge { cfg, summary, pipe: Some(client), _relay: None })
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
            };
            let summary = format!(
                "mode=tcp host=127.0.0.1:{host_port} relay_port={} 页面={APP_URL}（token 只留在壳内）",
                relay.port()
            );
            Ok(DshBridge { cfg, summary, pipe: None, _relay: Some(relay) })
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
/// → 回退直连 loopback（B2/B3 行为），两条路都不静默。
/// `pipe_path` 由 `dsh_shell` 生成并随 spawn 传入宿主（legacy 对照模式下为 None）。
pub fn attach(
    app: &tauri::AppHandle,
    window: Option<&WebviewWindow>,
    ready_url: &str,
    pipe_path: Option<&str>,
    workspace_notice: Option<&str>,
) {
    let legacy = std::env::var_os("WORLDSEA_LEGACY_DIRECT").is_some();
    let bridged = if legacy {
        println!("[DSH-SHELL] WORLDSEA_LEGACY_DIRECT=1：跳过桥，回退直连 loopback");
        false
    } else {
        match prepare(ready_url, pipe_path, workspace_notice) {
            Ok(bridge) => {
                println!("[DSH-SHELL] bridge ready: {}", bridge.describe());
                app.manage(bridge);
                // E2：主题真源与 dsh 对齐（首次反向读做种子；已有真源则以真源为准写回 dsh）
                crate::app_prefs::init_after_bridge(app);
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
        return;
    }
    schedule_reload_if_requested(window);
    schedule_eval_if_requested(window);
}

/// 诊断钩子：`WORLDSEA_EVAL_AFTER_READY=<js>` → 页面就绪后注入执行一次（排查用；结果建议经壳桥
/// `__WORLDSEA_SHELL__.report(...)` 落到壳日志）。与 `WORLDSEA_RELOAD_AFTER` 共用「等页面就绪」。
fn schedule_eval_if_requested(window: Option<&WebviewWindow>) {
    let Ok(script) = std::env::var("WORLDSEA_EVAL_AFTER_READY") else { return };
    if script.trim().is_empty() {
        return;
    }
    let Some(window) = window.cloned() else { return };
    println!("[DSH-SHELL] WORLDSEA_EVAL_AFTER_READY：页面就绪后注入诊断脚本（{} 字节）", script.len());
    std::thread::spawn(move || {
        if !wait_for_app_page(&window) {
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
        if let Err(e) = window.eval(script) {
            eprintln!("[DSH-SHELL] 诊断脚本注入失败：{e}");
        }
    });
}

/// 等页面真正落到壳协议页，返回是否就绪。
/// setup 期间主线程忙、`navigate` 是排队的——任何「页面就绪后」的动作都必须先过这道闸。
fn wait_for_app_page(window: &WebviewWindow) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(180);
    loop {
        std::thread::sleep(Duration::from_millis(500));
        if let Ok(url) = window.url() {
            if url.as_str().starts_with(APP_URL) {
                // 顺带留档页面真实 URL（验收项：token 不出现在 WebView 可见 URL）
                println!("[DSH-SHELL] 页面就绪：{}", url.as_str());
                return true;
            }
        }
        if std::time::Instant::now() > deadline {
            eprintln!("[DSH-SHELL] 等待页面就绪超时（未到 {APP_URL}）");
            return false;
        }
    }
}

/// 测试/核查钩子：`WORLDSEA_RELOAD_AFTER=<秒>` → 页面就绪后再等 <秒> 做一次 reload
/// （验「刷新/二次导航稳定」：index 与注入重新取、WS 重连、无残留状态）。
fn schedule_reload_if_requested(window: Option<&WebviewWindow>) {
    let Ok(seconds) = std::env::var("WORLDSEA_RELOAD_AFTER").unwrap_or_default().parse::<u64>() else {
        return;
    };
    let Some(window) = window.cloned() else { return };
    println!("[DSH-SHELL] WORLDSEA_RELOAD_AFTER={seconds}s：等到页面就绪后再做一次二次导航（刷新稳定性核查）");
    std::thread::spawn(move || {
        if !wait_for_app_page(&window) {
            return;
        }
        std::thread::sleep(Duration::from_secs(seconds));
        println!("[DSH-SHELL] 触发二次导航（window.reload）");
        if let Err(e) = window.reload() {
            eprintln!("[DSH-SHELL] 二次导航失败：{e}");
        }
    });
}

/// 把窗口导航到壳协议页面（UI origin = `worldsea://localhost` / 其 Windows workaround 形态）。
pub fn navigate_to_app(window: &WebviewWindow) {
    // C6：启动页（splash，`apps/tauri/splash/` 构建产物）就绪淡出——先触发兜底页的淡出钩子
    // `__wsSplash.ready()`（→ bootState='ready' → 600ms 追平旧版观感），再导航替换整页；
    // 钩子不存在（错误页 / 旧兜底页）时静默跳过，代价仅多等 700ms。
    let _ = window.eval(
        "(function(){try{if(window.__wsSplash&&typeof window.__wsSplash.ready==='function'){window.__wsSplash.ready()}}catch(e){}})()",
    );
    std::thread::sleep(std::time::Duration::from_millis(700));
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
            Some(bridge) => proxy(&bridge.cfg, &request),
            None => failure_response(503, true, "Agent 内核尚未就绪", "壳协议桥未装配完成，请稍后重试。"),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
#[path = "dsh_bridge_tests.rs"]
mod tests;
