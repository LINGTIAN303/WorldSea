// B2 壳接入（2026-09-23）：Tauri 壳承载 dsh —— spawn dsh host（node）+ 就绪探测 + WebView 导航 + 退出回收。
//
// 口径（见 docs/plans/2026-09-23-dsh接管Agent面-大重构准备.md §六）：
// - 只 spawn + 探测 + 导航；不改 dsh 树、不手写协议客户端（界面 100% 保留）。
// - 就绪信号 = 启动器打印的 `dsh web: http://127.0.0.1:<port>/?token=…`。
// - 异常路径（spawn 失败 / 就绪超时 / 子进程中途退出）导航到可辨认错误页，不静默白屏。

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, WebviewWindow};

use crate::dsh_workspace::{announce_workspace, resolve_workspace, strip_verbatim_prefix};

/// 就绪等待上限（冷启动 + profile 首启都在这条路径上）
const READY_TIMEOUT: Duration = Duration::from_secs(90);

/// dsh 子进程句柄：退出时回收；供心跳守护查询存活态。
pub struct DshProcess {
    child: Mutex<Option<Child>>,
    shutting_down: AtomicBool,
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

    /// 子进程是否已退出（守护线程轮询用；无句柄视为已退出）。
    fn has_exited(&self) -> bool {
        if self.shutting_down.load(Ordering::Relaxed) {
            return false;
        }
        match self.child.lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(child) => !matches!(child.try_wait(), Ok(None)),
                None => true,
            },
            Err(_) => false,
        }
    }
}

/// 取一个空闲的 loopback 端口（绑定 :0 后释放）——**仅用于 legacy TCP 模式**；
/// 管道模式下该端口只是「声明 authority」（URL 打印与 cookie 绑定用），无人监听。
fn free_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("探测空闲端口失败：{e}"))?;
    let port = listener.local_addr().map_err(|e| format!("读取端口失败：{e}"))?.port();
    drop(listener);
    Ok(port)
}

/// 生成本次会话的管道路径（壳持有命名权；宿主按此绑定）：
/// Windows = `\\.\pipe\worldsea-dsh-<pid>-<时间戳>`；POSIX = 临时目录下短名套接字。
fn generate_pipe_path() -> String {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    if cfg!(windows) {
        format!(r"\\.\pipe\worldsea-dsh-{pid}-{stamp}")
    } else {
        let base = std::env::temp_dir();
        let _ = std::fs::create_dir_all(&base);
        base.join(format!("worldsea-dsh-{pid}-{stamp}.sock")).to_string_lossy().to_string()
    }
}

