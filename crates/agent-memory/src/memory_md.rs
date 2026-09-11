//! # `MEMORY.md` 渲染（A1 乙3①）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §2.1 / §3.3 / §7.3。
//!
//! ## 定位（D1 双层架构的 interface 层）
//!
//! ```text
//!   常驻每轮注入 ────▶  MEMORY.md （interface）        ← 本模块产出
//!                        · Agent 主动维护 · 用户不可直接编辑
//!                        · 精选常驻 · 贯穿全部会话
//!                        · 与四层分层正交，不占短/长期分类
//!                        │ 结构化写入（四操作，非自由文本）
//!                        ▼
//!                      agent-memory 适配层 → MemoryCenter SQLite（substrate）
//! ```
//!
//! **关键约束**（乙1② / 乙2④）：`MEMORY.md` 是**每轮常态注入**，成本是「每轮消耗上下文」，
//! 因此内容边界必须是**高价值密度的小集合**——只放跨项目的、稳定的、必须每轮在场的条目；
//! 其余留在 substrate 里按需召回。
//!
//! **与召回注入的关系**：`agent-memory` 的「召回注入」预算与常驻注入**不是同一个池子**
//! （设计 §3.3 约束 3 专门澄清过这处长期混淆）。故本模块设**独立且更紧**的字符上限 ——
//! 常驻比按需更贵（每轮都付），必须更克制。
//!
//! **乙2 的例外地位**：乙2 裁定「双向，以文件为准」，但用户明确留言
//! **「以文件为准，但不包含 MEMORY.md 这个特殊记忆文件」**——即本文件
//! **不参与**「以文件为准」的读写闭环，而是由记忆系统按结构化操作**派生渲染**。
//! 这是「用户不能涉及 + 不能随意写入」在实现上的落点：没有自由文本写入口，
//! 只有「从受治理的记忆集合渲染」这一条路。
//!
//! ## 选取口径（谁有资格进精选常驻）
//!
//! 三类来源（来源本身即「为什么稳定且重要」的证据）：
//!
//! | 来源 | 证据 | 产生方式 |
//! |---|---|---|
//! | **置顶**（`pinned`） | 显式声明「不衰减、不淘汰」（甲4 的 pinned 列即为此设） | `MemoryAccessor::pin` |
//! | **调和结论** | 设计原话：「**调和结论正是最该进 MEMORY.md 的那类内容**（跨项目、稳定、必须常驻）」 | 甲2 取代式更新自动产出 |
//! | **显式打标**（`常驻` 标签） | 显式声明精选 | `write(...).with_tags(["常驻"])` |
//!
//! ## 确定性
//!
//! 输出对同一输入**逐字节稳定**（固定分组顺序、组内按时间升序、序号连续）——
//! 使调用方可按「内容是否变化」决定是否重写文件，避免每轮无意义写盘。

use crate::ext::SupersedeLink;

/// 常驻注入条目的来源（决定分组与「为何入选」的呈现）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CuratedKind {
    /// 置顶条目（`pinned`）
    Pinned,
    /// 调和结论（取代链上的摘要）
    Reconcile,
}

impl CuratedKind {
    /// 分组标题
    fn section_title(&self) -> &'static str {
        match self {
            Self::Pinned => "长期有效",
            Self::Reconcile => "已知更正",
        }
    }

    /// 分组副标题（向模型解释这一组为什么可信）
    fn section_hint(&self) -> &'static str {
        match self {
            Self::Pinned => "以下条目被显式标记为长期有效，请优先依据它们理解用户的稳定偏好与设定。",
            Self::Reconcile => {
                "以下条目记录了**发生过的更正**（旧值不被覆盖，仅标注被谁取代）——\
                 当旧印象与这里冲突时，以时序较晚者为准。"
            }
        }
    }

    /// 排序权重（组顺序固定：更正在前，因为它直接防「用过期印象作答」）
    fn order(&self) -> u8 {
        match self {
            Self::Reconcile => 0,
            Self::Pinned => 1,
        }
    }
}

