// 2026-09-30 arch 拆分：原 app_prefs.rs 内联测试外迁（`#[path]` 子模块，见 app_prefs.rs 尾部声明）。
use super::*;

#[test]
fn valid_values_are_the_three_state_model() {
    assert!(valid("light") && valid("dark") && valid("system"));
    assert!(!valid("auto"));
    assert!(!valid("Dark"));
    assert!(!valid(""));
}

#[test]
fn product_domain_prefs_normalize_fieldwise() {
    // 全缺省：节缺失 → 说明书开 / 薄指针关 / 快照 auto
    let defaults = normalize_product_domain(None);
    assert!(defaults.manual_generation);
    assert!(!defaults.agents_pointer);
    assert_eq!(defaults.snapshot_export, "auto");
    // 逐字段归一：好值保留，坏值回落缺省
    let node = serde_json::json!({
        "manualGeneration": false,
        "agentsPointer": true,
        "snapshotExport": "bogus",
    });
    let mixed = normalize_product_domain(Some(&node));
    assert!(!mixed.manual_generation);
    assert!(mixed.agents_pointer);
    assert_eq!(mixed.snapshot_export, "auto");
}

/// 全局标志与色板同测（同一用例内串行）：避免并行用例互相翻转 `DARK_NOW` 造成偶发红。
#[test]
fn dark_flag_drives_the_own_pages_palette() {
    let before = dark_now();
    set_dark(true);
    assert!(dark_now());
    let dark_html = error_page_html("标题 <x>", "详情 & 说明");
    set_dark(false);
    assert!(!dark_now());
    let light_html = error_page_html("标题 <x>", "详情 & 说明");
    set_dark(before);

    assert!(dark_html.contains("#111113") && light_html.contains("#fafaf9"), "亮暗两套底色应不同");
    assert_ne!(dark_html, light_html, "色板必须随真源变化（此前恒深色）");
    for html in [&dark_html, &light_html] {
        assert!(html.contains("&lt;x&gt;"), "标题需转义");
        assert!(html.contains("详情 &amp; 说明"), "详情需转义");
        assert!(html.contains("<meta charset=\"utf-8\">"));
    }
}