/// 定位仓内 dsh 树：`WORLDSEA_DSH_ROOT` 优先；否则按 CARGO_MANIFEST_DIR 上溯（dev 口径）。
fn resolve_dsh_root() -> Result<PathBuf, String> {
    let bin_rel = ["apps", "cli", "lib", "bin.js"];
    if let Some(raw) = std::env::var_os("WORLDSEA_DSH_ROOT") {
        let candidate = strip_verbatim_prefix(PathBuf::from(raw));
        return if candidate.join(bin_rel.iter().collect::<PathBuf>()).exists() {
            Ok(candidate)
        } else {
            Err(format!(
                "WORLDSEA_DSH_ROOT 指向的目录里没有 apps/cli/lib/bin.js：{}（先在该树执行 pnpm install && pnpm run build）",
                candidate.display()
            ))
        };
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest.join("..").join("..").join("..").join("dsh");
    let candidate = strip_verbatim_prefix(candidate.canonicalize().unwrap_or(candidate));
    if candidate.join(bin_rel.iter().collect::<PathBuf>()).exists() {
        Ok(candidate)
    } else {
        Err(format!(
            "未找到 dsh 树：{}（先在本仓 dsh/ 执行 pnpm install && pnpm run build；或用 WORLDSEA_DSH_ROOT 指定）",
            candidate.display()
        ))
    }
}

/// 启动 dsh host 并等就绪；返回（子进程句柄, 带 token 的 URL, 管道路径, 工作区横幅文案）。
/// 管道路径仅在默认（C2 零 TCP）模式生成；`WORLDSEA_TCP_HOST=1` 走 legacy（无管道）。
/// 横幅文案仅在「工作区不可供给且未关闭横幅」时非空（C4-b 起由 index 注入带出）。
pub fn spawn_and_wait_ready(
    app: &tauri::AppHandle,
) -> Result<(Child, String, Option<String>, Option<String>), String> {
    let root = resolve_dsh_root()?;
    let port = free_loopback_port()?;
    let node = std::env::var("WORLDSEA_NODE").unwrap_or_else(|_| "node".to_string());
    let bin = root.join("apps").join("cli").join("lib").join("bin.js");
    // 传输模式：默认管道（零 TCP）；`WORLDSEA_TCP_HOST=1` = C1 legacy 形态（对照口，冻结）
    let pipe_path = if std::env::var_os("WORLDSEA_TCP_HOST").is_some() {
        println!("[DSH-SHELL] WORLDSEA_TCP_HOST=1：legacy TCP 模式（宿主按端口监听，壳走 C1 转发链）");
        None
    } else {
        Some(generate_pipe_path())
    };
    // DSH_HOME 口径（2026-09-24 更正）：**默认隔离到本应用数据目录**（`<app_data>/dsh-home`），
    // 避免与用户其它 dsh 用法/第三方 profile 混用；`WORLDSEA_DSH_HOME` 可显式覆盖。
    // 更正说明：此前记录的「空 DSH_HOME 会让 dsh 静默退出」为**测试形式造成的假象**
    // （`timeout`+`env`+`>文件` 形式；实测管道形式下空 home 首启正常，dsh 会自动 initProfile）。
    let home = match std::env::var_os("WORLDSEA_DSH_HOME") {
        Some(raw) => PathBuf::from(raw),
        None => app
            .path()
            .app_data_dir()
            .map_err(|e| format!("定位应用数据目录失败：{e}"))?
            .join("dsh-home"),
    };
    std::fs::create_dir_all(&home).map_err(|e| format!("创建 DSH_HOME 失败：{e}"))?;

    // C4-a：默认工作区 = 用户 profile 下的专用目录（`WORLDSEA_WORKSPACE` 可覆盖）。
    // 此前把 dsh 树本身当 cwd——既非产品语义（工作区应是用户的目录），也必踩 D: 盘 ACL 的沙箱前提。
    let workspace = resolve_workspace(app)?;
    let workspace_notice = announce_workspace(app, &workspace);

    let pipe_arg = pipe_path.clone().unwrap_or_else(|| "(legacy tcp)".to_string());
    tracing::info!(
        "dsh shell: spawn {node} {} web --no-open --port {port} --ipc-pipe {pipe_arg}（DSH_HOME={}, 工作区={}）",
        bin.display(),
        home.display(),
        workspace.display()
    );
    // 控制台直出（与 [HTTP-BRIDGE] 同风格）：tracing 无订阅者，故障排查必须能看见这几行
    println!(
        "[DSH-SHELL] spawn {node} {} web --no-open --port {port} (pipe={pipe_arg}, DSH_HOME={}, workspace={})",
        bin.display(),
        home.display(),
        workspace.display()
    );
    // 壳 overlay（B4-a）：打开 web 下默认禁用的右栏内置浏览器等「desktop 才启用」的条目。
    // 位置固定为 `<仓根>/apps/tauri/dsh-overlay.yml`（dsh 树在仓根，故取其父目录）；缺失则跳过。
    let overlay = root
        .parent()
        .map(|repo| repo.join("apps").join("tauri").join("dsh-overlay.yml"))
        .filter(|candidate| candidate.exists());
    let mut command = Command::new(&node);
    command
        .arg(&bin)
        .arg("web");
    // 注意顺序：launcher 标志必须排在 app 参数之前（`--no-open`/`--port`/`--ipc-pipe` 属 web app 的参数）——
    // 先例 `dsh web --patch <file>`（dsh/apps/web/tests/pin-browse-picker.overlay.yml）。
    if let Some(overlay) = &overlay {
        command.arg("--patch").arg(overlay);
        println!("[DSH-SHELL] overlay: {}", overlay.display());
    }
    command
        .arg("--no-open")
        .arg("--port")
        .arg(port.to_string());
    if let Some(pipe) = &pipe_path {
        command.arg("--ipc-pipe").arg(pipe);
    }
    command
        .current_dir(&workspace)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // DSH_HOME 一律显式传入（默认=应用数据目录下的隔离 home，或 WORLDSEA_DSH_HOME 覆盖）
    command.env("DSH_HOME", &home);
    // E1（2026-09-25）：把**解析后的**工作区显式交给 dsh（overlay 的 `workspace-controller.documentsDirectory`
    // 读它 → 「首次使用默认工作区」候选落在单一可见根内，不再指向 Documents\deepseek-harness）
    command.env("WORLDSEA_WORKSPACE", &workspace);
    // C5（凭证批）：凭据取向 = 库优先 + env 兜底（判定、留痕与反证开关见 dsh_credentials.rs）
    crate::dsh_credentials::apply_credential_env(&mut command, &home);
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动 dsh 失败（node={node}）：{e}"))?;
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.contains("127.0.0.1:") && line.contains("/?token=") {
                    let url = line
                        .split_whitespace()
                        .find(|w| w.starts_with("http://127.0.0.1:"))
                        .unwrap_or("")
                        .to_string();
                    let _ = tx.send(url);
                } else if !line.trim().is_empty() {
                    // 宿主侧日志就地可见（排障必需）：C2-b 起宿主负责管道载体与流 lane，
                    // 其排障行（pipe-transport / 协议违规）只在宿主 stdout 上。
                    println!("[DSH-HOST] {line}");
                }
            }
            // 子进程 stdout 关闭 = 进程行将退出
            let _ = tx.send(String::new());
        });
    }
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[DSH-SHELL] dsh(stderr): {line}");
            }
        });
    }

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(url) if !url.is_empty() => {
            println!("[DSH-SHELL] ready: {url}");
            Ok((child, url, pipe_path, workspace_notice))
        }
        Ok(_) => {
            let _ = child.kill();
            Err("dsh 在打印就绪 URL 前退出（详见应用日志；常见原因：profile 依赖缺失，见 B2 批次发现）".to_string())
        }
        Err(_) => {
            let _ = child.kill();
            Err(format!("dsh 就绪超时（{}s）", READY_TIMEOUT.as_secs()))
        }
    }
}

