//! 出网收口（档 3-a，W3 能力面整顿）——URL 严格解析 + 公网目标判定，供抓取类工具逐跳复校
//! 详细设计见 docs/details/注释/tauri/net-egress.md

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// 允许的方案（仅此二者；`file://` / `ftp://` / `gopher://` 等一律拒）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme {
    Http,
    Https,
}

impl Scheme {
    pub fn as_str(self) -> &'static str {
        match self {
            Scheme::Http => "http",
            Scheme::Https => "https",
        }
    }
    fn default_port(self) -> u16 {
        match self {
            Scheme::Http => 80,
            Scheme::Https => 443,
        }
    }
}

/// 解析并复校后的出网目标（字段均为规范化结果：主机名小写、路径至少 `/`、端口显式化）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpTarget {
    pub scheme: Scheme,
    pub host: String,
    pub port: u16,
    pub path_and_query: String,
    pub insecure: bool,
}

impl HttpTarget {
    /// 重建可直接交给 HTTP 客户端的 URL（不含片段）
    pub fn to_url(&self) -> String {
        let default_port = self.scheme.default_port();
        let host_part = if self.host.contains(':') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        };
        let port_part = if self.port == default_port {
            String::new()
        } else {
            format!(":{}", self.port)
        };
        format!(
            "{}://{}{}{}",
            self.scheme.as_str(),
            host_part,
            port_part,
            self.path_and_query
        )
    }
}

/// 出网拒绝：`BadUrl` = 输入不是可判定的绝对 http(s) URL；`Blocked` = 合法但目标不允许触达
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EgressError {
    BadUrl(String),
    Blocked(String),
}

impl EgressError {
    pub fn reason(&self) -> &str {
        match self {
            EgressError::BadUrl(s) | EgressError::Blocked(s) => s.as_str(),
        }
    }
}

/// 解析 + 公网判定一步到位（**每一跳重定向都要重新过一次**）
pub fn guard_url(raw: &str) -> Result<HttpTarget, EgressError> {
    let target = parse_http_url(raw)?;
    assert_public_target(&target)?;
    Ok(target)
}

/// 严格解析绝对 http(s) URL（零依赖手写；仓库无 `url` crate）
pub fn parse_http_url(raw: &str) -> Result<HttpTarget, EgressError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(bad("URL 为空"));
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(bad("URL 含空白或控制字符"));
    }
    if trimmed.contains('\\') {
        return Err(bad("URL 含反斜杠"));
    }

    let (scheme_name, rest) = match trimmed.split_once("://") {
        // 无 :// 一律拒，不做「补 http://」的猜测（猜测会把 file/path 形态喂进解析器）
        Some((head, tail)) => {
            if head.is_empty() {
                return Err(bad("URL 缺方案"));
            }
            (head.to_ascii_lowercase(), tail)
        }
        None => return Err(bad("需绝对 URL（形如 https://host/path）")),
    };
    let scheme = match scheme_name.as_str() {
        "http" => Scheme::Http,
        "https" => Scheme::Https,
        other => {
            return Err(bad(&format!(
                "不支持的方案 {other}（仅允许 http / https）"
            )))
        }
    };

    // authority 到第一个 / ? # 为止
    let authority_end = rest
        .find(['/', '?', '#'])
        .unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    let tail = &rest[authority_end..];

    if authority.is_empty() {
        return Err(bad("URL 缺主机名"));
    }
    if authority.contains('@') {
        return Err(bad("URL 不得携带用户名/密码凭据"));
    }

    let (host, port) = split_host_port(authority)?;
    let host = normalize_host(&host)?;
    let port = port.unwrap_or_else(|| scheme.default_port());

    // 片段对服务端无意义，直接丢；查询保留
    let without_fragment = match tail.find('#') {
        Some(i) => &tail[..i],
        None => tail,
    };
    let path_and_query = if without_fragment.is_empty() {
        "/".to_string()
    } else {
        without_fragment.to_string()
    };

    Ok(HttpTarget {
        scheme,
        host,
        port,
        path_and_query,
        insecure: scheme == Scheme::Http,
    })
}

fn split_host_port(authority: &str) -> Result<(String, Option<u16>), EgressError> {
    if let Some(stripped) = authority.strip_prefix('[') {
        let end = stripped
            .find(']')
            .ok_or_else(|| bad("IPv6 字面量缺右括号"))?;
        let host = stripped[..end].to_string();
        let rest = &stripped[end + 1..];
        let port = match rest {
            "" => None,
            other => {
                let digits = other
                    .strip_prefix(':')
                    .ok_or_else(|| bad("IPv6 字面量后有多余内容"))?;
                Some(parse_port(digits)?)
            }
        };
        return Ok((host, port));
    }
    match authority.rfind(':') {
        Some(i) => {
            let host = authority[..i].to_string();
            let tail = &authority[i + 1..];
            if tail.is_empty() {
                // `host:` —— 端口缺省，按方案默认处理
                return Ok((host, None));
            }
            Ok((host, Some(parse_port(tail)?)))
        }
        None => Ok((authority.to_string(), None)),
    }
}

