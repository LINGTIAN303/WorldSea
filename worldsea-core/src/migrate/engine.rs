use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::models::pack::PACK_VERSION;

/// 迁移结果，记录版本迁移的执行过程和最终状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
  /// 迁移前的版本号
  pub from_version: u32,
  /// 迁移后的版本号
  pub to_version: u32,
  /// 执行的迁移步骤描述列表
  pub steps: Vec<String>,
  /// 迁移是否成功
  pub success: bool,
  /// 失败时的错误信息
  pub error: Option<String>,
}

/// 迁移快照，保存迁移前的数据状态用于回滚
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSnapshot {
  /// 快照对应的原始版本
  pub version: u32,
  /// 迁移前的数据快照
  pub data: serde_json::Value,
}

/// 检查指定版本是否可以被迁移到当前版本
///
/// 参数:
/// - `from_version`: 当前包的版本号
///
/// 返回: 如果可以迁移返回 `true`，否则返回 `false`
#[must_use]
pub const fn is_migratable(from_version: u32) -> bool {
  if from_version == 0 {
    return false;
  }
  if from_version > PACK_VERSION {
    return false;
  }
  if from_version == PACK_VERSION {
    return true;
  }
  let mut current = from_version;
  while current < PACK_VERSION {
    match current {
      1 => current = 2,
      _ => return false,
    }
  }
  true
}

/// 将包数据从指定版本迁移到当前支持的最新版本，并在每步迁移前保存快照
///
/// 参数:
/// - `pack_data`: 包数据的 JSON 值，迁移过程中会被原地修改
/// - `from_version`: 当前包的版本号
///
/// 返回: 包含迁移步骤、结果和快照的 `(MigrationResult, Vec<MigrationSnapshot>)`
#[must_use]
pub fn migrate_pack_with_snapshots(
  pack_data: &mut serde_json::Value,
  from_version: u32,
) -> (MigrationResult, Vec<MigrationSnapshot>) {
  let mut snapshots: Vec<MigrationSnapshot> = Vec::new();
  let mut result = MigrationResult {
    from_version,
    to_version: PACK_VERSION,
    steps: Vec::new(),
    success: true,
    error: None,
  };

  if from_version >= PACK_VERSION {
    return (result, snapshots);
  }

  let mut current = from_version;

  while current < PACK_VERSION {
    snapshots.push(MigrationSnapshot { version: current, data: pack_data.clone() });

    if current == 1 {
      migrate_v1_to_v2(pack_data, &mut result);
      current = 2;
    } else {
      result.success = false;
      result.error = Some(format!("未知的包版本: {current}"));
      return (result, snapshots);
    }
  }

  if let Some(manifest) = pack_data.get_mut("manifest") {
    if let Some(obj) = manifest.as_object_mut() {
      obj.insert("version".to_string(), serde_json::Value::Number(PACK_VERSION.into()));
    }
  }

  (result, snapshots)
}

/// 使用快照回滚到指定版本
///
/// 参数:
/// - `snapshots`: 迁移过程中保存的快照列表
/// - `target_version`: 要回滚到的版本号
///
/// 返回: 回滚后的数据，如果找不到对应版本的快照则返回错误
///
/// # Errors
///
/// Returns `CoreError` if no snapshot for the target version is found.
pub fn rollback_to_version(
  snapshots: &[MigrationSnapshot],
  target_version: u32,
) -> Result<serde_json::Value, CoreError> {
  snapshots
    .iter()
    .find(|s| s.version == target_version)
    .map(|s| s.data.clone())
    .ok_or_else(|| CoreError::NotFound(format!("未找到版本 {target_version} 的迁移快照")))
}

/// 将包数据从指定版本迁移到当前支持的最新版本
///
/// 参数:
/// - `pack_data`: 包数据的 JSON 值，迁移过程中会被原地修改
/// - `from_version`: 当前包的版本号
///
/// 返回: 包含迁移步骤和结果的 `MigrationResult`
#[must_use]
pub fn migrate_pack(pack_data: &mut serde_json::Value, from_version: u32) -> MigrationResult {
  let (result, _) = migrate_pack_with_snapshots(pack_data, from_version);
  result
}

fn migrate_v1_to_v2(_data: &mut serde_json::Value, result: &mut MigrationResult) {
  result.steps.push("v1 → v2: 结构兼容，无需迁移".to_string());
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_migrate_same_version() {
    let mut pack_data = serde_json::json!({"manifest": {"version": PACK_VERSION}});
    let result = migrate_pack(&mut pack_data, PACK_VERSION);
    assert!(result.success);
    assert!(result.steps.is_empty());
  }

  #[test]
  fn test_migrate_unknown_version() {
    let mut pack_data = serde_json::json!({"manifest": {"version": 99}});
    let result = migrate_pack(&mut pack_data, 99);
    assert!(result.success);
    assert!(result.steps.is_empty());
  }

  #[test]
  fn test_migrate_v1_to_v2() {
    let mut pack_data = serde_json::json!({"manifest": {"version": 1}});
    let result = migrate_pack(&mut pack_data, 1);
    assert!(result.success);
    assert_eq!(result.from_version, 1);
    assert_eq!(result.to_version, PACK_VERSION);
    assert!(!result.steps.is_empty());
    assert_eq!(pack_data["manifest"]["version"], PACK_VERSION);
  }

  #[test]
  fn test_is_migratable_v1() {
    assert!(is_migratable(1));
  }

  #[test]
  fn test_is_migratable_current() {
    assert!(is_migratable(PACK_VERSION));
  }

  #[test]
  fn test_is_migratable_zero() {
    assert!(!is_migratable(0));
  }

  #[test]
  fn test_is_migratable_gap() {
    assert!(!is_migratable(5));
  }

  #[test]
  fn test_migrate_with_snapshots() {
    let mut pack_data = serde_json::json!({"manifest": {"version": 1}, "data": "original"});
    let (result, snapshots) = migrate_pack_with_snapshots(&mut pack_data, 1);
    assert!(result.success);
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].version, 1);
    assert_eq!(snapshots[0].data["data"], "original");
  }

  #[test]
  fn test_rollback_to_version() {
    let mut pack_data = serde_json::json!({"manifest": {"version": 1}, "data": "original"});
    let (_, snapshots) = migrate_pack_with_snapshots(&mut pack_data, 1);
    let rolled_back = rollback_to_version(&snapshots, 1).unwrap();
    assert_eq!(rolled_back["data"], "original");
  }

  #[test]
  fn test_rollback_not_found() {
    let snapshots: Vec<MigrationSnapshot> = vec![];
    let result = rollback_to_version(&snapshots, 1);
    assert!(result.is_err());
  }
}
