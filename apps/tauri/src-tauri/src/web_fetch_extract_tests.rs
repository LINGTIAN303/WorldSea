//! 档 3-b HTML 扫描器单测（跳过块 / 标题 / 链接表 / 上限 / 容错）
//! 文本层（实体解码、属性扫描、相对链接归一）单测见 web_fetch_text_tests.rs

use super::*;
use crate::net_egress::parse_http_url;

const SAMPLE: &str = r##"<html><head><title>  标题 &amp; 副题
</title><style>.x{color:red}</style></head>
<body><nav>导航条不该出现</nav>
<script>var secret = "脚本内容不该出现";</script>
<h2>小节</h2><p>第一段&nbsp;文字</p>
<ul><li>条目一</li><li>条目二</li></ul>
<p>见 <a href="/docs/a.html">甲文档</a> 与 <a href="b.html">乙文档</a>。</p>
<p>再参考 <a href="https://other.example/x#y">外部</a>
<a href="#top">回到顶部</a><a href="mailto:some@where.io">邮件</a>
<a href="https://img.example/p.png"><img src="https://img.example/p.png"></a></p>
<footer>页脚不该出现</footer></body></html>"##;

fn extracted_sample() -> ExtractedDoc {
    extract_html(SAMPLE, &parse_http_url("https://example.com/docs/x/y.html").unwrap())
}

#[test]
fn skips_non_content_blocks() {
    let d = extracted_sample();
    for banned in [
        "脚本内容不该出现",
        "导航条不该出现",
        "页脚不该出现",
        "color:red",
    ] {
        assert!(!d.text.contains(banned), "正文含应被跳过的块内容: {banned}");
    }
}

#[test]
fn title_is_decoded_and_collapsed() {
    assert_eq!(extracted_sample().title, "标题 & 副题");
}

#[test]
fn headings_become_hash_prefixes_and_blocks_break_lines() {
    let d = extracted_sample();
    assert!(d.text.contains("## 小节"), "{}", d.text);
    assert!(d.text.contains("条目一\n条目二"), "列表项之间不留空行: {}", d.text);
    assert!(d.text.contains("第一段 文字"), "nbsp 要转成空格: {}", d.text);
}

#[test]
fn link_table_keeps_absolute_http_links_only() {
    let d = extracted_sample();
    let urls: Vec<&str> = d.links.iter().map(|l| l.url.as_str()).collect();
    assert!(
        urls.contains(&"https://example.com/docs/a.html"),
        "绝对路径要接站点根: {urls:?}"
    );
    assert!(
        urls.contains(&"https://example.com/docs/x/b.html"),
        "相对路径要接基准目录: {urls:?}"
    );
    assert!(urls.contains(&"https://other.example/x"), "片段要剥除: {urls:?}");
    assert_eq!(urls.len(), 3, "片段链接/邮件/空文本锚点不入表: {urls:?}");
}

#[test]
fn anchor_text_gets_inline_url_for_citation() {
    let d = extracted_sample();
    assert!(
        d.text.contains("甲文档 (https://example.com/docs/a.html)"),
        "正文里要能就地引用: {}",
        d.text
    );
}

#[test]
fn unclosed_skip_block_does_not_swallow_document() {
    let d = extract_html(
        "<p>前</p><script>var a=1; <div>半截标签</div>",
        &parse_http_url("https://example.com/").unwrap(),
    );
    assert!(
        d.text.contains("半截标签"),
        "找不到闭合时不得吞掉后续正文: {}",
        d.text
    );
}

#[test]
fn decoy_attribute_is_not_href() {
    let d = extract_html(
        r#"<a data-href="https://evil.example/" href="https://real.example/">T</a>"#,
        &parse_http_url("https://example.com/").unwrap(),
    );
    assert_eq!(d.links.len(), 1);
    assert_eq!(d.links[0].url, "https://real.example/");
}

#[test]
fn link_table_respects_cap_and_dedup() {
    let mut html = String::new();
    for i in 0..30 {
        html.push_str(&format!("<p><a href=\"/p{i}\">页{i}</a></p>"));
    }
    let base = parse_http_url("https://example.com/").unwrap();
    assert_eq!(
        extract_html(&html, &base).links.len(),
        MAX_LINKS,
        "链接表要有上限"
    );
    assert_eq!(
        extract_html("<a href=\"/same\">一</a><a href=\"/same\">二</a>", &base).links.len(),
        1,
        "同 URL 要按链接去重"
    );
}

#[test]
fn long_input_is_capped_and_flagged() {
    let huge = format!("<p>{}</p>", "字".repeat(EXTRACT_INPUT_CAP + 10));
    let d = extract_html(&huge, &parse_http_url("https://example.com/").unwrap());
    assert!(d.input_capped);
    assert!(d.text.chars().count() <= EXTRACT_INPUT_CAP);
}

#[test]
fn plain_text_path_is_not_entity_decoded() {
    let d = extract_plain("{\"k\":\"a&amp;b\"}", false);
    assert!(d.text.contains("a&amp;b"), "JSON/XML 原文里不该动实体");
    let md = extract_plain("# 标题\n正文", true);
    assert_eq!(md.text, "# 标题\n正文");
    assert_eq!(md.title, "", "非 HTML 面无标题");
}
