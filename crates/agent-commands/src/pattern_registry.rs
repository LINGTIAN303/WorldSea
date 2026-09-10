//! # 模式注册表 — 轻量静态注册（C0-3 / C0-11 / C0-15，M1-8）
//!
//! 每模式一条静态注册项 = **五触点检查单**（命令 / 事件族 / 交接物 / 配置 / 详图）：
//!
//! | 触点 | 字段 |
//! |------|------|
//! | ① 入口命令 | `entry_command`（手动命令前缀，A1 `/` 菜单；2026-09-09 指令层收敛后已无单聊命令，恒为 None） |
//! | ② 轨迹/细节事件族 | `event_family`（前端可按此过滤通道） |
//! | ③ 交接物 | `artifact_kind`（该模式产出的物类型，D23） |
//! | ④ 配置面 | `config_defaults`（次数参数等数据面，C0-5） |
//! | ⑤ 详图组件 | `detail_component`（深水区模式，A4 右栏） |
//!
//! 新增模式改 **2 处**（注册项 + 模式实现），取代现状 8 处贯穿改动（[02-现状事实](02-现状事实.md) §十）。
//! 2026-09-09 指令层收敛后前端 `patternRegistry.ts` 已删除，后端注册表为唯一事实源。
//!
//! 注册表是**元数据事实源**：命令层 / 前端从注册表读模式元数据，不再按模式写死（C0-15 契约发现）。

use serde::Serialize;

use agent_runtime::types::ArtifactKindTag;

/// 能力语义分组（C14：用户不感知 13 编号，命令菜单按此分组）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityGroup {
    /// 探索（ToT / GoT）
    Explore,
    /// 协作（Supervisor / MultiAgent）
    Collaborate,
    /// 规划（Plan→Execute 链）
    Plan,
    /// 评审（Reflection / Refine）
    Review,
}

/// 注册项 — 五触点检查单
#[derive(Debug, Clone, Serialize)]
pub struct PatternRegistryEntry {
    /// 模式 id（`"plan" | "tot" | "got" | "supervisor" | "multi_agent"`）
    pub pattern_id: &'static str,
    /// 人类可读名称（命令菜单展示）
    pub name: &'static str,
    /// 能力语义分组（C14）
    pub capability: CapabilityGroup,
    /// ① 手动命令入口（无 = 仅自动触发）
    pub entry_command: Option<&'static str>,
    /// ① 运行命令（前端 invoke 名，A1 `/` 菜单触发）
    ///
    /// 2026-09-09 指令层收敛后已无独立命令（tot/got/supervisor/multi 前端
    /// patternRegistry.ts 删除、tauri/RPC 注册删除），此字段恒为 None 保留元数据形状。
    pub run_command: Option<&'static str>,
    /// ② 事件族（该模式发出的轨迹/细节事件类型，语义名）
    pub event_family: &'static [&'static str],
    /// ③ 产出的交接物 kind（D23，构图期 kind 校验数据源）
    pub artifact_kind: ArtifactKindTag,
    /// ④ 配置默认值（次数参数等数据面，C0-5）
    pub config_defaults: PatternConfig,
    /// ⑤ 详图组件 id（深水区模式；无 = 迹线内即可表达）
    pub detail_component: Option<&'static str>,
}

/// 配置面默认值（C0-5：次数参数属数据 → 配置化）
#[derive(Debug, Clone, Default, Serialize)]
pub struct PatternConfig {
    /// 编排器最大轮次（plan 链）
    pub max_iterations: Option<u32>,
    /// ToT/GoT beam 宽度
    pub beam_width: Option<u32>,
    /// Supervisor / MultiAgent 最大轮次
    pub max_rounds: Option<u32>,
}

