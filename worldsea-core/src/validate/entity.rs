use serde::{Deserialize, Serialize};

use crate::models::entity::{Entity, EntityTypeSchema, FieldSchema};

/// 验证错误条目，记录单条验证问题的路径、消息和严重程度
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationError {
  /// 错误所在的数据路径，如 "id"、"properties.age"
  pub path: String,
  /// 错误描述信息
  pub message: String,
  /// 严重程度，"error" 或 "warning"
  pub severity: String,
}

/// 验证报告，汇总所有验证错误和警告，并标记整体是否通过
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
  /// 整体是否通过验证
  pub valid: bool,
  /// 所有验证错误和警告的列表
  pub errors: Vec<ValidationError>,
}

impl Default for ValidationReport {
  fn default() -> Self {
    Self::new()
  }
}

impl ValidationReport {
  #[must_use]
  pub const fn new() -> Self {
    Self { valid: true, errors: Vec::new() }
  }

  /// 添加一条错误级别的验证问题，同时将报告标记为未通过
  pub fn add_error(&mut self, path: &str, message: &str) {
    self.valid = false;
    self.errors.push(ValidationError {
      path: path.to_string(),
      message: message.to_string(),
      severity: "error".to_string(),
    });
  }

  /// 添加一条警告级别的验证问题，不影响整体通过状态
  pub fn add_warning(&mut self, path: &str, message: &str) {
    self.errors.push(ValidationError {
      path: path.to_string(),
      message: message.to_string(),
      severity: "warning".to_string(),
    });
  }
}

/// 验证实体数据的合法性，包括 ID、类型、名称等基本字段，以及可选的 Schema 约束检查
///
/// 参数:
/// - `entity`: 待验证的实体引用
/// - `schema`: 可选的实体类型 Schema，提供字段级别的约束校验
///
/// 返回: 包含所有验证结果的 `ValidationReport`
#[must_use]
pub fn validate_entity(entity: &Entity, schema: Option<&EntityTypeSchema>) -> ValidationReport {
  let mut report = ValidationReport::new();

  if entity.id.is_empty() {
    report.add_error("id", "实体 ID 不能为空");
  }

  if entity.entity_type.is_empty() {
    report.add_error("type", "实体类型不能为空");
  }

  if entity.name.trim().is_empty() {
    report.add_error("name", "实体名称不能为空");
  }

  if let Some(s) = schema {
    validate_entity_against_schema(entity, s, &mut report);
  }

  report
}

fn validate_entity_against_schema(
  entity: &Entity,
  schema: &EntityTypeSchema,
  report: &mut ValidationReport,
) {
  if entity.entity_type != schema.type_name {
    report.add_error(
      "type",
      &format!(
        "实体类型 '{entity_type}' 与 Schema 类型 '{schema_type_name}' 不匹配",
        entity_type = entity.entity_type,
        schema_type_name = schema.type_name
      ),
    );
    return;
  }

  let Some(props) = entity.properties.as_object() else {
    report.add_error("properties", "properties 必须是对象");
    return;
  };

  for field in &schema.fields {
    let path = format!("properties.{field_key}", field_key = field.key);
    validate_field(field, props, &path, report);
  }

  if let Some(ref custom_fields) = schema.custom_fields {
    for field in custom_fields {
      let path = format!("properties.{field_key}", field_key = field.key);
      validate_field(field, props, &path, report);
    }
  }
}

