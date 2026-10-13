use crate::error::CoreError;
use crate::models::entity::Entity;
use crate::models::relation::Relation;

/// 存储后端 trait，定义持久化操作的统一接口；所有方法失败时返回 `CoreError`。
pub trait StorageBackend: Send + Sync {
  /// 写入或替换实体。
  fn put_entity(&self, entity: &Entity) -> Result<(), CoreError>;
  /// 按 id 查询实体。
  fn get_entity(&self, id: &str) -> Result<Option<Entity>, CoreError>;
  /// 获取所有实体。
  fn get_all_entities(&self) -> Result<Vec<Entity>, CoreError>;
  /// 按类型查询实体列表。
  fn get_entities_by_type(&self, entity_type: &str) -> Result<Vec<Entity>, CoreError>;
  /// 按 id 部分更新实体字段。
  fn update_entity(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// 按 id 删除实体。
  fn delete_entity(&self, id: &str) -> Result<bool, CoreError>;
  /// 按类型统计实体数量。
  fn count_entities_by_type(&self) -> Result<Vec<(String, usize)>, CoreError>;
  /// 清空所有实体。
  fn clear_entities(&self) -> Result<(), CoreError>;
  /// 批量导入实体。
  fn import_entities(&self, entities: &[Entity]) -> Result<usize, CoreError>;

  /// 写入或替换关系。
  fn put_relation(&self, relation: &Relation) -> Result<(), CoreError>;
  /// 按 id 查询关系。
  fn get_relation(&self, id: &str) -> Result<Option<Relation>, CoreError>;
  /// 获取所有关系。
  fn get_all_relations(&self) -> Result<Vec<Relation>, CoreError>;
  /// 查询与指定实体相关的所有关系。
  fn get_relations_by_entity(&self, entity_id: &str) -> Result<Vec<Relation>, CoreError>;
  /// 按 id 部分更新关系字段。
  fn update_relation(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// 按 id 删除关系。
  fn delete_relation(&self, id: &str) -> Result<bool, CoreError>;
  /// 删除与指定实体相关的所有关系。
  fn delete_relations_by_entity(&self, entity_id: &str) -> Result<usize, CoreError>;
  /// 清空所有关系。
  fn clear_relations(&self) -> Result<(), CoreError>;
  /// 批量导入关系。
  fn import_relations(&self, relations: &[Relation]) -> Result<usize, CoreError>;

  /// 按键获取键值对的值。
  fn kv_get(&self, key: &str) -> Result<Option<String>, CoreError>;
  /// 设置键值对（已存在则覆盖）。
  fn kv_set(&self, key: &str, value: &str) -> Result<(), CoreError>;
  /// 获取所有键值对。
  fn kv_get_all(&self) -> Result<Vec<(String, String)>, CoreError>;
  /// 删除指定键的键值对（幂等，键不存在也成功）。
  fn kv_delete(&self, key: &str) -> Result<(), CoreError>;

  /// 写入或替换模块记录。
  fn put_module(
    &self,
    id: &str,
    active: bool,
    source: &str,
    manifest_json: &str,
  ) -> Result<(), CoreError>;
  /// 按 id 查询模块。
  fn get_module(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError>;
  /// 获取所有模块。
  fn get_all_modules(&self) -> Result<Vec<serde_json::Value>, CoreError>;
  /// 按 id 部分更新模块字段。
  fn update_module(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// 按 id 删除模块。
  fn delete_module(&self, id: &str) -> Result<bool, CoreError>;
}

pub mod sqlite;
pub mod workflow;