/// 静态注册表（每模式一条；新增模式在此追加一条 + 模式实现，共 2 处）
static PATTERN_REGISTRY: &[PatternRegistryEntry] = &[
        PatternRegistryEntry {
            pattern_id: "tot",
            name: "思维树探索",
            capability: CapabilityGroup::Explore,
            entry_command: None,
            run_command: None,
            event_family: &[
                "thought_node_created",
                "thought_node_scored",
                "branch_explored",
                "tot_goal_reached",
                "tot_terminated",
            ],
            artifact_kind: ArtifactKindTag::Exploration,
            config_defaults: PatternConfig {
                max_iterations: None,
                beam_width: Some(3),
                max_rounds: None,
            },
            detail_component: Some("ThoughtTree"),
        },
        PatternRegistryEntry {
            pattern_id: "got",
            name: "思维图聚合",
            capability: CapabilityGroup::Explore,
            entry_command: None,
            run_command: None,
            event_family: &[
                "thought_node_created",
                "thought_node_scored",
                "branch_explored",
                "thoughts_aggregated",
                "tot_goal_reached",
                "tot_terminated",
            ],
            artifact_kind: ArtifactKindTag::Aggregation,
            config_defaults: PatternConfig {
                max_iterations: None,
                beam_width: Some(3),
                max_rounds: None,
            },
            detail_component: Some("ThoughtTree"),
        },
        PatternRegistryEntry {
            pattern_id: "supervisor",
            name: "监督委派",
            capability: CapabilityGroup::Collaborate,
            entry_command: None,
            run_command: None,
            event_family: &["task_assigned", "sub_agent_started", "sub_agent_completed", "sub_agent_error"],
            artifact_kind: ArtifactKindTag::Delegation,
            config_defaults: PatternConfig {
                max_iterations: None,
                beam_width: None,
                max_rounds: Some(1),
            },
            detail_component: Some("SubAgentTree"),
        },
        PatternRegistryEntry {
            pattern_id: "multi_agent",
            name: "多智能体协作",
            capability: CapabilityGroup::Collaborate,
            entry_command: None,
            run_command: None,
            event_family: &["round_started", "message_sent", "blackboard_updated", "round_completed", "converged"],
            artifact_kind: ArtifactKindTag::Convergence,
            config_defaults: PatternConfig {
                max_iterations: None,
                beam_width: None,
                max_rounds: Some(10),
            },
            detail_component: Some("MultiAgentBoard"),
        },
];

/// 静态注册表访问器
pub fn pattern_registry() -> &'static [PatternRegistryEntry] {
    PATTERN_REGISTRY
}

/// 按 id 查注册项
pub fn get_pattern(pattern_id: &str) -> Option<&'static PatternRegistryEntry> {
    pattern_registry().iter().find(|e| e.pattern_id == pattern_id)
}

/// 全部注册项（供 list_patterns 命令）
pub fn list_patterns() -> Vec<&'static PatternRegistryEntry> {
    pattern_registry().iter().collect()
}

/// 注册表完整性自检（五触点检查单：每条必填字段齐全）——M1-8 测试同款逻辑
pub fn validate_registry(entries: &[PatternRegistryEntry]) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    for e in entries {
        if !ids.insert(e.pattern_id) {
            return Err(format!("模式 id 重复: {}", e.pattern_id));
        }
        if e.event_family.is_empty() {
            return Err(format!("{}: event_family 为空（② 缺失）", e.pattern_id));
        }
        // ③ artifact_kind 必填：注册项缺失则无法构图期 kind 校验（④ 配置可空、⑤ 详图可空）
        // pattern_id 本身非空由 &'static str 保证
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_four_patterns_with_unique_ids() {
        // 2026-09-04：plan 模式随 B 轨退役移除，注册表现有 4 个可触发模式（tot/got/supervisor/multi_agent）
        let all = pattern_registry();
        assert_eq!(all.len(), 4, "M1-8 注册 4 个可触发模式");
        let mut seen = std::collections::HashSet::new();
        for e in all {
            assert!(seen.insert(e.pattern_id), "id 必须唯一，重复: {}", e.pattern_id);
        }
    }

    #[test]
    fn registry_passes_contact_checklist() {
        // 五触点检查单：②事件族 ③物 必填（①命令触点指令层收敛后下线可空；④配置 ⑤详图可空）
        validate_registry(pattern_registry()).expect("注册表必须通过五触点检查单");
        for e in pattern_registry() {
            assert!(!e.event_family.is_empty());
        }
    }

    #[test]
    fn get_pattern_lookup_works() {
        assert_eq!(get_pattern("tot").unwrap().capability, CapabilityGroup::Explore);
        assert_eq!(get_pattern("multi_agent").unwrap().artifact_kind, ArtifactKindTag::Convergence);
        assert!(get_pattern("ghost").is_none());
    }

    #[test]
    fn capability_grouping_covers_all_entries() {
        let groups: Vec<CapabilityGroup> = pattern_registry()
            .iter()
            .map(|e| e.capability)
            .collect();
        assert!(groups.contains(&CapabilityGroup::Explore));
        assert!(groups.contains(&CapabilityGroup::Collaborate));
        // plan 模式已随 B 轨退役移除（2026-09-04）：不再出现在编排模式注册表
        assert!(!groups.contains(&CapabilityGroup::Plan));
    }
}