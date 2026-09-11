//! # 类型化保留契约（A1 己2①）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §5.4。
//!
//! ## 解决的三个真实问题
//!
//! 此前唯一自动裁剪点（[`crate::agent::AgentLoop`] 的预算裁剪）是**零类型感知**：
//! 判据只看体量、从头部逐条丢、只保留「最近 N 条」这个条数概念，不看 role、
//! 不成组、不留痕。由此产生三处缺口：
//!
//! | # | 问题 | 后果 | 本模块的对策 |
//! |---|---|---|---|
//! | ① | `state.messages[0]` 的 System 消息（承载系统提示词）在被裁最头部，**第一个丢掉**，下一轮又重新推入 —— 落在**列表末尾** | 功能无损但**位置漂移**；前端历史/检查点里系统提示词跑到中间 | [`RetentionClass::SystemAnchor`]：**永不参与裁剪**（且不因裁剪而移位） |
//! | ② | `tool_call` / `tool_result` 切点落在两者之间 → 悬空 `tool_call_id` → API 400 | 硬错误 | **工具交换组**按组原子丢弃（组内全可裁才丢，且整组同去） |
//! | ③ | 最近一轮 user 原始输入**无保证**——单轮含 ≥6 次工具调用（1 user + 6×(assistant + toolResult) = 13 条）即落在保留窗口外 | **真实可达的数据丢失**：用户刚说的话被丢 | [`RetentionClass::LatestUserInput`]：最近一条 user 消息**永不参与裁剪** |
//!
//! ## 保留优先级（本设计契约）
//!
//! ```text
//! 系统提示词  >  最近一轮 user 原始输入  >  未完成的计划步骤
//!         >  工具配对完整性（硬约束）  >  最近 N 轮对话  >  陈旧工具结果
//! ```
//!
//! 其中「未完成的计划步骤」与「记忆引用」等**内容级**语义，由写入方通过
//! [`mark_retention`] 在消息 `meta` 上打标（本模块给出机制，打标由甲2 调和 /
//! 乙3 注入等后续项接入）。
//!
//! ## A3 白名单四类硬保留
//!
//! 来源：A3 文档 L182 是全库**唯一的显式「必须保留类型」白名单**——
//! 「压缩不得牺牲关键信息（**意图、决策、待办、记忆引用**）」。
//! 直接采用为四类：[`RetentionTag::Intent`] / [`RetentionTag::Decision`] /
//! [`RetentionTag::Todo`] / [`RetentionTag::MemoryRef`]。
//!
//! ## 与 TS 侧既有心智的关系
//!
//! 类型化保留的心智在 TS 侧早已写出但**从未接线**（`ShortTermMemoryHelper` 无消费方、
//! `truncateMessages` 是死代码）。本模块是这套心智在 Rust 主链路的**首次落地**。

use crate::types::{MessageRole, OrchestratorMessage};

/// 消息 `meta` 中承载保留标签的键名
pub const META_RETENTION_KEY: &str = "retention";

/// A3 白名单四类硬保留内容
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionTag {
    /// 意图（用户/Agent 表达的目��）
    Intent,
    /// 决策（已作出的选择及其理由）
    Decision,
    /// 待办（未完成的动作）
    Todo,
    /// 记忆引用（指向长期记忆的锚点）
    MemoryRef,
}

impl RetentionTag {
    /// 序列化名（写入 `meta["retention"]`）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Intent => "intent",
            Self::Decision => "decision",
            Self::Todo => "todo",
            Self::MemoryRef => "memory_ref",
        }
    }

    /// 从序列化名解析
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "intent" => Some(Self::Intent),
            "decision" => Some(Self::Decision),
            "todo" => Some(Self::Todo),
            "memory_ref" => Some(Self::MemoryRef),
            _ => None,
        }
    }

    /// 中文名（日志用）
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Intent => "意图",
            Self::Decision => "决策",
            Self::Todo => "待办",
            Self::MemoryRef => "记忆引用",
        }
    }
}

/// 给消息打上保留标签（写入方调用；幂等覆盖）
///
/// 供甲2 调和结论、乙3 注入内容、计划步骤等**内容级语义**接入保留契约。
pub fn mark_retention(msg: &mut OrchestratorMessage, tag: RetentionTag) {
    let meta = msg.meta.get_or_insert_with(Default::default);
    meta.insert(
        META_RETENTION_KEY.to_string(),
        serde_json::Value::String(tag.as_str().to_string()),
    );
}

