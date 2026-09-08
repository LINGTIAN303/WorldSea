//! 工作流定义解析（YAML / JSON / Auto-detect）
//!
//! 提供：
//! - [`ParseFormat`]：JSON / YAML / Auto
//! - [`parse_definition`]：从字符串解析为 [`WorkflowDefinition`]
//! - [`serialize_definition`]：将定义序列化为字符串
//!
//! 错误通过 [`CoreError`] 暴露，调用方可统一在 Tauri Command 层映射到 `WorkflowError`。
//! 解析失败一律走 `CoreError::InvalidArgument`，表示输入端问题。

use crate::error::CoreError;
use crate::workflow::types::WorkflowDefinition;

/// 解析格式。`Auto` 会基于首字符做简单嗅探（`{` / `[` → JSON，否则 YAML）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseFormat {
    /// 显式 JSON
    Json,
    /// 显式 YAML
    Yaml,
    /// 自动嗅探
    Auto,
}

/// 把字符串解析为 [`WorkflowDefinition`]。
///
/// 行为：
/// - `Auto` 时调用 [`detect_format`] 判断走 JSON 还是 YAML 路径
/// - 先把源文本转 `serde_json::Value`，再用强类型反序列化到 `WorkflowDefinition`
/// - 任何解析 / 结构错误都映射为 `CoreError::InvalidArgument`
pub fn parse_definition(src: &str, format: ParseFormat) -> Result<WorkflowDefinition, CoreError> {
    let actual_format = match format {
        ParseFormat::Auto => detect_format(src),
        f => f,
    };
    let json_value: serde_json::Value = match actual_format {
        ParseFormat::Json => serde_json::from_str(src)
            .map_err(|e| CoreError::InvalidArgument(format!("JSON 解析失败: {e}")))?,
        ParseFormat::Yaml => serde_yaml::from_str(src)
            .map_err(|e| CoreError::InvalidArgument(format!("YAML 解析失败: {e}")))?,
        ParseFormat::Auto => unreachable!("Auto 已在前面展开"),
    };
    serde_json::from_value(json_value)
        .map_err(|e| CoreError::InvalidArgument(format!("工作流定义结构错误: {e}")))
}

/// 把 [`WorkflowDefinition`] 序列化为字符串。
///
/// - `Json` 输出 pretty JSON
/// - `Yaml` 输出 YAML
/// - `Auto` 默认走 pretty JSON（最稳）
pub fn serialize_definition(
    def: &WorkflowDefinition,
    format: ParseFormat,
) -> Result<String, CoreError> {
    let json_value = serde_json::to_value(def)
        .map_err(|e| CoreError::InvalidArgument(format!("序列化失败: {e}")))?;
    match format {
        ParseFormat::Json => serde_json::to_string_pretty(&json_value)
            .map_err(|e| CoreError::InvalidArgument(format!("JSON 序列化失败: {e}"))),
        ParseFormat::Yaml => serde_yaml::to_string(&json_value)
            .map_err(|e| CoreError::InvalidArgument(format!("YAML 序列化失败: {e}"))),
        ParseFormat::Auto => serde_json::to_string_pretty(&json_value)
            .map_err(|e| CoreError::InvalidArgument(format!("序列化失败: {e}"))),
    }
}

/// 嗅探格式：trim 后以 `{` 或 `[` 开头视为 JSON，否则视为 YAML。
fn detect_format(src: &str) -> ParseFormat {
    let trimmed = src.trim_start();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        ParseFormat::Json
    } else {
        ParseFormat::Yaml
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_json_by_brace() {
        assert_eq!(detect_format(" { \"a\": 1 }"), ParseFormat::Json);
        assert_eq!(detect_format("[1, 2, 3]"), ParseFormat::Json);
    }

    #[test]
    fn detect_yaml_by_indent() {
        assert_eq!(detect_format("id: x\nname: y"), ParseFormat::Yaml);
    }

    #[test]
    fn serialize_roundtrip_json() {
        let yaml_src = "id: wf-1\nname: T\nversion: 1\nnodes: []\nedges: []\n";
        let def = parse_definition(yaml_src, ParseFormat::Yaml).unwrap();
        let out = serialize_definition(&def, ParseFormat::Json).unwrap();
        // roundtrip 回去应当等价
        let back = parse_definition(&out, ParseFormat::Auto).unwrap();
        assert_eq!(back.id, def.id);
    }
}
