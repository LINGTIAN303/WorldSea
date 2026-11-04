// 页面导航与就绪等待——从 `dsh_bridge.rs` 拆出（守 400 行红线）。
// 只管「页面什么时候算就绪、什么时候导航」；桥状态与转发留在 `dsh_bridge.rs`。

use std::time::Duration;

use tauri::WebviewWindow;

use crate::dsh_bridge::APP_URL;

/// 诊断钩子：`WORLDSEA_EVAL_AFTER_READY=<js>` → 页面就绪后注入执行一次（排查用；结果建议经壳桥
/// `__WORLDSEA_SHELL__.report(...)` 落到壳日志）。与 `WORLDSEA_RELOAD_AFTER` 共用「等页面就绪」。
pub fn schedule_eval_if_requested(window: Option<&WebviewWindow>) {
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
pub fn wait_for_app_page(window: &WebviewWindow) -> bool {
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
pub fn schedule_reload_if_requested(window: Option<&WebviewWindow>) {
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
    // 启动页（splash，`apps/tauri/splash/` 构建产物）就绪淡出——先触发兜底页的淡出钩子
    // `__wsSplash.ready()`（→ bootState='ready' → 600ms 追平旧版观感），再导航替换整页；
    // 钩子不存在（错误页 / 旧兜底页）时静默跳过，代价仅多等 700ms。
    let _ = window.eval(
        "(function(){try{if(window.__wsSplash&&typeof window.__wsSplash.ready==='function'){window.__wsSplash.ready()}}catch(e){}})()",
    );
    std::thread::sleep(std::time::Duration::from_millis(700));
    match APP_URL.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                crate::dsh_error::show_error(window, "无法加载 dsh 界面", &format!("窗口导航失败：{e}"));
            }
        }
        Err(e) => crate::dsh_error::show_error(window, "无法加载 dsh 界面", &format!("URL 解析失败：{e}")),
    }
}