/// 读取消息的保留标签
pub fn retention_tag_of(msg: &OrchestratorMessage) -> Option<RetentionTag> {
    msg.meta
        .as_ref()
        .and_then(|m| m.get(META_RETENTION_KEY))
        .and_then(|v| v.as_str())
        .and_then(RetentionTag::from_str)
}

/// 校验一组消息是否**不存在悬空 tool 配对**
///
/// 返回悬空的 `tool_call_id` 列表（空 = 合规）。两种破坏形态都会被抓到：
/// 1. `toolResult` 找不到声明它的 `assistant(tool_calls)`；
/// 2. `assistant(tool_calls)` 声明的工具结果**一条都不在**（工具调用无回音）。
///
/// 这是裁剪结果的**独立不变量检查**——分组逻辑（[`RetentionPlan::build_groups`]）
/// 是内建保证，本函数用于测试与排障时从外部再验一遍，避免「逻辑自证」。
pub fn dangling_tool_calls(messages: &[OrchestratorMessage]) -> Vec<String> {
    use std::collections::HashSet;
    let mut declared: HashSet<&str> = HashSet::new();
    let mut answered: HashSet<&str> = HashSet::new();
    let mut dangling: Vec<String> = Vec::new();

    for m in messages {
        match m.role {
            MessageRole::Assistant => {
                for c in &m.tool_calls {
                    declared.insert(c.id.as_str());
                }
            }
            MessageRole::ToolResult => {
                if let Some(id) = m.tool_call_id.as_deref() {
                    if !declared.contains(id) && !answered.contains(id) {
                        dangling.push(id.to_string());
                    }
                    answered.insert(id);
                }
            }
            _ => {}
        }
    }
    // 反向：声明了却没有回音的工具调用（截断把结果切掉了）
    for id in &declared {
        if !answered.contains(id) {
            dangling.push((*id).to_string());
        }
    }
    dangling.sort();
    dangling.dedup();
    dangling
}

/// 保留等级（优先级从高到低排列，枚举定义顺序即优先级）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionClass {
    /// 系统提示词载体（`role = System`）——永不裁剪
    SystemAnchor,
    /// 最近一条 user 原始输入——永不裁剪
    LatestUserInput,
    /// 显式打标（A3 四类白名单之一）——永不裁剪
    Pinned(RetentionTag),
    /// 最近 N 条之内——裁剪时的第二道防线
    RecentTurn,
    /// 可裁（陈旧内容）
    Droppable,
}

impl RetentionClass {
    /// 是否受保护（不参与裁剪）
    pub fn is_protected(&self) -> bool {
        !matches!(self, Self::Droppable)
    }

    /// 优先级权重（越大越优先保留；诊断用）
    pub fn priority(&self) -> u8 {
        match self {
            Self::SystemAnchor => 5,
            Self::LatestUserInput => 4,
            Self::Pinned(_) => 3,
            Self::RecentTurn => 2,
            Self::Droppable => 0,
        }
    }
}

/// 保留策略
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// 最少保留条数（「最近 N 轮对话」的 N 条口径）
    pub keep_recent: usize,
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        // 对齐既有 HISTORY_KEEP_MESSAGES = 12（≈4–6 轮普通对话）
        Self { keep_recent: 12 }
    }
}

/// 裁剪计划
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DropPlan {
    /// 应删除的消息下标（升序）
    pub indices: Vec<usize>,
    /// 这些消息的 token 合计
    pub dropped_tokens: usize,
    /// 因受保护而放弃裁剪的「组」数（诊断：说明预算为何可能仍超线）
    pub skipped_protected_groups: usize,
}

impl DropPlan {
    /// 是否为空计划
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }

    /// 转为删除掩码（长度 = 消息条数）
    pub fn mask(&self, len: usize) -> Vec<bool> {
        let mut mask = vec![false; len];
        for &i in &self.indices {
            if i < len {
                mask[i] = true;
            }
        }
        mask
    }
}

/// 保留计划（对一组消息的分类结果）
#[derive(Debug, Clone)]
pub struct RetentionPlan {
    /// 每条消息的保留等级
    classes: Vec<RetentionClass>,
    /// 每条消息所属的工具交换组 id
    groups: Vec<usize>,
    /// 组总数
    group_count: usize,
}

