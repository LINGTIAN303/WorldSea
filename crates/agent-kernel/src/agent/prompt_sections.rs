//! 系统提示段式组装器（A4 提取融合）——详细见 docs/plans/2026-09-16-deepseek-harness-方向探究/04-施工准备.md §一 A4
//!
//! 设计来源：deepseek-harness 的 system-prompt 组装契约——段 = {name, order, text}，
//! 按 order 升序拼接（同 order 按 name 码点序），空段跳过。
//!
//! 本模块只做「结构」不做「插值」：WorldSea 现有 prompt 无模板变量场景
//! （场景 prompt 由 Rust 方法生成、TS 侧由模板字符串拼接），故暂不引入
//! dsh 的 `{{var}}` 未知引用报错契约——未来若引入模板化 prompt 再补校验。
//!
//! A4 双端收口（2026-09-17）：`PromptSection` 为跨端直传契约（serde 派生；
//! TS 侧 `PromptSectionDto` 与之同形）；分段带见 07 设计 §3.2 —— Rust 管带间
//! （本模块常量），TS 管带内（静态注入带 200-299，TS 侧 `SECTION_ORDER` 集中分配）。

/// 段序分配（集中定义，禁止散落魔数——对齐 dsh 的 getSectionOrder 做法）
///
/// 分段带：`SCENARIO(100)` → 静态注入带 `200-299`（TS 12 段 + `MCP_NOTE`）→
/// `MEMORY(300)` → `PIPELINE(400)`。
pub mod order {
    /// 场景身份（system prompt 主体）
    pub const SCENARIO: i32 = 100;
    /// 静态注入（legacy 单段：群聊 / 老会话文本；结构化段走 200-299 带）
    pub const STATIC: i32 = 200;
    /// MCP 环境注记（agent-commands 注入的会话级段；静态注入带尾）
    pub const MCP_NOTE: i32 = 290;
    /// 记忆注入（A1 记忆系统）
    pub const MEMORY: i32 = 300;
    /// 管线指引（Router 决策的本轮管线）
    pub const PIPELINE: i32 = 400;
}

/// 一个提示段
///
/// serde 派生：跨端直传 + 持久化契约（A4 双端收口）——TS 侧以同名 `PromptSectionDto`
/// 同形传递，`sessions.prompt_sections` 列存其 JSON。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PromptSection {
    /// 段名（同 order 时按此字典序；也用于日志诊断）
    pub name: String,
    /// 段序（升序靠前；取值见本模块 [`order`] 常量）
    pub order: i32,
    /// 段文本（纯空白段在组装时跳过）
    pub text: String,
}

impl PromptSection {
    /// 构造一个提示段
    pub fn new(name: impl Into<String>, order: i32, text: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            order,
            text: text.into(),
        }
    }
}

/// 组装多段为单一 system prompt
///
/// - 排序：order 升序 → 同 order 按 name 码点升序
/// - 空段（纯空白）跳过；全空返回 `None`（与既有「无 prompt」语义一致）
/// - 分隔：段间 `\n\n`（与改造前的拼接行为一致）
pub fn assemble_sections(mut sections: Vec<PromptSection>) -> Option<String> {
    sections.retain(|s| !s.text.trim().is_empty());
    if sections.is_empty() {
        return None;
    }
    sections.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.name.cmp(&b.name)));

    let mut out = String::new();
    for (i, s) in sections.iter().enumerate() {
        if i > 0 {
            out.push_str("\n\n");
        }
        out.push_str(&s.text);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 按段序升序拼接
    #[test]
    fn assembles_in_section_order() {
        let out = assemble_sections(vec![
            PromptSection::new("pipeline", order::PIPELINE, "管线"),
            PromptSection::new("scenario", order::SCENARIO, "场景"),
            PromptSection::new("memory", order::MEMORY, "记忆"),
            PromptSection::new("static", order::STATIC, "静态"),
        ]);
        assert_eq!(out.unwrap(), "场景\n\n静态\n\n记忆\n\n管线");
    }

    /// 同段序按名字典序
    #[test]
    fn breaks_ties_by_name() {
        let out = assemble_sections(vec![
            PromptSection::new("b", order::STATIC, "B"),
            PromptSection::new("a", order::STATIC, "A"),
        ]);
        assert_eq!(out.unwrap(), "A\n\nB");
    }

    /// 空段跳过；全空返回 None
    #[test]
    fn skips_blank_sections_and_returns_none() {
        assert_eq!(
            assemble_sections(vec![PromptSection::new("x", order::STATIC, "   \n")]),
            None
        );
        assert_eq!(assemble_sections(vec![]), None);
        let out = assemble_sections(vec![
            PromptSection::new("empty", order::STATIC, ""),
            PromptSection::new("scenario", order::SCENARIO, "场景"),
        ]);
        assert_eq!(out.unwrap(), "场景");
    }

    /// 单段无多余分隔符
    #[test]
    fn single_section_has_no_separator() {
        let out = assemble_sections(vec![PromptSection::new("scenario", order::SCENARIO, "仅场景")]);
        assert_eq!(out.unwrap(), "仅场景");
    }
}