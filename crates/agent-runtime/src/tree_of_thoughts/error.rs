// ─── 错误 ────────────────────────────────────────────

/// ToT 错误
#[derive(Debug, thiserror::Error)]
pub enum ToTError {
    #[error("LLM 调用失败: {0}")]
    LlmCall(String),

    #[error("LLM 响应解析失败: {0}")]
    Parse(String),

    #[error("探索失败: {0}")]
    Explore(String),

    #[error("评分失败: {0}")]
    Score(String),

    #[error("目标检查失败: {0}")]
    GoalCheck(String),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("其他错误: {0}")]
    Other(String),
}

impl From<crate::backend::BackendError> for ToTError {
    fn from(e: crate::backend::BackendError) -> Self {
        Self::LlmCall(e.to_string())
    }
}

/// 提取 LLM 输出中的 JSON 对象子串
///
/// 容错处理：
/// - ```json 代码围栏包裹
/// - 推理模型常见的双花括号 `{{...}}` 包裹（去掉一层）
///
/// 返回可被 `serde_json::from_str` 直接解析的对象字符串。
pub(super) fn extract_json_object(text: &str) -> String {
    let trimmed = text.trim();
    let json_str = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|s| s.strip_suffix("```"))
        .map(|s| s.trim())
        .unwrap_or(trimmed);

    // 双花括号包裹（如 `{{"score":0}}`）→ 去掉一层花括号
    if json_str.starts_with("{{") && json_str.ends_with("}}") {
        let inner = &json_str[1..json_str.len() - 1];
        return inner.trim().to_string();
    }

    json_str.to_string()
}
