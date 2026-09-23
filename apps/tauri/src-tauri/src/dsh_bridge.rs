// C1-a/C1-b（2026-09-24）：`worldsea` 协议层代理宿主（候选 A）——Tauri 原生 desktop 载体的 UI 面。
//
// 口径（见 docs/plans/2026-09-24-C1-Tauri原生desktop载体批计划.md §三/§四/§五）：
// - UI origin 与传输面分离：页面走壳注册的自定义协议，`/api` 与 mux WS 仍回 loopback（刻意保留）；
// - **零注入复刻 index**：index 直接取宿主渲染结果（`__DSH_BOOT__` 等由宿主注入），
//   壳只在 `<head>` 后补注入脚本（`__DSH_TRANSPORT__` 只合并不覆盖 = 裁定 ④ 的「传输基址单点」）；
// - 转发 `/api` 时按 Electron 桌面版同构处理：删掉页面的 origin/cookie/sec-fetch-*，补壳侧凭据
//   （带 303 换来的 `dsh-auth-*` cookie；Host 由转发 URL 决定 = 宿主 authority，cookie 与之绑定）；
// - **不触 dsh/**（fork 台账保持空）；协议名 `worldsea`，Windows 落形见〔自定义协议落形〕。
//
// 〔自定义协议落形〕wry 在 Windows 走 workaround（wry custom_protocol_workaround）：
//   `worldsea://localhost/…` ⇄ `http://worldsea.localhost/…`。故 authority 必须是 `localhost`
//   （否则会落到真实 TLD 且非安全上下文）；页面导航目标 = workaround 形态，处理器收到的
//   request URI 已被 wry 还原成 `worldsea://localhost/…`。
//
// 转发细节（闸门 / 缓存策略 / 插桩 / 失败降级）在 `dsh_proxy.rs`；本文件只管桥状态与装配。

use std::time::Duration;

use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder, WebviewWindow};

use crate::dsh_proxy::{failure_response, proxy, ProxyCfg};
use crate::dsh_relay::WsRelay;

/// 页面导航目标（Windows workaround 形态；macOS/Linux 对应 `worldsea://localhost/`）。
pub const APP_URL: &str = "http://worldsea.localhost/";

/// 桥状态：转发开关（含宿主端口与 cookie）+ WS 中转（随状态 drop 回收）+ 转发客户端。
pub struct DshBridge {
    cfg: ProxyCfg,
    relay: WsRelay,
    client: reqwest::blocking::Client,
}

impl DshBridge {
    /// 诊断摘要（不含 relay 随机前缀；只报到端口）。
    pub fn describe(&self) -> String {
        format!(
            "host=127.0.0.1:{} relay_port={} 页面={}（token 只留在壳内）",
            self.cfg.host_port,
            self.relay.port(),
            APP_URL
        )
    }
}

/// 绑定桥：303 换 cookie → 起 WS 中转 → 造转发客户端。全部失败都返回可读原因（调用方回退直连）。
pub fn prepare(ready_url: &str) -> Result<DshBridge, String> {
    let host_port = parse_port(ready_url)?;
    let cookie = exchange_cookie(ready_url)?;
    let diag = diag_enabled();
    let relay = crate::dsh_relay::start(host_port, cookie.clone(), diag)?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("转发客户端构建失败：{e}"))?;
    let cfg = ProxyCfg {
        host_port,
        cookie,
        relay_base: relay.base_url(),
        inject_transport: std::env::var_os("WORLDSEA_NO_TRANSPORT_INJECT").is_none(),
        inject_shell_bridge: std::env::var_os("WORLDSEA_NO_SHELL_BRIDGE").is_none(),
        diag,
        deny_path: std::env::var("WORLDSEA_DENY_PATH").ok().filter(|value| !value.is_empty()),
        open_paths: std::env::var_os("WORLDSEA_BRIDGE_OPEN").is_some(),
    };
    if !cfg.inject_transport {
        eprintln!("[DSH-SHELL] bridge: streamBaseUrl 注入已按 WORLDSEA_NO_TRANSPORT_INJECT 关闭（反证模式）");
    }
    if !cfg.inject_shell_bridge {
        eprintln!("[DSH-SHELL] bridge: 壳桥注入已按 WORLDSEA_NO_SHELL_BRIDGE 关闭（反证模式：设置入口必须显式降级）");
    }
    if cfg.diag {
        println!("[DSH-SHELL] bridge: 页内诊断已开（console 钩子 → [DSH-SHELL] page(diag)；中转落档握手原文）");
    }
    if let Some(deny) = &cfg.deny_path {
        println!("[DSH-SHELL] bridge: 测试钩子 WORLDSEA_DENY_PATH={deny}（该前缀一律 404）");
    }
    if cfg.open_paths {
        println!("[DSH-SHELL] bridge: 路径白名单已按 WORLDSEA_BRIDGE_OPEN 关闭（逃生口）");
    }
    Ok(DshBridge { cfg, relay, client })
}

/// 诊断开关（prepare 与 relay 共用同一判定口径）。
fn diag_enabled() -> bool {
    std::env::var_os("WORLDSEA_SHELL_DIAG").is_some()
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
        return;
    }
    schedule_reload_if_requested(window);
}

/// 测试/核查钩子：`WORLDSEA_RELOAD_AFTER=<秒>` → 等到页面真正落到壳协议页后，再等 <秒> 做一次 reload
/// （验「刷新/二次导航稳定」：index 与注入重新取、WS 重连、无残留状态）。
///
/// 为何要等：setup 期间主线程忙，`navigate` 是排队的；此时若按固定延时 reload，会在页面尚未加载时
/// 打断导航 → 空白窗口（实测踩到）。故先轮询 `window.url()` 确认已到 `APP_URL`，再开始倒计时。
fn schedule_reload_if_requested(window: Option<&WebviewWindow>) {
    let Ok(seconds) = std::env::var("WORLDSEA_RELOAD_AFTER").unwrap_or_default().parse::<u64>() else {
        return;
    };
    let Some(window) = window.cloned() else { return };
    println!("[DSH-SHELL] WORLDSEA_RELOAD_AFTER={seconds}s：等到页面就绪后再做一次二次导航（刷新稳定性核查）");
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(180);
        loop {
            std::thread::sleep(Duration::from_millis(500));
            match window.url() {
                Ok(url) if url.as_str().starts_with(APP_URL) => {
                    // 顺带留档页面真实 URL（验收项：token 不出现在 WebView 可见 URL）
                    println!("[DSH-SHELL] 页面就绪：{}", url.as_str());
                    break;
                }
                _ => {}
            }
            if std::time::Instant::now() > deadline {
                eprintln!("[DSH-SHELL] 二次导航等待超时（页面未到 {APP_URL}）");
                return;
            }
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
            Some(bridge) => proxy(&bridge.cfg, &bridge.client, &request),
            None => failure_response(503, true, "Agent 内核尚未就绪", "壳协议桥未装配完成，请稍后重试。"),
        };
        responder.respond(response);
    });
}

#[cfg(test)]
#[path = "dsh_bridge_tests.rs"]
mod tests;
