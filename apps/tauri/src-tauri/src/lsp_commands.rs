//! LSP 外挂桥（智能提示三期 B1，立项 §五）：
//! 检测系统 PATH 已装语言服务器 → spawn + stdio Content-Length 帧 ↔ Tauri IPC。
//! server 按语言常驻（编辑器关闭不停），App 真退出时 kill_all 清理（lib.rs RunEvent::Exit）；
//! Windows 侧 LSP 子进程额外挂 Job Object（KillOnJobClose，复用 agent-commands::job::WinJob）——
//! 句柄随 LspProc 生命周期关闭，App 即使被强杀（kill_all 未执行）也会由系统在 job 句柄全部
//! 关闭时整树回收子进程，防孤儿。
//! 前端消息面：emit `lsp-message` {lang, body?, closed?}，命令 cmd_lsp_detect/start/send/stop。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use serde_json::json;
use tauri::{AppHandle, Emitter};

/// 单语言 LSP 进程：stdin 写手 + 子进程句柄（stdout 归读线程持有）。
/// root=进程初始化时的工作区根（跨工程需重启）；gen=代次（区分「被重启替换的旧进程」）；
/// _job=Windows Job Object（KillOnJobClose：drop=关闭句柄=整树终止，兜底强杀/异常退出）
struct LspProc {
    #[allow(dead_code)]
    stdin: ChildStdin,
    child: Child,
    root: String,
    gen: u64,
    #[cfg(windows)]
    _job: Option<crate::win_job::WinJob>,
}

static PROCS: OnceLock<Mutex<HashMap<String, LspProc>>> = OnceLock::new();
static GEN: AtomicU64 = AtomicU64::new(1);

fn procs() -> &'static Mutex<HashMap<String, LspProc>> {
    PROCS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 语言 → (server 程序名, 启动参数)；一期内置映射，设置自定义留后续
fn server_spec(lang: &str) -> Option<(&'static str, &'static [&'static str])> {
    match lang {
        "rust" => Some(("rust-analyzer", &[])),
        "python" => Some(("pyright-langserver", &["--stdio"])),
        "go" => Some(("gopls", &["serve"])),
        "c" | "cpp" => Some(("clangd", &[])),
        "ts" | "tsx" | "js" | "jsx" => Some(("typescript-language-server", &["--stdio"])),
        _ => None,
    }
}

/// PATH 探测：Windows 用 where，其余用 which。
/// Windows 的 where 会命中 npm 全局包的无扩展名 sh 包装脚本（同一命令多行输出），
/// 必须优先选 .exe / .cmd / .bat 命中行，否则 spawn 会失败。
fn which(prog: &str) -> Option<String> {
    let output = if cfg!(windows) {
        Command::new("where").arg(prog).output()
    } else {
        Command::new("which").arg(prog).output()
    };
    match output {
        Ok(o) if o.status.success() => {
            let lines: Vec<String> = String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty())
                .collect();
            let first = lines.first()?.clone();
            if cfg!(windows) {
                let ends_with_any = |l: &String, exts: &[&str]| {
                    let low = l.to_lowercase();
                    exts.iter().any(|e| low.ends_with(e))
                };
                lines
                    .iter()
                    .find(|l| ends_with_any(l, &[".exe"]))
                    .or_else(|| lines.iter().find(|l| ends_with_any(l, &[".cmd", ".bat"])))
                    .cloned()
                    .or(Some(first))
            } else {
                Some(first)
            }
        }
        _ => None,
    }
}

/// spawn server：Windows 下 .cmd/.bat 是批处理包装（npm 全局包常态），Command 不能直接执行，
/// 须经 `cmd /c` 代执；.exe 与无扩展名可执行直接 spawn。
fn spawn_server(prog: &str, args: &[&str], cwd: &std::path::Path) -> std::io::Result<Child> {
    let low = prog.to_lowercase();
    let wrap = cfg!(windows) && (low.ends_with(".cmd") || low.ends_with(".bat"));
    let mut c = if wrap {
        let mut c = Command::new("cmd");
        c.arg("/c").arg(prog);
        c
    } else {
        Command::new(prog)
    };
    c.args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // GUI 模式下 spawn LSP 服务器（cmd /c 包装的 .cmd 尤甚）会闪控制台窗口
    crate::proc_quiet::hide_console(&mut c);
    c.spawn()
}

