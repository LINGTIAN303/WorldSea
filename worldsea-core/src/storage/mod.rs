use crate::error::CoreError;
use crate::models::entity::Entity;
use crate::models::relation::Relation;

/// Storage backend trait defining the interface for persistent storage operations.
///
/// All methods return `Result<_, CoreError>` and may fail if the underlying storage encounters errors.
pub trait StorageBackend: Send + Sync {
  /// Writes or replaces an entity.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn put_entity(&self, entity: &Entity) -> Result<(), CoreError>;
  /// Gets an entity by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_entity(&self, id: &str) -> Result<Option<Entity>, CoreError>;
  /// Gets all entities.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_all_entities(&self) -> Result<Vec<Entity>, CoreError>;
  /// Gets entities by type.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_entities_by_type(&self, entity_type: &str) -> Result<Vec<Entity>, CoreError>;
  /// Updates an entity partially.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn update_entity(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// Deletes an entity by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn delete_entity(&self, id: &str) -> Result<bool, CoreError>;
  /// Counts entities grouped by type.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn count_entities_by_type(&self) -> Result<Vec<(String, usize)>, CoreError>;
  /// Clears all entities.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn clear_entities(&self) -> Result<(), CoreError>;
  /// Imports entities in bulk.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn import_entities(&self, entities: &[Entity]) -> Result<usize, CoreError>;

  /// Writes or replaces a relation.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn put_relation(&self, relation: &Relation) -> Result<(), CoreError>;
  /// Gets a relation by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_relation(&self, id: &str) -> Result<Option<Relation>, CoreError>;
  /// Gets all relations.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_all_relations(&self) -> Result<Vec<Relation>, CoreError>;
  /// Gets relations by entity ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_relations_by_entity(&self, entity_id: &str) -> Result<Vec<Relation>, CoreError>;
  /// Updates a relation partially.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn update_relation(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// Deletes a relation by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn delete_relation(&self, id: &str) -> Result<bool, CoreError>;
  /// Deletes all relations involving an entity.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn delete_relations_by_entity(&self, entity_id: &str) -> Result<usize, CoreError>;
  /// Clears all relations.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn clear_relations(&self) -> Result<(), CoreError>;
  /// Imports relations in bulk.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn import_relations(&self, relations: &[Relation]) -> Result<usize, CoreError>;

  /// Gets a key-value pair.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn kv_get(&self, key: &str) -> Result<Option<String>, CoreError>;
  /// Sets a key-value pair.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn kv_set(&self, key: &str, value: &str) -> Result<(), CoreError>;
  /// Gets all key-value pairs.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn kv_get_all(&self) -> Result<Vec<(String, String)>, CoreError>;
  /// Deletes a key-value pair by key. Idempotent.
  fn kv_delete(&self, key: &str) -> Result<(), CoreError>;

  /// Writes or replaces a module.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn put_module(
    &self,
    id: &str,
    active: bool,
    source: &str,
    manifest_json: &str,
  ) -> Result<(), CoreError>;
  /// Gets a module by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_module(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError>;
  /// Gets all modules.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn get_all_modules(&self) -> Result<Vec<serde_json::Value>, CoreError>;
  /// Updates a module partially.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn update_module(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError>;
  /// Deletes a module by ID.
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the operation fails.
  fn delete_module(&self, id: &str) -> Result<bool, CoreError>;
}

pub mod sqlite;
pub mod workflow;