/// 一条常驻条目
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CuratedEntry {
    /// 来源分组
    pub kind: CuratedKind,
    /// 条目文本（渲染时按 [`MemoryMdPolicy::excerpt_chars`] 截断）
    pub text: String,
    /// 时点（Unix 毫秒；组内排序用，升序）
    pub at_ms: i64,
}

impl CuratedEntry {
    /// 从调和链记录构造条目
    ///
    /// 摘要缺失（`ChainOnly` 档）时**退回「旧 → 新」的骨架表达**而非跳过——
    /// 取代关系本身就有价值（它告诉模型「某个印象已过期」），
    /// 而摘要只是增强。退回时用 hook 短 ID 标示两端，保持可追溯。
    pub fn from_supersede_link(link: &SupersedeLink) -> Self {
        let text = match link.summary.as_deref() {
            Some(s) if !s.trim().is_empty() => s.to_string(),
            _ => format!(
                "（更正）{} → {}",
                short_id(&link.old_hook_id),
                short_id(&link.new_hook_id)
            ),
        };
        Self {
            kind: CuratedKind::Reconcile,
            text,
            at_ms: link.decided_at,
        }
    }
}

/// 渲染策略（每轮常态成本的上限）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryMdPolicy {
    /// 最多条目数
    pub max_entries: usize,
    /// 总字符上限（条目正文计；标题与固定说明不计）
    pub max_chars: usize,
    /// 单条文本截断长度（字符）
    pub excerpt_chars: usize,
}

/// 默认总字符上限
///
/// 取 1500 而非召回注入的 2000：常驻是**每轮都付**的成本，比按需召回更贵；
/// 且乙1② 的「少量条目」要求高价值密度。超出部分**不静默丢弃**——
/// 渲染时给出省略说明，让下游知道还有未展示的条目。
pub const DEFAULT_MAX_CHARS: usize = 1500;

/// 默认最多条目数
pub const DEFAULT_MAX_ENTRIES: usize = 20;

/// 默认单条截断长度
pub const DEFAULT_EXCERPT_CHARS: usize = 160;

impl Default for MemoryMdPolicy {
    fn default() -> Self {
        Self {
            max_entries: DEFAULT_MAX_ENTRIES,
            max_chars: DEFAULT_MAX_CHARS,
            excerpt_chars: DEFAULT_EXCERPT_CHARS,
        }
    }
}

/// 渲染 `MEMORY.md`
///
/// 返回 `None` = **无内容可渲染**（不产出空文件：空文件被注入只会白占上下文，
/// 且会让「文件存在」失去「有常驻记忆」的含义）。
pub fn render(entries: &[CuratedEntry], policy: &MemoryMdPolicy) -> Option<String> {
    if entries.is_empty() {
        return None;
    }

    // 排序：分组顺序固定 → 组内按时点升序（早→晚，与「时序先后」的阅读直觉一致）
    let mut sorted: Vec<&CuratedEntry> = entries.iter().collect();
    sorted.sort_by(|a, b| {
        a.kind
            .order()
            .cmp(&b.kind.order())
            .then_with(|| a.at_ms.cmp(&b.at_ms))
            .then_with(|| a.text.cmp(&b.text)) // 末位键保证同输入下排序唯一 → 输出逐字节稳定
    });

    let mut out = String::new();
    out.push_str(HEADER);

    let mut used_chars = 0usize;
    let mut used_entries = 0usize;
    let mut omitted = 0usize;
    let mut current: Option<CuratedKind> = None;
    let mut section_index = 0usize; // 组内序号（每组从 1 重新计数）

    for entry in &sorted {
        // 组切换 → 起新小节
        if current != Some(entry.kind) {
            if current.is_some() {
                out.push('\n');
            }
            out.push_str(&format!(
                "## {}\n\n{}\n\n",
                entry.kind.section_title(),
                entry.kind.section_hint()
            ));
            current = Some(entry.kind);
            section_index = 0;
        }

        let text = excerpt(&entry.text, policy.excerpt_chars);
        let cost = text.chars().count();

        // 双闸门：条数与字符数任一超限即停止（余下计入省略）
        if used_entries >= policy.max_entries || used_chars + cost > policy.max_chars {
            omitted += 1;
            continue;
        }

        section_index += 1;
        used_entries += 1;
        used_chars += cost;
        out.push_str(&format!("{section_index}. {text}\n"));
    }

    if omitted > 0 {
        out.push_str(&format!(
            "\n> 另有 {omitted} 条常驻条目因预算上限未展示（可通过记忆检索按需获取）。\n"
        ));
    }

    Some(out.trim_end().to_string() + "\n")
}

