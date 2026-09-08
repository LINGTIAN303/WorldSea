use serde::{Deserialize, Serialize};

use crate::models::entity::Entity;
use crate::models::relation::Relation;
use crate::validate::entity::validate_entity;
use crate::validate::reference::{check_references, ReferenceCheckResult};

/// 诊断摘要，汇总世界数据的统计信息和健康状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
  /// 实体总数
  pub total_entities: usize,
  /// 关系总数
  pub total_relations: usize,
  /// 按实体类型统计的分布列表
  pub entity_type_distribution: Vec<TypeCount>,
  /// 按关系类型统计的分布列表
  pub relation_type_distribution: Vec<TypeCount>,
  /// 引用完整性检查结果
  pub reference_check: ReferenceCheckResult,
  /// 验证错误数量
  pub validation_errors: u32,
  /// 验证警告数量
  pub validation_warnings: u32,
}

/// 类型计数条目，记录某种类型的名称和出现次数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeCount {
  /// 类型名称
  #[serde(rename = "type")]
  pub type_name: String,
  /// 该类型的出现次数
  pub count: usize,
}

/// 对世界数据执行全面诊断，包括类型分布统计、引用完整性检查和实体验证
///
/// 参数:
/// - `entities`: 实体列表
/// - `relations`: 关系列表
/// - `entity_schemas`: 可选的实体类型 Schema 列表，用于字段级验证
///
/// 返回: 包含统计信息和健康状态的 `DiagnosticSummary`
#[must_use]
pub fn run_diagnostics(
  entities: &[Entity],
  relations: &[Relation],
  entity_schemas: Option<&Vec<crate::models::entity::EntityTypeSchema>>,
) -> DiagnosticSummary {
  let mut type_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
  for e in entities {
    *type_counts.entry(e.entity_type.clone()).or_default() += 1;
  }
  let mut entity_type_distribution: Vec<TypeCount> =
    type_counts.into_iter().map(|(type_name, count)| TypeCount { type_name, count }).collect();
  entity_type_distribution.sort_by_key(|b| std::cmp::Reverse(b.count));

  let mut rel_type_counts: std::collections::HashMap<String, usize> =
    std::collections::HashMap::new();
  for r in relations {
    *rel_type_counts.entry(r.relation_type.clone()).or_default() += 1;
  }
  let mut relation_type_distribution: Vec<TypeCount> =
    rel_type_counts.into_iter().map(|(type_name, count)| TypeCount { type_name, count }).collect();
  relation_type_distribution.sort_by_key(|b| std::cmp::Reverse(b.count));

  let reference_check = check_references(entities, relations);

  let mut validation_errors: u32 = 0;
  let mut validation_warnings: u32 = 0;

  let schema_map: std::collections::HashMap<String, crate::models::entity::EntityTypeSchema> =
    entity_schemas
      .map(|schemas| schemas.iter().map(|s| (s.type_name.clone(), s.clone())).collect())
      .unwrap_or_default();

  for entity in entities {
    let schema = schema_map.get(&entity.entity_type);
    let report = validate_entity(entity, schema);
    for err in &report.errors {
      if err.severity == "error" {
        validation_errors += 1;
      } else {
        validation_warnings += 1;
      }
    }
  }

  DiagnosticSummary {
    total_entities: entities.len(),
    total_relations: relations.len(),
    entity_type_distribution,
    relation_type_distribution,
    reference_check,
    validation_errors,
    validation_warnings,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::models::entity::EntityTypeSchema;
  use crate::models::entity::FieldSchema;

  fn make_entity(id: &str, etype: &str) -> Entity {
    Entity {
      id: id.to_string(),
      entity_type: etype.to_string(),
      name: format!("实体{id}"),
      description: "".to_string(),
      properties: serde_json::json!({}),
      tags: vec![],
      avatar: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  fn make_relation(id: &str, rtype: &str, source: &str, target: &str) -> Relation {
    Relation {
      id: id.to_string(),
      relation_type: rtype.to_string(),
      source_id: source.to_string(),
      target_id: target.to_string(),
      label: None,
      properties: serde_json::json!({}),
      pair_id: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_empty_data() {
    let diag = run_diagnostics(&[], &[], None);
    assert_eq!(diag.total_entities, 0);
    assert_eq!(diag.total_relations, 0);
    assert_eq!(diag.validation_errors, 0);
    assert_eq!(diag.validation_warnings, 0);
  }

  #[test]
  fn test_type_distribution() {
    let entities = vec![
      make_entity("e1", "character"),
      make_entity("e2", "character"),
      make_entity("e3", "region"),
    ];
    let relations = vec![make_relation("r1", "knows", "e1", "e2")];
    let diag = run_diagnostics(&entities, &relations, None);
    assert_eq!(diag.total_entities, 3);
    assert_eq!(diag.total_relations, 1);
    let char_entry = diag.entity_type_distribution.iter().find(|t| t.type_name == "character");
    assert!(char_entry.is_some());
    assert_eq!(char_entry.unwrap().count, 2);
    let region_entry = diag.entity_type_distribution.iter().find(|t| t.type_name == "region");
    assert!(region_entry.is_some());
    assert_eq!(region_entry.unwrap().count, 1);
  }

  #[test]
  fn test_validation_with_schema() {
    let mut entity = make_entity("e1", "character");
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
    let diag = run_diagnostics(&[entity], &[], Some(&vec![schema]));
    assert!(diag.validation_errors > 0);
  }
}
