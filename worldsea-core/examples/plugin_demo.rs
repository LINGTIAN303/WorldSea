use worldsea_core::doctor::plugin::check_plugin_health;
use worldsea_core::models::plugin::{validate_manifest, PluginManifest, PluginPermission};

fn main() {
  let valid_manifest = PluginManifest {
    id: "official.characters".to_string(),
    name: "人物志".to_string(),
    version: "1.0.0".to_string(),
    description: "管理世界中的角色实体".to_string(),
    author: Some("WorldSea Team".to_string()),
    permissions: vec![
      PluginPermission {
        name: "entities:read".to_string(),
        description: Some("读取实体数据".to_string()),
      },
      PluginPermission {
        name: "entities:write".to_string(),
        description: Some("写入实体数据".to_string()),
      },
    ],
    dependencies: vec![],
    entity_types: vec!["character".to_string()],
    relation_types: vec![],
    views: vec![],
  };

  let result = validate_manifest(&valid_manifest);
  println!("有效清单校验结果:");
  let valid = result.valid;
  let error_count = result.errors.len();
  let warning_count = result.warnings.len();
  println!("  通过: {valid}");
  println!("  错误数: {error_count}");
  println!("  警告数: {warning_count}");

  let unknown_manifest = PluginManifest {
    id: "test.sketchy".to_string(),
    name: "可疑插件".to_string(),
    version: "0.1.0".to_string(),
    description: "声明了未知权限的插件".to_string(),
    author: None,
    permissions: vec![
      PluginPermission { name: "storage:read".to_string(), description: None },
      PluginPermission { name: "super:dangerous".to_string(), description: None },
      PluginPermission { name: "system:root".to_string(), description: None },
    ],
    dependencies: vec![],
    entity_types: vec![],
    relation_types: vec![],
    views: vec![],
  };

  let result2 = validate_manifest(&unknown_manifest);
  println!("\n含未知权限清单校验结果:");
  let valid2 = result2.valid;
  let error_count2 = result2.errors.len();
  let warning_count2 = result2.warnings.len();
  println!("  通过: {valid2}");
  println!("  错误数: {error_count2}");
  println!("  警告数: {warning_count2}");
  for w in &result2.warnings {
    println!("    警告: {w}");
  }

  let manifests = vec![valid_manifest, unknown_manifest];
  let active_ids = vec!["official.characters".to_string(), "test.sketchy".to_string()];

  let report = check_plugin_health(&manifests, &active_ids);
  println!("\n插件健康检查:");
  let total_plugins = report.total_plugins;
  let active_plugins = report.active_plugins;
  let manifest_issues_count = report.manifest_issues.len();
  println!("  插件总数: {total_plugins}");
  println!("  活跃插件数: {active_plugins}");
  println!("  清单问题数: {manifest_issues_count}");
  for issue in &report.manifest_issues {
    let plugin_id = &issue.plugin_id;
    println!("    插件 '{plugin_id}':");
    for err in &issue.errors {
      println!("      错误: {err}");
    }
    for warn in &issue.warnings {
      println!("      警告: {warn}");
    }
  }
  let perm_warnings = report.permission_warnings.len();
  println!("  权限警告数: {perm_warnings}");
  for pw in &report.permission_warnings {
    println!("    - {pw}");
  }
  let dep_conflicts = report.dependency_conflicts.len();
  println!("  依赖冲突数: {dep_conflicts}");
  for dc in &report.dependency_conflicts {
    println!("    - {dc}");
  }
}
