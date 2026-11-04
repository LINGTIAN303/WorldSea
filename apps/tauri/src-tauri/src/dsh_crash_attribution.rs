// 宿主崩溃的插件线索——从宿主 stderr 的 `last route:` 行解析出「崩溃时正在服务哪个插件」。
//
// **这是线索，不是判决**。`last route` 记录的是宿主最后一次成功派发的路由；崩溃可能来自
// 别处（后台任务、事件回调、定时器）。实测反例（2026-11-04）：一个插件在启动 8 秒后自行
// 抛错，但那期间页面恰好在调 `/api/settings/describe`，于是该行记的是 `client-connection`
// ——一个与崩溃毫无关系的官方内置插件。
//
// 故本模块只回答「崩溃那一刻谁在服务」，把判断留给用户：
// - 文案一律用「崩溃时正在服务」而非「疑似元凶」；
// - 没有该行时保持原错误页，绝不臆造；
// - 停用侧（`dsh_plugin_control`）另有硬约束：只碰外部插件，官方内置一律拒绝。
//
// 宿主在致命诊断里补写这一行（`installFailLoud` 的 activity 供应器）：
//
//   dsh: last route: GET /wallpaper-engine/media/x → prefix route /wallpaper-engine → plugin wallpaper-engine
//
// 拿到插件名后不必再从路径前缀反推包名（两者经常不同）。

use std::sync::Mutex;

use tauri::Manager;

/// 一次崩溃时正在服务的插件。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suspect {
    /// 插件名（宿主 fiber 名，通常等于 profile 里该 bundle 的包名）。
    pub plugin: String,
    /// 崩溃时正在服务的请求方法（如 `GET`）。
    pub method: String,
    /// 请求路径（如 `/wallpaper-engine/media/x`）。
    pub url: String,
    /// 命中的路由种类与注册路径（如 `prefix route /wallpaper-engine`）。
    pub route: String,
}

impl Suspect {
    /// 一行人类可读描述，用于错误页正文与应用日志。
    pub fn summary(&self) -> String {
        format!("{} {}（路由 {}）", self.plugin, self.url, self.route)
    }
}

/// 最近一次崩溃的归因；`None` 表示没有证据（宿主崩在非路由路径，或宿主没打印该行）。
///
/// 每次宿主重启时清空——否则一次崩溃的归因会一直挂在后续正常运行的页面上，
/// 让用户以为是当前故障。
#[derive(Default)]
pub struct DshCrashAttribution {
    suspect: Mutex<Option<Suspect>>,
}

impl DshCrashAttribution {
    /// 记下一次归因（覆盖旧的：用户看到的总应是最近这次崩溃的原因）。
    pub fn record(&self, suspect: Suspect) {
        if let Ok(mut guard) = self.suspect.lock() {
            *guard = Some(suspect);
        }
    }

    /// 取当前归因的副本。
    pub fn current(&self) -> Option<Suspect> {
        self.suspect.lock().ok().and_then(|guard| guard.clone())
    }

    /// 清空（宿主重新就绪时调用——归因只对已死的那个宿主成立）。
    pub fn clear(&self) {
        if let Ok(mut guard) = self.suspect.lock() {
            *guard = None;
        }
    }
}

/// 从宿主 stderr 的一行里解析归因；不是 `last route:` 行则返回 `None`。
///
/// 兼容两种形态：带 `→ plugin <名>`（本轮起）与不带（旧宿主 / 根 fiber 注册的路由）。
/// 后者**不产出归因**——没有插件名就无从指名，返回 `None` 比猜一个更诚实。
///
/// 行格式由宿主决定（`apps/cli/src/profile-boot.ts`），本函数是它的对端：
/// `last route: <METHOD> <url> → <kind> route <path> → plugin <name>`
pub fn parse_last_route(line: &str) -> Option<Suspect> {
    let rest = line.split_once("last route:")?.1.trim();
    // 插件名是唯一能指名被告的字段；缺失即放弃（不猜）
    let (head, plugin) = rest.rsplit_once("→ plugin ")?;
    let plugin = plugin.trim();
    if plugin.is_empty() {
        return None;
    }
    // head = "<METHOD> <url> → <kind> route <path>"
    let (request, route) = head.split_once(" → ")?;
    let (method, url) = request.trim().split_once(' ')?;
    Some(Suspect {
        plugin: plugin.to_string(),
        method: method.trim().to_string(),
        url: url.trim().to_string(),
        route: route.trim().to_string(),
    })
}

