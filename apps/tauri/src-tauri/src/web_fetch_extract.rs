//! 抓取正文抽取（档 3-b）——零依赖 HTML 扫描器 → 纯文本 + 去重链接表
//! 文本层工具（实体解码 / 链接归一 / 属性与闭合扫描）见 web_fetch_text.rs
//! 详细设计见 docs/details/注释/tauri/web-fetch.md

use crate::net_egress::HttpTarget;
use crate::web_fetch_text::{
    attr_value, collapse_spaces, decode_entities, find_close_tag, finish_text, next_gt, push_break,
    resolve_href,
};

/// 抽取输入上限：超出部分不解析（可读正文早已够长，且要防 10MB 页面把 `Vec<char>` 撑爆）
pub const EXTRACT_INPUT_CAP: usize = 400_000;
/// 链接表上限（与投给模型的行数挂钩，超出只影响链接清单不影响正文）
pub const MAX_LINKS: usize = 20;

/// 整块丢弃的标签（对模型无信息量，或是脚本/样式）
const SKIP_TAGS: [&str; 10] = [
    "script", "style", "noscript", "svg", "template", "iframe", "nav", "footer", "header", "aside",
];
/// 换行类块级标签
const BLOCK_TAGS: [&str; 18] = [
    "p", "div", "li", "ul", "ol", "tr", "table", "section", "article", "pre", "blockquote", "dl",
    "dd", "dt", "td", "th", "form", "main",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocLink {
    pub text: String,
    pub url: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExtractedDoc {
    pub title: String,
    pub text: String,
    pub links: Vec<DocLink>,
    /// 输入是否因超过 EXTRACT_INPUT_CAP 被截断（与 max_chars 的展示截断是两件事）
    pub input_capped: bool,
}

/// HTML → 纯文本 + 链接表
pub fn extract_html(html: &str, base: &HttpTarget) -> ExtractedDoc {
    let capped = html.chars().count() > EXTRACT_INPUT_CAP;
    let cs: Vec<char> = html.chars().take(EXTRACT_INPUT_CAP).collect();
    // 标签名匹配一律走小写视图，正文仍取原字符（大小写敏感）
    let lower: Vec<char> = html.to_ascii_lowercase().chars().take(EXTRACT_INPUT_CAP).collect();

    let mut out = String::new();
    let mut title = String::new();
    let mut links: Vec<DocLink> = Vec::new();
    let mut seen: Vec<String> = Vec::new();

    let mut i = 0usize;
    let n = cs.len();
    let mut in_title = false;
    // (正文起始下标, 归一化后的 href)
    let mut anchor: Option<(usize, Option<String>)> = None;

    while i < n {
        if lower[i] != '<' {
            if in_title {
                title.push(cs[i]);
            } else {
                out.push(cs[i]);
            }
            i += 1;
            continue;
        }
        // 注释整块跳过
        if lower[i..].starts_with(&['<', '!', '-', '-']) {
            i = find_subslice_or_end(&lower, &['-', '-', '>'], i + 3);
            continue;
        }
        // <!DOCTYPE ...> 之类声明：跳到下一个 '>'
        if lower[i..].starts_with(&['<', '!']) {
            i = next_gt(&lower, i).map(|e| e + 1).unwrap_or(n);
            continue;
        }

        let tag_start = i;
        let tag_end = match next_gt(&lower, i) {
            Some(e) => e,
            None => break, // 无闭合 '>' 的尾部残块：放弃剩余标记扫描，保留已采集内容
        };
        let tag_inner: String = cs[tag_start + 1..=tag_end].iter().collect();
        let is_close = tag_inner.starts_with('/');
        let name: String = tag_inner
            .chars()
            .skip(if is_close { 1 } else { 0 })
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        i = tag_end + 1;
        if name.is_empty() {
            continue;
        }

        if !is_close && SKIP_TAGS.contains(&name.as_str()) {
            // 整块跳到同名闭合标签；找不到闭合就停在本标签之后（不误吞全文）
            i = find_close_tag(&lower, &name, tag_end + 1).unwrap_or(tag_end + 1);
            continue;
        }

        match name.as_str() {
            "title" => in_title = !is_close,
            "br" => push_break(&mut out),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                if is_close {
                    push_break(&mut out);
                } else {
                    let level = name[1..2].parse::<usize>().unwrap_or(1);
                    push_break(&mut out);
                    for _ in 0..level {
                        out.push('#');
                    }
                    out.push(' ');
                }
            }
            "a" => {
                if is_close {
                    close_anchor(&mut out, &mut links, &mut seen, anchor.take());
                } else {
                    let href = attr_value(&tag_inner, "href")
                        .as_deref()
                        .and_then(|raw| resolve_href(raw, base));
                    anchor = Some((out.len(), href));
                }
            }
            _ => {
                if BLOCK_TAGS.contains(&name.as_str()) {
                    push_break(&mut out);
                }
            }
        }
    }

    ExtractedDoc {
        title: collapse_spaces(&decode_entities(&title)),
        text: finish_text(&out, true),
        links,
        input_capped: capped,
    }
}

/// 锚点收尾：正文里就地附绝对 URL，链接表按 URL 去重并设上限
fn close_anchor(
    out: &mut String,
    links: &mut Vec<DocLink>,
    seen: &mut Vec<String>,
    anchor: Option<(usize, Option<String>)>,
) {
    let Some((start, href)) = anchor else { return };
    let text = collapse_spaces(&out[start..]);
    // 空文本（如只包了一张图）不进链接表——模型无从引用
    let Some(url) = href.filter(|_| !text.is_empty()) else {
        return;
    };
    if seen.len() >= MAX_LINKS || seen.contains(&url) {
        return;
    }
    seen.push(url.clone());
    links.push(DocLink {
        text,
        url: url.clone(),
    });
    out.push_str(" (");
    out.push_str(&url);
    out.push(')');
}

/// 非 HTML 正文（text/plain · json · xml · markdown）：只做空白规整，实体解码按开关
pub fn extract_plain(body: &str, decode: bool) -> ExtractedDoc {
    let capped = body.chars().count() > EXTRACT_INPUT_CAP;
    let truncated: String = body.chars().take(EXTRACT_INPUT_CAP).collect();
    ExtractedDoc {
        title: String::new(),
        text: finish_text(&truncated, decode),
        links: Vec::new(),
        input_capped: capped,
    }
}

fn find_subslice_or_end(hay: &[char], needle: &[char], from: usize) -> usize {
    crate::web_fetch_text::find_subslice(hay, needle, from)
        .map(|k| k + needle.len())
        .unwrap_or(hay.len())
}

#[cfg(test)]
#[path = "web_fetch_extract_tests.rs"]
mod tests;
