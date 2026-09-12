//! # 锚点回填机制（A1 §6.2）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §6.2。
//!
//! ## 要解决的问题
//!
//! 上下文裁剪此前是**直接删除**（己2① 起为「选择性删除」）：超线的陈旧内容被整体
//! 移出活跃视图。虽然丙2 阶段 B 让被删内容在不可变日志中仍可寻址，但**上下文里
//! 没有任何痕迹**——LLM 不知道「这里曾有内容」，也无从知道可按坐标回源。
//!
//! > 用户机制定义（原话固化）：超长原始数据在压缩后的上下文里被「**一对前后锚点**」
//! > 替代（**空容器位**）；**完整原文进归档（外置）**；待后三层执行后，**按序把压缩
//! > 后的文本填回锚点之间**。
//!
//! ```text
//! 压缩前：    ... [ 超长工具原始数据 1200 token ] ...
//! 第一层后：  ... ⟨锚点A⟩ [空容器位] ⟨锚点B⟩ ...
//! 回填后：    ... ⟨锚点A⟩ [压缩后的文本] ⟨锚点B⟩ ...
//! 归档阈值：  完整原文进归档 → 清空上下文 → MemoryCenter 索引
//! ```
//!
//! ## 两条硬前置（均已由 丙2 阶段 B / 己1① 满足）
//!
//! 1. **原文必须已安全落地**——折叠的前提是外置成功（[`crate::raw_context::RawContextSink`]
//!    返回 `Some`）。外置被拒（超闸门 / 未注入）时**该组不折叠**——宁可超线，
//!    也不制造不可恢复的丢失。
//! 2. **稳定坐标**——折叠形不引用日志坐标，只引用**内容坐标**（`raw/{hash}`）；
//!    原文在不可变日志中的版本由日志自身保证（折叠 = 一次「就地修订」，
//!    旧版本留日志，见 `session_store` 的夹逼对齐）。
//!
//! ## 与「压缩四层」的关系（WorldSea 落地口径）
//!
//! 用户机制中的「第一层 → 后三层 → 填回」是**两段式**的：先占位（快速释放），
//! 后回填（压缩文本生成后填入）。WorldSea 的初版压缩器是**规则浓缩**（[`condense`]，
//! 零成本、即时），故两段在 [`crate::agent::AgentLoop::fold_context`] /
//! [`crate::agent::AgentLoop::backfill_folds`] 内**背靠背执行**；接口按两段式分离，
//! 将来压缩器升级为 LLM（慢）时可将回填后置调度，无需改数据模型。
//!
//! ## 数据模型（单一事实源 = 消息自身）
//!
//! 折叠状态**不落独立表**，而是内嵌在折叠形消息的 `meta["fold"]`（[`FoldMeta`]）：
//! 消息流到哪里（内存 / 日志 / 视图），折叠记录就跟到哪里。锚点引用 = 外置坐标
//! （内容寻址，同内容天然同坐标），无需另发编号。
//!
//! ## 配对安全
//!
//! 折叠以**工具交换组**为最小单位（与 [`crate::retention`] 同一分组），组内全部
//! 消息**合并为一条折叠形**并清空 `tool_calls` / `tool_call_id` 字段——工具配对
//! 关系在折叠形内部整体消化，不产生新的悬空（`dangling_tool_calls` 不变量保持）。

use crate::types::{MessageRole, OrchestratorMessage};

// ─── 折叠记录 ────────────────────────────────────

/// 折叠当前状态（锚点容器位的两态）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FoldState {
    /// 空容器位：原文已外置、压缩文本尚未回填
    Placeholder,
    /// 已回填：压缩文本已填入锚点之间
    Filled,
}

/// 折叠记录（存于折叠形消息的 `meta["fold"]`）
///
/// **单一事实源**：不落独立表——消息到哪里，记录到哪里。`raw` 既是外置坐标
/// （内容寻址），也是本折叠的稳定标识（同内容同坐标，无需另发编号）。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct FoldMeta {
    /// 当前状态（占位 / 已回填）
    pub state: FoldState,
    /// 原文外置坐标（sha256 前 16 位十六进制）
    pub raw: String,
    /// 原文体量（字节，= 外置材料字节数）
    pub orig_bytes: usize,
    /// 原文条数（被折叠的原始消息条数）
    pub orig_count: usize,
    /// 原文估算 token（释放量统计与后续权重参考）
    pub orig_tokens: usize,
}

/// 折叠形消息的 meta 键
pub const META_FOLD_KEY: &str = "fold";

/// 读取折叠记录（`None` = 该消息不是折叠形）
pub fn fold_meta_of(msg: &OrchestratorMessage) -> Option<FoldMeta> {
    let v = msg.meta.as_ref()?.get(META_FOLD_KEY)?;
    serde_json::from_value(v.clone()).ok()
}

