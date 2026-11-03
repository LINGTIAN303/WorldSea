// 工作台窗口的配置面测试：页面 URL 口径 + capability 与权限清单的**交叉一致性**
// （窗口标签 / 两窗授权互斥 / 切换命令已在壳桥权限内）。
// 这类断言的价值：把「ACL 接线」从口头约定变成门禁——删掉某条即报红。

use std::path::PathBuf;

use super::*;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn read_json(rel: &str) -> serde_json::Value {
    let path = manifest_dir().join(rel);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读 {rel} 失败：{e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("解析 {rel} 失败：{e}"))
}

fn read_text(rel: &str) -> String {
    let path = manifest_dir().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读 {rel} 失败：{e}"))
}

#[test]
fn page_url_is_workspace_prefix_on_the_same_origin() {
    assert_eq!(page_url(), format!("{}workspace/", crate::dsh_bridge::APP_URL));
    assert!(page_url().starts_with(crate::dsh_bridge::APP_URL));
}

#[test]
fn workspace_capability_targets_the_workspace_window_only() {
    let capability = read_json("capabilities/workspace.json");
    let windows: Vec<String> = capability["windows"]
        .as_array()
        .expect("windows 数组")
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect();
    assert_eq!(windows, vec![LABEL.to_string()], "工作台能力只授 workspace 窗");

    let permissions: Vec<String> = capability["permissions"]
        .as_array()
        .expect("permissions 数组")
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect();
    for required in ["core:default", "dialog:allow-open", "allow-shell-bridge", "allow-product-domain"] {
        assert!(permissions.contains(&required.to_string()), "缺权限项 {required}");
    }
    // 双向隔离的配置面：工作台窗**不**拿 dsh 的流桥权限
    assert!(!permissions.contains(&"allow-stream-bridge".to_string()), "工作台窗不该有流桥权限");
    // 启动拖拽（旧 TitleBar 用 data-tauri-drag-region 拖窗）
    assert!(permissions.contains(&"core:window:allow-start-dragging".to_string()));
}

#[test]
fn agent_window_capability_does_not_carry_the_product_domain() {
    let capability = read_json("capabilities/default.json");
    let permissions: Vec<String> = capability["permissions"]
        .as_array()
        .expect("permissions 数组")
        .iter()
        .map(|value| value.as_str().unwrap_or_default().to_string())
        .collect();
    assert!(permissions.contains(&"allow-shell-bridge".to_string()), "dsh 窗要壳桥");
    assert!(permissions.contains(&"allow-stream-bridge".to_string()), "dsh 窗要流桥");
    assert!(
        !permissions.contains(&"allow-product-domain".to_string()),
        "产品域命令族不得对 Agent 空间窗开放（安全面退步）"
    );
}

#[test]
fn product_permission_does_not_smuggle_agent_face_commands() {
    // 反证口径：产品域权限**清单体**里出现任何 Agent 面命令 = ACL 越界（会话/模型/循环/审批/凭证/MCP/技能/语义检索）；
    // 头注里的「有意排除」记录不算（故先剥注释行）
    let text = read_text("permissions/worldsea-product.toml");
    let list: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "cmd_agent_",
        "cmd_loop_control_",
        "cmd_long_task_",
        "cmd_perm_rule_",
        "cmd_retrofit_",
        "cmd_secure_",
        "cmd_mcp_",
        "cmd_skills_",
        "cmd_semantic_",
        "cmd_search_config_",
        "cmd_workspace_index_",
    ] {
        assert!(!list.contains(forbidden), "产品域权限不该含 {forbidden}");
    }
    // 数据面（工作台赖以工作的最小集）必须在
    for required in ["cmd_get_all_entities", "cmd_put_entity", "cmd_fs_read", "cmd_fs_write", "cmd_algo_dijkstra_path"] {
        assert!(list.contains(required), "产品域权限缺 {required}");
    }
}

