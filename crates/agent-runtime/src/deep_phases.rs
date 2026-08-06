//! Deep Mode 五阶段定义与工具映射，详细见 docs/details/注释/agent-runtime/deep_phases.md

// ─── 阶段定义 ────────────────────────────────────────────

/// Deep Mode 五阶段定义（label + 工具名列表）
///
/// 顺序即阶段顺序（index 0..4），与 TS 端 `DEEP_PHASES` 数组一致。
/// 工具名采用 snake_case，与 LLM 工具调用返回的 `name` 字段一致。
///
/// # 注意
/// 此处工具名需与 `src/agent/bubbles/deepPhases.ts` 中的 `DEEP_PHASES` 保持一致。
/// 修改时请同步更新 TS 端，并通过 CI 测试 `tests/deep_phases_parity.rs` 验证。
pub const DEEP_PHASES: &[(&str, &[&str])] = &[
    // ── 阶段 1：问题拆解 ──
    ("问题拆解", &["output_list", "output_choice"]),
    // ── 阶段 2：证据收集 ──
    ("证据收集", &[
        "entity_get", "entity_list", "entity_suggest_field", "entity_smart_fill",
        "entity_get_context",
        "content_search", "relation_list",
        "kb_search", "kb_list", "kb_read", "kb_extract", "kb_reflect", "kb_link",
        "web_search", "web_fetch", "web_search_cli", "web_fetch_cli", "web_qa_cli",
        "vision_analyze", "list_vision_images",
        "memory_recall",
        "fs_read", "fs_list", "fs_search", "fs_stat",
        "read_file", "search_files", "list_directory",
        "file_read", "file_list", "file_analyze",
    ]),
    // ── 阶段 3：推理分析 ──
    ("推理分析", &[
        "algo_graph_analysis", "algo_pagerank", "algo_community_detection",
        "algo_shortest_path", "algo_k_shortest_paths", "algo_topological_sort",
        "algo_force_layout",
        "consistency_check", "schema_validate",
        "graph_get_nodes", "graph_get_edges", "graph_find_path", "graph_cluster_analysis",
        "graph_highlight_nodes", "graph_export_snapshot", "graph_filter_by_type",
        "graph_search_subgraph",
    ]),
    // ── 阶段 4：创作操作 ──
    ("创作操作", &[
        "entity_create", "entity_update", "entity_delete",
        "relation_create", "relation_delete",
        "kb_write", "kb_delete", "kb_init",
        "memory_store", "memory_delete",
        "image_generate", "image_edit", "image_gen_config", "image_list", "image_show",
        "video_generate", "video_status", "video_list", "video_show", "video_gen_config",
        "persona_apply", "persona_reset", "persona_update",
        "load_skill",
        "schema_register_entity_type", "schema_unregister_entity_type",
        "schema_get_entity_type", "schema_list_entity_types", "schema_update_entity_type",
        "schema_register_validation", "schema_register_view", "schema_export",
        "ui_create_surface", "ui_update_components", "ui_update_data", "ui_delete_surface",
        "a2ui_show_entity", "a2ui_show_relation",
        "fs_write", "fs_move", "fs_delete", "fs_mkdir", "fs_copy",
        "write_file", "edit_file",
        "file_write", "file_delete", "file_associate",
        "plugin_write",
        "project_export", "project_import",
        "daily_report",
        "plan_create", "plan_update",
    ]),
    // ── 阶段 5：结论输出 ──
    ("结论输出", &[
        "output_table", "output_comparison", "output_accordion", "output_alert",
        "output_stat", "output_code", "output_entity_card", "output_progress",
        "output_timeline", "output_image", "output_manuscript",
    ]),
];

/// "其他操作"标签，用于未匹配任何阶段的工具
pub const OTHER_PHASE_LABEL: &str = "其他操作";

/// 未匹配阶段的 index 标记（与 `LongTaskCheckpoint.current_phase` 中 None 区分）
///
/// - `Some(("其他操作", -1))`：工具已识别但未在表中（兜底分类）
/// - `None`：尚未执行任何工具（初始状态）
pub const OTHER_PHASE_INDEX: i8 = -1;

// ─── 阶段判定 ────────────────────────────────────────────