/// 写入折叠记录
pub fn set_fold_meta(msg: &mut OrchestratorMessage, meta: &FoldMeta) {
    let map = msg
        .meta
        .get_or_insert_with(std::collections::HashMap::new);
    if let Ok(v) = serde_json::to_value(meta) {
        map.insert(META_FOLD_KEY.to_string(), v);
    }
}

/// 该消息是否是折叠形
pub fn is_folded(msg: &OrchestratorMessage) -> bool {
    fold_meta_of(msg).is_some()
}

/// 一次折叠执行的产出（供调用方回填与观测）
#[derive(Debug, Clone, Default)]
pub struct FoldOutcome {
    /// 成功折叠的组数
    pub folded_groups: usize,
    /// 被折叠的原始消息条数
    pub folded_messages: usize,
    /// 因外置被拒（闸门 / 失败）而保留原样的组数
    pub skipped_denied: usize,
    /// 因「已是折叠形」而跳过的组数（不二次折叠）
    pub skipped_embedded: usize,
    /// 估计释放的 token 数（原文成本 − 折叠形成本）
    pub saved_tokens: usize,
    /// `(raw 坐标, 压缩文本)` 对——供 `backfill_folds` 填回
    pub fills: Vec<(String, String)>,
}

// ─── 锚点标记 ────────────────────────────────────

/// 前锚点前缀（`⟨锚点A:{短坐标}⟩`）
pub const ANCHOR_A_PREFIX: &str = "⟨锚点A:";
/// 后锚点前缀（`⟨锚点B:{短坐标}⟩`）
pub const ANCHOR_B_PREFIX: &str = "⟨锚点B:";
/// 锚点闭合符
pub const ANCHOR_CLOSE: &str = "⟩";
/// 空容器位的首段标记（解析器据此判定 placeholder / filled）
pub const PLACEHOLDER_OPEN: &str = "[空容器位：";

/// 坐标短名（显示用；前 8 位足够区分，完整坐标在 [`FoldMeta::raw`]）
fn short_of(raw: &str) -> String {
    raw.chars().take(8).collect()
}

/// 前锚点标记
pub fn anchor_a(raw: &str) -> String {
    format!("{ANCHOR_A_PREFIX}{}{ANCHOR_CLOSE}", short_of(raw))
}

/// 后锚点标记
pub fn anchor_b(raw: &str) -> String {
    format!("{ANCHOR_B_PREFIX}{}{ANCHOR_CLOSE}", short_of(raw))
}

/// 渲染空容器位（placeholder 态）
pub fn render_placeholder(meta: &FoldMeta) -> String {
    format!(
        "{a}{open}原文 {bytes} 字节（{n} 条）已外置：raw/{raw}；压缩文本待回填]{b}",
        a = anchor_a(&meta.raw),
        b = anchor_b(&meta.raw),
        open = PLACEHOLDER_OPEN,
        bytes = meta.orig_bytes,
        n = meta.orig_count,
        raw = meta.raw,
    )
}

/// 渲染已回填形态（filled 态）
pub fn render_filled(meta: &FoldMeta, condensed: &str) -> String {
    format!(
        "{a}[{body}｜原文 {bytes} 字节（{n} 条）已外置：raw/{raw}]{b}",
        a = anchor_a(&meta.raw),
        b = anchor_b(&meta.raw),
        body = condensed,
        bytes = meta.orig_bytes,
        n = meta.orig_count,
        raw = meta.raw,
    )
}

/// 从折叠形文本解析出的锚点摘要（面板 / 测试 / 防重复用）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoldMarking {
    /// 坐标短名（前 8 位）
    pub short_hash: String,
    /// 状态（由内容区首段判定）
    pub state: FoldState,
}

/// 解析折叠形文本（`None` = 不含合法锚点对）
///
/// 判定规则：找 `⟨锚点A:{hex}⟩`，取 8 位短坐标（须为十六进制）；
/// 内容区以 [`PLACEHOLDER_OPEN`] 开头 → `Placeholder`，否则 `Filled`。
pub fn parse_fold_marking(text: &str) -> Option<FoldMarking> {
    let a_idx = text.find(ANCHOR_A_PREFIX)?;
    let after = &text[a_idx + ANCHOR_A_PREFIX.len()..];
    let close = after.find(ANCHOR_CLOSE)?;
    let short_hash: String = after[..close].chars().take(8).collect();
    if short_hash.is_empty() || !short_hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let rest = &after[close + ANCHOR_CLOSE.len()..];
    let state = if rest.starts_with(PLACEHOLDER_OPEN) {
        FoldState::Placeholder
    } else {
        FoldState::Filled
    };
    Some(FoldMarking { short_hash, state })
}

