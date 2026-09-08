#[cfg(feature = "sqlite")]
use worldsea_core::doctor::storage::check_storage_health;
#[cfg(feature = "sqlite")]
use worldsea_core::models::entity::Entity;
#[cfg(feature = "sqlite")]
use worldsea_core::models::relation::Relation;
#[cfg(feature = "sqlite")]
use worldsea_core::storage::sqlite::SqliteStore;
#[cfg(feature = "sqlite")]
use worldsea_core::storage::StorageBackend;

#[cfg(feature = "sqlite")]
fn main() {
  let store = SqliteStore::open_in_memory().expect("打开内存数据库失败");

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

  store.put_entity(&entity1).expect("写入实体1失败");
  store.put_entity(&entity2).expect("写入实体2失败");

  let relation = Relation {
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

  store.put_relation(&relation).expect("写入关系失败");

  let characters = store.get_entities_by_type("character").expect("查询失败");
  let char_count = characters.len();
  println!("类型为 'character' 的实体数量: {char_count}");
  for e in &characters {
    let e_name = &e.name;
    let e_id = &e.id;
    println!("  - {e_name} ({e_id})");
  }

  let updated = store
    .update_entity("char-001", &serde_json::json!({"name": "艾莉亚·史塔克"}))
    .expect("更新实体失败");
  println!("\n更新实体结果: {updated}");

  let fetched = store.get_entity("char-001").expect("查询实体失败").unwrap();
  let fetched_name = &fetched.name;
  println!("更新后实体名称: {fetched_name}");

  store.kv_set("world_name", "维斯特洛").expect("KV写入失败");
  store.kv_set("world_version", "1").expect("KV写入失败");

  let val = store.kv_get("world_name").expect("KV读取失败").unwrap();
  println!("\nKV 读取 world_name: {val}");

  let all_kv = store.kv_get_all().expect("KV读取全部失败");
  let kv_count = all_kv.len();
  println!("KV 总条目数: {kv_count}");
  for (k, v) in &all_kv {
    println!("  {k} = {v}");
  }

  let report = check_storage_health(&store as &dyn StorageBackend);
  println!("\n存储健康检查:");
  let status = &report.status;
  let entity_count = report.entity_count;
  let relation_count = report.relation_count;
  let kv_count_report = report.kv_count;
  let module_count = report.module_count;
  let integrity_ok = report.integrity_ok;
  println!("  状态: {status}");
  println!("  实体数: {entity_count}");
  println!("  关系数: {relation_count}");
  println!("  KV条目数: {kv_count_report}");
  println!("  模块数: {module_count}");
  println!("  完整性: {integrity_ok}");
  if !report.issues.is_empty() {
    println!("  问题:");
    for issue in &report.issues {
      println!("    - {issue}");
    }
  }
}

#[cfg(not(feature = "sqlite"))]
fn main() {
  println!("This example requires the 'sqlite' feature. Run with: cargo run --example storage_demo --features sqlite");
}
