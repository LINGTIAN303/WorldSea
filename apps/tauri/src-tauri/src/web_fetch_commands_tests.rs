//! 档 3-b 抓取工具单测（不触网：类型判定 / 截断与围栏 / 参数校验 / 出网拦截 / 缓存语义）

use std::time::Duration;

use super::*;
use agent_runtime::tool::Tool;
use serde_json::json;

// ─── 内容类型 ─────────────────────────────────────────────

#[test]
fn classify_content_type_accepts_text_forms() {
    let cases = [
        ("text/html; charset=utf-8", BodyKind::Html),
        ("APPLICATION/XHTML+XML", BodyKind::Html),
        ("text/plain", BodyKind::Plain),
        ("text/markdown;charset=UTF-8", BodyKind::Markdown),
        ("application/json", BodyKind::Json),
        ("text/xml", BodyKind::Xml),
    ];
    for (header, want) in cases {
        assert_eq!(classify_content_type(header).unwrap(), want, "{header}");
    }
}

#[test]
fn classify_content_type_rejects_binaries_and_blanks() {
    for header in [
        "image/png",
        "application/pdf",
        "application/octet-stream",
        "video/mp4",
        "",
        "text/",
    ] {
        let err = classify_content_type(header)
            .err()
            .unwrap_or_else(|| panic!("{header:?} 应被拒"));
        assert!(err.contains("不支持的内容类型"), "{err}");
    }
}

// ─── 截断与围栏 ───────────────────────────────────────────

/// 从围栏结果里取回**正文本身**（去掉首尾标记与截断提示）
/// 注意：不能直接数围栏串里的字符数——提示语自身含 `max_chars` / `字符`，会把计数带偏
fn body_of(fenced: &str) -> String {
    let after_head = fenced.splitn(2, ">>>\n").nth(1).unwrap_or("");
    let before_tail = after_head.splitn(2, "\n<<<外部网页原文结束>>>").next().unwrap_or("");
    before_tail.splitn(2, "\n\n…[").next().unwrap_or("").to_string()
}

#[test]
fn fence_declares_external_content_as_untrusted_data() {
    let (fenced, truncated) = truncate_and_fence("https://example.com/a", "正文内容", 8000);
    assert!(!truncated);
    assert!(fenced.starts_with("<<<外部网页原文 url=https://example.com/a"), "{fenced}");
    assert!(fenced.contains("不可信数据"), "围栏要声明不可信属性: {fenced}");
    assert!(fenced.contains("无约束力"), "围栏要声明指令不生效: {fenced}");
    assert!(fenced.ends_with("<<<外部网页原文结束>>>"), "{fenced}");
    assert_eq!(body_of(&fenced), "正文内容");
}

#[test]
fn truncation_marks_original_length_and_stays_within_cap() {
    let body = "字".repeat(500);
    let (fenced, truncated) = truncate_and_fence("https://example.com/x", &body, 100);
    assert!(truncated);
    assert!(fenced.contains("截断，原文共 500 字符"), "{fenced}");
    assert_eq!(body_of(&fenced).chars().count(), 100, "正文须恰好截在 cap");
}

#[test]
fn max_chars_is_clamped_to_hard_ceiling() {
    let body = "a".repeat(HARD_MAX_CHARS + 50);
    let (fenced, truncated) = truncate_and_fence("https://example.com/", &body, 9_999_999);
    assert!(truncated);
    assert_eq!(body_of(&fenced).chars().count(), HARD_MAX_CHARS, "超大 max_chars 要收敛到上限");
}

#[test]
fn zero_max_chars_clamps_to_one_not_empty() {
    let (fenced, truncated) = truncate_and_fence("https://example.com/", "abc", 0);
    assert!(truncated);
    assert_eq!(body_of(&fenced), "a");
}

// ─── 参数校验与出网拦截（全程不触网） ──────────────────────

fn tool() -> WebFetchTool {
    WebFetchTool::default()
}

#[tokio::test]
async fn execute_rejects_missing_or_blank_url() {
    for args in [json!({}), json!({"url": ""}), json!({"url": "   "}), json!({"url": 42})] {
        let err = tool()
            .execute(args.clone())
            .await
            .err()
            .unwrap_or_else(|| panic!("{args} 应被拒"));
        assert!(
            matches!(err, ToolError::ArgsParse(_)),
            "{args} 应为 ArgsParse，实为 {err:?}"
        );
    }
}

#[tokio::test]
async fn execute_rejects_non_numeric_max_chars() {
    let err = tool()
        .execute(json!({"url": "https://example.com/", "max_chars": "很多"}))
        .await
        .err()
        .unwrap();
    assert!(matches!(err, ToolError::ArgsParse(_)), "{err:?}");
}

#[tokio::test]
async fn execute_separates_bad_url_from_blocked_target() {
    // 非法/不支持方案属参数问题（ArgsParse）；本地与私网属策略拒绝（Execution）
    let bad = tool()
        .execute(json!({"url": "file:///etc/passwd"}))
        .await
        .err()
        .unwrap();
    assert!(matches!(bad, ToolError::ArgsParse(_)), "{bad:?}");

    for url in [
        "http://127.0.0.1:8787/rpc",
        "http://169.254.169.254/latest/meta-data/",
        "http://intranet/admin",
    ] {
        let blocked = tool().execute(json!({"url": url})).await.err().unwrap();
        match blocked {
            ToolError::Execution(msg) => assert!(
                msg.contains("本地") || msg.contains("私网") || msg.contains("内网"),
                "{url} 拒绝理由要可读: {msg}"
            ),
            other => panic!("{url} 应为 Execution，实为 {other:?}"),
        }
    }
}

#[test]
fn tool_metadata_shape_is_stable() {
    let t = tool();
    assert_eq!(t.name(), "web_fetch");
    let params = t.parameters();
    assert_eq!(params["required"], json!(["url"]));
    assert!(params["properties"]["max_chars"].is_object());
}

#[test]
fn agent_facing_description_is_neutral() {
    // 口径：给模型看的说明只陈述事实（能力/参数/返回/边界），不出现引导词
    let t = tool();
    let d = t.description();
    for banned in ["建议", "推荐", "优先", "首选", "应该", "务必", "最好"] {
        assert!(!d.contains(banned), "描述含引导词「{banned}」: {d}");
    }
}

// ─── 缓存语义 ─────────────────────────────────────────────

#[test]
fn cache_roundtrip_and_expiry() {
    let cache = FetchCache::new();
    assert!(cache.get("k").is_none());
    cache.insert("k".into(), json!({"text": "v"}));
    assert_eq!(cache.get("k").unwrap()["text"], json!("v"));

    let expired = FetchCache::with_ttl(Duration::ZERO);
    expired.insert("k".into(), json!({"text": "v"}));
    assert!(expired.get("k").is_none(), "TTL 到期后不得再命中");
}

#[test]
fn cache_evicts_when_over_entry_limit() {
    let cache = FetchCache::new();
    for i in 0..=(CACHE_MAX_ENTRIES) {
        cache.insert(format!("k{i}"), json!({"i": i}));
    }
    assert!(
        cache.len() <= CACHE_MAX_ENTRIES,
        "超上限要淘汰：实际 {}",
        cache.len()
    );
}
