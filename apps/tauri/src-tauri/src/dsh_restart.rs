// 宿主崩溃自愈的重启链——从 `dsh_shell.rs` 拆出（守 400 行红线）。
// 判定与守护留在 `dsh_shell.rs`；本文件只负责「已判定异常 → 退避重启 → 恢复页面」，
// 并拥有子进程句柄（`DshProcess`）与重试常量——它们是重启语义的一部分。
// 口径见 docs/plans/2026-11-04-宿主崩溃自愈批计划.md §三。

use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;

use crate::dsh_error::show_error;
use crate::dsh_shell::spawn_and_wait_ready;

/// 守护线程发现异常退出后调用的完整恢复流程。
///
/// 步骤固定：就绪态回退 pending（重启期页面确实不可用）→ 显示中间态 →
/// 跑重启链 → 成功则整页 reload / 失败则停在错误页。
/// @returns 成功为 `Ok(())`；失败已由本函数处理完页面与通知，调用方停止守护即可。
pub fn recover(app: &tauri::AppHandle) -> Result<(), ()> {
    crate::dsh_ready::mark_pending();
    show_restarting(app, 1);
    match restart_host(app) {
        Ok(attempt) => {
            tracing::info!("dsh shell: 第 {attempt} 次重启成功");
            eprintln!("[DSH-SHELL] 第 {attempt} 次重启成功，页面将重新加载");
            reload_agent_page(app);
            Ok(())
        }
        Err(e) => {
            tracing::error!("dsh shell: 重启链失败：{e}");
            eprintln!("[DSH-SHELL] 重启链失败：{e}");
            notify_and_stop(app, "Agent 内核（dsh）反复崩溃，已停止自动重启。");
            show_manual_restart(app, &e);
            Err(())
        }
    }
}

/// 手动重启（原生菜单项入口）：后台跑完整条重启链，不占用自动重试配额。
///
/// 用户显式发起，故每次都给完整 3 次尝试。**不放页面按钮**：错误页是 `data:` URL，
/// 不在 Tauri 的 `is_local_url` 白名单内，页面拿不到 `__TAURI_INTERNALS__`，
/// 任何 invoke 都会失败——菜单事件（`on_menu_event`）不依赖 IPC，是唯一可靠入口。
pub fn request_manual_restart(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        crate::dsh_ready::mark_pending();
        show_restarting(&app, 1);
        match restart_host(&app) {
            Ok(attempt) => {
                eprintln!("[DSH-SHELL] 手动重启成功（第 {attempt} 次尝试）");
                reload_agent_page(&app);
            }
            Err(e) => {
                eprintln!("[DSH-SHELL] 手动重启失败：{e}");
                show_manual_restart(&app, &e);
            }
        }
    });
}

/// 跑完整条重启链：退避 → spawn → 等就绪 → 换桥 + 换句柄。
///
/// 每次尝试都重新解析安装位置与管道路径——宿主崩溃后旧管道已失效，
/// 且新路径天然不与旧路径冲突（`generate_pipe_path` 带时间戳）。
/// @returns 成功时的尝试序号（1 起），全部失败时返回最后一次错误。
fn restart_host(app: &tauri::AppHandle) -> Result<u32, String> {
    let mut last = String::new();
    for attempt in 1..=MAX_RESTARTS {
        let backoff = RESTART_BACKOFF[(attempt - 1) as usize];
        eprintln!("[DSH-SHELL] 第 {attempt}/{MAX_RESTARTS} 次重启：等待 {}ms", backoff.as_millis());
        show_restarting(app, attempt);
        std::thread::sleep(backoff);
        match spawn_and_wait_ready(app) {
            Ok((child, url, pipe_path, workspace_notice, dsh_home)) => {
                // 先换桥（页面转发立刻指向新宿主），再换句柄（守护看到新进程）
                crate::dsh_bridge::attach(
                    app,
                    app.get_webview_window("main").as_ref(),
                    &url,
                    pipe_path.as_deref(),
                    workspace_notice.as_deref(),
                    Some(&dsh_home),
                );
                if let Some(state) = app.try_state::<DshProcess>() {
                    state.replace(child);
                }
                crate::dsh_ready::mark_ready();
                return Ok(attempt);
            }
            Err(e) => {
                eprintln!("[DSH-SHELL] 第 {attempt} 次重启失败：{e}");
                last = e;
            }
        }
    }
    Err(last)
}

/// 重启期把 Agent 页换成「正在重启」提示（重试序号可见，避免用户误判卡死）。
fn show_restarting(app: &tauri::AppHandle, attempt: u32) {
    if let Some(window) = app.get_webview_window("main") {
        show_error(
            &window,
            "正在重启 Agent 内核",
            &format!("Agent 内核（dsh）意外退出，正在尝试第 {attempt}/{MAX_RESTARTS} 次自动重启…\n（无需操作，成功后页面会自动恢复。）"),
        );
    }
    crate::workspace_window::request_space_switch(app, "space");
}

