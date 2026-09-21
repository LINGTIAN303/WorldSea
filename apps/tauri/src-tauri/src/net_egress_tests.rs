//! 档 3-a 出网收口单测（表格驱动：解析合法性 + 目标可达性两类，边界逐条钉住）

use super::*;

fn host_of(url: &str) -> HttpTarget {
    parse_http_url(url).unwrap_or_else(|e| panic!("解析应成功 {url}: {}", e.reason()))
}

fn blocked_urls() -> Vec<&'static str> {
    vec![
        // IPv4 回环 / 私网 / 链路本地（含云元数据 IP）/ CGNAT / 本网络 / 组播 / 广播
        "http://127.0.0.1/x",
        "http://127.8.9.10/x",
        "http://10.0.0.5/x",
        "http://172.16.0.1/x",
        "http://192.168.1.1/x",
        "http://169.254.169.254/latest/meta-data/",
        "http://100.64.0.1/x",
        "http://0.0.0.1/x",
        "http://224.0.0.1/x",
        "http://255.255.255.255/x",
        // IPv6 回环 / 未指定 / ULA / 链路本地 / 组播
        "http://[::1]/x",
        "http://[::]/x",
        "http://[fc00::1]/x",
        "http://[fd12:3456::78]/x",
        "http://[fe80::1]/x",
        "http://[ff02::1]/x",
        // 内嵌 IPv4 的三种形态都要还原复校
        "http://[::ffff:127.0.0.1]/x",
        "http://[::ffff:10.1.2.3]/x",
        "http://[2002:7f00:1::]/x",
        "http://[64:ff9b::7f00:1]/x",
        // 本地/内网语义主机名
        "http://localhost/x",
        "http://LOCALHOST:8787/rpc",
        "http://app.localhost/x",
        "http://printer.local/x",
        "http://svc.internal/x",
        "http://metadata.google.internal/x",
        // 裸主机名（无点）会经 search domain 落到内网
        "http://intranet/x",
        "http://MACHINE1/x",
    ]
}

fn allowed_urls() -> Vec<&'static str> {
    vec![
        "https://example.com/x",
        "https://sub.domain.co.uk/",
        "http://93.184.216.34/",
        "https://8.8.8.8/",
        "https://1.1.1.1/",
        "https://[2001:4860:4860::8888]/",
        "https://[2606:4700::6810:85e5]/",
        // 公有段的边界值（CGNAT 前一段与后一段都应放行）
        "http://100.63.255.1/",
        "http://100.128.0.1/",
    ]
}

#[test]
fn guard_blocks_all_local_and_private_targets() {
    for url in blocked_urls() {
        let err = guard_url(url)
            .err()
            .unwrap_or_else(|| panic!("{url} 应被拦下"));
        assert!(
            matches!(err, EgressError::Blocked(_)),
            "{url} 分类应为 Blocked，实为 {:?}",
            err
        );
    }
}

#[test]
fn guard_allows_public_targets() {
    for url in allowed_urls() {
        guard_url(url).unwrap_or_else(|e| panic!("{url} 应放行: {}", e.reason()));
    }
}

#[test]
fn guard_is_idempotent_for_redirect_recheck() {
    // 逐跳复校的语义前提：对同一 URL 复校结果稳定
    let first = guard_url("https://example.com/a/b?c=1").unwrap();
    let again = guard_url(&first.to_url()).unwrap();
    assert_eq!(first, again);
}

#[test]
fn parse_normalizes_case_trailing_dot_and_drops_fragment() {
    let t = host_of("https://Example.COM:443/Path/Page?x=1#section");
    assert_eq!(t.host, "example.com");
    assert_eq!(t.port, 443);
    assert_eq!(t.path_and_query, "/Path/Page?x=1");
    assert!(!t.insecure, "https 不标 insecure");
    assert_eq!(t.to_url(), "https://example.com/Path/Page?x=1");

    let dotted = host_of("https://example.com./");
    assert_eq!(dotted.host, "example.com", "根点应剥除（否则同站两键，缓存分裂）");
}

