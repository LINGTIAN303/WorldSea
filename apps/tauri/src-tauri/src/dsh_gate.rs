// 路径闸门：放行集合、判定与拒绝响应（从 dsh_proxy.rs 拆出，控制单文件规模）。
// 口径：壳侧先判一遍（越界 403 / 越权 405 / 放行集合），宿主仍会按其静态伺服语义再判一次。
// 放行集合 = **静态底集**（dsh 内置路由 + dist 根文件，枚举自宿主源码）∪ **运行期快照**
// （宿主 hello 自报的前缀表）。后者是第三方插件命名空间的来源——插件在运行时注册路由，
// 壳内无法预先枚举，故不再手工记账。
//
// 关键判断：这层闸门挡的是「页面被 XSS 后借道」，**不是**「恶意插件」——插件代码本身就跑在
// 宿主进程内（能读任意文件、能注册任意路由），对插件命名空间做精确字符串匹配不构成安全边界。
// 故对插件前缀放宽的收益损失有限，而摩擦成本（漏登记 = 静默 404）是全额。

/// 允许的方法：协议面只服务页面自用（读 + RPC 的 POST 写）。其余一律 405。
pub(crate) const ALLOWED_METHODS: [&str; 3] = ["GET", "HEAD", "POST"];

/// 路径白名单前缀（`/` 与 `/index.html` 另按精确匹配放行）。清单**枚举自 dsh 源码**的全部注册路由 + dist 根内文件：
/// - `webServer.register`：`/plugins`（前缀，模块包 + `/plugins/events` HMR 事件）、`/open-in-app/apps`（精确）、
///   `/open-in-app/icon`（前缀）、`/oauth/callback`（账户 OAuth 回调）；`connection.fetch.register`：`/api/file`（落在 `/api` 下）；
/// - `frontend-static` 兜底座：dist 根的 `assets/`、`favicon*.svg`、`manifest.webmanifest`、`preview*`、index。
/// 新增宿主路由时的动作：加进本表 + 补 `allowlist_covers_enumerated_host_routes` 用例。
/// 第三方插件命名空间不在此表：由宿主 hello 上报（见 [`PathVerdict::Runtime`]）。
pub(crate) const ALLOWED_PREFIXES: [&str; 8] = [
    "/assets/",
    "/plugins/",
    "/api/",
    "/favicon",
    "/manifest.webmanifest",
    "/preview",
    "/open-in-app/",
    "/oauth/callback",
];

/// 第三方插件路由前缀的**静态兜底底集**：宿主 hello 上报 `routePrefixes` 失败/缺席时的退路。
/// 正常路径下闸门按宿主自报的整张前缀表判定（见 [`PathVerdict`]）。此表仅保留两个历史已知项，
/// 保证「上报缺失」时这两个插件仍可用。
pub(crate) const FALLBACK_PLUGIN_PREFIXES: [&str; 2] = ["/dsh-whale/", "/dsh-bili/"];

/// 路径闸门判定：放行的两种来源，以及「都不命中」时交给调用方去试探转发。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PathVerdict {
    /// 命中静态白名单（dsh 内置路由 + dist 根文件 + 兜底插件底集）。
    Static,
    /// 命中宿主 hello 上报的运行期前缀表（第三方插件命名空间的主要来源）。
    Runtime,
    /// 两者都不命中：宿主可能仍有路由（热装插件、上报缺失），故先试探转发再定。
    Unknown,
}

/// 路径判定（`open` = 逃生口放行全部）。
pub(crate) fn path_verdict(path_only: &str, open: bool, runtime_prefixes: &[String]) -> PathVerdict {
    if open {
        return PathVerdict::Static;
    }
    if path_only == "/" || path_only == "/index.html" {
        return PathVerdict::Static;
    }
    if ALLOWED_PREFIXES
        .iter()
        .chain(FALLBACK_PLUGIN_PREFIXES.iter())
        .any(|prefix| path_only.starts_with(prefix))
    {
        return PathVerdict::Static;
    }
    if runtime_prefixes.iter().any(|prefix| path_only.starts_with(prefix.as_str())) {
        return PathVerdict::Runtime;
    }
    PathVerdict::Unknown
}

/// 路径是否在放行集合内（静态 ∪ 运行期快照）。「未命中」不在此判定——见 [`path_verdict`]。
/// 仅供测试断言使用：生产路径必须区分 `Unknown`（→ 试探转发），不能用布尔判定替代。
#[cfg(test)]
pub(crate) fn path_allowed(path_only: &str, open: bool, runtime_prefixes: &[String]) -> bool {
    path_verdict(path_only, open, runtime_prefixes) != PathVerdict::Unknown
}

/// 路径是否含越界段（`.` / `..`；percent 编码形态由宿主侧 URL 归一化负责，壳这里挡明文）。
pub(crate) fn has_traversal(path_only: &str) -> bool {
    path_only.split('/').any(|segment| segment == "." || segment == "..")
}

/// 方法是否允许。
pub(crate) fn method_allowed(method: &str) -> bool {
    ALLOWED_METHODS.contains(&method)
}

/// 需要强制 no-store 的路径：index（含每进程注入）与 /plugins/*（按启动修订命名）。
pub(crate) fn needs_no_store(path_only: &str) -> bool {
    path_only == "/" || path_only == "/index.html" || path_only.starts_with("/plugins/")
}
