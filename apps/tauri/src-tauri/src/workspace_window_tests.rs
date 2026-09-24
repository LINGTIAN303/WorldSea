// D1-b/D1-c 的配置面测试：页面 URL 口径 + capability 与权限清单的**交叉一致性**
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
        "产品域命令族不得对 Agent 空间窗开放（C3 安全面退步）"
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
fn geometry_size_reads_inner_to_match_set_size() {
    // 走查缺陷回归（逐次放大）的判据：写口径是 inner（tauri-runtime-wry: SetSize → set_inner_size），
    // 故快照必须读 `inner_size`；本测锁源码约定（读改回 outer 即报红）
    let source = read_text("src/workspace_window.rs");
    assert!(source.contains("size: window.inner_size().ok()"), "几何快照必须读 inner_size");
    assert!(!source.contains("outer_size()"), "不得再读 outer_size（与 set_size 口径不一致 → 逐次放大）");
}