// ─── 折叠形构造 ──────────────────────────────────

/// 决定折叠形的 role：随组首条消息；孤儿 toolResult / system 转 `Assistant`
/// （避免带 `tool_call_id` 依赖的形态；System 本受保护、实际不会进入）。
pub fn fold_role_of(messages: &[OrchestratorMessage]) -> MessageRole {
    match messages.first().map(|m| m.role) {
        Some(MessageRole::ToolResult) | Some(MessageRole::System) => MessageRole::Assistant,
        Some(r) => r,
        None => MessageRole::Assistant,
    }
}

/// 由折叠记录构造一条折叠形消息（初始为 placeholder 态，回填由调用方后续执行）
pub fn make_folded_message(role: MessageRole, meta: &FoldMeta) -> OrchestratorMessage {
    let mut msg = OrchestratorMessage {
        role,
        content: render_placeholder(meta),
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    };
    set_fold_meta(&mut msg, meta);
    msg
}

// ─── 外置材料渲染 ────────────────────────────────

/// 把一组消息渲染为外置材料（完整、无损、自解释）
///
/// 这是**折叠形所指向的"原文"**：组内每条消息的正文与工具调用参数全量保留，
/// 供按坐标取回与人工审计。
pub fn render_archive_content(messages: &[OrchestratorMessage]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "以下是被折叠的原始内容（共 {} 条消息）：\n",
        messages.len()
    ));
    for (i, m) in messages.iter().enumerate() {
        out.push_str(&format!("\n--- [{}] {} ---\n", i + 1, role_label(m)));
        let body = m.content.trim();
        if !body.is_empty() {
            out.push_str(body);
            out.push('\n');
        }
        for tc in &m.tool_calls {
            out.push_str(&format!("[工具调用] {} {}\n", tc.name, tc.args));
        }
    }
    out.trim_end().to_string()
}

/// 材料渲染的角色标签
fn role_label(m: &OrchestratorMessage) -> String {
    match m.role {
        MessageRole::Assistant if !m.tool_calls.is_empty() => "assistant · 发起工具调用".to_string(),
        MessageRole::Assistant => "assistant".to_string(),
        MessageRole::User => "user".to_string(),
        MessageRole::ToolResult => match &m.tool_call_id {
            Some(id) => format!("tool_result · {id}"),
            None => "tool_result".to_string(),
        },
        MessageRole::System => "system".to_string(),
    }
}

// ─── 压缩（规则浓缩器）────────────────────────────

/// 折叠压缩策略（"后三层"的压缩强度参数）
#[derive(Debug, Clone, Copy)]
pub struct FoldPolicy {
    /// 保头字符数
    pub head_chars: usize,
    /// 保尾字符数
    pub tail_chars: usize,
}

impl Default for FoldPolicy {
    fn default() -> Self {
        Self {
            head_chars: 200,
            tail_chars: 80,
        }
    }
}

/// 规则浓缩：保头 + 保尾 + 省略计数（UTF-8 安全；空白折叠为单空格）
///
/// 这是 WorldSea 初版的「压缩后的文本」（零 LLM 成本）。压缩器的升级
/// （LLM 摘要 / 归档摘要复用）只需替换本函数产出，不影响锚点数据模型。
pub fn condense(text: &str, head_chars: usize, tail_chars: usize) -> String {
    let flat = flatten_ws(text);
    let n = flat.chars().count();
    if n <= head_chars + tail_chars {
        return flat;
    }
    let head: String = flat.chars().take(head_chars).collect();
    let tail: String = flat.chars().skip(n - tail_chars).collect();
    format!(
        "{head}……（省略 {omitted} 字符）……{tail}",
        omitted = n - head_chars - tail_chars
    )
}

