// C3-b（2026-09-24）：壳级导航/新窗栅栏——WebView2 事件层（主框架 NavigationStarting + NewWindowRequested）。
//
// 定位：页内 JS 守卫（C1-c′，镜像 Electron 语义）可被绕过或失效；本层在壳内、不经页面，
// 补上「程序化 `location` 赋值」等缺口（C1-c′ 登记项转正）。
// **事件面选择**（C3 批计划 §三 裁定 ②）：`NavigationStarting` = **主框架**；iframe 走
// `FrameNavigationStarting` —— 本批**不挂**后者，避免误伤内置浏览器面板与文档预览。
// 反证开关：`WORLDSEA_NO_NAV_FENCE=1` 关闭本层（JS 守卫仍在）。

/// 主框架导航是否放行（纯函数：单测与探针共用同一判据）。
///
/// 放行面：
/// - 自家 UI：`http(s)://worldsea.localhost`（Windows workaround 形态）与 `worldsea://localhost`（canonical）；
/// - 壳自有资产页：`tauri://localhost` / `http(s)://tauri.localhost`（`frontendDist = shell-loading`
///   兜底页——启动期与失败态都靠它，**必须放行**；实测拦它会得到空窗口）；
/// - legacy 回退页：`http://127.0.0.1:<port>/?token=…`（`WORLDSEA_LEGACY_DIRECT` 或桥失败时的直连导航）；
/// - 壳错误页（`data:`）与空页（`about:`）。
/// 其余一律拦（http(s) 交系统浏览器，见 [`external_target`]）。
pub(crate) fn navigation_allowed(url: &str) -> bool {
    let Ok(parsed) = tauri::Url::parse(url) else {
        return false;
    };
    let own_host = |host: Option<&str>| {
        host.is_some_and(|host| {
            matches!(host, "worldsea.localhost" | "tauri.localhost" | "127.0.0.1" | "localhost" | "::1")
        })
    };
    match parsed.scheme() {
        "http" | "https" => own_host(parsed.host_str()),
        "worldsea" | "tauri" => parsed.host_str().is_some_and(|host| host == "localhost"),
        "data" | "about" => true,
        _ => false,
    }
}

/// 被拦下的 URL 该不该交系统浏览器（http(s)/mailto 才交；其它协议只拦不外开）。
pub(crate) fn external_target(url: &str) -> Option<String> {
    let parsed = tauri::Url::parse(url).ok()?;
    match parsed.scheme() {
        "http" | "https" | "mailto" => Some(url.to_string()),
        _ => None,
    }
}

/// 挂载栅栏（Windows：WebView2 事件层）。重复调用会重复挂载事件，故仅在装配点调一次。
#[cfg(windows)]
pub fn install(window: &tauri::WebviewWindow) {
    if std::env::var_os("WORLDSEA_NO_NAV_FENCE").is_some() {
        println!("[DSH-SHELL] nav_fence: 已按 WORLDSEA_NO_NAV_FENCE 关闭（反证模式；JS 守卫仍在）");
        return;
    }
    let result = window.with_webview(|webview| {
        use webview2_com::{NavigationStartingEventHandler, NewWindowRequestedEventHandler};
        use windows::core::PWSTR;

        /// 读 WebView2 交回的 PWSTR 并释放（CoTaskMemAlloc 分配的字符串）。
        unsafe fn read_pwstr(ptr: PWSTR) -> String {
            let text = ptr.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(ptr.0.cast()));
            text
        }

        unsafe {
            let controller = webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                eprintln!("[DSH-SHELL] nav_fence: CoreWebView2 不可得，栅栏未挂");
                return;
            };
            let mut token = 0i64;
            let navigation = NavigationStartingEventHandler::create(Box::new(|_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = PWSTR::null();
                args.Uri(&mut raw)?;
                let uri = read_pwstr(raw);
                if navigation_allowed(&uri) {
                    return Ok(());
                }
                args.SetCancel(true)?;
                eprintln!("[DSH-SHELL] nav_fence: 拦下主框架导航 {uri}");
                if let Some(target) = external_target(&uri) {
                    let _ = tauri_plugin_opener::open_url(target, None::<&str>);
                }
                Ok(())
            }));
            if let Err(error) = core.add_NavigationStarting(&navigation, &mut token) {
                eprintln!("[DSH-SHELL] nav_fence: 主框架栅栏挂载失败：{error}");
                return;
            }
            let mut token = 0i64;
            let new_window = NewWindowRequestedEventHandler::create(Box::new(|_sender, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = PWSTR::null();
                args.Uri(&mut raw)?;
                let uri = read_pwstr(raw);
                args.SetHandled(true)?;
                eprintln!("[DSH-SHELL] nav_fence: 拦下新窗请求 {uri}");
                if let Some(target) = external_target(&uri) {
                    let _ = tauri_plugin_opener::open_url(target, None::<&str>);
                }
                Ok(())
            }));
            if let Err(error) = core.add_NewWindowRequested(&new_window, &mut token) {
                eprintln!("[DSH-SHELL] nav_fence: 新窗栅栏挂载失败：{error}");
                return;
            }
            println!("[DSH-SHELL] nav_fence: 主框架导航 + 新窗栅栏已挂（WebView2 事件层）");
        }
    });
    if let Err(error) = result {
        eprintln!("[DSH-SHELL] nav_fence: with_webview 失败：{error}");
    }
}

#[cfg(test)]
#[path = "nav_fence_tests.rs"]
mod tests;