/// 按工具名判定所属阶段，详细见 docs/details/注释/agent-runtime/deep_phases.md
pub fn classify_tool(tool_name: &str) -> (&'static str, i8) {
    for (idx, (label, tools)) in DEEP_PHASES.iter().enumerate() {
        if tools.contains(&tool_name) {
            return (label, idx as i8);
        }
    }
    (OTHER_PHASE_LABEL, OTHER_PHASE_INDEX)
}

/// 获取所有阶段标签（按顺序）
///
/// 用于初始化或验证场景，返回 `["问题拆解", "证据收集", "推理分析", "创作操作", "结论输出"]`
pub fn all_phase_labels() -> Vec<&'static str> {
    DEEP_PHASES.iter().map(|(label, _)| *label).collect()
}

/// 按阶段标签反查索引
///
/// 用于 DeepPhaseChanged 广播"旧阶段完成"事件时，由缓存中的阶段标签（String）
/// 反查其索引。"其他操作"返回 -1；不在五阶段内的标签返回 `None`。
pub fn phase_index_by_label(label: &str) -> Option<i8> {
    if label == OTHER_PHASE_LABEL {
        return Some(OTHER_PHASE_INDEX);
    }
    DEEP_PHASES
        .iter()
        .position(|(l, _)| *l == label)
        .map(|i| i as i8)
}

/// 收集所有已分阶段的工具名（用于 CI 一致性测试）
///
/// 返回扁平化的工具名列表，顺序与 `DEEP_PHASES` 中的定义一致。
/// CI 测试 `tests/deep_phases_parity.rs` 会对比此列表与 TS 端 `ALL_PHASE_TOOLS`。
pub fn all_phase_tools() -> Vec<&'static str> {
    DEEP_PHASES
        .iter()
        .flat_map(|(_, tools)| *tools)
        .copied()
        .collect()
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn classify_tool_should_match_phase_0() {
        assert_eq!(classify_tool("output_list"), ("问题拆解", 0));
        assert_eq!(classify_tool("output_choice"), ("问题拆解", 0));
    }

    #[test]
    fn classify_tool_should_match_phase_1() {
        assert_eq!(classify_tool("entity_get"), ("证据收集", 1));
        assert_eq!(classify_tool("web_search"), ("证据收集", 1));
        assert_eq!(classify_tool("read_file"), ("证据收集", 1));
        assert_eq!(classify_tool("memory_recall"), ("证据收集", 1));
    }

    #[test]
    fn classify_tool_should_match_phase_2() {
        assert_eq!(classify_tool("algo_pagerank"), ("推理分析", 2));
        assert_eq!(classify_tool("graph_find_path"), ("推理分析", 2));
        assert_eq!(classify_tool("consistency_check"), ("推理分析", 2));
    }

    #[test]
    fn classify_tool_should_match_phase_3() {
        assert_eq!(classify_tool("entity_create"), ("创作操作", 3));
        assert_eq!(classify_tool("write_file"), ("创作操作", 3));
        assert_eq!(classify_tool("image_generate"), ("创作操作", 3));
        assert_eq!(classify_tool("plan_create"), ("创作操作", 3));
    }

    #[test]
    fn classify_tool_should_match_phase_4() {
        assert_eq!(classify_tool("output_table"), ("结论输出", 4));
        assert_eq!(classify_tool("output_progress"), ("结论输出", 4));
    }

    #[test]
    fn classify_tool_should_return_other_for_unknown() {
        assert_eq!(classify_tool("unknown_tool"), ("其他操作", -1));
        assert_eq!(classify_tool(""), ("其他操作", -1));
    }

    #[test]
    fn all_phase_labels_should_return_five_phases_in_order() {
        let labels = all_phase_labels();
        assert_eq!(
            labels,
            vec!["问题拆解", "证据收集", "推理分析", "创作操作", "结论输出"]
        );
    }

    /// 防止同一工具名出现在多个阶段（保证互斥）
    #[test]
    fn tools_should_be_mutually_exclusive_across_phases() {
        let all_tools: Vec<&str> = all_phase_tools();
        let unique_tools: HashSet<&str> = all_tools.iter().copied().collect();
        assert_eq!(
            all_tools.len(),
            unique_tools.len(),
            "存在重复工具：{:?}",
            all_tools
                .iter()
                .filter(|t| all_tools.iter().filter(|x| *x == *t).count() > 1)
                .copied()
                .collect::<HashSet<_>>()
        );
    }
}
