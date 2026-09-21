//! 档 3-b 文本层单测（实体解码 / 属性扫描 / 相对链接归一 / 空白规整）

use super::*;
use crate::net_egress::parse_http_url;

// ─── 实体解码 ─────────────────────────────────────────────

#[test]
fn decode_entities_matrix() {
    assert_eq!(decode_entities("&amp;&lt;&gt;&quot;&apos;"), "&<>\"'");
    assert_eq!(decode_entities("&#39;&#x4E2D;&#101;"), "'中e");
    assert_eq!(decode_entities("&notanentity;"), "&notanentity;");
    assert_eq!(decode_entities("a & b"), "a & b", "无分号不折腾");
    assert_eq!(decode_entities("&#x110000;"), "&#x110000;", "非法码位保留原文");
    let long_run = format!("{}abc;", "&".repeat(20));
    assert_eq!(decode_entities(&long_run), long_run, "过长实体串按原文保留");
}

// ─── 属性扫描 ─────────────────────────────────────────────

#[test]
fn attr_value_forms_are_all_parsed() {
    assert_eq!(
        attr_value(r#"<a href='/single/q.html'>"#, "href").as_deref(),
        Some("/single/q.html")
    );
    assert_eq!(
        attr_value(r#"<a HREF = /unquoted/q.html >"#, "href").as_deref(),
        Some("/unquoted/q.html"),
        "属性名大小写不敏感 + 无引号形态"
    );
    assert_eq!(attr_value("<a href>", "href"), None);
    assert_eq!(attr_value("<a href=\"\">", "href"), None);
    assert_eq!(attr_value("<a title=\"x\">", "href"), None);
    assert_eq!(
        attr_value(r#"<a href="/a?x=1&amp;y=2">"#, "href").as_deref(),
        Some("/a?x=1&y=2"),
        "属性值内实体要解码"
    );
}

#[test]
fn attr_value_rejects_same_suffix_attributes() {
    // data-href / xhref 这类同后缀属性不能被当成 href（边界要判空白）
    assert_eq!(attr_value(r#"<a data-href="/d.html">"#, "href"), None);
    assert_eq!(attr_value(r#"<a xhref="/x.html">"#, "href"), None);
    assert_eq!(
        attr_value(r#"<a data-href="/d.html" href="/r.html">"#, "href").as_deref(),
        Some("/r.html")
    );
}

// ─── 相对链接归一 ─────────────────────────────────────────

#[test]
fn resolve_href_rules() {
    let base = parse_http_url("https://example.com/docs/x/y.html").unwrap();
    assert_eq!(
        resolve_href("//cdn.example/a.js", &base).as_deref(),
        Some("https://cdn.example/a.js")
    );
    assert_eq!(
        resolve_href("./z.html", &base).as_deref(),
        Some("https://example.com/docs/x/z.html")
    );
    assert_eq!(
        resolve_href("../up.html", &base).as_deref(),
        Some("https://example.com/docs/up.html")
    );
    assert_eq!(
        resolve_href("/abs?x=1", &base).as_deref(),
        Some("https://example.com/abs?x=1")
    );
    assert_eq!(resolve_href("#frag", &base), None);
    assert_eq!(resolve_href("JAVASCRIPT:alert(1)", &base), None);
    assert_eq!(resolve_href("FILE:///etc/passwd", &base), None);
    assert_eq!(resolve_href("", &base), None);
    assert_eq!(
        resolve_href("http://127.0.0.1/x", &base).as_deref(),
        Some("http://127.0.0.1/x"),
        "链接表只做归一；可达性由抓取时的出网判定拦，此处不重复判定"
    );
}

#[test]
fn resolve_href_from_site_root_and_port() {
    let root = parse_http_url("https://example.com/").unwrap();
    assert_eq!(
        resolve_href("a/b.html", &root).as_deref(),
        Some("https://example.com/a/b.html")
    );
    let ported = parse_http_url("http://localhost.example:8080/docs/i.html").unwrap();
    assert_eq!(
        resolve_href("../k.html", &ported).as_deref(),
        Some("http://localhost.example:8080/k.html"),
        "非默认端口要保住"
    );
}

#[test]
fn remove_dot_segments_matrix() {
    assert_eq!(remove_dot_segments("/a/b/../c"), "/a/c");
    assert_eq!(remove_dot_segments("/a/./b"), "/a/b");
    assert_eq!(remove_dot_segments("/a/b/"), "/a/b/");
    assert_eq!(remove_dot_segments("/a/b/.."), "/a/");
    assert_eq!(remove_dot_segments("a/b"), "/a/b", "结果保证以 / 开头");
    assert_eq!(remove_dot_segments("/../../x"), "/x", "越界上跳不逃出根");
}

// ─── 空白规整 ─────────────────────────────────────────────

#[test]
fn collapse_and_finish_text() {
    assert_eq!(collapse_spaces("  a \t b  \n"), "a b");
    assert_eq!(
        finish_text("行一\n\n\n\n行二   空格折叠", false),
        "行一\n\n行二 空格折叠",
        "连续空行压到一行"
    );
    assert_eq!(finish_text("&amp;x", true), "&x");
    assert_eq!(finish_text("&amp;x", false), "&amp;x", "纯文本面可不解实体");
    assert_eq!(finish_text("\n\n尾随空行\n\n", false), "尾随空行");
}

#[test]
fn push_break_collapses_consecutive_boundaries() {
    let mut s = String::new();
    push_break(&mut s);
    assert_eq!(s, "", "开头不加换行");
    s.push('a');
    push_break(&mut s);
    push_break(&mut s);
    s.push('b');
    assert_eq!(s, "a\nb", "连续块边界只留一个换行");
}
