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
///「不白屏」安全网、壳桥（`__WORLDSEA_SHELL__`）、窗口栏（C6）、诊断钩子——各自可按开关关掉；
/// 另按 `dsh_home` 透传 **`__WORLDSEA_DSH_HOME__` 常量**（D3-c2b：console「插件数据面」显示缺省生效值）。
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
    titlebar: bool,
    diag: bool,
    capabilities: bool,
    notice: Option<&str>,
    dsh_home: Option<&str>,
) -> String {
    let mut scripts = String::new();
    // E2-b（2026-09-24）：壳自有面（安全网 / 横幅 / 窗口栏退化值）按主题真源取亮暗——先于它们注入
    // A（2026-09-25）补齐 `__WORLDSEA_THEME__`：能力伺服要报主题快照，且与工作台页注入面一致
    scripts.push_str(&format!(
        "<script>/* worldsea-shell:theme */globalThis.__WORLDSEA_THEME__ = \"{}\";globalThis.__WORLDSEA_DARK__ = {}</script>",
        crate::app_prefs::preference_now(),
        crate::app_prefs::dark_now()
    ));
    // D3-c2b：壳解析出的 DSH_HOME（= spawn 时注入宿主 env 的同值）——console 数据面未覆盖时显示缺省生效值
    if let Some(home) = dsh_home {
        match serde_json::to_string(home) {
            Ok(json) => scripts.push_str(&format!(
                "<script>/* worldsea-shell:dsh-home */globalThis.__WORLDSEA_DSH_HOME__ = {json}</script>"
            )),
            Err(error) => eprintln!("[DSH-SHELL] DSH_HOME 序列化失败：{error}"),
        }
    }
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
    // C6：窗口栏（无边框形态的壳件；`WORLDSEA_NO_TITLEBAR=1` 或 `WORLDSEA_FRAMED=1` 时不注入）
    if titlebar {
        scripts.push_str("<script>");
        scripts.push_str(TITLEBAR_SCRIPT);
        scripts.push_str("</script>");
    }
    if diag {
        scripts.push_str("<script>");
        scripts.push_str(DIAG_SCRIPT);
        scripts.push_str("</script>");
    }
    // A（2026-09-25）：Agent 面能力伺服（登记 `agent.*` 能力 + `__WORLDSEA_CAPABILITY_CALL__` 派发入口；
    // `WORLDSEA_NO_CAPABILITY_BRIDGE=1` 反证关——关掉后 agent 提供方缺席，跨窗调用应报 UNKNOWN）
    if capabilities {
        scripts.push_str("<script>");
        scripts.push_str(CAPABILITIES_SCRIPT);
        scripts.push_str("</script>");
    }
    // C4-b：工作区不可供给时的顶部横幅（文案由壳探测结果带出；关掉见 WORLDSEA_NO_WORKSPACE_NOTICE）
    if let Some(message) = notice {
        match serde_json::to_string(message) {
            Ok(json) => {
                scripts.push_str(&format!(
                    "<script>/* worldsea-shell:workspace-notice */globalThis.__WORLDSEA_WORKSPACE_NOTICE__ = {json}</script>"
                ));
                scripts.push_str("<script>");
                scripts.push_str(WORKSPACE_NOTICE_SCRIPT);
                scripts.push_str("</script>");
            }
            Err(error) => eprintln!("[DSH-SHELL] 工作区横幅文案序列化失败：{error}"),
        }
    }
    match find_head_end(html) {
        Some(at) => format!("{}{}{}", &html[..at], scripts, &html[at..]),
        None => format!("{scripts}{html}"),
    }
}

