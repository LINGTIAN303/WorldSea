use crate::models::pack::{WorldSeaPack, PACK_VERSION};
use crate::validate::entity::ValidationReport;

/// 验证 `WorldSea` 包数据的合法性，包括版本号、导出时间戳和序列化器数据
///
/// 参数:
/// - `pack`: 待验证的包引用
///
/// 返回: 包含所有验证结果的 `ValidationReport`
#[must_use]
pub fn validate_pack(pack: &WorldSeaPack) -> ValidationReport {
  let mut report = ValidationReport::new();

  if pack.manifest.version == 0 {
    report.add_error("manifest.version", "包版本不能为 0");
  }

  if pack.manifest.version > PACK_VERSION {
    report.add_error(
      "manifest.version",
      &format!(
        "包版本 {pack_version} 高于当前支持版本 {PACK_VERSION}，请升级应用",
        pack_version = pack.manifest.version
      ),
    );
  }

  if pack.manifest.exported_at.is_empty() {
    report.add_warning("manifest.exportedAt", "缺少导出时间戳");
  }

  if pack.serializers.is_null() {
    report.add_error("serializers", "serializers 不能为 null");
  } else if let Some(obj) = pack.serializers.as_object() {
    if obj.is_empty() {
      report.add_warning("serializers", "serializers 为空，包中无数据");
    }
  }

  report
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::models::pack::{WorldSeaManifest, WorldSeaPack};

  #[test]
  fn test_valid_pack() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 2,
        exported_at: "2024-01-01".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::json!({"entities": []}),
    };
    let report = validate_pack(&pack);
    assert!(report.valid);
  }

  #[test]
  fn test_zero_version() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 0,
        exported_at: "2024-01-01".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::json!({}),
    };
    let report = validate_pack(&pack);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "manifest.version"));
  }

  #[test]
  fn test_future_version() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 99,
        exported_at: "2024-01-01".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::json!({}),
    };
    let report = validate_pack(&pack);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "manifest.version"));
  }

  #[test]
  fn test_missing_exported_at() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 2,
        exported_at: "".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::json!({}),
    };
    let report = validate_pack(&pack);
    assert!(report.valid);
    assert!(report
      .errors
      .iter()
      .any(|e| e.path == "manifest.exportedAt" && e.severity == "warning"));
  }

  #[test]
  fn test_null_serializers() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 2,
        exported_at: "2024-01-01".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::Value::Null,
    };
    let report = validate_pack(&pack);
    assert!(!report.valid);
    assert!(report.errors.iter().any(|e| e.path == "serializers"));
  }

  #[test]
  fn test_empty_serializers() {
    let pack = WorldSeaPack {
      manifest: WorldSeaManifest {
        version: 2,
        exported_at: "2024-01-01".to_string(),
        app_version: None,
        description: None,
      },
      serializers: serde_json::json!({}),
    };
    let report = validate_pack(&pack);
    assert!(report.valid);
    assert!(report.errors.iter().any(|e| e.path == "serializers" && e.severity == "warning"));
  }
}
