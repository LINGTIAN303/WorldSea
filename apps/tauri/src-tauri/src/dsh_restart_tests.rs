// 宿主崩溃自愈的判定面单测（随重启模块一起从 dsh_shell 拆出）——只测「怎么判定」，不真的 spawn 进程。
// 重启链本身需要真实进程，属真机走查范围（见 docs/plans/2026-11-04-宿主崩溃自愈批计划.md §五）。
// 这里锁住三条最容易被后续改动破坏的语义：
//   ① 退出码 0 = 正常收尾，不重启
//   ② 异常退出 = 走重启链
//   ③ 退避序列与上限是刻意的，改小改大都得先改测试

use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Duration;

use super::*;

/// 造一个「已退出且退出码可控」的子进程：用 sh -c 立即退出（Windows 走 cmd /c）。
fn exited_child(code: i32) -> Child {
    let mut command = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/c").arg(format!("exit {code}"));
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(format!("exit {code}"));
        c
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn test child")
}

/// 等到子进程真的退出（`exit_status` 依赖 `try_wait`，spawn 后需给它一点时间）。
fn wait_exited(process: &DshProcess) -> Option<Option<std::process::ExitStatus>> {
    for _ in 0..200 {
        if let Some(status) = process.exit_status() {
            return Some(status);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    None
}

#[test]
fn a_live_child_reports_no_exit() {
    // 启动一个会等一会的子进程（ping 到本机回环，至少 1 秒）
    let mut command = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/c").arg("ping -n 3 127.0.0.1 > nul");
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg("sleep 2");
        c
    };
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn live child");
    let process = DshProcess::new(child);
    assert!(process.exit_status().is_none(), "运行中的子进程必须报告 None（仍在运行）");
    process.kill();
}

#[test]
fn clean_exit_is_distinguishable_from_a_crash() {
    // 退出码 0 = 正常收尾（用户关停 / SIGTERM）→ 不该重启
    let process = DshProcess::new(exited_child(0));
    let status = wait_exited(&process).expect("子进程应已退出");
    let status = status.expect("退出码应可读");
    assert!(status.success(), "退出码 0 必须被判为正常收尾（不重启）");
}

#[test]
fn a_crash_exit_code_is_not_clean() {
    // 退出码非 0 = 异常崩溃 → 走重启链
    let process = DshProcess::new(exited_child(1));
    let status = wait_exited(&process).expect("子进程应已退出");
    let status = status.expect("退出码应可读");
    assert!(!status.success(), "退出码 1 必须被判为异常（重启）");
}

#[test]
fn shutting_down_suppresses_detection() {
    // 应用正在关停时守护必须静默：否则退出流程会被自己触发重启链
    let process = DshProcess::new(exited_child(1));
    let _ = wait_exited(&process);
    process.shutting_down.store(true, Ordering::Relaxed);
    assert!(process.exit_status().is_none(), "关停标志置位后必须报告 None（守护静默）");
}

#[test]
fn restart_backoff_is_deliberately_slow() {
    // 退避是防崩溃循环烧 CPU 的核心；改小会让「必崩插件」把机器拖死
    assert_eq!(MAX_RESTARTS, 3, "重试上限改动需重新评估崩溃循环风险");
    assert_eq!(
        RESTART_BACKOFF,
        [Duration::from_secs(1), Duration::from_secs(2), Duration::from_secs(4)],
        "退避序列必须是递增的 1s/2s/4s"
    );
    // 序列长度必须与上限一致，否则下标会越界
    assert_eq!(RESTART_BACKOFF.len(), MAX_RESTARTS as usize);
}

#[test]
fn backoff_is_monotonically_increasing() {
    for pair in RESTART_BACKOFF.windows(2) {
        assert!(pair[1] > pair[0], "退避必须递增，否则退避失去意义：{pair:?}");
    }
}

#[test]
fn replace_swaps_the_handle_and_clears_the_shutdown_flag() {
    // 重启链的关键动作：换上新句柄后守护必须看到「新进程在运行」，而不是旧的退出态
    let process = DshProcess::new(exited_child(0));
    let _ = wait_exited(&process);
    assert!(process.exit_status().is_some(), "旧句柄应报已退出");

    process.replace(exited_child(0));
    // 刚换上的新进程可能已经跑完了（cmd /c exit 很快），但只要不报「关停中」即可
    assert!(!process.shutting_down.load(Ordering::Relaxed), "replace 必须清掉关停标志");
    process.kill();
}

#[test]
fn error_page_is_served_over_the_shell_scheme_with_a_titlebar() {
    // 真机缺陷的回归锁：错误页曾是 data: URL，不在 Tauri 的 is_local_url 白名单，
    // 页面既拿不到 __TAURI_INTERNALS__，也没有窗口栏脚本 → 「⋯」菜单不存在，
    // 用户无法用「视图 → 重新启动 Agent 内核」恢复。
    let response = crate::dsh_error::error_page_response("title=Agent%20%E5%B7%B4&detail=detail");
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers().get("content-type").and_then(|v| v.to_str().ok()),
        Some("text/html; charset=utf-8"),
    );
    let html = String::from_utf8_lossy(response.body()).into_owned();
    // 窗口栏脚本必须被注入，否则「⋯」菜单无从出现
    if !(html.contains("worldsea-shell:titlebar") || html.contains("__WORLDSEA_TITLEBAR__")) {
        let tail = html.len().saturating_sub(500);
        panic!("错误页未注入窗口栏。HTML 尾部：{}", &html[tail..]);
    }
    // 标题经 query 还原（中文需正确解码）
    assert!(html.contains("Agent 巴"), "标题应从 query 解码后进入页面：{html:.200}");
}