fn validate_field(
  field: &FieldSchema,
  props: &serde_json::Map<String, serde_json::Value>,
  path: &str,
  report: &mut ValidationReport,
) {
  let value = props.get(&field.key);
  let is_missing = value.is_none() || value == Some(&serde_json::Value::Null);

  if field.required.unwrap_or(false) && is_missing {
    report.add_error(path, &format!("必填字段 '{field_label}' 缺失", field_label = field.label));
    return;
  }

  if is_missing {
    return;
  }

  let Some(val) = value else {
    return;
  };
  if val.is_null() {
    return;
  }

  match field.field_type.as_str() {
    "number" if !val.is_number() => {
      report.add_error(path, &format!("字段 '{field_label}' 应为数字", field_label = field.label));
    }
    "boolean" if !val.is_boolean() => {
      report
        .add_error(path, &format!("字段 '{field_label}' 应为布尔值", field_label = field.label));
    }
    "text" | "textarea" | "date" | "image" | "color" | "url" | "email" if !val.is_string() => {
      report.add_error(path, &format!("字段 '{field_label}' 应为文本", field_label = field.label));
    }
    "select" => {
      if let Some(ref options) = field.options {
        if let Some(s) = val.as_str() {
          // 空字符串表示未选择，跳过选项验证
          if !s.is_empty() && !options.contains(&s.to_string()) {
            report.add_error(
              path,
              &format!(
                "字段 '{field_label}' 的值 '{val_s}' 不在选项列表中",
                field_label = field.label,
                val_s = s
              ),
            );
          }
        } else {
          report.add_error(
            path,
            &format!("字段 '{field_label}' 应为字符串选项", field_label = field.label),
          );
        }
      }
    }
    "multi-select" => {
      if let Some(arr) = val.as_array() {
        if let Some(ref options) = field.options {
          for item in arr {
            if let Some(s) = item.as_str() {
              if !options.contains(&s.to_string()) {
                report.add_warning(
                  path,
                  &format!(
                    "字段 '{field_label}' 的值 '{item_s}' 不在选项列表中",
                    field_label = field.label,
                    item_s = s
                  ),
                );
              }
            }
          }
        }
      } else {
        report
          .add_error(path, &format!("字段 '{field_label}' 应为数组", field_label = field.label));
      }
    }
    "entityRef" | "entity-ref" if !val.is_string() => {
      report.add_error(
        path,
        &format!("字段 '{field_label}' 应为实体引用 ID", field_label = field.label),
      );
    }
    _ => {}
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_entity() -> Entity {
    Entity {
      id: "e1".to_string(),
      entity_type: "character".to_string(),
      name: "测试角色".to_string(),
      description: "描述".to_string(),
      properties: serde_json::json!({"age": 25, "bio": "一段介绍"}),
      tags: vec!["tag1".to_string()],
      avatar: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_valid_entity() {
    let entity = make_entity();
    let report = validate_entity(&entity, None);
    assert!(report.valid);
    assert!(report.errors.is_empty());
  }

  #[test]
  fn test_empty_id() {
    let mut entity = make_entity();
    entity.id = "".to_string();
    let report = validate_entity(&entity, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "id"));
  }

  #[test]
  fn test_empty_name() {
    let mut entity = make_entity();
    entity.name = "   ".to_string();
    let report = validate_entity(&entity, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "name"));
  }

  #[test]
  fn test_schema_type_mismatch() {
    let entity = make_entity();
    let schema = EntityTypeSchema {
      type_name: "region".to_string(),
      label: "区域".to_string(),
      icon: None,
      fields: vec![],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "type"));
  }

  #[test]
  fn test_required_field_missing() {
    let entity = make_entity();
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "level".to_string(),
        label: "等级".to_string(),
        field_type: "number".to_string(),
        required: Some(true),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "properties.level"));
  }

  #[test]
  fn test_field_type_validation_number() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"age": "not a number"});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "age".to_string(),
        label: "年龄".to_string(),
        field_type: "number".to_string(),
        required: Some(true),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "properties.age"));
  }

  #[test]
  fn test_select_field_invalid_option() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"rank": "S"});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "rank".to_string(),
        label: "等级".to_string(),
        field_type: "select".to_string(),
        required: Some(true),
        default_value: None,
        options: Some(vec!["A".to_string(), "B".to_string(), "C".to_string()]),
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
  }

  #[test]
  fn test_empty_type() {
    let mut entity = make_entity();
    entity.entity_type = "".to_string();
    let report = validate_entity(&entity, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "type"));
  }

  #[test]
  fn test_entity_with_null_properties() {
    let mut entity = make_entity();
    entity.properties = serde_json::Value::Null;
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "age".to_string(),
        label: "年龄".to_string(),
        field_type: "number".to_string(),
        required: Some(true),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "properties"));
  }

  #[test]
  fn test_multi_select_valid() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"tags": ["A", "B"]});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "tags".to_string(),
        label: "标签".to_string(),
        field_type: "multi-select".to_string(),
        required: Some(false),
        default_value: None,
        options: Some(vec!["A".to_string(), "B".to_string(), "C".to_string()]),
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(report.valid);
  }

  #[test]
  fn test_multi_select_invalid_option() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"tags": ["A", "Z"]});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "tags".to_string(),
        label: "标签".to_string(),
        field_type: "multi-select".to_string(),
        required: Some(false),
        default_value: None,
        options: Some(vec!["A".to_string(), "B".to_string(), "C".to_string()]),
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(report.valid);
    assert!(report.errors.iter().any(|e| e.severity == "warning" && e.path == "properties.tags"));
  }

  #[test]
  fn test_entity_ref_field_valid() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"ref": "entity-42"});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "ref".to_string(),
        label: "引用".to_string(),
        field_type: "entityRef".to_string(),
        required: Some(false),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(report.valid);
  }

  #[test]
  fn test_entity_ref_field_invalid() {
    let mut entity = make_entity();
    entity.properties = serde_json::json!({"ref": 123});
    let schema = EntityTypeSchema {
      type_name: "character".to_string(),
      label: "人物".to_string(),
      icon: None,
      fields: vec![FieldSchema {
        key: "ref".to_string(),
        label: "引用".to_string(),
        field_type: "entityRef".to_string(),
        required: Some(false),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }],
      custom_fields: None,
      plugin_id: None,
    };
    let report = validate_entity(&entity, Some(&schema));
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "properties.ref"));
  }
}
