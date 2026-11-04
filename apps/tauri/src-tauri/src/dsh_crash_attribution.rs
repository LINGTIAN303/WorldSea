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

/// 宿主一次崩溃最多写多少行 `last route:`（与宿主侧 `ACTIVITY_HISTORY` 对齐）。
///
/// 用途不只是展示：`observe_line` 靠它判定「上一轮是否已经收满，这一条属于下次崩溃」。
/// 两边若不同步，线索会跨轮混在一起——宿主改大这个值时这里必须跟着改。
const ACTIVITY_TRAIL_LIMIT: usize = 5;

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
    /// 崩溃前宿主依次服务过的插件名（按时间先后，含本次）。
    ///
    /// 宿主保留最近几条路由，这里取每条的插件名。看不出差异时不主张什么——
    /// 它的价值在于「是被同一个插件密集刷，还是夹在一堆无关请求里」这一点。
    pub trail: Vec<String>,
}

impl Suspect {
    /// 一行人类可读描述，用于应用日志。
    pub fn summary(&self) -> String {
        format!("{} {}（路由 {}）", self.plugin, self.url, self.route)
    }

    /// 崩溃前依次服务过的插件名（含本次，按时间先后，已去重相邻重复）。
    ///
    /// 宿主只保留最近几条路由（`ACTIVITY_HISTORY`）；这里把它们的插件名摊平，
    /// 让用户看出「是某个插件在密集刷同一路由」还是「一堆不相干的请求里夹了这一次」。
    pub fn plugin_trail(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for step in &self.trail {
            if out.last() != Some(step) {
                out.push(step.clone());
            }
        }
        out
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
    /// 记一次崩溃的完整线索（每次崩溃开头调用：清掉上一轮的残留）。
    pub fn begin(&self, suspect: Suspect) {
        if let Ok(mut guard) = self.suspect.lock() {
            *guard = Some(suspect);
        }
    }

    /// 追加一条同一次崩溃内更早的路由（宿主按「旧→新」输出，故先到的其实是更早的）。
    ///
    /// 只在已有记录时追加；没有主体记录就说明这行不属于一次已知崩溃，忽略。
    pub fn push_trail(&self, plugin: &str) {
        if let Ok(mut guard) = self.suspect.lock() {
            if let Some(suspect) = guard.as_mut() {
                suspect.trail.push(plugin.to_string());
            }
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
        trail: vec![plugin.to_string()],
    })
}

/// 宿主一次崩溃会连续写多行 `last route:`（旧→新，最后一行是崩溃瞬间）。
///
/// 这里按到达顺序累积：**第一条开新记录**（`begin`），后续追加进同一条的 `trail`。
/// 判定「这是新一轮的第一条」靠 `ACTIVITY_TRAIL_LIMIT`：宿主最多写这么多行，
/// 收满即说明上一轮结束；再来的必然是下一次崩溃的首条。
/// 若宿主某轮少于上限（例如中途又被重启打断），`clear()` 也会把它归零。
pub fn observe_line(app: &tauri::AppHandle, line: &str) {
    let Some(suspect) = parse_last_route(line) else { return };
    let Some(state) = app.try_state::<DshCrashAttribution>() else { return };
    let existing_len = state.current().map_or(0, |existing| existing.trail.len());
    let starts_new = existing_len == 0 || existing_len >= ACTIVITY_TRAIL_LIMIT;
    if starts_new {
        println!("[DSH-SHELL] 崩溃线索：宿主崩溃时正在服务插件 {}", suspect.summary());
        state.begin(suspect);
    } else {
        state.push_trail(&suspect.plugin);
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
        // 线索属于「最近一次崩溃」：新崩溃覆盖旧的，宿主重新就绪后清空。
        let state = DshCrashAttribution::default();
        assert_eq!(state.current(), None);
        state.begin(Suspect {
            plugin: "a".into(), method: "GET".into(), url: "/a".into(),
            route: "prefix route /a".into(), trail: vec!["a".into()],
        });
        state.begin(Suspect {
            plugin: "b".into(), method: "GET".into(), url: "/b".into(),
            route: "prefix route /b".into(), trail: vec!["b".into()],
        });
        assert_eq!(state.current().map(|s| s.plugin), Some("b".into()));
        state.clear();
        assert_eq!(state.current(), None);
    }

    #[test]
    fn trail_accumulates_in_arrival_order_and_dedupes_neighbours() {
        // 宿主按「旧→新」写多行；`plugin_trail` 保留先后关系，但把连写的同一插件合成一项，
        // 这样「某插件密集刷同一路由」读起来就是一段，而不是五个同样的名字。
        let state = DshCrashAttribution::default();
        state.begin(Suspect {
            plugin: "a".into(), method: "GET".into(), url: "/a".into(),
            route: "prefix route /a".into(), trail: vec!["a".into()],
        });
        for name in ["a", "a", "b", "a"] {
            state.push_trail(name);
        }
        let suspect = state.current().expect("应有记录");
        assert_eq!(suspect.plugin, "a", "主体仍是首条的插件");
        assert_eq!(suspect.plugin_trail(), vec!["a", "b", "a"], "相邻重复应合并");
    }

    #[test]
    fn pushing_a_trail_without_a_subject_is_ignored() {
        // 没有主体记录时追加是无意义的：那行不属于任何一次已知崩溃。
        let state = DshCrashAttribution::default();
        state.push_trail("ghost");
        assert_eq!(state.current(), None);
    }
}