#[test]
fn parse_fills_defaults_and_keeps_query() {
    let t = host_of("https://example.com");
    assert_eq!(t.path_and_query, "/");
    assert_eq!(t.port, 443);

    let t2 = host_of("http://example.com:8080/api?q=%E4%B8%AD");
    assert_eq!(t2.port, 8080);
    assert!(t2.insecure, "http 要标出来供呈现层标注");
    assert_eq!(t2.to_url(), "http://example.com:8080/api?q=%E4%B8%AD");

    // to_url 对默认端口不重复拼
    assert_eq!(host_of("http://example.com:80/x").to_url(), "http://example.com/x");
}

#[test]
fn parse_handles_ipv6_literals() {
    let t = host_of("https://[2001:4860:4860::8888]/dns");
    assert_eq!(t.host, "2001:4860:4860::8888");
    assert_eq!(t.to_url(), "https://[2001:4860:4860::8888]/dns", "IPv6 必须带回括号");

    let with_port = host_of("https://[::1]:8443/x");
    assert_eq!(with_port.port, 8443);
    assert!(assert_public_target(&with_port).is_err(), "字面量端口变了也要复校");
}

#[test]
fn parse_rejects_malformed_or_unsafe_input() {
    // (输入, 场景说明, **期望拒绝理由关键词**)
    // 理由级别断言是必需的：只断言错误类别会出现「假绿」——
    // 例：摘掉凭据校验后，"https://user:pw@host/" 会因「端口非法」顺带被拒，类别断言看不出退化。
    let cases = [
        ("", "空", "空"),
        ("   ", "全空白", "空"),
        ("://example.com", "缺方案", "缺方案"),
        ("javascript:alert(1)", "无 ::// 不猜方案", "绝对"),
        ("//example.com/x", "协议相对", "绝对"),
        ("ftp://example.com/x", "非 http(s) 方案", "方案"),
        ("file:///etc/passwd", "本地文件", "方案"),
        ("https://user:pw@example.com/", "凭据", "凭据"),
        ("https://", "缺主机名", "主机名"),
        ("https://exa mple.com/", "含空白", "空白"),
        ("http://host\\evil/", "含反斜杠", "反斜杠"),
        ("http://*.example.com/", "通配符", "通配符"),
        ("https://example.com:99999/", "端口越界", "端口"),
        ("https://example.com:abc/", "端口非法", "端口"),
        ("https://-bad.example.com/", "连字符位置", "连字符"),
        ("https://ex%41mple.com/", "主机名字面百分号", "非法字符"),
    ];
    for (raw, why, keyword) in cases {
        let err = parse_http_url(raw)
            .err()
            .unwrap_or_else(|| panic!("{raw:?} 应被拒（{why}）"));
        match &err {
            EgressError::BadUrl(_) => {}
            other => panic!("{raw:?}（{why}）分类应为 BadUrl，实为 {other:?}"),
        }
        assert!(
            err.reason().contains(keyword),
            "{raw:?}（{why}）拒绝理由应含「{keyword}」，实为「{}」",
            err.reason()
        );
    }
}

#[test]
fn blocked_reason_names_the_host_not_internals() {
    // 拒绝理由要能给用户看：含主机名/字面量，不含额外解析结果
    let err = guard_url("http://169.254.169.254/latest/meta-data/").unwrap_err();
    assert!(err.reason().contains("169.254.169.254"), "{}", err.reason());
    let err2 = guard_url("http://intranet/x").unwrap_err();
    assert!(err2.reason().contains("intranet"), "{}", err2.reason());
}

#[test]
fn local_hostname_rule_covers_bare_and_suffixed_forms() {
    assert!(is_local_hostname("localhost"));
    assert!(is_local_hostname("a.local"));
    assert!(is_local_hostname("a.internal"));
    assert!(is_local_hostname("a.home.arpa"));
    assert!(is_local_hostname("single"));
    assert!(!is_local_hostname("example.com"));
    assert!(!is_local_hostname("a.b.c"));
}

#[test]
fn embedded_ipv4_unwraps_6to4_and_dns64() {
    let v6 = "2002:0a01:0203::".parse::<Ipv6Addr>().unwrap();
    assert_eq!(embedded_ipv4(v6), Some("10.1.2.3".parse().unwrap()));
    assert!(!ipv6_is_public(v6), "6to4 包私网要拦");

    let dns64 = "64:ff9b::0808:0808".parse::<Ipv6Addr>().unwrap();
    assert_eq!(embedded_ipv4(dns64), Some("8.8.8.8".parse().unwrap()));
    assert!(ipv6_is_public(dns64), "6to4/DNS64 包公网仍应放行");
}
