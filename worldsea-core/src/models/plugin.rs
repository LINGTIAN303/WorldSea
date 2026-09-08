use serde::{Deserialize, Serialize};

/// 插件权限声明，描述插件请求的一项权限
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPermission {
  /// 权限名称
  pub name: String,
  /// 权限的描述说明
  #[serde(default)]
  pub description: Option<String>,
}

/// 插件清单，描述插件的基本信息、权限和依赖
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
  /// 插件的唯一标识符
  pub id: String,
  /// 插件名称
  pub name: String,
  /// 插件版本号
  pub version: String,
  /// 插件描述
  #[serde(default)]
  pub description: String,
  /// 插件作者
  #[serde(default)]
  pub author: Option<String>,
  /// 插件请求的权限列表
  #[serde(default)]
  pub permissions: Vec<PluginPermission>,
  /// 插件依赖的其他插件列表
  #[serde(default)]
  pub dependencies: Vec<PluginDependency>,
  /// 插件注册的实体类型名称列表
  #[serde(default)]
  pub entity_types: Vec<String>,
  /// 插件注册的关系类型名称列表
  #[serde(default)]
  pub relation_types: Vec<String>,
  /// 插件注册的视图标识列表
  #[serde(default)]
  pub views: Vec<String>,
}

/// 插件依赖声明，描述对另一个插件的版本要求
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDependency {
  /// 依赖的插件 ID
  pub plugin_id: String,
  /// 依赖插件的最低版本要求
  #[serde(default)]
  pub min_version: Option<String>,
}

/// 已知的插件权限名称列表
pub const KNOWN_PERMISSIONS: &[&str] = &[
  "storage:read",
  "storage:write",
  "entities:read",
  "entities:write",
  "relations:read",
  "relations:write",
  "schema:register",
  "hooks:register",
  "views:register",
  "network:fetch",
  "clipboard:access",
  "notifications:send",
];

/// 校验权限列表中是否包含未知权限，返回未知权限名称列表
///
/// `permissions` - 待校验的权限列表
#[must_use]
pub fn validate_permissions(permissions: &[PluginPermission]) -> Vec<String> {
  let known: std::collections::HashSet<&str> = KNOWN_PERMISSIONS.iter().copied().collect();
  let mut unknown: Vec<String> = Vec::new();
  for p in permissions {
    if !known.contains(p.name.as_str()) {
      unknown.push(p.name.clone());
    }
  }
  unknown
}

/// 校验插件清单的合法性，检查必填字段和依赖完整性，返回校验结果
///
/// `manifest` - 待校验的插件清单引用
#[must_use]
pub fn validate_manifest(manifest: &PluginManifest) -> ManifestValidationResult {
  let mut errors: Vec<String> = Vec::new();
  let mut warnings: Vec<String> = Vec::new();

  if manifest.id.is_empty() {
    errors.push("插件 ID 不能为空".to_string());
  }

  if manifest.id.contains(' ') {
    errors.push(format!("插件 ID '{}' 不能包含空格", manifest.id));
  }

  if manifest.name.is_empty() {
    errors.push("插件名称不能为空".to_string());
  }

  if manifest.version.is_empty() {
    errors.push("插件版本不能为空".to_string());
  }

  let unknown = validate_permissions(&manifest.permissions);
  for p in &unknown {
    warnings.push(format!("未知权限: '{p}'"));
  }

  let mut dep_ids: std::collections::HashSet<&str> = std::collections::HashSet::new();
  for dep in &manifest.dependencies {
    if dep.plugin_id.is_empty() {
      errors.push("依赖插件 ID 不能为空".to_string());
    }
    if dep_ids.contains(dep.plugin_id.as_str()) {
      warnings.push(format!("重复依赖: '{}'", dep.plugin_id));
    }
    dep_ids.insert(dep.plugin_id.as_str());
  }

  ManifestValidationResult { valid: errors.is_empty(), errors, warnings }
}

/// 插件清单校验结果，包含校验状态和错误警告信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestValidationResult {
  /// 清单是否通过校验
  pub valid: bool,
  /// 校验发现的错误列表
  pub errors: Vec<String>,
  /// 校验发现的警告列表
  pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_valid_manifest() {
    let manifest = PluginManifest {
      id: "official.characters".to_string(),
      name: "人物志".to_string(),
      version: "1.0.0".to_string(),
      description: "测试".to_string(),
      author: None,
      permissions: vec![],
      dependencies: vec![],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    };
    let result = validate_manifest(&manifest);
    assert!(result.valid);
    assert!(result.errors.is_empty());
  }

  #[test]
  fn test_empty_id() {
    let manifest = PluginManifest {
      id: "".to_string(),
      name: "测试".to_string(),
      version: "1.0.0".to_string(),
      description: "".to_string(),
      author: None,
      permissions: vec![],
      dependencies: vec![],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    };
    let result = validate_manifest(&manifest);
    assert!(!result.valid);
  }

  #[test]
  fn test_id_with_spaces() {
    let manifest = PluginManifest {
      id: "has space".to_string(),
      name: "测试".to_string(),
      version: "1.0.0".to_string(),
      description: "".to_string(),
      author: None,
      permissions: vec![],
      dependencies: vec![],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    };
    let result = validate_manifest(&manifest);
    assert!(!result.valid);
  }

  #[test]
  fn test_unknown_permission_warning() {
    let manifest = PluginManifest {
      id: "test.plugin".to_string(),
      name: "测试".to_string(),
      version: "1.0.0".to_string(),
      description: "".to_string(),
      author: None,
      permissions: vec![PluginPermission {
        name: "super:dangerous".to_string(),
        description: None,
      }],
      dependencies: vec![],
      entity_types: vec![],
      relation_types: vec![],
      views: vec![],
    };
    let result = validate_manifest(&manifest);
    assert!(result.valid);
    assert!(!result.warnings.is_empty());
  }

  #[test]
  fn test_validate_permissions() {
    let perms = vec![
      PluginPermission { name: "storage:read".to_string(), description: None },
      PluginPermission { name: "unknown:perm".to_string(), description: None },
    ];
    let unknown = validate_permissions(&perms);
    assert_eq!(unknown.len(), 1);
    assert_eq!(unknown[0], "unknown:perm");
  }
}
