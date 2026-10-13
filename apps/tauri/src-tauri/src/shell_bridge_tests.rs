// 全屏入口统一「先脱最大化」的源码约定锁：删掉任一处即报红。
// （tao 全屏不脱最大化 → 任务栏条 + max+全屏坏组合；真机现象与处置见 shell_bridge.rs 的 set_fullscreen_safely 注释。）

use std::path::PathBuf;

fn read_text(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读 {rel} 失败：{e}"))
}

#[test]
fn fullscreen_entrances_unmaximize_first() {
    let bridge = read_text("src/shell_bridge.rs");
    assert!(bridge.contains("fn set_fullscreen_safely"), "缺安全全屏助手");
    assert!(bridge.contains("window.is_maximized()?"), "助手须检查最大化");
    assert!(bridge.contains("window.unmaximize()?"), "进全屏前须先脱最大化");
    assert!(bridge.contains("set_fullscreen_safely(&window, !now)"), "F11 命令须经助手");
    let menu = read_text("src/menu.rs");
    assert!(menu.contains("set_fullscreen_safely"), "菜单全屏入口须共用助手");
}