/// 自动重试耗尽：停在错误页并给出可点的「重新启动」入口。
fn show_manual_restart(app: &tauri::AppHandle, reason: &str) {
    if let Some(window) = app.get_webview_window("main") {
        // 页面只放指引文字：错误页是 data: URL，拿不到 __TAURI_INTERNALS__（不在
        // Tauri 的 is_local_url 白名单内），按钮会静默失效。真正入口是原生菜单项。
        let html = crate::app_prefs::error_page_html_with_restart(
            "Agent 内核已停止运行",
            &format!("自动重启 {MAX_RESTARTS} 次均失败，已停手以免反复崩溃。\n最后一次错误：{reason}\n\n（日志见应用日志与 DSH_HOME 下的 startup 诊断报告。）"),
        );
        let url = format!("data:text/html;charset=utf-8,{}", crate::dsh_error::percent_encode_pub(&html));
        if let Ok(parsed) = url.parse::<tauri::Url>() {
            if let Err(e) = window.navigate(parsed) {
                tracing::error!("dsh shell: 错误页导航失败：{e}");
            }
        }
    }
    crate::workspace_window::request_space_switch(app, "space");
}

/// 系统通知 + 停止守护（正常退出与重试耗尽共用）。
pub(crate) fn notify_and_stop(app: &tauri::AppHandle, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    if let Err(e) = app
        .notification()
        .builder()
        .title("WorldSea")
        .body(body)
        .show()
    {
        eprintln!("[DSH-SHELL] 退出通知发送失败：{e}");
    }
}

/// 重启成功后让 Agent 页重新加载。
///
/// 必须是**整页 reload**而不是重连 transport：宿主重启后 `__DSH_BOOT__`
/// （release / token / client 图）全部变化，页面里已加载的 client bundle
/// 仍指向旧宿主，`client-modules` 的 ReleaseChangeGate 会因 release 不匹配
/// 而拒绝应用新图（`packages/client/modules/src/client/release-change.ts`）。
/// 只有重新拿 boot 图才能让侧栏入口与插件状态回到一致。
fn reload_agent_page(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    if app.try_state::<crate::dsh_bridge::DshBridge>().is_none() {
        // 桥未装配（回退直连）：直接重载当前 URL
        if let Err(e) = window.eval("location.reload()") {
            eprintln!("[DSH-SHELL] 页面重载失败：{e}");
        }
        return;
    }
    // 桥已装配：导航回壳协议页（注入脚本与 boot 图都会重新取）
    crate::dsh_nav::navigate_to_app(&window);
}

/// 崩溃自愈的重试上限：超过即停手，交给用户手动决定。
///
/// 上限是刻意的——必崩的插件会让宿主每次启动都死，无限重启只会烧 CPU
/// 并把真因埋在日志里。3 次足够覆盖瞬时故障（内存压力、临时文件锁）。
pub(crate) const MAX_RESTARTS: u32 = 3;

/// 退避序列（第 n 次重启前等待）。防崩溃循环把 CPU 打满。
const RESTART_BACKOFF: [Duration; MAX_RESTARTS as usize] = [
    Duration::from_secs(1),
    Duration::from_secs(2),
    Duration::from_secs(4),
];

/// dsh 子进程句柄：退出时回收；供心跳守护查询存活态。
pub struct DshProcess {
    child: Mutex<Option<Child>>,
    pub(crate) shutting_down: AtomicBool,
}

impl DshProcess {
    pub fn new(child: Child) -> Self {
        Self { child: Mutex::new(Some(child)), shutting_down: AtomicBool::new(false) }
    }

    /// 退出回收：置关停标志（心跳守护静默）→ kill + wait（防孤儿进程）。
    pub fn kill(&self) {
        self.shutting_down.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// 重启用：换上新句柄并清掉关停标志。
    ///
    /// 心跳守护与重启链都走同一把锁，故替换是原子的：守护要么看到旧句柄的
    /// 退出态、要么看到新句柄的运行态，不会把「刚换上的新进程」误判成已退出。
    pub fn replace(&self, child: Child) {
        if let Ok(mut guard) = self.child.lock() {
            // 旧句柄若还在（理论上已退出），先回收避免僵尸
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
                let _ = old.wait();
            }
            *guard = Some(child);
        }
        self.shutting_down.store(false, Ordering::Relaxed);
    }

    /// 子进程是否已退出（守护线程轮询用；无句柄视为已退出）。
    ///
    /// 返回值区分三态，因为「要不要重启」取决于退出码：
    /// `None` = 仍在运行；`Some(None)` = 已退出但拿不到退出码（句柄已被取走或
    /// `try_wait` 失败，按异常处理）；`Some(Some(status))` = 已退出且退出码可读。
    /// 退出码 0 表示正常收尾（用户关停 / SIGTERM），不该重启。
    pub(crate) fn exit_status(&self) -> Option<Option<std::process::ExitStatus>> {
        if self.shutting_down.load(Ordering::Relaxed) {
            return None;
        }
        match self.child.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(None) => None,
                    Ok(Some(status)) => Some(Some(status)),
                    // 查询本身失败：视作已退出但原因未知
                    Err(_) => Some(None),
                },
                None => Some(None),
            },
            // 锁中毒同样按「已退出、原因未知」处理，避免守护线程静默停摆
            Err(_) => Some(None),
        }
    }
}

#[path = "dsh_restart_tests.rs"]
#[cfg(test)]
mod tests;
