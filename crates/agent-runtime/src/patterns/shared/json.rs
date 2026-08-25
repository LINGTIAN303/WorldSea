//! JSON 解析公共工具 — 供各扩展模式复用
//!
//! 原散落于 plan.rs（extract_code_block/extract_json_array/extract_json_object）与
//! tot/error.rs（extract_json_object String 版）；迁移起因见 matrix §4 Reflection
//! 卡片跨模式耦合修正。统一后全部 pub，模式间经 shared 复用。

/// 提取响应中的 ```code``` 块内容（无块则 None）
pub fn extract_code_block(response: &str) -> Option<String> {
    let marker = "```";
    let start = response.find(marker)? + marker.len();
    let rest = &response[start..];
    // 跳过可选的 language 标识（直到换行）
    let content_start = rest.find('\n').map(|i| i + 1).unwrap_or(0);
    let content = &rest[content_start..];
    let end = content.find(marker)?;
    Some(content[..end].trim().to_string())
}

/// 容错解析 JSON 数组 — 三级降级：
/// 1. 直接 parse（若顶层是数组）
/// 2. 提取 ```json ... ``` 代码块
/// 3. 提取首个 `[...]` 片段
pub fn extract_json_array(response: &str) -> Option<Vec<serde_json::Value>> {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(response) {
        if let Some(arr) = v.as_array() {
            return Some(arr.clone());
        }
    }
    if let Some(block) = extract_code_block(response) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&block) {
            if let Some(arr) = v.as_array() {
                return Some(arr.clone());
            }
        }
    }
    if let (Some(start), Some(end)) = (response.find('['), response.rfind(']')) {
        if end > start {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&response[start..=end]) {
                if let Some(arr) = v.as_array() {
                    return Some(arr.clone());
                }
            }
        }
    }
    None
}

/// 容错解析 JSON 对象 — 三级降级（Reflection 评审结果等用）
///
/// 1. 直接 parse（若顶层是对象）
/// 2. 提取 ```json ... ``` 代码块
/// 3. 提取首个 `{...}` 片段
/// 另含推理模型「双花括号 `{{...}}` 包裹」容错（剥一层再试）。
pub fn extract_json_object(response: &str) -> Option<serde_json::Value> {
    // 双花括号包裹（如 `{{"score":0}}`）→ 去掉一层花括号
    let trimmed = response.trim();
    let unwrapped = if trimmed.starts_with("{{") && trimmed.ends_with("}}") {
        trimmed[1..trimmed.len() - 1].trim()
    } else {
        trimmed
    };

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(unwrapped) {
        if v.is_object() {
            return Some(v);
        }
    }
    if let Some(block) = extract_code_block(response) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&block) {
            if v.is_object() {
                return Some(v);
            }
        }
    }
    if let (Some(start), Some(end)) = (response.find('{'), response.rfind('}')) {
        if end > start {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&response[start..=end]) {
                if v.is_object() {
                    return Some(v);
                }
            }
        }
    }
    None
}

/// 提取 JSON 对象子串（String 版）— 供 `serde_json::from_str` 直接消费的场景
///
/// 解析失败时回退为剥围栏/双花括号后的原文（与逻辑等价于旧 tot 版）。
pub fn extract_json_object_string(text: &str) -> String {
    extract_json_object(text)
        .map(|v| v.to_string())
        .unwrap_or_else(|| {
            let trimmed = text.trim();
            let unwrapped = if trimmed.starts_with("{{") && trimmed.ends_with("}}") {
                trimmed[1..trimmed.len() - 1].trim()
            } else {
                trimmed
            };
            unwrapped
                .strip_prefix("```json")
                .or_else(|| unwrapped.strip_prefix("```"))
                .and_then(|s| s.strip_suffix("```"))
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|| unwrapped.to_string())
        })
}