use worldsea_core::models::entity::{Entity, EntityTypeSchema, FieldSchema};
use worldsea_core::validate::entity::validate_entity;
use worldsea_core::validate::reference::check_references;

fn main() {
  let entity = Entity {
    id: "char-001".to_string(),
    entity_type: "character".to_string(),
    name: "艾莉亚".to_string(),
    description: "北方之剑".to_string(),
    properties: serde_json::json!({
        "age": 18,
        "class": "战士",
        "level": 5
    }),
    tags: vec!["主角".to_string(), "战士".to_string()],
    avatar: None,
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

  let report = validate_entity(&entity, Some(&schema));
  if report.valid {
    println!("✅ 实体 '{name}' 验证通过", name = entity.name);
  } else {
    println!("❌ 验证失败:");
    for err in &report.errors {
      println!("  错误 [{path}]: {message}", path = err.path, message = err.message);
    }
  }

  let entity2 = Entity {
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

  let ref_result = check_references(&[entity.clone(), entity2], &[]);
  println!("\n📊 引用检查结果:");
  let orphan_count = ref_result.orphan_entities.len();
  let dangling_count = ref_result.dangling_relations.len();
  println!("  孤立实体: {orphan_count}");
  println!("  悬空关系: {dangling_count}");
}
