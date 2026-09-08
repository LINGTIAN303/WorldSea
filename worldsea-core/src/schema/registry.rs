use super::types::{EntityTypeSchema, FieldSchema, ViewDeclaration};
use super::validation::ValidationRule;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Default)]
pub struct SchemaRegistry {
  schemas: HashMap<String, EntityTypeSchema>,
}

impl SchemaRegistry {
  pub fn new() -> Self {
    Self { schemas: HashMap::new() }
  }

  pub fn register(&mut self, schema: EntityTypeSchema) -> Result<(), String> {
    if self.schemas.contains_key(&schema.type_key) {
      return Err(format!("Entity type '{}' already registered", schema.type_key));
    }
    self.schemas.insert(schema.type_key.clone(), schema);
    Ok(())
  }

  pub fn unregister(&mut self, type_key: &str) -> Option<EntityTypeSchema> {
    self.schemas.remove(type_key)
  }

  pub fn get(&self, type_key: &str) -> Option<&EntityTypeSchema> {
    self.schemas.get(type_key)
  }

  pub fn get_mut(&mut self, type_key: &str) -> Option<&mut EntityTypeSchema> {
    self.schemas.get_mut(type_key)
  }

  pub fn list_all(&self) -> Vec<&EntityTypeSchema> {
    self.schemas.values().collect()
  }

  pub fn update_fields(&mut self, type_key: &str, fields: Vec<FieldSchema>) -> Result<(), String> {
    let schema = self
      .schemas
      .get_mut(type_key)
      .ok_or_else(|| format!("Entity type '{}' not found", type_key))?;
    schema.fields = fields;
    Ok(())
  }

  pub fn add_field(&mut self, type_key: &str, field: FieldSchema) -> Result<(), String> {
    let schema = self
      .schemas
      .get_mut(type_key)
      .ok_or_else(|| format!("Entity type '{}' not found", type_key))?;
    if schema.fields.iter().any(|f| f.key == field.key) {
      return Err(format!("Field '{}' already exists in '{}'", field.key, type_key));
    }
    schema.fields.push(field);
    Ok(())
  }

  pub fn remove_field(&mut self, type_key: &str, field_key: &str) -> Result<(), String> {
    let schema = self
      .schemas
      .get_mut(type_key)
      .ok_or_else(|| format!("Entity type '{}' not found", type_key))?;
    let before = schema.fields.len();
    schema.fields.retain(|f| f.key != field_key);
    if schema.fields.len() == before {
      return Err(format!("Field '{}' not found in '{}'", field_key, type_key));
    }
    Ok(())
  }

  pub fn add_view(&mut self, type_key: &str, view: ViewDeclaration) -> Result<(), String> {
    let schema = self
      .schemas
      .get_mut(type_key)
      .ok_or_else(|| format!("Entity type '{}' not found", type_key))?;
    schema.views.push(view);
    Ok(())
  }

  pub fn add_validation(&mut self, type_key: &str, rule: ValidationRule) -> Result<(), String> {
    let schema = self
      .schemas
      .get_mut(type_key)
      .ok_or_else(|| format!("Entity type '{}' not found", type_key))?;
    schema.validations.push(rule);
    Ok(())
  }