impl RetentionPlan {
    /// 对消息序列分类
    ///
    /// 优先级按 [`RetentionClass`] 定义顺序赋值（低优先级先赋值，高优先级覆盖）。
    pub fn classify(messages: &[OrchestratorMessage], policy: &RetentionPolicy) -> Self {
        let n = messages.len();
        let mut classes = vec![RetentionClass::Droppable; n];

        // ② 「最近 N 条」——最低的非零等级，先铺
        let recent_from = n.saturating_sub(policy.keep_recent);
        for c in classes.iter_mut().skip(recent_from) {
            *c = RetentionClass::RecentTurn;
        }

        // ③ 显式打标（A3 四类白名单）——覆盖 RecentTurn
        for (i, m) in messages.iter().enumerate() {
            if let Some(tag) = retention_tag_of(m) {
                classes[i] = RetentionClass::Pinned(tag);
            }
        }

        // ④ 最近一轮 user 原始输入——覆盖 Pinned
        if let Some(idx) = messages.iter().rposition(|m| m.role == MessageRole::User) {
            classes[idx] = RetentionClass::LatestUserInput;
        }

        // ⑤ 系统提示词载体——最高优先级
        for (i, m) in messages.iter().enumerate() {
            if m.role == MessageRole::System {
                classes[i] = RetentionClass::SystemAnchor;
            }
        }

        let (groups, group_count) = Self::build_groups(messages);
        Self {
            classes,
            groups,
            group_count,
        }
    }

    /// 构建工具交换组
    ///
    /// 规则：**`toolResult` 归入「最近的、声明了它 `tool_call_id` 的前置 assistant」所在组**；
    /// 无声明者的孤儿结果、以及非工具消息各自成组。
    ///
    /// ## 为什么用「按 id 匹配」而不是「按下标相邻」
    ///
    /// 首版按下标扫描「assistant 后紧跟的结果」，被属性测试当场抓出缺口：
    ///
    /// ```text
    /// [asst(tool_calls=[c1]), asst(tool_calls=[c2]), result(c1), result(c2)]
    /// ```
    ///
    /// 下标法会把两个 result 判为「无主」各自成组 → 单独丢掉 `result(c1)` 就留下
    /// `asst(c1)` 孤零零声明无回音 → 截断实现该保证的不变量被破坏。
    /// 真实链路里一轮多工具本就常见（`assistant(tool_calls=[c1, c2])` 后跟两条结果），
    /// 结果到达顺序也不保证与声明顺序一致，故按 **id 匹配 + 最近前置**归属，与顺序解耦。
    ///
    /// 成组的目的是**原子丢弃**——切在组中间会产生悬空 `tool_call_id`（API 400）。
    fn build_groups(messages: &[OrchestratorMessage]) -> (Vec<usize>, usize) {
        let n = messages.len();
        let mut groups = vec![usize::MAX; n];
        let mut g = 0usize;

        // 1. 每个 assistant(tool_calls) 起一组，记录其声明的 id
        let mut declarers: Vec<(usize, Vec<String>)> = Vec::new();
        for (i, m) in messages.iter().enumerate() {
            if m.role == MessageRole::Assistant && !m.tool_calls.is_empty() {
                groups[i] = g;
                g += 1;
                declarers.push((i, m.tool_calls.iter().map(|c| c.id.clone()).collect()));
            }
        }

        // 2. toolResult 归属到最近的、声明了它的前置 assistant
        for (i, m) in messages.iter().enumerate() {
            if m.role != MessageRole::ToolResult || groups[i] != usize::MAX {
                continue;
            }
            let id = m.tool_call_id.as_deref();
            let owner = id.and_then(|target| {
                declarers
                    .iter()
                    .rev() // 声明者按下标递增收集，反向即「从近到远」
                    .find(|(di, ids)| *di < i && ids.iter().any(|x| x == target))
                    .map(|(di, _)| groups[*di])
            });
            groups[i] = match owner {
                Some(grp) => grp,
                None => {
                    // 孤儿结果（无前置声明者）——独立成组，可单独回收
                    let solo = g;
                    g += 1;
                    solo
                }
            };
        }

        // 3. 其余消息各自成组
        for i in 0..n {
            if groups[i] == usize::MAX {
                groups[i] = g;
                g += 1;
            }
        }
        (groups, g)
    }