/// 空白折叠：所有空白（含换行）压为单空格、首尾去空（压缩文本读起来是一行）
fn flatten_ws(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out.trim().to_string()
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

    fn meta_filled() -> FoldMeta {
        FoldMeta {
            state: FoldState::Filled,
            raw: "ab12cd34ef567890".into(),
            orig_bytes: 12345,
            orig_count: 4,
            orig_tokens: 3086,
        }
    }

    #[test]
    fn placeholder_roundtrips_and_is_recognized() {
        let mut meta = meta_filled();
        meta.state = FoldState::Placeholder;
        let text = render_placeholder(&meta);

        assert!(text.starts_with("⟨锚点A:ab12cd34⟩"));
        assert!(text.ends_with("⟨锚点B:ab12cd34⟩"));
        assert!(text.contains("12345 字节"));
        assert!(text.contains("raw/ab12cd34ef567890"));

        let marking = parse_fold_marking(&text).expect("应能解析");
        assert_eq!(marking.short_hash, "ab12cd34");
        assert_eq!(marking.state, FoldState::Placeholder);
    }

    #[test]
    fn filled_roundtrips_and_is_recognized() {
        let text = render_filled(&meta_filled(), "压缩后的正文……（省略 100 字符）……结尾");
        let marking = parse_fold_marking(&text).expect("应能解析");
        assert_eq!(marking.short_hash, "ab12cd34");
        assert_eq!(marking.state, FoldState::Filled);
        assert!(text.contains("压缩后的正文"));
    }

    #[test]
    fn parser_rejects_texts_without_valid_anchor() {
        assert!(parse_fold_marking("普通文本").is_none());
        // 锚点后非十六进制 → 拒绝
        assert!(parse_fold_marking("⟨锚点A:ZZZZZZZZ⟩[空容器位：x]⟨锚点B:ZZZZZZZZ⟩").is_none());
        // 缺闭合符 → 拒绝
        assert!(parse_fold_marking("⟨锚点A:ab12cd34").is_none());
    }

    #[test]
    fn meta_roundtrips_through_message() {
        let meta = meta_filled();
        let mut m = msg(MessageRole::Assistant, "x");
        assert!(!is_folded(&m));
        set_fold_meta(&mut m, &meta);
        assert!(is_folded(&m));
        assert_eq!(fold_meta_of(&m).as_ref(), Some(&meta));

        // 序列化-反序列化往返（meta 随消息持久化）
        let json = serde_json::to_string(&m).unwrap();
        let back: OrchestratorMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(fold_meta_of(&back).as_ref(), Some(&meta));
    }

    #[test]
    fn folded_message_carries_placeholder_and_meta() {
        let mut meta = meta_filled();
        meta.state = FoldState::Placeholder;
        let folded = make_folded_message(MessageRole::Assistant, &meta);
        assert_eq!(folded.role, MessageRole::Assistant);
        assert!(folded.tool_calls.is_empty());
        assert!(folded.tool_call_id.is_none());
        assert_eq!(
            parse_fold_marking(&folded.content).map(|m| m.state),
            Some(FoldState::Placeholder)
        );
        assert_eq!(fold_meta_of(&folded).unwrap().raw, "ab12cd34ef567890");
    }

    #[test]
    fn fold_role_follows_first_member_except_toolresult() {
        let asst = msg(MessageRole::Assistant, "a");
        let user = msg(MessageRole::User, "u");
        let mut tool = msg(MessageRole::ToolResult, "r");
        tool.tool_call_id = Some("c1".into());

        assert_eq!(fold_role_of(&[asst]), MessageRole::Assistant);
        assert_eq!(fold_role_of(&[user]), MessageRole::User);
        assert_eq!(fold_role_of(&[tool]), MessageRole::Assistant, "孤儿结果转中性 role");
        assert_eq!(fold_role_of(&[]), MessageRole::Assistant);
    }

    #[test]
    fn condense_keeps_head_tail_and_marks_omission() {
        let long = "头".repeat(300) + &"尾".repeat(200);
        let out = condense(&long, 200, 80);
        assert!(out.starts_with(&"头".repeat(200)));
        assert!(out.ends_with(&"尾".repeat(80)));
        assert!(out.contains("省略 220 字符"));

        // 短文本原样（仅空白折叠）
        assert_eq!(condense("短内容", 200, 80), "短内容");
    }

    #[test]
    fn condense_flattens_whitespace_and_is_utf8_safe() {
        let out = condense("第一行\n\n  第二行\t第三行", 200, 80);
        assert_eq!(out, "第一行 第二行 第三行");

        // 多字节边界：不会 panic，且字符计数正确
        let zh = "中".repeat(500);
        let out = condense(&zh, 100, 50);
        assert_eq!(out.chars().filter(|c| *c == '中').count(), 150);
    }

    #[test]
    fn archive_content_is_lossless_and_self_describing() {
        let mut asst = msg(MessageRole::Assistant, "我来调用工具");
        asst.tool_calls = vec![
            ToolCall {
                id: "c1".into(),
                name: "read_file".into(),
                args: serde_json::json!({"path": "/tmp/a.txt"}),
            },
            ToolCall {
                id: "c2".into(),
                name: "echo".into(),
                args: serde_json::json!({"text": "hi"}),
            },
        ];
        let mut res = msg(MessageRole::ToolResult, "文件内容……");
        res.tool_call_id = Some("c1".into());

        let out = render_archive_content(&[asst, res]);
        assert!(out.contains("共 2 条消息"));
        assert!(out.contains("assistant · 发起工具调用"));
        assert!(out.contains("read_file"));
        assert!(out.contains("/tmp/a.txt"), "工具参数须全量保留");
        assert!(out.contains("tool_result · c1"));
        assert!(out.contains("文件内容……"));
    }
}