/// B2 壳接入装配（C1-a 起含协议桥；C2-b 起默认管道传输）：spawn 宿主 → 等就绪 → 桥（可回退直连）
/// → 挂句柄 + 心跳守护。具体导航与回退分支见 `dsh_bridge::attach`；口径与批次见
/// docs/plans/2026-09-23-dsh接管Agent面-大重构准备.md §六 与 C2 批计划 §五。
pub fn install(app: &tauri::AppHandle, window: Option<&WebviewWindow>) {
    // C6-fix（2026-09-24）：宿主 spawn / 就绪等待**移入后台线程**——setup 不再被阻塞（此前 ~12s）。
    // 根因（CDP 实测）：Tauri 对 frontendDist（启动页）的**初始导航**排在 setup 之后执行；
    // setup 被本函数同步阻塞期间窗口始终为空文档（黑屏），结束后初始导航又被紧随的 dsh 导航
    // 瞬间替换 → 启动页从未可见。后台化后：窗口立即可见 → 启动页展示 → 宿主就绪 → attach（导航）。
    let app_handle = app.clone();
    let window = window.cloned();
    std::thread::spawn(move || match spawn_and_wait_ready(&app_handle) {
        Ok((child, url, pipe_path, workspace_notice)) => {
            tracing::info!("dsh shell: ready at {url}");
            crate::dsh_bridge::attach(
                &app_handle,
                window.as_ref(),
                &url,
                pipe_path.as_deref(),
                workspace_notice.as_deref(),
            );
            app_handle.manage(DshProcess::new(child));
            watch_child(app_handle.clone());
        }
        Err(e) => {
            tracing::error!("dsh shell: {e}");
            eprintln!("[DSH-SHELL] 启动失败：{e}");
            if let Some(window) = &window {
                show_error(window, "dsh 未能启动", &e);
            }
        }
    });
}

/// 把主窗口导航到 dsh 带 token 的 URL；失败则显示可辨认错误页。
pub fn navigate_to_dsh(window: &WebviewWindow, url: &str) {
    match url.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                show_error(window, "无法加载 dsh 界面", &format!("窗口导航失败：{e}"));
            }
        }
        Err(e) => show_error(window, "无法加载 dsh 界面", &format!("URL 解析失败：{e}（{url}）")),
    }
}

/// 子进程心跳守护：运行中退出 → 导航到可辨认错误页（首期不加自动重启，保留证据）。
pub fn watch_child(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));
        let state = app.try_state::<DshProcess>();
        let Some(state) = state else { return };
        if state.shutting_down.load(Ordering::Relaxed) {
            return;
        }
        if state.has_exited() {
            tracing::error!("dsh shell: dsh 子进程已退出（未随应用关停）");
            eprintln!("[DSH-SHELL] dsh 子进程已退出（未随应用关停）");
            // C1-c：附一条系统通知——窗口可能被收进托盘，错误页在屏幕上看不见（通知失败不影响主流程）
            {
                use tauri_plugin_notification::NotificationExt;
                if let Err(e) = app
                    .notification()
                    .builder()
                    .title("WorldSea")
                    .body("Agent 内核（dsh）已退出，界面已停止更新。请重启应用恢复。")
                    .show()
                {
                    eprintln!("[DSH-SHELL] 退出通知发送失败：{e}");
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                show_error(
                    &window,
                    "dsh 已退出",
                    "与 Agent 内核的连接已中断。请退出应用后重新启动以恢复。\n（详细日志见应用日志与 DSH_HOME 下的 startup 诊断报告。）",
                );
            }
            return;
        }
    });
}

/// 可辨认失败态：把窗口导航到内联错误页（不静默白屏）。HTML 模板与色板单点在 `app_prefs::error_page_html`。
pub fn show_error(window: &WebviewWindow, title: &str, detail: &str) {
    let html = crate::app_prefs::error_page_html(title, detail);
    let url = format!("data:text/html;charset=utf-8,{}", percent_encode(&html));
    match url.parse::<tauri::Url>() {
        Ok(parsed) => {
            if let Err(e) = window.navigate(parsed) {
                tracing::error!("dsh shell: 错误页导航失败：{e}");
            }
        }
        Err(e) => tracing::error!("dsh shell: 错误页 URL 解析失败：{e}"),
    }
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\''
            | b'(' | b')' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