/// 语言对应的工程清单（上溯时优先匹配本语言标记）
fn lang_manifests(lang: &str) -> &'static [&'static str] {
    match lang {
        "rust" => &["Cargo.toml"],
        "ts" | "tsx" | "js" | "jsx" => &["package.json", "tsconfig.json", "jsconfig.json"],
        "python" => &["pyproject.toml", "setup.py", "requirements.txt"],
        "go" => &["go.mod"],
        "c" | "cpp" => &["compile_commands.json", "CMakeLists.txt"],
        _ => &[],
    }
}

/// 通用工程清单：本语言标记未命中时的兜底识别
const ANY_MANIFESTS: &[&str] = &[
    "Cargo.toml",
    "package.json",
    "tsconfig.json",
    "jsconfig.json",
    "pyproject.toml",
    "go.mod",
    "CMakeLists.txt",
];

/// 工作区根：自文件父目录沿父链上溯，本语言清单优先 → 通用清单；全程无命中回落父目录。
/// 不把 .git 当标记：monorepo 场景下会把 root 抬到仓库根，server 会索引整个仓库（性能风险）。
/// 返回 (根目录, 是否命中清单)——未命中=孤儿目录，server 大概率不产诊断，前端据此降级角标。
fn workspace_root(file_path: &str, lang: &str) -> (std::path::PathBuf, bool) {
    let start = std::path::Path::new(file_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let own = lang_manifests(lang);
    for dir in start.ancestors() {
        if own.iter().any(|m| dir.join(m).is_file()) {
            return (dir.to_path_buf(), true);
        }
    }
    for dir in start.ancestors() {
        if ANY_MANIFESTS.iter().any(|m| dir.join(m).is_file()) {
            return (dir.to_path_buf(), true);
        }
    }
    (start, false)
}

/// 启动结果：工作区根（前端作 rootUri，须与 Rust 侧同口径）+ 是否命中工程清单
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStartInfo {
    root: String,
    has_manifest: bool,
}

/// 探测语言可用的 server：命中返回可执行路径（前端缓存 + 作 start 入参），未装返回 null
#[tauri::command]
pub fn cmd_lsp_detect(lang: String) -> Option<String> {
    let (prog, _) = server_spec(&lang)?;
    which(prog)
}

/// 启动（幂等）：以工程根（沿父链上溯命中的清单目录）spawn server；stdout 读线程解帧 emit `lsp-message`。
/// 返回根路径与清单命中情况——前者供前端算 rootUri（须与 Rust 侧同口径），后者驱动角标降级
#[tauri::command]
pub fn cmd_lsp_start(
    app: AppHandle,
    lang: String,
    exe: String,
    file_path: String,
) -> Result<LspStartInfo, String> {
    let (root, has_manifest) = workspace_root(&file_path, &lang);
    let root_s = root.to_string_lossy().into_owned();
    let mut map = procs().lock().map_err(|e| e.to_string())?;
    if let Some(p) = map.get(&lang) {
        if p.root == root_s {
            // 同工程已运行（常驻语义）；仍回 root 供新开的编辑器算 rootUri
            return Ok(LspStartInfo {
                root: root_s,
                has_manifest,
            });
        }
        // 跨工程：server 的 initialize root 与当前文件不符（常驻会让新工程沿用旧 workspace），
        // 必须重启。先摘表再 kill——旧读线程靠 gen 失配识别，不会误删新条目/误广播 closed
        if let Some(mut old) = map.remove(&lang) {
            let _ = old.child.kill();
            let _ = old.child.wait();
        }
    }
    let (prog, args) = server_spec(&lang).ok_or_else(|| format!("语言 {lang} 无内置 server 配置"))?;
    let exe_or_prog = if exe.is_empty() { prog.to_string() } else { exe };
    let mut child = spawn_server(&exe_or_prog, args, &root)
        .map_err(|e| format!("启动 {exe_or_prog} 失败: {e}"))?;
    // 挂 Job Object（KillOnJobClose，win_job::WinJob——原 agent-commands P1 基础设施打捞版）：
    // 句柄随 LspProc 生命周期关闭 → 系统整树终止（含孙进程），兜底强杀/异常退出防孤儿目标（走查遗留）
    #[cfg(windows)]
    let job_guard = match crate::win_job::WinJob::new()
        .and_then(|job| job.assign(child.id()).map(|()| job))
    {
        Ok(job) => Some(job),
        Err(_) => None, // job 创建/挂入失败：降级为原 kill_all 行为，不阻断 LSP 启动
    };
    let stdin = child.stdin.take().ok_or("stdin 不可用")?;
    let stdout = child.stdout.take().ok_or("stdout 不可用")?;

    let gen = GEN.fetch_add(1, Ordering::Relaxed);
    map.insert(
        lang.clone(),
        LspProc {
            stdin,
            child,
            root: root_s.clone(),
            gen,
            #[cfg(windows)]
            _job: job_guard,
        },
    );
    drop(map); // 读线程结束时也要锁表，先释放

    let app2 = app.clone();
    let lang2 = lang.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_frame(&mut reader) {
                Ok(Some(body)) => {
                    let _ = app2.emit("lsp-message", json!({ "lang": lang2, "body": body }));
                }
                _ => break, // EOF 或帧错误 = 进程退出/异常
            }
        }
        // 收尾：仅当表里仍是本代进程时才摘除并广播 closed。
        // 若已被跨工程重启替换（gen 失配）则静默退出——否则会误删新条目、
        // 并给新编辑器的 transport 误发 closed
        let still_current = match procs().lock() {
            Ok(mut m) => match m.get(&lang2) {
                Some(p) if p.gen == gen => {
                    m.remove(&lang2);
                    true
                }
                _ => false,
            },
            Err(_) => false,
        };
        if still_current {
            let _ = app2.emit("lsp-message", json!({ "lang": lang2, "closed": true }));
        }
    });
    Ok(LspStartInfo {
        root: root_s,
        has_manifest,
    })
}