    /// 消息条数
    pub fn len(&self) -> usize {
        self.classes.len()
    }

    /// 是否为空
    pub fn is_empty(&self) -> bool {
        self.classes.is_empty()
    }

    /// 某条消息的保留等级
    pub fn class_of(&self, index: usize) -> Option<RetentionClass> {
        self.classes.get(index).copied()
    }

    /// 某条消息是否受保护
    pub fn is_protected(&self, index: usize) -> bool {
        self.classes
            .get(index)
            .map(|c| c.is_protected())
            .unwrap_or(false)
    }

    /// 受保护消息的条数（按等级统计，诊断用）
    pub fn protected_counts(&self) -> (usize, usize, usize) {
        let mut system = 0usize;
        let mut latest_user = 0usize;
        let mut pinned = 0usize;
        for c in &self.classes {
            match c {
                RetentionClass::SystemAnchor => system += 1,
                RetentionClass::LatestUserInput => latest_user += 1,
                RetentionClass::Pinned(_) => pinned += 1,
                _ => {}
            }
        }
        (system, latest_user, pinned)
    }

    /// 选择要丢弃的**组**（不返回单个下标）
    ///
    /// 算法：从最旧的组开始，整组丢弃，直到累计占用降到 `trigger` 之下；
    /// **任何含受保护成员的组一律跳过**（含 `keep_recent` 之内的组）。
    ///
    /// # 参数
    /// - `costs`：每条消息的 token 成本（长度须与消息数一致）
    /// - `total_tokens`：当前总占用
    /// - `trigger`：目标水位（裁剪到不超过它）
    pub fn select_drops(&self, costs: &[usize], total_tokens: usize, trigger: usize) -> DropPlan {
        let n = self.classes.len();
        if costs.len() != n || n == 0 || total_tokens <= trigger {
            return DropPlan::default();
        }

        // 组 → 成员下标 + 组成本 + 组是否可裁
        let mut members: Vec<Vec<usize>> = vec![Vec::new(); self.group_count];
        let mut group_cost: Vec<usize> = vec![0; self.group_count];
        let mut group_droppable: Vec<bool> = vec![true; self.group_count];
        for i in 0..n {
            let g = self.groups[i];
            members[g].push(i);
            group_cost[g] += costs.get(i).copied().unwrap_or(0);
            if self.classes[i].is_protected() {
                group_droppable[g] = false;
            }
        }

        // 组按「成员最小下标」升序 = 从旧到新
        let mut order: Vec<usize> = (0..self.group_count).collect();
        order.sort_by_key(|&g| members[g].first().copied().unwrap_or(usize::MAX));

        let mut acc = total_tokens;
        let mut skipped = 0usize;
        let mut indices: Vec<usize> = Vec::new();
        let mut dropped_tokens = 0usize;

        for g in order {
            if acc <= trigger {
                break;
            }
            if !group_droppable[g] {
                skipped += 1;
                continue;
            }
            acc = acc.saturating_sub(group_cost[g]);
            dropped_tokens += group_cost[g];
            indices.extend(members[g].iter().copied());
        }
        indices.sort_unstable();

        DropPlan {
            indices,
            dropped_tokens,
            skipped_protected_groups: skipped,
        }
    }
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ToolCall;

    fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
        OrchestratorMessage {
            role,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }
    }

    fn tool_caller(id: &str, content: &str) -> OrchestratorMessage {
        let mut m = msg(MessageRole::Assistant, content);
        m.tool_calls = vec![ToolCall {
            id: id.into(),
            name: "echo".into(),
            args: serde_json::json!({}),
        }];
        m
    }

    fn tool_result(id: &str, content: &str) -> OrchestratorMessage {
        let mut m = msg(MessageRole::ToolResult, content);
        m.tool_call_id = Some(id.into());
        m
    }

    /// 一轮内并发多个工具调用（真实形态：一条 assistant 带多个 tool_calls）
    fn multi_tool_caller(ids: &[&str], content: &str) -> OrchestratorMessage {
        let mut m = msg(MessageRole::Assistant, content);
        m.tool_calls = ids
            .iter()
            .map(|id| ToolCall {
                id: (*id).into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            })
            .collect();
        m
    }

    /// 每条 10 token 的成本表
    fn flat_costs(n: usize, each: usize) -> Vec<usize> {
        vec![each; n]
    }

    #[test]
    fn system_anchor_and_latest_user_are_never_dropped() {
        let mut msgs = vec![msg(MessageRole::System, "系统提示词")];
        for i in 0..20 {
            msgs.push(msg(MessageRole::User, &format!("轮次 {i}")));
            msgs.push(msg(MessageRole::Assistant, &format!("回复 {i}")));
        }
        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy { keep_recent: 4 });

        assert_eq!(plan.class_of(0), Some(RetentionClass::SystemAnchor));
        // 最后一条 user（下标 39）
        assert_eq!(plan.class_of(39), Some(RetentionClass::LatestUserInput));

        let costs = flat_costs(msgs.len(), 10);
        let drops = plan.select_drops(&costs, 1000, 100);
        assert!(!drops.indices.contains(&0), "System 消息不得被裁");
        assert!(!drops.indices.contains(&39), "最近一轮 user 输入不得被裁");
        assert!(!drops.is_empty(), "应有可裁内容");
    }

    /// ★ 己2① 的靶心案例：单轮 ≥6 次工具调用时，最近一轮 user 输入仍在保留区外
    ///
    /// 旧实现（纯「最近 12 条」）会把它丢掉 —— 用户刚说的话消失。
    #[test]
    fn latest_user_survives_heavy_tool_turn() {
        let mut msgs: Vec<OrchestratorMessage> = (0..10)
            .map(|i| msg(MessageRole::User, &format!("旧消息 {i}")))
            .collect();
        // 本轮：1 条 user + 6×(assistant(tool_calls) + toolResult) = 13 条
        msgs.push(msg(MessageRole::User, "[本轮] 请重构这个模块"));
        for k in 0..6 {
            msgs.push(tool_caller(&format!("call_{k}"), &format!("决定调用工具 {k}")));
            msgs.push(tool_result(&format!("call_{k}"), &format!("结果 {k}")));
        }
        let n = msgs.len();
        assert_eq!(n, 23);

        let policy = RetentionPolicy { keep_recent: 12 };
        let plan = RetentionPlan::classify(&msgs, &policy);
        let user_idx = 10; // 本轮 user 消息

        // 旧口径：「最近 12 条」从下标 11 起，下标 10 落在保护窗口之外
        assert!(
            user_idx < n - policy.keep_recent,
            "本用例的前提：该 user 消息确实落在「最近 12 条」之外（否则测不到缺口）"
        );
        // 新口径：被显式保护
        assert_eq!(plan.class_of(user_idx), Some(RetentionClass::LatestUserInput));

        let costs = flat_costs(n, 100);
        let drops = plan.select_drops(&costs, 2300, 100);
        assert!(
            !drops.indices.contains(&user_idx),
            "最后一条 user 输入必须存活（本轮 13 条挤压出保留窗口的真实场景）"
        );
        // 被丢的是更早的旧消息
        assert!(drops.indices.iter().any(|&i| i < 10));
    }

    #[test]
    fn tool_exchange_groups_are_dropped_atomically() {
        let mut msgs = vec![msg(MessageRole::User, "开始")];
        msgs.push(tool_caller("c1", "调用"));
        msgs.push(tool_result("c1", "结果"));
        msgs.push(msg(MessageRole::Assistant, "收尾"));
        // 尾部若干新消息，确保前部可裁
        for i in 0..8 {
            msgs.push(msg(MessageRole::User, &format!("新 {i}")));
        }

        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy { keep_recent: 4 });
        let costs = flat_costs(msgs.len(), 100);
        let drops = plan.select_drops(&costs, 1300, 100);

        let has_caller = drops.indices.contains(&1);
        let has_result = drops.indices.contains(&2);
        assert_eq!(
            has_caller, has_result,
            "assistant(tool_calls) 与其 toolResult 必须同去同留（悬空 tool_call_id → 400）"
        );

        // 全量不变量：保留区里不得出现「toolResult 而缺少其声明者」
        let kept: Vec<&OrchestratorMessage> = msgs
            .iter()
            .enumerate()
            .filter(|(i, _)| !drops.indices.contains(i))
            .map(|(_, m)| m)
            .collect();
        let declared: Vec<String> = kept
            .iter()
            .flat_map(|m| m.tool_calls.iter().map(|c| c.id.clone()))
            .collect();
        for m in &kept {
            if let Some(t) = &m.tool_call_id {
                assert!(declared.contains(t), "保留区存在悬空 tool_call_id: {t}");
            }
        }
    }

    #[test]
    fn protect_window_blocks_drops_inside_it() {
        let msgs: Vec<OrchestratorMessage> = (0..6)
            .map(|i| msg(MessageRole::User, &format!("m{i}")))
            .collect();
        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy { keep_recent: 4 });
        let costs = flat_costs(6, 100);
        // 目标水位极低 → 想把能丢的都丢光
        let drops = plan.select_drops(&costs, 600, 1);
        // 最近 4 条（下标 2..6）受保护；下标 0、1 可裁
        assert_eq!(drops.indices, vec![0, 1]);
        assert_eq!(drops.dropped_tokens, 200);
    }

    #[test]
    fn pinned_tag_outranks_recent_window() {
        let mut msgs: Vec<OrchestratorMessage> = (0..10)
            .map(|i| msg(MessageRole::Assistant, &format!("m{i}")))
            .collect();
        // 把一条很旧的消息标为「决策」
        mark_retention(&mut msgs[1], RetentionTag::Decision);

        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy { keep_recent: 4 });
        assert_eq!(
            plan.class_of(1),
            Some(RetentionClass::Pinned(RetentionTag::Decision))
        );
        assert!(plan.is_protected(1));

        let costs = flat_costs(10, 100);
        let drops = plan.select_drops(&costs, 1000, 1);
        assert!(!drops.indices.contains(&1), "打标消息不得被裁");
        // 打标的那一组被跳过 → 计入诊断
        assert!(drops.skipped_protected_groups > 0);
    }

    #[test]
    fn retention_tag_marker_roundtrip() {
        let mut m = msg(MessageRole::Assistant, "x");
        assert!(retention_tag_of(&m).is_none());
        mark_retention(&mut m, RetentionTag::MemoryRef);
        assert_eq!(retention_tag_of(&m), Some(RetentionTag::MemoryRef));
        // 覆盖写
        mark_retention(&mut m, RetentionTag::Todo);
        assert_eq!(retention_tag_of(&m), Some(RetentionTag::Todo));

        for tag in [
            RetentionTag::Intent,
            RetentionTag::Decision,
            RetentionTag::Todo,
            RetentionTag::MemoryRef,
        ] {
            assert_eq!(RetentionTag::from_str(tag.as_str()), Some(tag));
            assert!(!tag.display_name().is_empty());
        }
        assert_eq!(RetentionTag::from_str("乱写"), None);
    }

    #[test]
    fn priority_order_is_documented_order() {
        let p = |c: RetentionClass| c.priority();
        assert!(p(RetentionClass::SystemAnchor) > p(RetentionClass::LatestUserInput));
        assert!(p(RetentionClass::LatestUserInput) > p(RetentionClass::Pinned(RetentionTag::Intent)));
        assert!(p(RetentionClass::Pinned(RetentionTag::Intent)) > p(RetentionClass::RecentTurn));
        assert!(p(RetentionClass::RecentTurn) > p(RetentionClass::Droppable));
    }

    #[test]
    fn no_drop_when_under_trigger() {
        let msgs: Vec<OrchestratorMessage> = (0..10)
            .map(|i| msg(MessageRole::User, &format!("m{i}")))
            .collect();
        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy::default());
        let costs = flat_costs(10, 10);
        let drops = plan.select_drops(&costs, 100, 100);
        assert!(drops.is_empty(), "未超线不该产生裁剪计划");
    }

    #[test]
    fn mask_and_counts_are_consistent() {
        let mut msgs = vec![msg(MessageRole::System, "sys")];
        msgs.push(msg(MessageRole::User, "u"));
        mark_retention(&mut msgs[1], RetentionTag::Intent);
        let plan = RetentionPlan::classify(&msgs, &RetentionPolicy { keep_recent: 0 });
        assert_eq!(plan.len(), 2);
        assert!(!plan.is_empty());
        let (s, u, p) = plan.protected_counts();
        // 该条 user 同时被「打标」和「最新 user」覆盖——按优先级取后者，
        // 故打标计数为 0（不是缺陷，而是契约：最新 user 优先级更高）
        assert_eq!((s, u, p), (1, 1, 0));

        // 打成「决策」的非 user 消息才计入打标位
        let mut msgs2 = vec![msg(MessageRole::System, "sys")];
        msgs2.push(msg(MessageRole::Assistant, "已决定用 A 方案"));
        mark_retention(&mut msgs2[1], RetentionTag::Decision);
        msgs2.push(msg(MessageRole::User, "继续"));
        let plan2 = RetentionPlan::classify(&msgs2, &RetentionPolicy { keep_recent: 0 });
        let (s2, u2, p2) = plan2.protected_counts();
        assert_eq!((s2, u2, p2), (1, 1, 1));

        let mask = DropPlan {
            indices: vec![0],
            dropped_tokens: 5,
            skipped_protected_groups: 0,
        }
        .mask(2);
        assert_eq!(mask, vec![true, false]);
    }

    #[test]
    fn dangling_detector_catches_both_break_shapes() {
        // 合规：成对
        let ok = vec![tool_caller("c1", "调用"), tool_result("c1", "结果")];
        assert!(dangling_tool_calls(&ok).is_empty());

        // 形态 1：结果留下、声明者被切走
        let orphan = vec![tool_result("c1", "结果")];
        assert_eq!(dangling_tool_calls(&orphan), vec!["c1".to_string()]);

        // 形态 2：声明留下、结果被切走
        let unanswered = vec![tool_caller("c2", "调用")];
        assert_eq!(dangling_tool_calls(&unanswered), vec!["c2".to_string()]);
    }

    /// 属性式验证：多种布局下，**裁剪不得新增悬空配对**
    ///
    /// 注意不变量的正确表述是「裁剪后的悬空集合 ⊆ 裁剪前的悬空集合」——
    /// 输入本身若已含缺陷（如孤儿 `toolResult`，布局 2 就是），
    /// 裁剪器既不该掩盖它，也不该被它拖累；绝对为空的断言属于「输入良构」的
    /// 更强前提（由 [`Self::tool_exchange_groups_are_dropped_atomically`] 覆盖）。
    #[test]
    fn drops_never_break_tool_pairing_across_layouts() {
        // 七种布局：交替、连续工具、多工具并发（一条 assistant）、
        // 交错声明者、孤儿结果、纯文本、单条
        let layouts: Vec<Vec<OrchestratorMessage>> = vec![
            vec![msg(MessageRole::User, "a"), msg(MessageRole::Assistant, "b")],
            vec![tool_caller("c1", "x"), tool_result("c1", "y")],
            vec![tool_result("orphan", "z"), msg(MessageRole::User, "w")],
            vec![
                tool_caller("c1", "x"),
                tool_caller("c2", "y"),
                tool_result("c1", "r1"),
                tool_result("c2", "r2"),
            ],
            // 真实并发形态：一条 assistant 声明两个工具，两条结果随后到达
            vec![
                msg(MessageRole::User, "开始"),
                multi_tool_caller(&["c1", "c2"], "并行调用"),
                tool_result("c1", "r1"),
                tool_result("c2", "r2"),
                msg(MessageRole::Assistant, "汇总"),
                msg(MessageRole::User, "继续"),
            ],
            (0..12).map(|i| msg(MessageRole::User, &format!("t{i}"))).collect(),
            vec![msg(MessageRole::User, "唯一一条")],
        ];

        for (li, base) in layouts.iter().enumerate() {
            let before = dangling_tool_calls(base);
            for keep_recent in [0usize, 1, 3, 12] {
                let plan = RetentionPlan::classify(base, &RetentionPolicy { keep_recent });
                let costs = flat_costs(base.len(), 100);
                // 从「刚好超线」扫到「尽量多丢」，覆盖各种裁剪深度
                for target in [0usize, 100, 250, 500, 900] {
                    let drops = plan.select_drops(&costs, base.len() * 100, target);
                    let kept: Vec<OrchestratorMessage> = base
                        .iter()
                        .enumerate()
                        .filter(|(i, _)| !drops.indices.contains(i))
                        .map(|(_, m)| m.clone())
                        .collect();
                    let after = dangling_tool_calls(&kept);
                    for id in &after {
                        assert!(
                            before.contains(id),
                            "布局 {li}（keep_recent={keep_recent}, target={target}）\
                             裁剪新增了悬空配对 {id}（裁剪前无此缺陷）"
                        );
                    }
                }
            }
        }
    }
}
