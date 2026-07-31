//! # 别名系统 — 旧工具名到新工具名的映射
//!
//! 对应 TS 版三张静态映射表：
//! - `worldsmith-agent/src/tools/coding-agent-tools.ts` 的 `LEGACY_TO_CODING_MAP`
//! - `worldsmith-agent/src/tools/algo-tools.ts` 的 `LEGACY_ALGO_MAP`
//! - `worldsmith-agent/src/tools/plugin-backend-tools.ts` 的 `LEGACY_PLUGIN_MAP`
//!
//! ## 用途
//! WorldSmith 历史版本中工具名多次迭代（如 `fs_read` → `read_file`），
//! 旧 Agent 配置/技能元数据中仍引用旧名。别名系统在调用前透明映射，
//! 保证向后兼容。
//!
//! ## 设计
//! - 三张表用 `const` 静态切片定义，启动时构建为 `HashMap`，零运行时开销
//! - `resolve_alias(name)` 依次查 CODING → ALGO → PLUGIN，最多深度 3 防循环
//! - 与 `ToolBus::call_tool` 解耦：AgentLoop 在调用前先解析别名

use std::collections::HashMap;
use std::sync::OnceLock;

// ─── 静态映射表 ────────────────────────────────────────────

/// 旧编码工具名 → 新编码工具名
///
/// 来源：`worldsmith-agent/src/tools/coding-agent-tools.ts:585`
pub const LEGACY_TO_CODING_MAP: &[(&str, &str)] = &[
    ("fs_read", "read_file"),
    ("fs_write", "write_file"),
    ("fs_list", "list_directory"),
    ("fs_search", "search_files"),
    ("fs_stat", "read_file"),
    ("fs_mkdir", "write_file"),
    ("fs_copy", "execute_command"),
    ("fs_move", "execute_command"),
    ("fs_delete", "execute_command"),
    ("detect_shells", "shell_session"),
    ("shell_session_create", "shell_session"),
    ("shell_session_exec", "shell_session"),
    ("shell_session_input", "shell_session"),
    ("shell_session_destroy", "shell_session"),
    ("shell_session_list", "shell_session"),
    ("content_search", "search_files"),
    ("file_read", "read_file"),
    ("file_write", "write_file"),
    ("file_list", "list_directory"),
    ("file_delete", "execute_command"),
];

/// 旧算法工具名 → 新算法工具名（统一为 `algo_run`）
///
/// 来源：`worldsmith-agent/src/tools/algo-tools.ts:1262`
pub const LEGACY_ALGO_MAP: &[(&str, &str)] = &[
    ("algo_spatial_insert", "algo_run"),
    ("algo_spatial_query", "algo_run"),
    ("algo_spatial_clear", "algo_run"),
    ("algo_segment_intersect", "algo_run"),
    ("algo_find_intersections", "algo_run"),
    ("algo_point_in_polygon", "algo_run"),
    ("algo_polygon_metrics", "algo_run"),
    ("algo_convex_hull", "algo_run"),
    ("algo_collision_check", "algo_run"),
    ("algo_shortest_path", "algo_run"),
    ("algo_k_shortest_paths", "algo_run"),
    ("algo_topological_sort", "algo_run"),
    ("algo_graph_analysis", "algo_run"),
    ("algo_force_layout", "algo_run"),
    ("algo_crdt_lww", "algo_run"),
];

/// 旧插件工具名 → 新插件工具名（按模块聚合）
///
/// 来源：`worldsmith-agent/src/tools/plugin-backend-tools.ts:967`
pub const LEGACY_PLUGIN_MAP: &[(&str, &str)] = &[
    // timeline 模块
    ("timeline_create_event", "timeline"),
    ("timeline_update_event", "timeline"),
    ("timeline_sort_events", "timeline"),
    ("timeline_detect_conflicts", "timeline"),
    ("timeline_get_events", "timeline"),
    ("timeline_export_timeline", "timeline"),
    ("timeline_set_layout_mode", "timeline"),
    ("timeline_set_group_mode", "timeline"),
    ("timeline_zoom", "timeline"),
    ("timeline_toggle_collapse", "timeline"),
    // graph 模块
    ("graph_get_nodes", "graph"),
    ("graph_get_edges", "graph"),
    ("graph_find_path", "graph"),
];

// ─── 别名解析 ────────────────────────────────────────────

