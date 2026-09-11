//! # 原文外置接口（A1 己1①）
//!
//! 对应 [A1 记忆系统设计](../../../docs/plans/2026-09-11-A1-记忆系统设计.md) §6.1 / §6.3。
//!
//! ## 要解决的问题
//!
//! 工具结果在**入库前**按 [`crate::agent`] 的阈值截断（`clamp_tool_result`）——
//! 被丢掉的中段**此后在任何存储里都不存在**，无从回溯。己1③ 把「只保头部」改成
//! 「保头 + 保尾」是**缓解**（重要内容更可能落在首尾），不是解决：中段依然消失。
//!
//! 己1① 的解法：**截断之前，先把完整原文外置成文件**，消息里只留一个指向它的
//! **内容坐标**（sha256 前 16 位）。于是「内容丢失」降级为「位置丢失」——
//! 需要时可按坐标取回。
//!
//! ```text
//! 截断前：…[已截断，省略 12345 字节]…
//! 截断后：…[已截断，省略 12345 字节；原文已外置：raw/ab12cd34ef567890]…
//! ```
//!
//! ## 为什么是闭包注入（与 [`crate::context_budget::TokenEstimator`] 同款）
//!
//! 真实外置实现要写文件、算 sha256、登记 `raw_ref` 引用——那是 `agent-memory` 的事。
//! 底座内核**不引入**这条依赖边（星型拓扑：只定义契约，不依赖具体实现），
//! 只暴露「一个函数」的签名，由装配层注入。
//!
//! 因此本模块**只含契约**（类型 + 标注文本 + 标注解析），**零新依赖**：
//! 坐标怎么算（sha256）、文件落在哪（`raw/{hash}.txt`）都属实现方，见
//! `agent_memory::raw_store`。
//!
//! ## 同步签名是有意的
//!
//! 调用点 `clamp_tool_result` 是**同步**函数（在 async 上下文里，但本身不 await）。
//! 外置单个工具结果是小块 IO，实现方直接同步写即可；若要做成 async，就得把
//! `clamp_tool_result` 整条链改成 async（涉及两处调用点与广播路径），
//! 收益不匹配代价。**实现方须自行避免在此闭包内做任何 await 或阻塞式网络调用。**
//!
//! ## 契约（实现方必须遵守）
//!
//! 1. **失败必须返回 `None`，不得 panic、不得阻断**——外置是增强，截断才是兜底。
//!    `None` 时调用方退回纯截断（保头 + 保尾），功能不中断。
//! 2. **大小闸门**：超过实现方的单文件 / 总量上限时返回 `None`（拒绝外置 → 退回截断），
//!    不做「截断后再外置」（那会让外置内容与原文不一致，反而制造伪保真）。
//! 3. **内容寻址**：返回的 `content_hash` 必须**只由内容决定**（同内容必同 hash），
//!    这样重复的相同内容天然去重、且坐标可跨会话复用。

use std::sync::Arc;

/// 外置原文的引用坐标
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawRef {
    /// 内容坐标：sha256 前 16 位十六进制（**只由内容决定**）
    pub content_hash: String,
    /// 原文字节数（供日志与容量统计）
    pub byte_len: usize,
}

/// 原文外置器（`Fn(原文) -> Option<坐标>`）
///
/// 返回 `None` = 未外置（超闸门 / IO 失败等）→ 调用方退回纯截断。
pub type RawContextSink = Arc<dyn Fn(&str) -> Option<RawRef> + Send + Sync>;

/// 空实现（不外置）——未注入时的默认值，行为与改造前完全一致
pub fn noop_sink() -> RawContextSink {
    Arc::new(|_| None)
}

/// 截断标注中标记「原文已外置」的片段前缀（**读取侧/测试的匹配锚点**）
///
/// 形如：`原文已外置：raw/ab12cd34ef567890`
///
/// 放在契约层（而非实现方）：因为标注文本由**本层**生成（截断发生在这里），
/// 而解析它的是实现方与 UI —— 两侧必须认同一个锚点串。
pub const EXTERNALIZED_MARKER: &str = "原文已外置：raw/";

/// 生成截断标注里那一段可读文本
pub fn externalized_note(content_hash: &str) -> String {
    format!("{EXTERNALIZED_MARKER}{content_hash}")
}

/// 从文本中提取被标注的外置坐标（**读取侧共用**：从截断标注反解出坐标）
///
/// 返回 `None` = 文本中不含外置标注。
pub fn parse_externalized_hash(text: &str) -> Option<String> {
    let idx = text.find(EXTERNALIZED_MARKER)? + EXTERNALIZED_MARKER.len();
    let rest = &text[idx..];
    // 坐标 = 后续的连续十六进制字符（sha256 前 16 位）
    let hash: String = rest
        .chars()
        .take_while(|c| c.is_ascii_hexdigit())
        .take(16)
        .collect();
    if hash.chars().count() == 16 {
        Some(hash)
    } else {
        None
    }
}

// ─── 测试 ────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noop_sink_never_externalizes() {
        let sink = noop_sink();
        assert!(sink("任意内容").is_none(), "空实现必须返回 None（退回纯截断）");
    }

    #[test]
    fn externalized_note_roundtrips_through_parser() {
        let hash = "ab12cd34ef567890";
        let note = externalized_note(hash);
        assert!(note.starts_with(EXTERNALIZED_MARKER));
        assert_eq!(parse_externalized_hash(&note).as_deref(), Some(hash));

        // 嵌入到完整截断标注里也能解析出来
        let full = format!("生成的大输出\n…[已截断，省略 12345 字节；{note}]…\n尾部结论");
        assert_eq!(parse_externalized_hash(&full).as_deref(), Some(hash));
    }

    #[test]
    fn parser_rejects_absent_or_malformed_marker() {
        assert!(parse_externalized_hash("普通文本，无标注").is_none());
        // 坐标不足 16 位 → 拒绝（宁可当没有，也不给出会取错的坐标）
        let short = externalized_note("abcd");
        assert!(parse_externalized_hash(&short).is_none());
        // 非十六进制前缀 → 拒绝
        let bad = "原文已外置：raw/ZZZZZZZZZZZZZZZZ";
        assert!(parse_externalized_hash(bad).is_none());
        // 恰好 16 位后跟其他字符 → 只取 16 位
        let long = externalized_note(&"0123456789abcdef".to_string());
        assert_eq!(
            parse_externalized_hash(&format!("{long}额外文字")).as_deref(),
            Some("0123456789abcdef")
        );
    }
}
