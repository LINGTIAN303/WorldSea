// workspace_geometry 的测试：几何平移/转移判据（纯函数）+ 启动自检规则 + 源码约定锁定。
// 与 workspace_window.rs 的测试分开：本文件只覆盖几何面，切换时序面在 workspace_window_tests.rs。

use super::*;

/// 读源码做约定锁定（路径相对 crate 根）。
fn read_text(rel: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读源码 {} 失败：{e}", path.display()))
}

#[test]
fn geometry_plan_transfers_maximize_and_never_writes_geometry_over_it() {
    // 源最大化 → 目标只跟最大化（且已是最大化时不重复调），无论如何都不写几何（写=顶掉最大化）
    assert_eq!(geometry_plan(true, false), (true, false));
    assert_eq!(geometry_plan(true, true), (true, false));
    // 源未最大化 → 目标若停在最大化，先还原再落几何
    assert_eq!(geometry_plan(false, true), (false, true));
    assert_eq!(geometry_plan(false, false), (false, false));
}

#[test]
fn geometry_snapshot_carries_minimized_and_apply_skips_it() {
    // 走查缺陷（2026-09-27）：最小化来源的占位几何（Windows ≈ -32000 / 标题栏尺寸）不得转移给
    // 目标窗——否则目标窗「打开即不可见」并被窗口状态插件持久化。锁源码约定（删掉守卫即报红）。
    let source = read_text("src/workspace_geometry.rs");
    assert!(source.contains("minimized: window.is_minimized()"), "快照须记录最小化态");
    assert!(source.contains("geometry_transfer_skipped("), "apply_geometry 须经几何转移跳过判据");
}

#[test]
fn geometry_transfer_is_skipped_for_fullscreen_windows() {
    // 全屏窗不参与几何转移——来源全屏（几何=屏尺寸，写过去只是摊成假全屏）；
    // 目标全屏（对全屏窗 set_position/set_size 会把全屏顶掉/成怪态）。与最小化共用一个纯判据。
    assert!(geometry_transfer_skipped(true, false, false), "最小化来源不转移");
    assert!(geometry_transfer_skipped(false, true, false), "来源全屏不转移");
    assert!(geometry_transfer_skipped(false, false, true), "目标全屏不写几何");
    assert!(geometry_transfer_skipped(false, true, true));
    assert!(!geometry_transfer_skipped(false, false, false));
    let source = read_text("src/workspace_geometry.rs");
    assert!(source.contains("fullscreen: window.is_fullscreen()"), "快照须记录全屏态");
}

#[test]
fn restored_geometry_sanity_rules() {
    // 启动自检判据：正常几何可用；最小化/离屏占位与过小尺寸判不可用；读不到则不动。
    assert!(restored_geometry_is_usable(Some((343, 69)), Some((1280, 800))));
    assert!(!restored_geometry_is_usable(Some((-32000, -32000)), Some((181, 24))), "最小化占位几何必须判不可用");
    assert!(!restored_geometry_is_usable(Some((-25600, -25600)), Some((159, 27))));
    assert!(!restored_geometry_is_usable(Some((343, 69)), Some((100, 24))), "尺寸过小不可用");
    assert!(restored_geometry_is_usable(None, None), "读不到几何 → 不动");
}

#[test]
fn geometry_size_reads_inner_to_match_set_size() {
    // 走查缺陷回归（逐次放大）的判据：写口径是 inner（tauri-runtime-wry: SetSize → set_inner_size），
    // 故快照必须读 `inner_size`；本测锁源码约定（读改回 outer 即报红）
    let source = read_text("src/workspace_geometry.rs");
    assert!(source.contains("size: window.inner_size().ok()"), "几何快照必须读 inner_size");
    assert!(!source.contains("outer_size()"), "不得再读 outer_size（与 set_size 口径不一致 → 逐次放大）");
}