/// 读一条 LSP 帧：头（Content-Length）+ 空行 + 定长 body
fn read_frame(reader: &mut impl BufRead) -> std::io::Result<Option<String>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None); // EOF
        }
        let l = line.trim();
        if l.is_empty() {
            break;
        }
        if let Some(v) = l.strip_prefix("Content-Length:") {
            content_length = v.trim().parse().ok();
        }
    }
    let len = content_length
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "缺 Content-Length"))?;
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

/// 前端 → server：封帧写 stdin
#[tauri::command]
pub fn cmd_lsp_send(lang: String, body: String) -> Result<(), String> {
    let mut map = procs().lock().map_err(|e| e.to_string())?;
    let p = map.get_mut(&lang).ok_or("LSP 未运行")?;
    let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
    p.stdin
        .write_all(frame.as_bytes())
        .and_then(|_| p.stdin.flush())
        .map_err(|e| format!("写入失败: {e}"))
}

/// 手动停某语言 server（一期主要供排障；正常生命周期=常驻至 App 退出）。
/// 注：先摘表再 kill，读线程见 gen 失配不会广播 closed（主动停止不视为异常断开）
#[tauri::command]
pub fn cmd_lsp_stop(lang: String) -> Result<(), String> {
    if let Ok(mut m) = procs().lock() {
        if let Some(mut p) = m.remove(&lang) {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }
    Ok(())
}

/// App 退出清理：杀全部 LSP 子进程（lib.rs RunEvent::Exit 调用，防孤儿进程）
pub fn kill_all() {
    if let Ok(mut m) = procs().lock() {
        for (_, mut p) in m.drain() {
            let _ = p.child.kill();
            let _ = p.child.wait();
        }
    }
}
