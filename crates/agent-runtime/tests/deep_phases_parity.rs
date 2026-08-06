//! Deep Phases 跨语言一致性测试（CI 守护），详细见 docs/details/注释/agent-runtime/deep_phases_parity.md

use agent_runtime::deep_phases::{all_phase_tools, DEEP_PHASES};
use std::collections::HashSet;

/// TS 端 `deepPhases.ts` 源文件内容（编译期嵌入）
///
/// 路径相对本文件：`tests/deep_phases_parity.rs` → 上一级 → 上一级 → 上一级 → 项目根 → `packages/shared-ui/src/agent/bubbles/deepPhases.ts`
/// （5.3 迁移后 TS 端 bubbles 已从根目录 `src/` 迁至共享层 packages/shared-ui）
const TS_SOURCE: &str = include_str!("../../../packages/shared-ui/src/agent/bubbles/deepPhases.ts");

/// 从一行文本中提取 `'xxx'` 形式的字符串字面量
///
/// 跳过空字符串，不支持转义（TS 端工具名均为简单标识符，无需转义）。
fn extract_strings_from_line(line: &str, out: &mut Vec<String>) {
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\'' {
            let mut s = String::new();
            while let Some(&nc) = chars.peek() {
                if nc == '\'' {
                    chars.next(); // 消费闭合引号
                    break;
                }
                s.push(nc);
                chars.next();
            }
            if !s.is_empty() {
                out.push(s);
            }
        }
    }
}

/// 解析 TS 端 `DEEP_PHASES` 数组中的所有工具名，详细见 docs/details/注释/agent-runtime/deep_phases_parity.md
fn parse_ts_phase_tools(ts_source: &str) -> Vec<String> {
    let mut tools = Vec::new();
    let mut in_tools_block = false;

    for line in ts_source.lines() {
        let trimmed = line.trim();

        if !in_tools_block {
            // 查找 "tools: [" 标记
            if let Some(idx) = trimmed.find("tools: [") {
                in_tools_block = true;
                let after_bracket = &trimmed[idx + "tools: [".len()..];
                extract_strings_from_line(after_bracket, &mut tools);
                // 同行以 ] 结束 → 退出 tools 块
                if after_bracket.contains(']') {
                    in_tools_block = false;
                }
            }
        } else {
            // 在 tools 块内：提取本行所有 '...' 字符串
            extract_strings_from_line(trimmed, &mut tools);
            // 行尾有 ] → 退出 tools 块
            if trimmed.contains(']') {
                in_tools_block = false;
            }
        }
    }

    tools
}

/// 测试 1：TS 与 Rust 端工具集合完全一致（核心 CI 守护）
///
/// 任一端新增/删除工具未同步时，此测试失败。
#[test]
fn ts_and_rust_phase_tools_should_be_identical() {
    let rust_tools: Vec<&str> = all_phase_tools();
    let ts_tools = parse_ts_phase_tools(TS_SOURCE);

    let rust_set: HashSet<&str> = rust_tools.iter().copied().collect();
    let ts_set: HashSet<&str> = ts_tools.iter().map(String::as_str).collect();

    assert_eq!(
        rust_set, ts_set,
        "TS 与 Rust 端 Deep Mode 工具集合不一致\n\
         Rust 端 ({}) 个: {:#?}\n\
         TS 端 ({}) 个: {:#?}\n\
         \n\
         仅 Rust 有: {:#?}\n\
         仅 TS 有: {:#?}",
        rust_set.len(),
        rust_set,
        ts_set.len(),
        ts_set,
        rust_set.difference(&ts_set).collect::<Vec<_>>(),
        ts_set.difference(&rust_set).collect::<Vec<_>>(),
    );
}

/// 测试 2：阶段数一致（5 个阶段）
///
/// 注意：不能简单用 `TS_SOURCE.matches("label:").count()`，因为 TS 端的
/// `PhaseGroup` interface 也定义了 `label: string` 字段（不带引号），
/// 会被误匹配。这里只匹配 `label: '` 形式的字符串字面量。
#[test]
fn phase_count_should_match() {
    let rust_phase_count = DEEP_PHASES.len();
    let ts_phase_count = TS_SOURCE.matches("label: '").count();

    assert_eq!(
        rust_phase_count, ts_phase_count,
        "阶段数不一致：Rust 端 {} 个，TS 端 {} 个（仅匹配 `label: '` 字面量）",
        rust_phase_count, ts_phase_count,
    );
}

/// 测试 3：工具数量一致
#[test]
fn tool_count_should_match() {
    let rust_tools = all_phase_tools();
    let ts_tools = parse_ts_phase_tools(TS_SOURCE);

    assert_eq!(
        rust_tools.len(),
        ts_tools.len(),
        "工具数量不一致：Rust 端 {} 个，TS 端 {} 个",
        rust_tools.len(),
        ts_tools.len(),
    );
}

/// 测试 4：阶段标签顺序一致
///
/// 即使工具集合相同，阶段标签或顺序变化也会导致前端 UI 显示异常
/// （如 Rust 端广播"推理分析"但前端 deepSegments 期望"创作操作"）。
#[test]
fn phase_labels_should_match_in_order() {
    // 从 TS 源文件提取 label 字段值
    let ts_labels: Vec<String> = {
        let mut labels = Vec::new();
        for line in TS_SOURCE.lines() {
            let trimmed = line.trim();
            if let Some(idx) = trimmed.find("label: '") {
                let after_label = &trimmed[idx + "label: '".len()..];
                if let Some(end) = after_label.find('\'') {
                    labels.push(after_label[..end].to_string());
                }
            }
        }
        labels
    };

    let rust_labels: Vec<&str> = DEEP_PHASES
        .iter()
        .map(|(label, _)| *label)
        .collect();

    assert_eq!(
        rust_labels.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        ts_labels,
        "阶段标签顺序不一致\n\
         Rust 端: {:?}\n\
         TS 端: {:?}",
        rust_labels, ts_labels,
    );
}

/// 测试 5：解析器健全性检查
///
/// 确保 `parse_ts_phase_tools` 能正确解析已知的 TS 文件结构，
/// 避免解析器自身 bug 导致后续测试假阳性。
#[test]
fn parser_should_extract_known_tools() {
    let ts_tools = parse_ts_phase_tools(TS_SOURCE);

    // 抽样验证：几个已知工具必须被识别
    let known_tools = [
        "output_list",       // 阶段 1
        "entity_get",        // 阶段 2
        "algo_pagerank",     // 阶段 3
        "entity_create",     // 阶段 4
        "output_table",      // 阶段 5
    ];

    for tool in &known_tools {
        assert!(
            ts_tools.iter().any(|t| t == tool),
            "解析器未能提取已知工具 '{}'",
            tool,
        );
    }

    // 不应包含 label 字段的值
    let label_values = ["问题拆解", "证据收集", "推理分析", "创作操作", "结论输出"];
    for label in &label_values {
        assert!(
            !ts_tools.iter().any(|t| t == *label),
            "解析器误将 label 值 '{}' 当作工具提取",
            label,
        );
    }
}