/// 文件抬头（固定说明）
///
/// 三重作用：① 告知模型这是什么、该怎么用；② 告知任何打开此文件的人它由 Agent 维护、
/// 改动会被下次派生覆盖；③ 声明与四层分层正交，避免被误读成某层记忆。
const HEADER: &str = "\
# MEMORY.md

> 本文件由记忆系统**自动维护**（Agent 主动更新，用户不可直接编辑）。
> 手工改动会在下次派生时被覆盖；如需变更，请在对话中告知 Agent。
> 内容为**精选常驻**条目：跨会话稳定、且每轮都需要在场的最小集合；
> 其余记忆留在记忆库中按需检索，不在此文件展开。

";

/// 截断（按字符边界，UTF-8 安全；空白折叠为单空格便于单行展示）
fn excerpt(text: &str, limit: usize) -> String {
    let cleaned: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if limit == 0 || cleaned.chars().count() <= limit {
        return cleaned;
    }
    let head: String = cleaned.chars().take(limit).collect();
    format!("{head}…")
}

/// hook_id 短标识（8 字符；用于退回骨架表达时的可追溯指认）
fn short_id(hook_id: &str) -> String {
    hook_id.chars().take(8).collect()
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(text: &str, at: i64) -> CuratedEntry {
        CuratedEntry {
            kind: CuratedKind::Pinned,
            text: text.into(),
            at_ms: at,
        }
    }

    fn link(old: &str, new: &str, summary: Option<&str>, at: i64) -> SupersedeLink {
        SupersedeLink {
            old_hook_id: old.into(),
            new_hook_id: new.into(),
            reason: "revision".into(),
            summary: summary.map(|s| s.to_string()),
            decided_at: at,
        }
    }

    #[test]
    fn empty_input_renders_none_not_empty_file() {
        assert!(render(&[], &MemoryMdPolicy::default()).is_none());
    }

    #[test]
    fn header_declares_agent_maintained_and_readonly() {
        let out = render(&[pin("用户偏好深色主题", 1)], &MemoryMdPolicy::default()).unwrap();
        assert!(out.starts_with("# MEMORY.md"), "抬头固定: {out}");
        assert!(out.contains("自动维护"), "表明 Agent 维护");
        assert!(out.contains("用户不可直接编辑"), "表明用户只读");
        assert!(out.contains("精选常驻"), "表明内容边界");
        assert!(out.contains("按需检索"), "表明与库内内容的分工");
    }

    #[test]
    fn groups_are_ordered_reconcile_before_pinned() {
        let entries = vec![
            pin("长期偏好", 100),
            CuratedEntry::from_supersede_link(&link("a", "b", Some("已更正"), 200)),
        ];
        let out = render(&entries, &MemoryMdPolicy::default()).unwrap();
        let idx_reconcile = out.find("## 已知更正").expect("应有更正组");
        let idx_pinned = out.find("## 长期有效").expect("应有长期有效组");
        assert!(
            idx_reconcile < idx_pinned,
            "更正组在前（直接防「用过期印象作答」）: {out}"
        );
    }

    #[test]
    fn entries_are_numbered_per_section_and_time_ordered() {
        let entries = vec![
            pin("后写入的", 200),
            pin("先写入的", 100),
        ];
        let out = render(&entries, &MemoryMdPolicy::default()).unwrap();
        let first = out.find("1. 先写入的").expect("序号 1 应为较早条目");
        let second = out.find("2. 后写入的").expect("序号 2 应为较晚条目");
        assert!(first < second, "组内按时点升序: {out}");
    }

    #[test]
    fn output_is_byte_stable_for_same_input() {
        let entries = vec![
            pin("B", 100),
            pin("A", 100), // 同时点 → 靠末位键（text）定序
            CuratedEntry::from_supersede_link(&link("x", "y", Some("s"), 50)),
        ];
        let a = render(&entries, &MemoryMdPolicy::default()).unwrap();
        let b = render(&entries, &MemoryMdPolicy::default()).unwrap();
        assert_eq!(a, b, "同输入须逐字节稳定（调用方据此决定是否重写文件）");

        // 输入顺序打乱也不影响输出
        let mut shuffled = entries.clone();
        shuffled.reverse();
        assert_eq!(render(&shuffled, &MemoryMdPolicy::default()).unwrap(), a);
    }

    #[test]
    fn supersede_without_summary_falls_back_to_traceable_skeleton() {
        let e = CuratedEntry::from_supersede_link(&link(
            "0123456789abcdef",
            "fedcba9876543210",
            None,
            1,
        ));
        assert!(e.text.contains("更正"), "骨架须表明是更正: {}", e.text);
        assert!(e.text.contains("01234567"), "含旧值短 ID 便于追溯");
        assert!(e.text.contains("fedcba98"), "含新值短 ID");
        // 有摘要时用摘要
        let with = CuratedEntry::from_supersede_link(&link("a", "b", Some("真正的摘要"), 1));
        assert_eq!(with.text, "真正的摘要");
        // 空白摘要视为缺失（不产出空洞条目）
        let blank = CuratedEntry::from_supersede_link(&link("a", "b", Some("   "), 1));
        assert!(blank.text.contains("更正"));
    }

    #[test]
    fn char_budget_stops_and_reports_omission() {
        let entries: Vec<CuratedEntry> = (0..10)
            .map(|i| pin(&format!("条目{i}：{}", "字".repeat(40)), i as i64))
            .collect();
        let policy = MemoryMdPolicy {
            max_entries: 100,
            max_chars: 150, // 只够 3 条（每条 40+ 字）
            excerpt_chars: 160,
        };
        let out = render(&entries, &policy).unwrap();
        assert!(out.contains("另有"), "超限须给出省略说明（不静默丢弃）: {out}");
        assert!(out.contains("未展示"), "省略说明须明示");
        // 实际展示条数受限
        let shown = out.matches("：").count();
        assert!(shown <= 4, "受字符预算约束，实际展示 {shown} 条");
    }

    #[test]
    fn entry_count_cap_is_enforced() {
        let entries: Vec<CuratedEntry> = (0..5).map(|i| pin(&format!("e{i}"), i)).collect();
        let policy = MemoryMdPolicy {
            max_entries: 2,
            max_chars: 100_000,
            excerpt_chars: 160,
        };
        let out = render(&entries, &policy).unwrap();
        assert!(out.contains("另有 3 条"), "条数闸门应拦下 3 条: {out}");
    }

    #[test]
    fn long_entry_is_truncated_utf8_safely() {
        let long = "中".repeat(300);
        let entries = vec![pin(&long, 1)];
        let policy = MemoryMdPolicy {
            excerpt_chars: 10,
            ..Default::default()
        };
        let out = render(&entries, &policy).unwrap();
        assert!(out.contains('…'), "超长应截断并标注");
        // 截断后单条字符数 = 10 + 省略号
        let line = out.lines().find(|l| l.starts_with("1. ")).unwrap();
        assert_eq!(line.chars().count(), 3 + 11, "行内容: {line}");
    }

    #[test]
    fn inline_newlines_collapse_to_keep_one_entry_per_line() {
        let e = pin("第一行\n第二行\n\n第三行", 1);
        let out = render(&[e], &MemoryMdPolicy::default()).unwrap();
        assert!(out.contains("1. 第一行 第二行 第三行"), "空白折叠为单空格: {out}");
    }

    #[test]
    fn render_ends_with_single_newline() {
        let out = render(&[pin("x", 1)], &MemoryMdPolicy::default()).unwrap();
        assert!(out.ends_with('\n'));
        assert!(!out.ends_with("\n\n"), "不应有多余空行");
    }
}