#[test]
fn space_switch_is_granted_in_the_shared_shell_bridge() {
    let text = read_text("permissions/worldsea-shell.toml");
    assert!(text.contains("\"cmd_shell_space_switch\""), "切换命令须在壳桥权限内（两窗共用）");
    assert!(text.contains("identifier = \"allow-shell-bridge\""));
    // 主题读写命令同在共用壳桥内（产品页设置面板改主题走它）
    assert!(text.contains("\"cmd_theme_get\"") && text.contains("\"cmd_theme_set\""), "主题命令须在壳桥权限内");
}

#[test]
fn capability_bridge_is_shared_by_both_windows_and_gated_by_a_falsification_switch() {
    // 能力桥是**两窗的缝**——权限单列且两窗都引；提供方/回执的 ACL 在 Rust 侧按 label 判。
    let shell = read_text("permissions/worldsea-shell.toml");
    assert!(shell.contains("identifier = \"allow-capability-bridge\""), "缺能力桥权限块");
    for command in [
        "cmd_capability_register",
        "cmd_capability_list",
        "cmd_capability_invoke",
        "cmd_capability_result",
    ] {
        assert!(shell.contains(&format!("\"{command}\"")), "能力桥权限缺 {command}");
    }
    for file in ["capabilities/default.json", "capabilities/workspace.json"] {
        let capability = read_json(file);
        let permissions: Vec<String> = capability["permissions"]
            .as_array()
            .expect("permissions 数组")
            .iter()
            .map(|value| value.as_str().unwrap_or_default().to_string())
            .collect();
        assert!(
            permissions.contains(&"allow-capability-bridge".to_string()),
            "{file} 缺能力桥权限（agent 面或产品域任一侧不引 = 缝断开）"
        );
    }
    // 反证开关在注入侧：关掉后 agent 提供方缺席（跨窗调用应报 UNKNOWN）
    let bridge = read_text("src/dsh_bridge.rs");
    assert!(bridge.contains("WORLDSEA_NO_CAPABILITY_BRIDGE"), "缺反证开关 WORLDSEA_NO_CAPABILITY_BRIDGE");
}

#[test]
fn space_switch_is_serialized_and_main_thread_safe() {
    // 切换经互斥串行（async 命令并发时 show/hide 交错 → 双窗/双隐，实测复现）；
    // 主线程调用方（托盘 / CloseRequested）只投递后台线程——主线程等锁会与窗口操作的消息泵互锁。
    // 断言取**整行守卫**而非裸子串：`snapshot()` 里也有 `is_minimized().unwrap_or(false)`，
    // 裸子串会被它假满足（反证实测踩到）。
    let source = read_text("src/workspace_window.rs");
    assert!(source.contains("static SPACE_SWITCH_LOCK"), "缺空间切换互斥");
    assert!(source.contains("fn request_space_switch"), "缺主线程安全投递入口");
    assert!(source.contains("fn ensure_target_visible"), "缺条件化显示助手");
    assert!(source.contains("if window.is_minimized().unwrap_or(false) {"), "unminimize 须先判最小化（整行守卫）");
    assert!(source.contains("fn state_pair"), "缺切换后状态对留痕");
    let tray = read_text("src/tray.rs");
    assert!(tray.contains("request_space_switch"), "托盘须走投递（主线程不得直呼等锁）");
}

#[test]
fn startup_hides_main_window_explicitly() {
    // 双窗同现缺陷回归（2026-11-03 走查）：`tauri-plugin-window-state` 默认 StateFlags 含 VISIBLE，
    // 会在 on_window_ready 按存档恢复主窗可见性（存档 `main.visible = true` → 直接 show），
    // **覆盖 tauri.conf.json 的 `visible: false`**。故启动裁决必须**显式 hide** 主窗，
    // 不能只靠「不调用 show」。删掉这行即报红。
    let source = read_text("src/workspace_window.rs");
    assert!(
        source.contains("main.hide()"),
        "启动裁决须显式隐藏主窗（防窗口状态插件按存档恢复可见性）"
    );
    // 工作台窗同理：建窗的 `.visible(false)` 只是初值，插件会再恢复一次 → 建窗后补 hide 兜住
    assert!(
        source.contains("let _ = workspace.hide();"),
        "建窗后须显式隐藏工作台窗（插件会按存档再恢复一次可见性）"
    );
}