/// 把宿主 stderr 的一行喂进来：若是 `last route:` 行则记归因。
///
/// 在 stderr 读取线程里调用（见 `dsh_shell::spawn_and_wait_ready`）。
pub fn observe_line(app: &tauri::AppHandle, line: &str) {
    let Some(suspect) = parse_last_route(line) else { return };
    println!("[DSH-SHELL] 归因：宿主崩溃时正在服务插件 {}", suspect.summary());
    if let Some(state) = app.try_state::<DshCrashAttribution>() {
        state.record(suspect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_host_line_with_the_plugin_name() {
        // 输入是**真实宿主崩溃时的原样 stderr 行**（2026-11-04 实测捕获：
        // 隔离 DSH_HOME + 真 Loader 挂一个在路由服务中抛错的插件）。
        // 不是手写样例——宿主改了行格式而不改壳，这条会先红。
        let line = "dsh: last route: GET /e2e-crash/api/self → prefix route /e2e-crash/api → plugin e2e-crash-plugin";
        let got = parse_last_route(line).expect("应解析出归因");
        assert_eq!(got.plugin, "e2e-crash-plugin");
        assert_eq!(got.method, "GET");
        assert_eq!(got.url, "/e2e-crash/api/self");
        assert_eq!(got.route, "prefix route /e2e-crash/api");
    }

    #[test]
    fn parses_a_line_where_the_plugin_name_differs_from_the_path_prefix() {
        // 本批存在的理由：路由前缀 `/wallpaper-engine` 与包名
        // `dsh-plugin-wallpaper-engine` 不同，壳若靠路径反推必然指错。
        let line = "dsh: last route: GET /wallpaper-engine/media/x → prefix route /wallpaper-engine → plugin dsh-plugin-wallpaper-engine";
        let got = parse_last_route(line).expect("应解析出归因");
        assert_eq!(got.plugin, "dsh-plugin-wallpaper-engine");
        assert_eq!(got.url, "/wallpaper-engine/media/x");
        assert_ne!(got.route.trim_start_matches("prefix route "), got.plugin, "两者本就不应相等");
    }

    #[test]
    fn ignores_a_line_without_the_plugin_suffix() {
        // 旧宿主 / 根 fiber 注册的路由没有插件名：无从指名，必须返回 None 而不是猜。
        assert_eq!(parse_last_route("dsh: last route: GET /api/x → prefix route /api"), None);
        assert_eq!(parse_last_route("dsh: last route: GET /x → exact route /x → plugin "), None);
    }

    #[test]
    fn ignores_unrelated_lines() {
        // 宿主的其它诊断（致命错误、profile 警告）不能被误读成归因。
        assert_eq!(parse_last_route("dsh: fatal uncaught exception: Error: boom"), None);
        assert_eq!(parse_last_route("dsh: warning: 1 entry did not activate"), None);
        assert_eq!(parse_last_route(""), None);
    }

    #[test]
    fn tolerates_surrounding_whitespace_and_windows_line_endings() {
        // stderr 逐行读取会带 \r（Windows），且前缀长度不固定。
        let line = "dsh: last route: POST /p/a → exact route /p/a → plugin p\r";
        let got = parse_last_route(line).expect("应解析出归因");
        assert_eq!(got.plugin, "p");
        assert_eq!(got.method, "POST");
        assert!(!got.route.contains('\r'), "route 不应含行尾回车：{:?}", got.route);
        assert_eq!(got.url, "/p/a");
    }

    #[test]
    fn attribution_is_replaceable_and_clearable() {
        // 归因属于「最近一次崩溃」：新崩溃覆盖旧的，宿主重新就绪后清空。
        let state = DshCrashAttribution::default();
        assert_eq!(state.current(), None);
        state.record(Suspect {
            plugin: "a".into(), method: "GET".into(), url: "/a".into(), route: "prefix route /a".into(),
        });
        state.record(Suspect {
            plugin: "b".into(), method: "GET".into(), url: "/b".into(), route: "prefix route /b".into(),
        });
        assert_eq!(state.current().map(|s| s.plugin), Some("b".into()));
        state.clear();
        assert_eq!(state.current(), None);
    }
}
