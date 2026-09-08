use crate::models::relation::{Relation, RelationTypeSchema};
use crate::validate::entity::ValidationReport;

/// 验证关系数据的合法性，包括 ID、类型、源/目标实体等基本字段，以及可选的 Schema 约束检查
///
/// 参数:
/// - `relation`: 待验证的关系引用
/// - `schema`: 可选的关系类型 Schema，提供类型匹配和属性约束校验
///
/// 返回: 包含所有验证结果的 `ValidationReport`
#[must_use]
pub fn validate_relation(
  relation: &Relation,
  schema: Option<&RelationTypeSchema>,
) -> ValidationReport {
  let mut report = ValidationReport::new();

  if relation.id.is_empty() {
    report.add_error("id", "关系 ID 不能为空");
  }

  if relation.relation_type.is_empty() {
    report.add_error("type", "关系类型不能为空");
  }

  if relation.source_id.is_empty() {
    report.add_error("sourceId", "源实体 ID 不能为空");
  }

  if relation.target_id.is_empty() {
    report.add_error("targetId", "目标实体 ID 不能为空");
  }

  if relation.source_id == relation.target_id {
    report.add_warning("sourceId/targetId", "关系指向自身（自引用关系）");
  }

  if let Some(s) = schema {
    if relation.relation_type != s.type_name {
      report.add_error(
        "type",
        &format!(
          "关系类型 '{relation_type}' 与 Schema 类型 '{schema_type_name}' 不匹配",
          relation_type = relation.relation_type,
          schema_type_name = s.type_name
        ),
      );
    }

    if !s.source_types.is_empty() && !s.source_types.contains(&"any".to_string()) {
      report.add_warning(
        "sourceId",
        &format!(
          "源实体类型未校验（Schema 要求: {source_types}）",
          source_types = s.source_types.join(", ")
        ),
      );
    }

    if !s.target_types.is_empty() && !s.target_types.contains(&"any".to_string()) {
      report.add_warning(
        "targetId",
        &format!(
          "目标实体类型未校验（Schema 要求: {target_types}）",
          target_types = s.target_types.join(", ")
        ),
      );
    }

    if let Some(ref props_schema) = s.properties {
      if !props_schema.is_empty() {
        if let Some(props) = relation.properties.as_object() {
          for field in props_schema {
            if field.required.unwrap_or(false) && !props.contains_key(&field.key) {
              report.add_error(
                &format!("properties.{field_key}", field_key = field.key),
                &format!("必填属性 '{field_label}' 缺失", field_label = field.label),
              );
            }
          }
        } else if !props_schema.is_empty() {
          report.add_warning("properties", "关系属性不是对象，无法校验 Schema");
        }
      }
    }
  }

  report
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::models::entity::FieldSchema;

  fn make_relation() -> Relation {
    Relation {
      id: "r1".to_string(),
      relation_type: "knows".to_string(),
      source_id: "e1".to_string(),
      target_id: "e2".to_string(),
      label: None,
      properties: serde_json::json!({}),
      pair_id: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_valid_relation() {
    let relation = make_relation();
    let report = validate_relation(&relation, None);
    assert!(report.valid);
  }

  #[test]
  fn test_empty_id() {
    let mut relation = make_relation();
    relation.id = "".to_string();
    let report = validate_relation(&relation, None);
    assert!(!report.valid);
  }

  #[test]
  fn test_self_reference_warning() {
    let mut relation = make_relation();
    relation.target_id = "e1".to_string();
    let report = validate_relation(&relation, None);
    assert!(report.valid);
    assert!(report.errors.iter().any(|e| e.severity == "warning"));
  }

  #[test]
  fn test_schema_type_mismatch() {
    let relation = make_relation();
    let schema = RelationTypeSchema {
      type_name: "located_in".to_string(),
      label: "位于".to_string(),
      source_types: vec!["character".to_string()],
      target_types: vec!["region".to_string()],
      directed: true,
      inverse_type: None,
      auto_create_inverse: None,
      properties: None,
      plugin_id: None,
    };
    let report = validate_relation(&relation, Some(&schema));
    assert!(!report.valid);
  }

  #[test]
  fn test_required_property_missing() {
    let relation = make_relation();
    let schema = RelationTypeSchema {
      type_name: "knows".to_string(),
      label: "认识".to_string(),
      source_types: vec![],
      target_types: vec![],
      directed: true,
      inverse_type: None,
      auto_create_inverse: None,
      properties: Some(vec![FieldSchema {
        key: "since".to_string(),
        label: "起始时间".to_string(),
        field_type: "text".to_string(),
        required: Some(true),
        default_value: None,
        options: None,
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      }]),
      plugin_id: None,
    };
    let report = validate_relation(&relation, Some(&schema));
    assert!(!report.valid);
  }

  #[test]
  fn test_empty_source_id() {
    let mut relation = make_relation();
    relation.source_id = "".to_string();
    let report = validate_relation(&relation, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "sourceId"));
  }

  #[test]
  fn test_empty_target_id() {
    let mut relation = make_relation();
    relation.target_id = "".to_string();
    let report = validate_relation(&relation, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "targetId"));
  }

  #[test]
  fn test_empty_relation_type() {
    let mut relation = make_relation();
    relation.relation_type = "".to_string();
    let report = validate_relation(&relation, None);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "type"));
  }
}