fn parse_port(raw: &str) -> Result<u16, EgressError> {
    if raw.is_empty() || !raw.chars().all(|c| c.is_ascii_digit()) {
        return Err(bad(&format!("端口非法：{raw}")));
    }
    match raw.parse::<u32>() {
        Ok(n) if (1..=65535).contains(&n) => Ok(n as u16),
        _ => Err(bad(&format!("端口超出范围：{raw}"))),
    }
}

fn normalize_host(raw: &str) -> Result<String, EgressError> {
    let host = raw.trim().to_ascii_lowercase();
    let host = host.strip_suffix('.').unwrap_or(&host).to_string();
    if host.is_empty() {
        return Err(bad("URL 缺主机名"));
    }
    if host.contains('*') {
        return Err(bad("不接受通配符主机名"));
    }
    let ok = host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    if !ok {
        return Err(bad(&format!("主机名含非法字符：{host}")));
    }
    if host.starts_with('-') || host.ends_with('-') {
        return Err(bad("主机名连字符位置非法"));
    }
    Ok(host)
}

fn bad(msg: &str) -> EgressError {
    EgressError::BadUrl(msg.to_string())
}

// ─── 目标可达性判定 ───────────────────────────────────────

/// 拦截本地/私网/特殊用途目标（字面量层面，fail-closed）
///
/// **不做 DNS preflight**：部分网络 1s 内解不完 DNS，会让普通公网 URL 在真实请求前先失败；
/// 代价是 DNS 重绑定（域名解析到内网）拦不住，取舍写明在此。
pub fn assert_public_target(target: &HttpTarget) -> Result<(), EgressError> {
    let host = &target.host;

    if let Some(ip) = parse_ip_literal(host) {
        return match ip {
            IpAddr::V4(v4) if ipv4_is_public(v4) => Ok(()),
            IpAddr::V6(v6) if ipv6_is_public(v6) => Ok(()),
            other => Err(blocked(&format!("目标是本地/私网地址（{other}）"))),
        };
    }

    if is_local_hostname(host) {
        return Err(blocked(&format!("目标是本地/内网名（{host}）")));
    }
    Ok(())
}

fn parse_ip_literal(host: &str) -> Option<IpAddr> {
    if host.parse::<Ipv4Addr>().is_ok() {
        return Some(IpAddr::V4(host.parse().ok()?));
    }
    if host.contains(':') {
        return host.parse::<Ipv6Addr>().ok().map(IpAddr::V6);
    }
    None
}

/// 本地/内网语义主机名
fn is_local_hostname(host: &str) -> bool {
    const LOCAL_SUFFIXES: [&str; 5] = [
        ".localhost",
        ".local",
        ".internal",
        ".localdomain",
        ".home.arpa",
    ];
    if host == "localhost" {
        return true;
    }
    if LOCAL_SUFFIXES.iter().any(|s| host.ends_with(s)) {
        return true;
    }
    // 裸主机名（无点）会经 search domain 补全落到内网；本机名也算这一类
    !host.contains('.')
}

fn ipv4_is_public(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    !(v4.is_unspecified()
        || v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_multicast()
        || v4.is_broadcast()
        // 0/8「本网络」与 CGNAT 100.64/10 均 std 未覆盖
        || o[0] == 0
        || (o[0] == 100 && o[1] >= 64 && o[1] <= 127)
        // 240/4 保留段
        || o[0] >= 240)
}

fn ipv6_is_public(v6: Ipv6Addr) -> bool {
    if v6.is_unspecified() || v6.is_loopback() || v6.is_multicast() {
        return false;
    }
    let seg0 = v6.segments()[0];
    // ULA fc00::/7 与 link-local fe80::/10
    if seg0 & 0xfe00 == 0xfc00 {
        return false;
    }
    if seg0 & 0xffc0 == 0xfe80 {
        return false;
    }
    // IPv4-mapped ::ffff:x:y —— 还原内嵌 v4 复校
    if let Some(v4) = v6.to_ipv4_mapped() {
        return ipv4_is_public(v4);
    }
    // 6to4 2002::/16 与 DNS64 64:ff9b::/96 都把 v4 塞在地址里，同样复校
    if let Some(v4) = embedded_ipv4(v6) {
        return ipv4_is_public(v4);
    }
    true
}

fn embedded_ipv4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    let s = v6.segments();
    if s[0] == 0x2002 {
        return Some(Ipv4Addr::new((s[1] >> 8) as u8, s[1] as u8, (s[2] >> 8) as u8, s[2] as u8));
    }
    if s[0] == 0x0064 && s[1] == 0xff9b {
        return Some(Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8));
    }
    None
}

fn blocked(msg: &str) -> EgressError {
    EgressError::Blocked(msg.to_string())
}

#[cfg(test)]
#[path = "net_egress_tests.rs"]
mod tests;
