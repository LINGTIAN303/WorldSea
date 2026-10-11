use worldsea_core::doctor::diagnostics::run_diagnostics;
use worldsea_core::models::entity::{Entity, EntityTypeSchema, FieldSchema};
use worldsea_core::models::relation::Relation;

fn main() {
  let entity1 = Entity {
    id: "char-001".to_string(),
    entity_type: "character".to_string(),
    name: "艾莉亚".to_string(),
    description: "北方之剑".to_string(),
    properties: serde_json::json!({"age": 18, "class": "战士"}),
    tags: vec!["主角".to_string()],
    avatar: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  };

  let entity2 = Entity {
    id: "char-002".to_string(),
    entity_type: "character".to_string(),
    name: "琼恩".to_string(),
    description: "守夜人".to_string(),
    properties: serde_json::json!({"age": 19, "class": "战士"}),
    tags: vec![],
    avatar: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  };

  let entity3 = Entity {
    id: "region-001".to_string(),
    entity_type: "region".to_string(),
    name: "北境".to_string(),
    description: "冰雪覆盖的北方".to_string(),
    properties: serde_json::json!({}),
    tags: vec![],
    avatar: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  };

  let relation1 = Relation {
    id: "rel-001".to_string(),
    relation_type: "located_in".to_string(),
    source_id: "char-001".to_string(),
    target_id: "region-001".to_string(),
    label: Some("居住于".to_string()),
    properties: serde_json::json!({}),
    pair_id: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  };

  let relation2 = Relation {
    id: "rel-002".to_string(),
    relation_type: "knows".to_string(),
    source_id: "char-001".to_string(),
    target_id: "char-002".to_string(),
    label: Some("相识".to_string()),
    properties: serde_json::json!({}),
    pair_id: None,
    created_at: "2024-01-01".to_string(),
    updated_at: "2024-01-01".to_string(),
  };

  let schema = EntityTypeSchema {
    type_name: "character".to_string(),
    label: "人物".to_string(),
    icon: Some("👤".to_string()),
    fields: vec![
      FieldSchema {
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
      },
      FieldSchema {
        key: "class".to_string(),
        label: "职业".to_string(),
        field_type: "select".to_string(),
        required: Some(true),
        default_value: None,
        options: Some(vec!["战士".to_string(), "法师".to_string(), "盗贼".to_string()]),
        placeholder: None,
        ref_type: None,
        relation_type: None,
        auto_link: None,
      },
    ],
    custom_fields: None,
    plugin_id: None,
  };

  let entities = vec![entity1, entity2, entity3];
  let relations = vec![relation1, relation2];
  let schemas = vec![schema];

  let summary = run_diagnostics(&entities, &relations, Some(&schemas));

  println!("诊断摘要:");
  let total_entities = summary.total_entities;
  let total_relations = summary.total_relations;
  let validation_errors = summary.validation_errors;
  let validation_warnings = summary.validation_warnings;
  println!("  实体总数: {total_entities}");
  println!("  关系总数: {total_relations}");
  println!("  验证错误数: {validation_errors}");
  println!("  验证警告数: {validation_warnings}");
  println!("  实体类型分布:");
  for tc in &summary.entity_type_distribution {
    let type_name = &tc.type_name;
    let count = tc.count;
    println!("    - {type_name}: {count}");
  }
  println!("  关系类型分布:");
  for tc in &summary.relation_type_distribution {
    let type_name = &tc.type_name;
    let count = tc.count;
    println!("    - {type_name}: {count}");
  }
  let orphan_count = summary.reference_check.orphan_entities.len();
  let dangling_count = summary.reference_check.dangling_relations.len();
  println!("  孤立实体: {orphan_count}");
  println!("  悬空关系: {dangling_count}");
}
