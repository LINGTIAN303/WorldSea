use worldsea_core::migrate::engine::migrate_pack;

fn main() {
  let mut pack_data = serde_json::json!({
    "manifest": {
      "version": 1,
      "exportedAt": "2024-01-01T00:00:00Z",
      "appVersion": "0.1.0"
    },
    "serializers": {
      "entities": [],
      "relations": []
    }
  });

  let before_version = &pack_data["manifest"]["version"];
  println!("迁移前版本: {before_version}");

  let result = migrate_pack(&mut pack_data, 1);

  let after_version = &pack_data["manifest"]["version"];
  println!("迁移后版本: {after_version}");
  println!("迁移结果:");
  let from_version = result.from_version;
  let to_version = result.to_version;
  let success = result.success;
  println!("  起始版本: {from_version}");
  println!("  目标版本: {to_version}");
  println!("  是否成功: {success}");
  println!("  迁移步骤:");
  for step in &result.steps {
    println!("    - {step}");
  }
  if let Some(err) = &result.error {
    println!("  错误: {err}");
  }
}
