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

/// 造一个「会一直跑」的子进程：模拟半死状态的宿主（进程在，但桥断了）。
fn long_running_child() -> Child {
    let mut command = if cfg!(windows) {
        // ping 本机做无副作用的等待；-n 30 够测试跑完，结束后 kill 收尾
        let mut c = Command::new("cmd");
        c.arg("/c").arg("ping -n 30 127.0.0.1 >nul");
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg("sleep 30");
        c
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn long-running test child")
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
fn reap_then_adopt_swaps_the_handle_and_keeps_the_watchdog_alive() {
    // 重启链的新顺序：先 reap（收旧）再 adopt（装新）。两者必须分开——
    // reap 不能置 shutting_down（那是 kill() 的语义，会让心跳守护永久静默，
    // 新宿主之后再崩就没人接）。
    let process = DshProcess::new(exited_child(0));
    let _ = wait_exited(&process);
    assert!(process.exit_status().is_some(), "旧句柄应报已退出");

    process.reap_for_restart();
    assert!(!process.shutting_down.load(Ordering::Relaxed), "reap 不得让守护静默");
    assert!(process.exit_status().is_some(), "reap 后无句柄，守护看到的是已退出");

    process.adopt(exited_child(0));
    // 刚装上的新进程可能已经跑完了（cmd /c exit 很快），但只要不报「关停中」即可
    assert!(!process.shutting_down.load(Ordering::Relaxed), "adopt 必须清掉关停标志");
    process.kill();
}

#[test]
fn reap_kills_a_still_running_host_before_restart() {
    // 半死状态：宿主进程还活着但桥断了。手动重启时它必须被真的收掉，
    // 否则两个宿主会短暂共用同一个 DSH_HOME 的 storages 目录。
    let process = DshProcess::new(long_running_child());
    assert!(process.exit_status().is_none(), "新起的子进程应在运行");
    process.reap_for_restart();
    // 收掉后句柄为空，守护看到的就是「已退出」
    assert!(process.exit_status().is_some(), "reap 后旧进程必须已不在运行");
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

/// 造一条归因（测试用；字段顺序与宿主实产行一致）。
fn sample_suspect() -> crate::dsh_crash_attribution::Suspect {
    crate::dsh_crash_attribution::Suspect {
        plugin: "dsh-plugin-wallpaper-engine".to_string(),
        method: "GET".to_string(),
        url: "/wallpaper-engine/media/x".to_string(),
        route: "prefix route /wallpaper-engine".to_string(),
        trail: vec![
            "dsh-plugin-wallpaper-engine".to_string(),
            "dsh-plugin-wallpaper-engine".to_string(),
            "client-connection".to_string(),
            "dsh-plugin-wallpaper-engine".to_string(),
        ],
    }
}

#[test]
fn stop_page_shows_the_plugin_trail_when_it_has_something_to_say() {
    // 轨迹的价值在于「崩溃前换过插件」——那才说明这次可能不是随手撞上的。
    let detail = manual_restart_detail("spawn timeout", Some(&sample_suspect()));
    assert!(
        detail.contains("崩溃前依次服务过：dsh-plugin-wallpaper-engine → client-connection → dsh-plugin-wallpaper-engine"),
        "应展示压缩后的轨迹：{detail}",
    );
}

#[test]
fn stop_page_omits_the_trail_when_one_plugin_served_everything() {
    // 全是同一个插件时，把名字再列一遍只是撑长正文，没有判断价值。
    let suspect = crate::dsh_crash_attribution::Suspect {
        plugin: "solo".into(), method: "GET".into(), url: "/solo".into(),
        route: "prefix route /solo".into(),
        trail: vec!["solo".into(), "solo".into(), "solo".into()],
    };
    let detail = manual_restart_detail("spawn timeout", Some(&suspect));
    assert!(!detail.contains("崩溃前依次服务过"), "单插件轨迹不该出现：{detail}");
    assert!(detail.contains("崩溃时正在服务的插件：solo"), "但主体线索仍要在：{detail}");
}

#[test]
fn stop_page_does_not_claim_the_plugin_caused_the_crash() {
    // 设计线：`last route` 只说明崩溃那一刻谁在服务，不主张因果。
    // 实测反例——插件自行抛错时该行记的却是恰好在服务的无关官方插件。
    let detail = manual_restart_detail("spawn timeout", Some(&sample_suspect()));
    assert!(!detail.contains("疑似问题插件："), "不得把线索说成嫌疑：{detail}");
    assert!(detail.contains("不一定是崩溃原因"), "须明确保留这一前提：{detail}");
    // 但仍要给出可执行路径，否则用户只知道线索不知道能做什么
    assert!(detail.contains("停用疑似问题插件后重启"), "须指出菜单入口：{detail}");
}

#[test]
fn stop_page_names_the_suspect_plugin_when_attribution_exists() {
    // 本批的可见产出：用户要看得到「崩溃时谁在服务」，而不是笼统的「反复崩溃」。
    let detail = manual_restart_detail("spawn timeout", Some(&sample_suspect()));
    assert!(detail.contains("崩溃时正在服务的插件：dsh-plugin-wallpaper-engine"), "正文须点名崩溃时在服务的插件：{detail}");
    assert!(detail.contains("GET /wallpaper-engine/media/x"), "正文须带崩溃时在服务的请求：{detail}");
    assert!(detail.contains("prefix route /wallpaper-engine"), "正文须带命中路由：{detail}");
    // 原有信息一条都不能丢
    assert!(detail.contains("最后一次错误：spawn timeout"), "失败原因不能因为点名而丢失：{detail}");
}

#[test]
fn stop_page_keeps_the_old_wording_without_attribution() {
    // 崩在启动期或后台任务时没有归因：绝不能臆造插件名（那样会把用户引去停用无辜插件）。
    let detail = manual_restart_detail("spawn timeout", None);
    assert!(!detail.contains("崩溃时正在服务的插件"), "无证据时不得出现「崩溃时正在服务的插件」：{detail}");
    assert!(detail.contains("最后一次错误：spawn timeout"), "无归因时仍须报失败原因：{detail}");
}

#[test]
fn suspect_plugin_reaches_the_rendered_error_page() {
    // 链的最后一环：文案 → query → 协议页 HTML。少任何一环，用户都看不到插件名。
    let detail = manual_restart_detail("spawn timeout", Some(&sample_suspect()));
    let query = format!(
        "title={}&detail={}",
        crate::dsh_error::percent_encode_pub("Agent 内核已停止运行"),
        crate::dsh_error::percent_encode_pub(&detail),
    );
    let response = crate::dsh_error::error_page_response(&query);
    let html = String::from_utf8_lossy(response.body()).into_owned();
    // <pre> 承载多行正文：插件名必须真的落进 HTML，而不是被编码/截断/吞掉
    assert!(
        html.contains("崩溃时正在服务的插件：dsh-plugin-wallpaper-engine"),
        "插件名未出现在错误页 HTML：{}",
        &html[html.len().saturating_sub(400)..],
    );
    assert!(html.contains("white-space:pre-wrap"), "多行正文需要 pre-wrap 才能换行显示");
}

#[test]
fn a_real_host_stderr_line_ends_up_on_the_error_page() {
    // 全链贯通：宿主真实产出的 stderr 行 → 壳解析 → 归因 → 错误页 HTML。
    // 这是「壳侧归因逻辑链无误」的机器可验证形态，不依赖 WebView 或真实崩溃。
    let line = "dsh: last route: GET /e2e-crash/api/self → prefix route /e2e-crash/api → plugin e2e-crash-plugin";
    let suspect = crate::dsh_crash_attribution::parse_last_route(line)
        .expect("真实宿主行必须能被壳解析");
    let detail = manual_restart_detail("dsh 在打印就绪 URL 前退出", Some(&suspect));
    let query = format!(
        "title={}&detail={}",
        crate::dsh_error::percent_encode_pub("Agent 内核已停止运行"),
        crate::dsh_error::percent_encode_pub(&detail),
    );
    let html = String::from_utf8_lossy(crate::dsh_error::error_page_response(&query).body()).into_owned();
    assert!(html.contains("崩溃时正在服务的插件：e2e-crash-plugin"), "插件名未贯通到页面");
    assert!(html.contains("GET /e2e-crash/api/self"), "崩溃时在服务的请求未贯通到页面");
    assert!(html.contains("dsh 在打印就绪 URL 前退出"), "失败原因未贯通到页面");
}
