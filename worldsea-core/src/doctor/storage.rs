use serde::{Deserialize, Serialize};

use crate::storage::StorageBackend;

/// 存储健康报告，汇总数据库各表的记录数和完整性状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageHealthReport {
  /// 健康状态，"healthy" 或 "degraded"
  pub status: String,
  /// 实体表记录数
  pub entity_count: usize,
  /// 关系表记录数
  pub relation_count: usize,
  /// KV 表记录数
  pub kv_count: usize,
  /// 模块表记录数
  pub module_count: usize,
  /// 完整性是否通过
  pub integrity_ok: bool,
  /// 发现的问题列表
  pub issues: Vec<String>,
}

/// 检查存储层的健康状态，统计各表记录数并检测读取异常
///
/// 参数:
/// - `store`: 实现了 `StorageBackend` trait 的存储实例引用
///
/// 返回: 包含各表统计和问题列表的 `StorageHealthReport`
pub fn check_storage_health(store: &dyn StorageBackend) -> StorageHealthReport {
  let mut issues: Vec<String> = Vec::new();

  let entity_count = match store.get_all_entities() {
    Ok(entities) => entities.len(),
    Err(e) => {
      issues.push(format!("实体表读取失败: {e}"));
      0
    }
  };

  let relation_count = match store.get_all_relations() {
    Ok(relations) => relations.len(),
    Err(e) => {
      issues.push(format!("关系表读取失败: {e}"));
      0
    }
  };

  let kv_count = match store.kv_get_all() {
    Ok(pairs) => pairs.len(),
    Err(e) => {
      issues.push(format!("KV 表读取失败: {e}"));
      0
    }
  };

  let module_count = match store.get_all_modules() {
    Ok(modules) => modules.len(),
    Err(e) => {
      issues.push(format!("模块表读取失败: {e}"));
      0
    }
  };

  let integrity_ok = issues.is_empty();

  let status = if issues.is_empty() { "healthy".to_string() } else { "degraded".to_string() };

  StorageHealthReport {
    status,
    entity_count,
    relation_count,
    kv_count,
    module_count,
    integrity_ok,
    issues,
  }
}
