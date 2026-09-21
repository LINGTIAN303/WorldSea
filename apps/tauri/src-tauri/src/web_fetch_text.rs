//! 抓取文本工具（档 3-b）——实体解码、空白规整、相对链接归一、标签属性与闭合扫描
//! 详细设计见 docs/details/注释/tauri/web-fetch.md

use crate::net_egress::{parse_http_url, HttpTarget};

/// 块边界换行：连续边界只留一个换行（否则列表项之间会夹空行）
pub fn push_break(out: &mut String) {
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
}

/// 单行空白规整（换行保留，其余空白折叠为一个空格，首尾去空白）
pub fn collapse_spaces(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_space = false;
    for c in s.chars() {
        if c == '\n' {
            out.push(c);
            last_space = false;
            continue;
        }
        if c.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
            continue;
        }
        out.push(c);
        last_space = false;
    }
    out.trim().to_string()
}

/// 行规整收尾：逐行 collapse + 连续空行压到一行 + 去尾部空行；`decode` 控制是否解实体
pub fn finish_text(raw: &str, decode: bool) -> String {
    let owned: Vec<String> = if decode {
        decode_entities(raw).lines().map(collapse_spaces).collect()
    } else {
        raw.lines().map(collapse_spaces).collect()
    };
    let mut out: Vec<&str> = Vec::with_capacity(owned.len());
    let mut blank_run = 0usize;
    for line in &owned {
        if line.is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
        } else {
            blank_run = 0;
        }
        out.push(line.as_str());
    }
    while out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }
    out.join("\n").trim_matches('\n').to_string()
}

/// 实体解码：常用命名字符集 + 十进制 / 十六进制数字实体；解不开的一律保留原文
pub fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    const NAMED: [(&str, &str); 8] = [
        ("amp", "&"),
        ("lt", "<"),
        ("gt", ">"),
        ("quot", "\""),
        ("apos", "'"),
        ("nbsp", " "),
        ("mdash", "—"),
        ("hellip", "…"),
    ];
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0usize;
    while i < chars.len() {
        if chars[i] != '&' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let Some(semi_rel) = chars[i..].iter().position(|c| *c == ';') else {
            out.push('&');
            i += 1;
            continue;
        };
        // 超过 10 字符的「实体名」按原文处理（避免把 "&&&&&...;" 当成实体折腾）
        if semi_rel > 10 {
            out.push('&');
            i += 1;
            continue;
        }
        let entity: String = chars[i + 1..i + semi_rel].iter().collect();
        let decoded = if let Some(hex) = entity
            .strip_prefix("#x")
            .or_else(|| entity.strip_prefix("#X"))
        {
            u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
        } else if let Some(dec) = entity.strip_prefix('#') {
            dec.parse::<u32>().ok().and_then(char::from_u32)
        } else {
            NAMED
                .iter()
                .find(|(k, _)| *k == entity.as_str())
                .and_then(|(_, v)| v.chars().next())
        };
        match decoded {
            Some(c) => {
                out.push(c);
                i += semi_rel + 1;
            }
            None => {
                out.push('&');
                i += 1;
            }
        }
    }
    out
}

/// 相对链接 → 绝对 URL；非 http(s) 与纯片段返回 None
pub fn resolve_href(raw: &str, base: &HttpTarget) -> Option<String> {
    let href = raw.trim();
    if href.is_empty() || href.starts_with('#') {
        return None;
    }
    for prefix in ["mailto:", "tel:", "javascript:", "data:", "ftp:", "file:"] {
        if href.to_ascii_lowercase().starts_with(prefix) {
            return None;
        }
    }
    let candidate = if href.starts_with("//") {
        format!("{}:{}", base.scheme.as_str(), href)
    } else if href.starts_with('/') {
        format!("{}{}", origin(base), href)
    } else if href.contains("://") {
        href.to_string()
    } else {
        format!("{}{}{}", origin(base), base_dir(base), href)
    };
    let target = parse_http_url(&candidate).ok()?;
    let path = target.path_and_query.split('?').next().unwrap_or("/");
    let query = target
        .path_and_query
        .split_once('?')
        .map(|(_, q)| q.to_string())
        .unwrap_or_default();
    let normalized = remove_dot_segments(path);
    let pq = if query.is_empty() {
        normalized
    } else {
        format!("{normalized}?{query}")
    };
    Some(
        HttpTarget {
            path_and_query: pq,
            ..target
        }
        .to_url(),
    )
}

/// 基准目录（含结尾斜杠，保证与 origin 拼接后不缺 `/`）
fn base_dir(base: &HttpTarget) -> String {
    match base.path_and_query[1..].rsplit_once('/') {
        Some((d, _)) => format!("/{d}/"),
        None => "/".to_string(),
    }
}

fn origin(base: &HttpTarget) -> String {
    let host = if base.host.contains(':') {
        format!("[{}]", base.host)
    } else {
        base.host.clone()
    };
    let default = if base.scheme.as_str() == "https" { 443 } else { 80 };
    if base.port == default {
        format!("{}://{}", base.scheme.as_str(), host)
    } else {
        format!("{}://{}:{}", base.scheme.as_str(), host, base.port)
    }
}

/// RFC 3986 remove_dot_segments 的够用版（`./` 丢弃、`../` 弹一层、结果以 `/` 开头）
pub fn remove_dot_segments(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for seg in path.split('/') {
        match seg {
            "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    let mut joined = out.join("/");
    if (path.ends_with("/.") || path.ends_with("/..")) && !joined.ends_with('/') {
        joined.push('/');
    }
    if !joined.starts_with('/') {
        joined.insert(0, '/');
    }
    joined
}

/// 从标签内文取属性值（`name="v"` / `name='v'` / `name=v`；属性名大小写不敏感）
pub fn attr_value(tag_inner: &str, name: &str) -> Option<String> {
    let lower = tag_inner.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find(name) {
        let at = search_from + rel;
        let after = at + name.len();
        let bytes = lower.as_bytes();
        // 必须是完整属性名：前一个字符是空白（挡掉 data-href 这类同后缀属性），后面紧跟 '='
        let name_boundary_ok = at == 0 || bytes[at - 1].is_ascii_whitespace();
        let rest = lower[after..].trim_start();
        if name_boundary_ok && rest.starts_with('=') {
            let value_part = rest[1..].trim_start();
            let value: String = match value_part.chars().next() {
                Some(q) if q == '"' || q == '\'' => {
                    value_part[1..].split(q).next().unwrap_or("").to_string()
                }
                Some(_) => value_part.split_whitespace().next().unwrap_or("").to_string(),
                None => String::new(),
            };
            return if value.is_empty() {
                None
            } else {
                Some(decode_entities(value.trim()))
            };
        }
        search_from = at + name.len();
    }
    None
}

pub fn next_gt(hay: &[char], from: usize) -> Option<usize> {
    (from..hay.len()).find(|&k| hay[k] == '>')
}

pub fn find_subslice(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || from + needle.len() > hay.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&k| &hay[k..k + needle.len()] == needle)
}

/// 找 `</name>` 并返回闭合标签之后的下标（用于整块跳过 script/style/nav 等）
pub fn find_close_tag(hay: &[char], name: &str, from: usize) -> Option<usize> {
    let mut needle = Vec::with_capacity(name.len() + 2);
    needle.push('<');
    needle.push('/');
    needle.extend(name.chars());
    let at = find_subslice(hay, &needle, from)?;
    Some(next_gt(hay, at).map(|e| e + 1).unwrap_or(hay.len()))
}

#[cfg(test)]
#[path = "web_fetch_text_tests.rs"]
mod tests;
