// C2-b（2026-09-24）：index 注入脚本装配——从 dsh_proxy.rs 拆出（转发核心回到 400 行内）。
//
// 口径（顺序契约见 C1-b，C2-b 扩展）：壳脚本插到 `<head>` 之后、**早于**宿主注入行与全部模块脚本；
// 注入面按 [`TransportInject`] 三态：无 / `streamBaseUrl`（legacy WS 中转）/ `openStream`（C2 管道 mux）；
// 另有常驻安全网与可关壳桥、诊断钩子——各自独立开关，互不越级。

/// 注入页面的传输写法。
pub(crate) enum TransportInject {
    /// 不注入——`WORLDSEA_NO_TRANSPORT_INJECT=1` 反证模式：页面退到 WS 路径，流面必须显式降级。
    None,
    /// legacy：`streamBaseUrl`（页面连壳内 WS 中转）。
    StreamBase(String),
    /// C2：`openStream` 钩子（逻辑流经壳的 Tauri IPC 直达管道）。
    OpenStream,
}

impl TransportInject {
    /// 本态是否需要注入传输类脚本（含流桥脚本）。
    pub(crate) fn wants_scripts(&self) -> bool {
        !matches!(self, TransportInject::None)
    }
}

/// 注入壳脚本（**只合并不覆盖**）：「流桥 + `__DSH_TRANSPORT__`」（传输面，按 [`TransportInject`] 三态）、
///「不白屏」安全网、壳桥（`__WORLDSEA_SHELL__`）、诊断钩子——各自可按开关关掉。
///
/// **顺序契约**（C1-b 成文，C2-b 扩展）：宿主渲染的 index 里，`<base href="./">` 与 `__DSH_BOOT__` 等行紧跟 `<head>`；
/// 壳在本函数里把脚本插到**同一个位置的最前**（即 `<head>` 之后、所有宿主行与模块脚本之前）：
/// ① 流桥脚本先于 transport 行（transport 行要从中取 `openStream`）；
/// ② 全部注入都必在客户端 `apply()` 与页面脚本前就位；③ 宿主注入行原样保留、顺序不变；
/// ④ `__DSH_BOOT_READY__`（宿主尾行）壳不碰。均有 tests 锁定。
pub(crate) fn inject_shell_scripts(
    html: &str,
    transport: &TransportInject,
    bridge: bool,
    diag: bool,
) -> String {
    let mut scripts = String::new();
    match transport {
        TransportInject::None => {}
        TransportInject::StreamBase(base_url) => {
            scripts.push_str(&format!(
                "<script>/* worldsea-shell:transport */globalThis.__DSH_TRANSPORT__ = Object.assign({{}}, globalThis.__DSH_TRANSPORT__, {{ ownsHost: true, streamBaseUrl: \"{base_url}\" }})</script>"
            ));
        }
        TransportInject::OpenStream => {
            scripts.push_str("<script>");
            scripts.push_str(STREAM_BRIDGE_SCRIPT);
            scripts.push_str("</script>");
            scripts.push_str(
                "<script>/* worldsea-shell:transport */globalThis.__DSH_TRANSPORT__ = Object.assign({}, globalThis.__DSH_TRANSPORT__, { ownsHost: true, openStream: globalThis.__WORLDSEA_STREAM__.openStream })</script>",
            );
        }
    }
    scripts.push_str("<script>");
    scripts.push_str(WATCHDOG_SCRIPT);
    scripts.push_str("</script>");
    if bridge {
        scripts.push_str("<script>");
        scripts.push_str(SHELL_BRIDGE_SCRIPT);
        scripts.push_str("</script>");
    }
    if diag {
        scripts.push_str("<script>");
        scripts.push_str(DIAG_SCRIPT);
        scripts.push_str("</script>");
    }
    match find_head_end(html) {
        Some(at) => format!("{}{}{}", &html[..at], scripts, &html[at..]),
        None => format!("{scripts}{html}"),
    }
}

/// `<head …>` 开标签结束位置（大小写不敏感）；`to_ascii_lowercase` 不改字节长度，索引可直接复用。
fn find_head_end(html: &str) -> Option<usize> {
    let lower = html.to_ascii_lowercase();
    let start = lower.find("<head")?;
    let after_name = &lower[start + 5..];
    let is_tag = after_name.starts_with('>') || after_name.starts_with(char::is_whitespace);
    if !is_tag {
        return None;
    }
    let end = after_name.find('>')?;
    Some(start + 5 + end + 1)
}

/// 「不白屏」安全网（常驻）：入口脚本失败或长时间无渲染时就地出示错误页。
const WATCHDOG_SCRIPT: &str = include_str!("dsh_watchdog.js");
/// 壳桥（常驻，可 `WORLDSEA_NO_SHELL_BRIDGE=1` 关）：`__WORLDSEA_SHELL__` 的通知/外链/设置入口/日志。
const SHELL_BRIDGE_SCRIPT: &str = include_str!("dsh_shell_bridge.js");
/// 流桥（C2 管道模式随 transport 一起注入）：`__WORLDSEA_STREAM__` 的 `openStream` 钩子。
const STREAM_BRIDGE_SCRIPT: &str = include_str!("dsh_stream_bridge.js");
/// 页内诊断（`WORLDSEA_SHELL_DIAG=1` 才注入）：console/异常/资源错误 → 壳日志。
const DIAG_SCRIPT: &str = include_str!("dsh_diag.js");
