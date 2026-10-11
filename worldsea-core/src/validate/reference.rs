use std::collections::{HashMap, HashSet};

use crate::models::entity::Entity;
use crate::models::relation::Relation;
use crate::validate::entity::ValidationReport;

/// 引用完整性检查结果，包含孤立实体、悬空关系、重复 ID 等信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckResult {
  /// 未被任何关系引用的孤立实体列表
  pub orphan_entities: Vec<String>,
  /// 源或目标实体不存在的悬空关系列表
  pub dangling_relations: Vec<DanglingRelation>,
  /// 两端实体均不存在的孤立关系 ID 列表
  pub orphan_relations: Vec<String>,
  /// 重复的实体 ID 列表
  pub duplicate_entity_ids: Vec<String>,
  /// 重复的关系 ID 列表
  pub duplicate_relation_ids: Vec<String>,
}

/// 悬空关系条目，记录关系 ID、类型及缺失的端点信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DanglingRelation {
  /// 关系 ID
  pub relation_id: String,
  /// 关系类型
  pub relation_type: String,
  /// 缺失端点的描述，如 "sourceId 'e1'"
  pub missing: String,
}

/// 检查实体和关系之间的引用完整性，检测孤立实体、悬空关系和重复 ID
///
/// 参数:
/// - `entities`: 实体列表
/// - `relations`: 关系列表
///
/// 返回: 包含所有引用完整性问题的 `ReferenceCheckResult`
#[must_use]
pub fn check_references(entities: &[Entity], relations: &[Relation]) -> ReferenceCheckResult {
  let entity_ids: HashSet<&str> = entities.iter().map(|e| e.id.as_str()).collect();

  let mut seen_entity_ids: HashMap<&str, Vec<&str>> = HashMap::new();
  for e in entities {
    seen_entity_ids.entry(e.id.as_str()).or_default().push(&e.name);
  }
  let duplicate_entity_ids: Vec<String> = seen_entity_ids
    .iter()
    .filter(|(_, names)| names.len() > 1)
    .map(|(id, _)| id.to_string())
    .collect();

  let mut seen_relation_ids: HashMap<&str, u32> = HashMap::new();
  for r in relations {
    *seen_relation_ids.entry(r.id.as_str()).or_default() += 1;
  }
  let duplicate_relation_ids: Vec<String> = seen_relation_ids
    .iter()
    .filter(|(_, count)| **count > 1)
    .map(|(id, _)| id.to_string())
    .collect();

  let mut dangling_relations: Vec<DanglingRelation> = Vec::new();
  for r in relations {
    if !entity_ids.contains(r.source_id.as_str()) {
      dangling_relations.push(DanglingRelation {
        relation_id: r.id.clone(),
        relation_type: r.relation_type.clone(),
        missing: format!("sourceId '{source_id}'", source_id = r.source_id),
      });
    }
    if !entity_ids.contains(r.target_id.as_str()) {
      dangling_relations.push(DanglingRelation {
        relation_id: r.id.clone(),
        relation_type: r.relation_type.clone(),
        missing: format!("targetId '{target_id}'", target_id = r.target_id),
      });
    }
  }

  let referenced_entity_ids: HashSet<&str> =
    relations.iter().flat_map(|r| [r.source_id.as_str(), r.target_id.as_str()]).collect();
  let orphan_entities: Vec<String> = entities
    .iter()
    .filter(|e| !referenced_entity_ids.contains(e.id.as_str()))
    .map(|e| format!("{e_id} ({e_name})", e_id = e.id, e_name = e.name))
    .collect();

  let orphan_relations: Vec<String> = relations
    .iter()
    .filter(|r| {
      !entity_ids.contains(r.source_id.as_str()) && !entity_ids.contains(r.target_id.as_str())
    })
    .map(|r| r.id.clone())
    .collect();

  ReferenceCheckResult {
    orphan_entities,
    dangling_relations,
    orphan_relations,
    duplicate_entity_ids,
    duplicate_relation_ids,
  }
}

/// 检查实体和关系之间的引用完整性，并生成标准化的验证报告
///
/// 参数:
/// - `entities`: 实体列表
/// - `relations`: 关系列表
///
/// 返回: 包含所有引用完整性问题的 `ValidationReport`
#[must_use]
pub fn check_references_report(entities: &[Entity], relations: &[Relation]) -> ValidationReport {
  let mut report = ValidationReport::new();
  let result = check_references(entities, relations);

  for id in &result.duplicate_entity_ids {
    report.add_error("id", &format!("重复的实体 ID: {id}"));
  }

  for id in &result.duplicate_relation_ids {
    report.add_error("id", &format!("重复的关系 ID: {id}"));
  }

  for d in &result.dangling_relations {
    report.add_error(
      &format!("relations.{relation_id}", relation_id = d.relation_id),
      &format!(
        "悬空关系: {relation_type} 缺少 {missing}",
        relation_type = d.relation_type,
        missing = d.missing
      ),
    );
  }

  for id in &result.orphan_relations {
    report.add_warning(&format!("relations.{id}"), &format!("孤立关系: {id} 的两端实体均不存在"));
  }

  if !result.orphan_entities.is_empty() {
    report.add_warning(
      "entities",
      &format!("存在 {count} 个未被任何关系引用的孤立实体", count = result.orphan_entities.len()),
    );
  }

  report
}

#[cfg(test)]
mod tests {
  use super::*;

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
  fn test_clean_references() {
    let entities = vec![make_entity("e1", "character"), make_entity("e2", "character")];
    let relations = vec![make_relation("r1", "knows", "e1", "e2")];
    let result = check_references(&entities, &relations);
    assert!(result.dangling_relations.is_empty());
    assert!(result.duplicate_entity_ids.is_empty());
  }

  #[test]
  fn test_dangling_relation() {
    let entities = vec![make_entity("e1", "character")];
    let relations = vec![make_relation("r1", "knows", "e1", "e_missing")];
    let result = check_references(&entities, &relations);
    assert_eq!(result.dangling_relations.len(), 1);
    assert_eq!(result.dangling_relations[0].missing, "targetId 'e_missing'");
  }

  #[test]
  fn test_orphan_entity() {
    let entities = vec![make_entity("e1", "character"), make_entity("e2", "character")];
    let relations = vec![make_relation("r1", "knows", "e1", "e2")];
    let result = check_references(&entities, &relations);
    assert!(result.orphan_entities.is_empty());

    let entities2 = vec![
      make_entity("e1", "character"),
      make_entity("e2", "character"),
      make_entity("e3", "character"),
    ];
    let result2 = check_references(&entities2, &relations);
    assert_eq!(result2.orphan_entities.len(), 1);
  }

  #[test]
  fn test_duplicate_entity_ids() {
    let entities = vec![make_entity("e1", "character"), make_entity("e1", "region")];
    let relations = vec![];
    let result = check_references(&entities, &relations);
    assert_eq!(result.duplicate_entity_ids.len(), 1);
  }
}
