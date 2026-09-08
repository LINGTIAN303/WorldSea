use serde::{Deserialize, Serialize};

use crate::models::plugin::{validate_manifest, validate_permissions, PluginManifest};

/// 插件健康报告，汇总插件的清单问题、权限警告和依赖冲突
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginHealthReport {
  /// 插件总数
  pub total_plugins: usize,
  /// 活跃插件数
  pub active_plugins: usize,
  /// 清单校验发现的问题列表
  pub manifest_issues: Vec<PluginManifestIssue>,
  /// 权限相关的警告列表
  pub permission_warnings: Vec<String>,
  /// 依赖冲突列表
  pub dependency_conflicts: Vec<String>,
}

/// 插件清单问题条目，记录单个插件的错误和警告
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifestIssue {
  /// 插件 ID
  pub plugin_id: String,
  /// 清单校验错误列表
  pub errors: Vec<String>,
  /// 清单校验警告列表
  pub warnings: Vec<String>,
}

/// 检查插件系统的健康状态，包括清单校验、权限检查和依赖冲突检测
///
/// 参数:
/// - `manifests`: 插件清单列表
/// - `active_ids`: 当前活跃的插件 ID 列表
///
/// 返回: 包含插件健康状态的 `PluginHealthReport`
#[must_use]
pub fn check_plugin_health(
  manifests: &[PluginManifest],
  active_ids: &[String],
) -> PluginHealthReport {
  let mut manifest_issues: Vec<PluginManifestIssue> = Vec::new();
  let mut permission_warnings: Vec<String> = Vec::new();
  let mut dependency_conflicts: Vec<String> = Vec::new();

  let active_set: std::collections::HashSet<&str> = active_ids.iter().map(String::as_str).collect();

  let all_ids: std::collections::HashSet<&str> = manifests.iter().map(|m| m.id.as_str()).collect();

  let mut seen_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();

  for manifest in manifests {
    if seen_ids.contains(manifest.id.as_str()) {
      dependency_conflicts.push(format!("重复插件 ID: '{id}'", id = manifest.id));
    }
    seen_ids.insert(manifest.id.as_str());

    let result = validate_manifest(manifest);
    if !result.errors.is_empty() || !result.warnings.is_empty() {
      manifest_issues.push(PluginManifestIssue {
        plugin_id: manifest.id.clone(),
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    let unknown = validate_permissions(&manifest.permissions);
    for p in &unknown {
      permission_warnings.push(format!("插件 '{id}' 声明未知权限: '{p}'", id = manifest.id));
    }

    for dep in &manifest.dependencies {
      if !all_ids.contains(dep.plugin_id.as_str()) && active_set.contains(manifest.id.as_str()) {
        dependency_conflicts.push(format!(
          "插件 '{id}' 依赖 '{dep_id}' 但未安装",
          id = manifest.id,
          dep_id = dep.plugin_id
        ));
      }
    }
  }

  let active_count = manifests.iter().filter(|m| active_set.contains(m.id.as_str())).count();

  PluginHealthReport {
    total_plugins: manifests.len(),
    active_plugins: active_count,
    manifest_issues,
    permission_warnings,
    dependency_conflicts,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::models::plugin::PluginDependency;

  #[test]
  fn test_dependency_after_current() {
    let manifests = vec![
      PluginManifest {
        id: "plugin.a".to_string(),
        name: "A".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        author: None,
        permissions: vec![],
        dependencies: vec![PluginDependency {
          plugin_id: "plugin.b".to_string(),
          min_version: None,
        }],
        entity_types: vec![],
        relation_types: vec![],
        views: vec![],
      },
      PluginManifest {
        id: "plugin.b".to_string(),
        name: "B".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        author: None,
        permissions: vec![],
        dependencies: vec![],
        entity_types: vec![],
        relation_types: vec![],
        views: vec![],
      },
    ];
    let active_ids = vec!["plugin.a".to_string(), "plugin.b".to_string()];
    let report = check_plugin_health(&manifests, &active_ids);
    assert!(report.dependency_conflicts.is_empty());
  }

  #[test]
  fn test_missing_dependency() {
    let manifests = vec![PluginManifest {
      id: "plugin.a".to_string(),
      name: "A".to_string(),
      version: "1.0.0".to_string(),
      description: "".to_string(),
      author: None,
      permissions: vec![],
      dependencies: vec![PluginDependency {
        plugin_id: "plugin.missing".to_string(),
        min_version: None,
      }],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    }];
    let active_ids = vec!["plugin.a".to_string()];
    let report = check_plugin_health(&manifests, &active_ids);
    assert_eq!(report.dependency_conflicts.len(), 1);
  }

  #[test]
  fn test_duplicate_plugin_id() {
    let manifests = vec![
      PluginManifest {
        id: "plugin.x".to_string(),
        name: "X1".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        author: None,
        permissions: vec![],
        dependencies: vec![],
        entity_types: vec![],
        relation_types: vec![],
        views: vec![],
      },
      PluginManifest {
        id: "plugin.x".to_string(),
        name: "X2".to_string(),
        version: "1.0.0".to_string(),
        description: "".to_string(),
        author: None,
        permissions: vec![],
        dependencies: vec![],
        entity_types: vec![],
        relation_types: vec![],
        views: vec![],
      },
    ];
    let active_ids: Vec<String> = vec![];
    let report = check_plugin_health(&manifests, &active_ids);
    assert_eq!(report.dependency_conflicts.len(), 1);
  }

  #[test]
  fn test_inactive_plugin_missing_dep() {
    let manifests = vec![PluginManifest {
      id: "plugin.a".to_string(),
      name: "A".to_string(),
      version: "1.0.0".to_string(),
      description: "".to_string(),
      author: None,
      permissions: vec![],
      dependencies: vec![PluginDependency {
        plugin_id: "plugin.missing".to_string(),
        min_version: None,
      }],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    }];
    let active_ids: Vec<String> = vec![];
    let report = check_plugin_health(&manifests, &active_ids);
    assert!(report.dependency_conflicts.is_empty());
  }

  #[test]
  fn test_empty_manifests() {
    let manifests: Vec<PluginManifest> = vec![];
    let active_ids: Vec<String> = vec![];
    let report = check_plugin_health(&manifests, &active_ids);
    assert_eq!(report.total_plugins, 0);
    assert_eq!(report.active_plugins, 0);
    assert!(report.manifest_issues.is_empty());
    assert!(report.permission_warnings.is_empty());
    assert!(report.dependency_conflicts.is_empty());
  }
}