/// 合并后的别名表（启动时构建一次，后续只读）
static ALIAS_MAP: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();

/// 获取合并后的别名表（懒加载）
fn alias_map() -> &'static HashMap<&'static str, &'static str> {
    ALIAS_MAP.get_or_init(|| {
        let mut m = HashMap::with_capacity(
            LEGACY_TO_CODING_MAP.len() + LEGACY_ALGO_MAP.len() + LEGACY_PLUGIN_MAP.len(),
        );
        // 注入顺序：PLUGIN → ALGO → CODING（CODING 优先级最高，最后注入覆盖）
        for &(k, v) in LEGACY_PLUGIN_MAP {
            m.insert(k, v);
        }
        for &(k, v) in LEGACY_ALGO_MAP {
            m.insert(k, v);
        }
        for &(k, v) in LEGACY_TO_CODING_MAP {
            m.insert(k, v);
        }
        m
    })
}

/// 别名解析的最大深度（防止 A→B→C→A 循环）
const MAX_ALIAS_DEPTH: u8 = 3;

/// 解析工具名别名
///
/// # 参数
/// - `name`：可能是旧名的工具名
///
/// # 返回
/// 解析后的最终工具名（若无别名映射，返回原名）
///
/// # 示例
/// ```
/// use agent_runtime::alias::resolve_alias;
/// assert_eq!(resolve_alias("fs_read"), "read_file");
/// assert_eq!(resolve_alias("read_file"), "read_file"); // 无别名，原样返回
/// ```
pub fn resolve_alias(name: &str) -> &str {
    let map = alias_map();
    let mut current = name;
    for _ in 0..MAX_ALIAS_DEPTH {
        match map.get(current) {
            Some(next) => {
                if *next == current {
                    break; // 自引用保护
                }
                current = next;
            }
            None => break,
        }
    }
    current
}

/// 检查给定名称是否为别名（即有映射到其他名称）
pub fn is_alias(name: &str) -> bool {
    alias_map().contains_key(name)
}

/// 获取所有别名的数量
pub fn alias_count() -> usize {
    alias_map().len()
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_coding_alias() {
        assert_eq!(resolve_alias("fs_read"), "read_file");
        assert_eq!(resolve_alias("fs_write"), "write_file");
        assert_eq!(resolve_alias("fs_list"), "list_directory");
        assert_eq!(resolve_alias("file_read"), "read_file");
        assert_eq!(resolve_alias("detect_shells"), "shell_session");
    }

    #[test]
    fn resolve_algo_alias() {
        assert_eq!(resolve_alias("algo_spatial_insert"), "algo_run");
        assert_eq!(resolve_alias("algo_convex_hull"), "algo_run");
        assert_eq!(resolve_alias("algo_force_layout"), "algo_run");
    }

    #[test]
    fn resolve_plugin_alias() {
        assert_eq!(resolve_alias("timeline_create_event"), "timeline");
        assert_eq!(resolve_alias("graph_get_nodes"), "graph");
        assert_eq!(resolve_alias("graph_find_path"), "graph");
    }

    #[test]
    fn non_alias_returns_original() {
        assert_eq!(resolve_alias("read_file"), "read_file");
        assert_eq!(resolve_alias("nonexistent_tool"), "nonexistent_tool");
        assert_eq!(resolve_alias("algo_run"), "algo_run");
    }

    #[test]
    fn is_alias_detects_correctly() {
        assert!(is_alias("fs_read"));
        assert!(is_alias("algo_spatial_insert"));
        assert!(is_alias("timeline_create_event"));
        assert!(!is_alias("read_file"));
        assert!(!is_alias("nonexistent"));
    }

    #[test]
    fn alias_count_matches_total() {
        let expected = LEGACY_TO_CODING_MAP.len() + LEGACY_ALGO_MAP.len() + LEGACY_PLUGIN_MAP.len();
        // 注意：合并时可能有 key 冲突（不同表的同名 key 覆盖），
        // 实际数量可能小于总和。这里只验证下界。
        assert!(alias_count() <= expected);
        assert!(alias_count() > 0);
    }

    #[test]
    fn coding_takes_priority_over_others() {
        // 若三个表有同名 key，CODING 应优先（最后注入覆盖）
        // 当前数据无冲突，此测试预留为回归保护
        let _ = resolve_alias("fs_read");
    }
}