/// D1-a/D1-b（2026-09-24）：**工作台页**（壳协议 `/workspace` 前缀，产物由 `workspace_dist` 伺服）的 index 注入。
/// 只装两件：
/// ① 「不白屏」安全网——挂载点 `#app`（旧前端口径，与 dsh 页的 `#root` 不同）：
///    先置 `__WORLDSEA_BOOT_ROOT__` 再注入同一份 watchdog 脚本（默认值 'root' 保 dsh 行为不变）；
/// ② 空间切换桥（`__WORLDSEA_SPACE_SWITCH__`，D1-b）——旧前端 TitleBar 的「Agent 空间⇄工作台」控件
///    据此走壳命令（双窗互斥）；无该全局时旧前端回退页内切换（浏览器预览/旧壳）。
/// 传输面 / dsh 壳桥 / 注入式窗口栏均**不注入**：工作台不连 dsh，且它自带旧前端 TitleBar 作窗口栏。
pub(crate) fn inject_workspace_scripts(html: &str) -> String {
    let theme_script = format!(
        "<script>/* worldsea-shell:theme */globalThis.__WORLDSEA_THEME__ = \"{}\";\
globalThis.__WORLDSEA_DARK__ = {}</script>",
        crate::app_prefs::preference_now(),
        crate::app_prefs::dark_now()
    );
    let scripts = format!(
        "{theme_script}{BOOT_ROOT_SCRIPT}<script>{WATCHDOG_SCRIPT}</script>{SPACE_SWITCH_BRIDGE}{THEME_SET_BRIDGE}"
    );
    match find_head_end(html) {
        Some(at) => format!("{}{}{}", &html[..at], scripts, &html[at..]),
        None => format!("{scripts}{html}"),
    }
}

/// 产品页主题写回桥（E2-c）：页内设置改主题时调壳命令 → 壳写真源 + 同步 dsh + 广播两窗。
const THEME_SET_BRIDGE: &str = "<script>/* worldsea-shell:theme-set */globalThis.__WORLDSEA_SET_THEME__ = function (value) { return globalThis.__TAURI_INTERNALS__.invoke('cmd_theme_set', { value: value }) }</script>";

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
/// 工作台页挂载点（D1-a）：watchdog 认 `#app`（旧前端口径）。
const BOOT_ROOT_SCRIPT: &str =
    "<script>/* worldsea-shell:boot-root */globalThis.__WORLDSEA_BOOT_ROOT__ = 'app'</script>";
/// 工作台页空间切换桥（D1-b）：旧前端 TitleBar 据此调壳命令做双窗互斥切换。
const SPACE_SWITCH_BRIDGE: &str = "<script>/* worldsea-shell:space-switch */globalThis.__WORLDSEA_SPACE_SWITCH__ = function (target) { return globalThis.__TAURI_INTERNALS__.invoke('cmd_shell_space_switch', { target: target }) }</script>";
/// 壳桥（常驻，可 `WORLDSEA_NO_SHELL_BRIDGE=1` 关）：`__WORLDSEA_SHELL__` 的通知/外链/设置入口/日志。
const SHELL_BRIDGE_SCRIPT: &str = include_str!("dsh_shell_bridge.js");
/// 窗口栏（C6，无边框形态缺省注入；`WORLDSEA_NO_TITLEBAR=1` 反证关）：32px 壳级窗口栏 + 工作台占位页。
const TITLEBAR_SCRIPT: &str = include_str!("dsh_titlebar.js");
/// 流桥（C2 管道模式随 transport 一起注入）：`__WORLDSEA_STREAM__` 的 `openStream` 钩子。
const STREAM_BRIDGE_SCRIPT: &str = include_str!("dsh_stream_bridge.js");
/// 页内诊断（`WORLDSEA_SHELL_DIAG=1` 才注入）：console/异常/资源错误 → 壳日志。
const DIAG_SCRIPT: &str = include_str!("dsh_diag.js");
/// Agent 面能力伺服（A，常驻，可 `WORLDSEA_NO_CAPABILITY_BRIDGE=1` 关）：`agent.face.status` 等。
const CAPABILITIES_SCRIPT: &str = include_str!("dsh_capabilities.js");
/// 工作区横幅（C4-b，仅不可供给时注入）：顶部提示 + 「修复工作区权限」按钮（点击才执行）。
const WORKSPACE_NOTICE_SCRIPT: &str = include_str!("dsh_workspace_notice.js");