  pub fn load_from_dir(dir: &Path) -> Result<Self, String> {
    let mut registry = Self::new();
    if !dir.exists() {
      return Ok(registry);
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read schema dir: {}", e))?;
    for entry in entries {
      let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
      let path = entry.path();
      if path.extension().map(|e| e == "json").unwrap_or(false) {
        let content = fs::read_to_string(&path)
          .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
        let schema: EntityTypeSchema = serde_json::from_str(&content)
          .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
        registry.schemas.insert(schema.type_key.clone(), schema);
      }
    }
    Ok(registry)
  }

  pub fn persist_to_dir(&self, dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create schema dir: {}", e))?;
    for schema in self.schemas.values() {
      let path = dir.join(format!("{}.json", schema.type_key));
      let content = serde_json::to_string_pretty(schema)
        .map_err(|e| format!("Failed to serialize {}: {}", schema.type_key, e))?;
      fs::write(&path, content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::schema::types::{FieldType, ViewType};
  use crate::schema::validation::ValidationRuleType;

  fn sample_schema(type_key: &str) -> EntityTypeSchema {
    EntityTypeSchema {
      type_key: type_key.to_string(),
      label: format!("Test {}", type_key),
      icon: "📄".to_string(),
      fields: vec![FieldSchema {
        key: "name".to_string(),
        label: "名称".to_string(),
        field_type: FieldType::Text,
        required: true,
        default_value: None,
        options: vec![],
        placeholder: Some("输入名称".to_string()),
        ref_type: None,
        auto_link: None,
        animation: None,
      }],
      relations: vec![],
      validations: vec![],
      views: vec![ViewDeclaration {
        view_type: ViewType::List,
        config: serde_json::Value::Null,
        animation: None,
      }],
      icon_map: HashMap::new(),
      id_prefix: "t-".to_string(),
      plugin_id: None,
    }
  }

  #[test]
  fn test_register_and_get() {
    let mut reg = SchemaRegistry::new();
    let schema = sample_schema("weapon");
    reg.register(schema).unwrap();
    let got = reg.get("weapon").unwrap();
    assert_eq!(got.type_key, "weapon");
    assert_eq!(got.label, "Test weapon");
  }

  #[test]
  fn test_register_duplicate() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let err = reg.register(sample_schema("weapon")).unwrap_err();
    assert!(err.contains("already registered"));
  }

  #[test]
  fn test_unregister() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let removed = reg.unregister("weapon").unwrap();
    assert_eq!(removed.type_key, "weapon");
    assert!(reg.get("weapon").is_none());
  }

  #[test]
  fn test_add_field() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let new_field = FieldSchema {
      key: "damage".to_string(),
      label: "伤害".to_string(),
      field_type: FieldType::Number,
      required: false,
      default_value: Some(serde_json::json!(0)),
      options: vec![],
      placeholder: None,
      ref_type: None,
      auto_link: None,
      animation: None,
    };
    reg.add_field("weapon", new_field).unwrap();
    let schema = reg.get("weapon").unwrap();
    assert_eq!(schema.fields.len(), 2);
    assert_eq!(schema.fields[1].key, "damage");
  }

  #[test]
  fn test_add_duplicate_field() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let dup_field = FieldSchema {
      key: "name".to_string(),
      label: "名称".to_string(),
      field_type: FieldType::Text,
      required: false,
      default_value: None,
      options: vec![],
      placeholder: None,
      ref_type: None,
      auto_link: None,
      animation: None,
    };
    let err = reg.add_field("weapon", dup_field).unwrap_err();
    assert!(err.contains("already exists"));
  }

  #[test]
  fn test_remove_field() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    reg.remove_field("weapon", "name").unwrap();
    let schema = reg.get("weapon").unwrap();
    assert!(schema.fields.is_empty());
  }

  #[test]
  fn test_add_view() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let tree_view = ViewDeclaration {
      view_type: ViewType::Tree,
      config: serde_json::json!({"edgeField": "evolves_from"}),
      animation: None,
    };
    reg.add_view("weapon", tree_view).unwrap();
    let schema = reg.get("weapon").unwrap();
    assert_eq!(schema.views.len(), 2);
    assert!(matches!(schema.views[1].view_type, ViewType::Tree));
  }

  #[test]
  fn test_add_validation() {
    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    let rule = ValidationRule {
      id: "v1".to_string(),
      description: "名称必填".to_string(),
      field_key: "name".to_string(),
      rule_type: ValidationRuleType::Required,
      params: serde_json::Value::Null,
    };
    reg.add_validation("weapon", rule).unwrap();
    let schema = reg.get("weapon").unwrap();
    assert_eq!(schema.validations.len(), 1);
  }

  #[test]
  fn test_persist_and_load() {
    let dir = std::env::temp_dir().join("worldsea_schema_test");
    let _ = fs::remove_dir_all(&dir);

    let mut reg = SchemaRegistry::new();
    reg.register(sample_schema("weapon")).unwrap();
    reg.register(sample_schema("armor")).unwrap();
    reg.persist_to_dir(&dir).unwrap();

    let loaded = SchemaRegistry::load_from_dir(&dir).unwrap();
    assert_eq!(loaded.list_all().len(), 2);
    assert!(loaded.get("weapon").is_some());
    assert!(loaded.get("armor").is_some());

    let _ = fs::remove_dir_all(&dir);
  }
}
