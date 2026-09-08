use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::retrofit::intent::RetrofitIntent;
#[cfg(feature = "sqlite")]
use crate::retrofit::intent::StyleTarget;
#[cfg(feature = "sqlite")]
use crate::storage::StorageBackend;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionResult {
  pub intent_id: String,
  pub success: bool,
  pub message: String,
  pub side_effects: Vec<String>,
}

pub trait IntentExecutor: Send + Sync {
  /// # Errors
  /// 意图执行失败时返回错误
  fn execute(&mut self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError>;
  /// # Errors
  /// 预检失败时返回错误
  fn dry_run(&self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError>;
}

pub struct NoOpExecutor;

impl IntentExecutor for NoOpExecutor {
  fn execute(&mut self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    Ok(ExecutionResult {
      intent_id: format!("{:?}", intent.intent_type()),
      success: true,
      message: format!("意图 {:?} 已记录（NoOp 执行器）", intent.intent_type()),
      side_effects: vec![],
    })
  }

  fn dry_run(&self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    Ok(ExecutionResult {
      intent_id: format!("{:?}", intent.intent_type()),
      success: true,
      message: format!("意图 {:?} 预检通过（NoOp 执行器）", intent.intent_type()),
      side_effects: vec![],
    })
  }
}

#[cfg(feature = "sqlite")]
pub struct StorageExecutor<'a> {
  storage: &'a dyn StorageBackend,
}

#[cfg(feature = "sqlite")]
impl<'a> StorageExecutor<'a> {
  #[must_use]
  pub const fn new(storage: &'a dyn StorageBackend) -> Self {
    Self { storage }
  }
}

#[cfg(feature = "sqlite")]
pub struct OwnedSqliteExecutor {
  storage: crate::storage::sqlite::SqliteStore,
}

#[cfg(feature = "sqlite")]
impl OwnedSqliteExecutor {
  #[must_use]
  pub const fn new(storage: crate::storage::sqlite::SqliteStore) -> Self {
    Self { storage }
  }

  #[must_use]
  pub const fn storage(&self) -> &crate::storage::sqlite::SqliteStore {
    &self.storage
  }
}

#[cfg(feature = "sqlite")]
impl IntentExecutor for OwnedSqliteExecutor {
  #[allow(clippy::too_many_lines)]
  #[allow(clippy::or_fun_call)]
  fn execute(&mut self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    let mut inner = StorageExecutor::new(&self.storage as &dyn StorageBackend);
    inner.execute(intent)
  }

  fn dry_run(&self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    let inner = StorageExecutor::new(&self.storage as &dyn StorageBackend);
    inner.dry_run(intent)
  }
}

#[cfg(feature = "sqlite")]
impl IntentExecutor for StorageExecutor<'_> {
  #[allow(clippy::too_many_lines)]
  #[allow(clippy::or_fun_call)]
  fn execute(&mut self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    match intent {
      RetrofitIntent::AddEntityType { type_name, fields } => {
        let schema_key = format!("schema:{type_name}");
        let schema_json = serde_json::json!({
          "typeName": type_name,
          "fields": fields,
        });
        self.storage.kv_set(&schema_key, &schema_json.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("AddEntityType:{type_name}"),
          success: true,
          message: format!("实体类型 '{type_name}' 已创建（含 {} 个字段）", fields.len()),
          side_effects: vec![format!("kv_set:{schema_key}")],
        })
      }

      RetrofitIntent::RemoveEntityType { type_name } => {
        let entities = self.storage.get_entities_by_type(type_name)?;
        let entity_count = entities.len();
        for entity in &entities {
          self.storage.delete_relations_by_entity(&entity.id)?;
          self.storage.delete_entity(&entity.id)?;
        }
        let schema_key = format!("schema:{type_name}");
        self.storage.kv_set(&schema_key, "")?;
        Ok(ExecutionResult {
          intent_id: format!("RemoveEntityType:{type_name}"),
          success: true,
          message: format!("实体类型 '{type_name}' 已删除（移除 {entity_count} 个实体）"),
          side_effects: vec![
            format!("deleted_entities:{entity_count}"),
            format!("kv_clear:{schema_key}"),
          ],
        })
      }

      RetrofitIntent::AddField { entity_type, field } => {
        let schema_key = format!("schema:{entity_type}");
        let existing = self.storage.kv_get(&schema_key)?;
        let mut schema: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"typeName": entity_type, "fields": []}));

        if let Some(fields) = schema.get_mut("fields").and_then(|f| f.as_array_mut()) {
          fields
            .push(serde_json::to_value(field).map_err(|e| CoreError::serialize(e.to_string()))?);
        }

        self.storage.kv_set(&schema_key, &schema.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("AddField:{entity_type}:{}", field.name),
          success: true,
          message: format!("字段 '{}' 已添加到实体类型 '{entity_type}'", field.name),
          side_effects: vec![format!("kv_set:{schema_key}")],
        })
      }

      RetrofitIntent::RemoveField { entity_type, field_name } => {
        let schema_key = format!("schema:{entity_type}");
        let existing = self.storage.kv_get(&schema_key)?;
        let mut schema: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"typeName": entity_type, "fields": []}));

        if let Some(fields) = schema.get_mut("fields").and_then(|f| f.as_array_mut()) {
          fields.retain(|f| f.get("name").and_then(|n| n.as_str()) != Some(field_name));
        }

        self.storage.kv_set(&schema_key, &schema.to_string())?;

        let entities = self.storage.get_entities_by_type(entity_type)?;
        for entity in &entities {
          let changes = serde_json::json!({ "customFields": { field_name: null } });
          self.storage.update_entity(&entity.id, &changes)?;
        }

        Ok(ExecutionResult {
          intent_id: format!("RemoveField:{entity_type}:{field_name}"),
          success: true,
          message: format!("字段 '{field_name}' 已从实体类型 '{entity_type}' 移除"),
          side_effects: vec![
            format!("kv_set:{schema_key}"),
            format!("field_cleared_from:{}:entities", entities.len()),
          ],
        })
      }

      RetrofitIntent::ModifyField { entity_type, field_name, changes } => {
        let schema_key = format!("schema:{entity_type}");
        let existing = self.storage.kv_get(&schema_key)?;
        let mut schema: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"typeName": entity_type, "fields": []}));

        if let Some(fields) = schema.get_mut("fields").and_then(|f| f.as_array_mut()) {
          for field in fields.iter_mut() {
            if field.get("name").and_then(|n| n.as_str()) == Some(field_name) {
              if let Some(new_label) = &changes.new_label {
                field["label"] = serde_json::Value::String(new_label.clone());
              }
              if let Some(new_required) = changes.new_required {
                field["required"] = serde_json::Value::Bool(new_required);
              }
              if let Some(new_options) = &changes.new_options {
                field["options"] = serde_json::to_value(new_options)
                  .map_err(|e| CoreError::serialize(e.to_string()))?;
              }
            }
          }
        }

        self.storage.kv_set(&schema_key, &schema.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyField:{entity_type}:{field_name}"),
          success: true,
          message: format!("字段 '{field_name}' (实体类型 '{entity_type}') 已修改"),
          side_effects: vec![format!("kv_set:{schema_key}")],
        })
      }

      RetrofitIntent::ModifySchema { entity_type, changes: schema_changes } => {
        let schema_key = format!("schema:{entity_type}");
        let existing = self.storage.kv_get(&schema_key)?;
        let mut schema: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"typeName": entity_type, "fields": []}));

        if let Some(fields) = schema.get_mut("fields").and_then(|f| f.as_array_mut()) {
          for field_def in &schema_changes.add_fields {
            fields.push(
              serde_json::to_value(field_def).map_err(|e| CoreError::serialize(e.to_string()))?,
            );
          }
          for remove_name in &schema_changes.remove_fields {
            fields.retain(|f| f.get("name").and_then(|n| n.as_str()) != Some(remove_name.as_str()));
          }
          for modify in &schema_changes.modify_fields {
            for field in fields.iter_mut() {
              if field.get("name").and_then(|n| n.as_str()) == Some(modify.name.as_str()) {
                if let Some(new_label) = &modify.new_label {
                  field["label"] = serde_json::Value::String(new_label.clone());
                }
                if let Some(new_required) = modify.new_required {
                  field["required"] = serde_json::Value::Bool(new_required);
                }
                if let Some(new_options) = &modify.new_options {
                  field["options"] = serde_json::to_value(new_options)
                    .map_err(|e| CoreError::serialize(e.to_string()))?;
                }
              }
            }
          }
        }

        self.storage.kv_set(&schema_key, &schema.to_string())?;
        let total = schema_changes.add_fields.len()
          + schema_changes.remove_fields.len()
          + schema_changes.modify_fields.len();
        Ok(ExecutionResult {
          intent_id: format!("ModifySchema:{entity_type}"),
          success: true,
          message: format!("Schema '{entity_type}' 已修改（{total} 项变更）"),
          side_effects: vec![format!("kv_set:{schema_key}")],
        })
      }

      RetrofitIntent::AddView { entity_type: _, view } => {
        let view_key = format!("view:{}", view.id);
        let view_json =
          serde_json::to_string(view).map_err(|e| CoreError::serialize(e.to_string()))?;
        self.storage.kv_set(&view_key, &view_json)?;
        Ok(ExecutionResult {
          intent_id: format!("AddView:{}", view.id),
          success: true,
          message: format!("视图 '{}' 已创建", view.id),
          side_effects: vec![format!("kv_set:{view_key}")],
        })
      }

      RetrofitIntent::ModifyView { view_id, changes } => {
        let view_key = format!("view:{view_id}");
        let existing = self.storage.kv_get(&view_key)?;
        let mut view_data: serde_json::Value =
          existing.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(serde_json::json!({}));

        if let Some(new_name) = &changes.name {
          view_data["name"] = serde_json::Value::String(new_name.clone());
        }
        if let Some(new_layout) = &changes.layout {
          view_data["layout"] =
            serde_json::to_value(new_layout).map_err(|e| CoreError::serialize(e.to_string()))?;
        }
        if let Some(fields) = view_data.get_mut("fields").and_then(|f| f.as_array_mut()) {
          for add_f in &changes.add_fields {
            fields.push(serde_json::Value::String(add_f.clone()));
          }
          fields.retain(|f| {
            let name = f.as_str().unwrap_or("");
            !changes.remove_fields.iter().any(|r| r == name)
          });
        }

        self.storage.kv_set(&view_key, &view_data.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyView:{view_id}"),
          success: true,
          message: format!("视图 '{view_id}' 已修改"),
          side_effects: vec![format!("kv_set:{view_key}")],
        })
      }

      RetrofitIntent::RemoveView { view_id } => {
        let view_key = format!("view:{view_id}");
        self.storage.kv_set(&view_key, "")?;
        Ok(ExecutionResult {
          intent_id: format!("RemoveView:{view_id}"),
          success: true,
          message: format!("视图 '{view_id}' 已删除"),
          side_effects: vec![format!("kv_clear:{view_key}")],
        })
      }

      RetrofitIntent::AddAction { target, action } => {
        let action_key = format!("action:{}", action.id);
        let action_json = serde_json::json!({
          "id": action.id,
          "label": action.label,
          "target": target,
          "handlerHint": action.handler_hint,
        });
        self.storage.kv_set(&action_key, &action_json.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("AddAction:{}", action.id),
          success: true,
          message: format!("行为 '{}' 已添加", action.id),
          side_effects: vec![format!("kv_set:{action_key}")],
        })
      }

      RetrofitIntent::ModifyAction { action_id, changes } => {
        let action_key = format!("action:{action_id}");
        let existing = self.storage.kv_get(&action_key)?;
        let mut action_data: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"id": action_id}));

        if let Some(new_label) = &changes.new_label {
          action_data["label"] = serde_json::Value::String(new_label.clone());
        }
        if let Some(new_handler) = &changes.new_handler_hint {
          action_data["handlerHint"] = serde_json::Value::String(new_handler.clone());
        }

        self.storage.kv_set(&action_key, &action_data.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyAction:{action_id}"),
          success: true,
          message: format!("行为 '{action_id}' 已修改"),
          side_effects: vec![format!("kv_set:{action_key}")],
        })
      }

      RetrofitIntent::RemoveAction { action_id } => {
        let action_key = format!("action:{action_id}");
        self.storage.kv_set(&action_key, "")?;
        Ok(ExecutionResult {
          intent_id: format!("RemoveAction:{action_id}"),
          success: true,
          message: format!("行为 '{action_id}' 已删除"),
          side_effects: vec![format!("kv_clear:{action_key}")],
        })
      }

      RetrofitIntent::AddRelationType { type_name, source_types, target_types } => {
        let rel_key = format!("relation_type:{type_name}");
        let rel_json = serde_json::json!({
          "typeName": type_name,
          "sourceTypes": source_types,
          "targetTypes": target_types,
        });
        self.storage.kv_set(&rel_key, &rel_json.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("AddRelationType:{type_name}"),
          success: true,
          message: format!("关系类型 '{type_name}' 已创建"),
          side_effects: vec![format!("kv_set:{rel_key}")],
        })
      }

      RetrofitIntent::ModifyRelationType { type_name, changes } => {
        let rel_key = format!("relation_type:{type_name}");
        let existing = self.storage.kv_get(&rel_key)?;
        let mut rel_data: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"typeName": type_name}));

        if let Some(new_sources) = &changes.new_source_types {
          rel_data["sourceTypes"] =
            serde_json::to_value(new_sources).map_err(|e| CoreError::serialize(e.to_string()))?;
        }
        if let Some(new_targets) = &changes.new_target_types {
          rel_data["targetTypes"] =
            serde_json::to_value(new_targets).map_err(|e| CoreError::serialize(e.to_string()))?;
        }

        self.storage.kv_set(&rel_key, &rel_data.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyRelationType:{type_name}"),
          success: true,
          message: format!("关系类型 '{type_name}' 已修改"),
          side_effects: vec![format!("kv_set:{rel_key}")],
        })
      }

      RetrofitIntent::RemoveRelationType { type_name } => {
        let rel_key = format!("relation_type:{type_name}");
        self.storage.kv_set(&rel_key, "")?;
        Ok(ExecutionResult {
          intent_id: format!("RemoveRelationType:{type_name}"),
          success: true,
          message: format!("关系类型 '{type_name}' 已删除"),
          side_effects: vec![format!("kv_clear:{rel_key}")],
        })
      }

      RetrofitIntent::SetTheme { theme } => {
        let theme_key = format!("theme:{}", theme.id);
        let theme_json =
          serde_json::to_string(theme).map_err(|e| CoreError::serialize(e.to_string()))?;
        self.storage.kv_set(&theme_key, &theme_json)?;
        let active_key = "theme:__active__";
        self.storage.kv_set(active_key, &theme.id)?;
        Ok(ExecutionResult {
          intent_id: format!("SetTheme:{}", theme.id),
          success: true,
          message: format!("主题 '{}' 已设置并激活", theme.id),
          side_effects: vec![format!("kv_set:{theme_key}"), format!("kv_set:{active_key}")],
        })
      }

      RetrofitIntent::ModifyTheme { theme_id, changes } => {
        let theme_key = format!("theme:{theme_id}");
        let existing = self.storage.kv_get(&theme_key)?;
        let mut theme_data: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or(serde_json::json!({"id": theme_id}));

        if let Some(new_name) = &changes.name {
          theme_data["name"] = serde_json::Value::String(new_name.clone());
        }
        if let Some(new_colors) = &changes.colors {
          theme_data["colors"] =
            serde_json::to_value(new_colors).map_err(|e| CoreError::serialize(e.to_string()))?;
        }
        if let Some(new_typography) = &changes.typography {
          theme_data["typography"] = serde_json::to_value(new_typography)
            .map_err(|e| CoreError::serialize(e.to_string()))?;
        }
        if let Some(new_spacing) = &changes.spacing {
          theme_data["spacing"] =
            serde_json::to_value(new_spacing).map_err(|e| CoreError::serialize(e.to_string()))?;
        }
        if let Some(new_border_radius) = &changes.border_radius {
          theme_data["borderRadius"] = serde_json::Value::String(new_border_radius.clone());
        }

        self.storage.kv_set(&theme_key, &theme_data.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyTheme:{theme_id}"),
          success: true,
          message: format!("主题 '{theme_id}' 已修改"),
          side_effects: vec![format!("kv_set:{theme_key}")],
        })
      }

      RetrofitIntent::ModifyLayout { layout } => {
        let layout_key = format!("layout:{}", layout.id);
        let layout_json =
          serde_json::to_string(layout).map_err(|e| CoreError::serialize(e.to_string()))?;
        self.storage.kv_set(&layout_key, &layout_json)?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyLayout:{}", layout.id),
          success: true,
          message: format!("布局 '{}' 已更新", layout.id),
          side_effects: vec![format!("kv_set:{layout_key}")],
        })
      }

      RetrofitIntent::ModifyStyle { style } => {
        let style_key = match &style.target {
          StyleTarget::Component { component_id } => {
            format!("style:component:{component_id}")
          }
          StyleTarget::Element { selector } => format!("style:element:{selector}"),
          StyleTarget::CssVariable { variable_name } => {
            format!("style:css-var:{variable_name}")
          }
        };

        let existing = self.storage.kv_get(&style_key)?;
        let mut style_data: serde_json::Value = existing
          .and_then(|s| serde_json::from_str(&s).ok())
          .unwrap_or_else(|| serde_json::to_value(&style.target).unwrap_or(serde_json::json!({})));

        let props_array = style_data
          .get_mut("properties")
          .and_then(|p| p.as_array_mut())
          .map(std::mem::take)
          .unwrap_or_default();

        let mut merged: Vec<serde_json::Value> = props_array
          .into_iter()
          .filter(|p| {
            let existing_prop = p.get("property").and_then(|v| v.as_str()).unwrap_or("");
            !style.properties.iter().any(|sp| sp.property == existing_prop)
          })
          .collect();

        for prop in &style.properties {
          merged.push(serde_json::to_value(prop).map_err(|e| CoreError::serialize(e.to_string()))?);
        }

        style_data["properties"] = serde_json::Value::Array(merged);
        self.storage.kv_set(&style_key, &style_data.to_string())?;
        Ok(ExecutionResult {
          intent_id: format!("ModifyStyle:{style_key}"),
          success: true,
          message: format!("样式 '{}' 已更新（含 {} 个属性）", style_key, style.properties.len()),
          side_effects: vec![format!("kv_set:{style_key}")],
        })
      }
    }
  }

  fn dry_run(&self, intent: &RetrofitIntent) -> Result<ExecutionResult, CoreError> {
    match intent {
      RetrofitIntent::AddEntityType { type_name, fields } => {
        let schema_key = format!("schema:{type_name}");
        match self.storage.kv_get(&schema_key) {
          Ok(Some(_)) => Ok(ExecutionResult {
            intent_id: format!("AddEntityType:{type_name}"),
            success: false,
            message: format!("实体类型 '{type_name}' 已存在"),
            side_effects: vec![],
          }),
          _ => Ok(ExecutionResult {
            intent_id: format!("AddEntityType:{type_name}"),
            success: true,
            message: format!(
              "预检通过：将创建实体类型 '{type_name}'（含 {} 个字段）",
              fields.len()
            ),
            side_effects: vec![],
          }),
        }
      }
      RetrofitIntent::RemoveEntityType { type_name } => {
        let entities = self.storage.get_entities_by_type(type_name)?;
        Ok(ExecutionResult {
          intent_id: format!("RemoveEntityType:{type_name}"),
          success: true,
          message: format!(
            "预检通过：将删除实体类型 '{type_name}'（影响 {} 个实体）",
            entities.len()
          ),
          side_effects: vec![],
        })
      }
      RetrofitIntent::SetTheme { theme } => {
        let theme_key = format!("theme:{}", theme.id);
        match self.storage.kv_get(&theme_key) {
          Ok(Some(_)) => Ok(ExecutionResult {
            intent_id: format!("SetTheme:{}", theme.id),
            success: true,
            message: format!("预检通过：将覆盖主题 '{}' 并激活", theme.id),
            side_effects: vec![],
          }),
          _ => Ok(ExecutionResult {
            intent_id: format!("SetTheme:{}", theme.id),
            success: true,
            message: format!("预检通过：将创建并激活主题 '{}'", theme.id),
            side_effects: vec![],
          }),
        }
      }
      RetrofitIntent::ModifyTheme { theme_id, .. } => {
        let theme_key = format!("theme:{theme_id}");
        match self.storage.kv_get(&theme_key) {
          Ok(Some(_)) => Ok(ExecutionResult {
            intent_id: format!("ModifyTheme:{theme_id}"),
            success: true,
            message: format!("预检通过：将修改主题 '{theme_id}'"),
            side_effects: vec![],
          }),
          _ => Ok(ExecutionResult {
            intent_id: format!("ModifyTheme:{theme_id}"),
            success: false,
            message: format!("主题 '{theme_id}' 不存在，无法修改"),
            side_effects: vec![],
          }),
        }
      }
      RetrofitIntent::ModifyLayout { layout } => Ok(ExecutionResult {
        intent_id: format!("ModifyLayout:{}", layout.id),
        success: true,
        message: format!("预检通过：将更新布局 '{}'", layout.id),
        side_effects: vec![],
      }),
      RetrofitIntent::ModifyStyle { style } => {
        let prop_count = style.properties.len();
        Ok(ExecutionResult {
          intent_id: format!("ModifyStyle:{:?}", style.target),
          success: true,
          message: format!("预检通过：将更新样式（含 {prop_count} 个属性）"),
          side_effects: vec![],
        })
      }
      _ => Ok(ExecutionResult {
        intent_id: format!("{:?}", intent.intent_type()),
        success: true,
        message: format!("预检通过：意图 {:?}", intent.intent_type()),
        side_effects: vec![],
      }),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
  pub has_conflicts: bool,
  pub conflicts: Vec<ConflictEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictEntry {
  pub intent_index_a: usize,
  pub intent_index_b: usize,
  pub conflict_type: ConflictType,
  pub description: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictType {
  AddRemoveSameTarget,
  DuplicateAdd,
  DependencyOrder,
  IncompatibleModification,
}

pub struct IntentConflictDetector;

impl IntentConflictDetector {
  #[must_use]
  pub fn detect(intents: &[RetrofitIntent]) -> ConflictReport {
    let mut conflicts = Vec::new();

    for i in 0..intents.len() {
      for j in (i + 1)..intents.len() {
        if let Some(conflict) = Self::check_pair(&intents[i], &intents[j], i, j) {
          conflicts.push(conflict);
        }
      }
    }

    ConflictReport { has_conflicts: !conflicts.is_empty(), conflicts }
  }

  #[allow(clippy::too_many_lines)]
  fn check_pair(
    a: &RetrofitIntent,
    b: &RetrofitIntent,
    index_a: usize,
    index_b: usize,
  ) -> Option<ConflictEntry> {
    match (a, b) {
      (
        RetrofitIntent::AddField { entity_type: et1, field: f1 },
        RetrofitIntent::RemoveField { entity_type: et2, field_name: fn2 },
      )
      | (
        RetrofitIntent::RemoveField { entity_type: et1, field_name: fn2 },
        RetrofitIntent::AddField { entity_type: et2, field: f1 },
      ) if et1 == et2 && f1.name == *fn2 => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::AddRemoveSameTarget,
        description: format!("同时添加和删除字段 '{fn2}' (实体类型 '{et1}')"),
      }),

      (
        RetrofitIntent::AddEntityType { type_name: tn1, .. },
        RetrofitIntent::RemoveEntityType { type_name: tn2 },
      )
      | (
        RetrofitIntent::RemoveEntityType { type_name: tn2 },
        RetrofitIntent::AddEntityType { type_name: tn1, .. },
      ) if tn1 == tn2 => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::AddRemoveSameTarget,
        description: format!("同时添加和删除实体类型 '{tn1}'"),
      }),

      (
        RetrofitIntent::AddView { entity_type: _, view: v1 },
        RetrofitIntent::RemoveView { view_id: vid2 },
      )
      | (
        RetrofitIntent::RemoveView { view_id: vid2 },
        RetrofitIntent::AddView { entity_type: _, view: v1 },
      ) if v1.id == *vid2 => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::AddRemoveSameTarget,
        description: format!("同时添加和删除视图 '{vid2}'"),
      }),

      (
        RetrofitIntent::AddField { entity_type: et1, field: f1 },
        RetrofitIntent::AddField { entity_type: et2, field: f2 },
      ) if et1 == et2 && f1.name == f2.name => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::DuplicateAdd,
        description: format!("重复添加字段 '{}' (实体类型 '{et1}')", f1.name),
      }),

      (
        RetrofitIntent::AddEntityType { type_name: tn1, .. },
        RetrofitIntent::AddEntityType { type_name: tn2, .. },
      ) if tn1 == tn2 => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::DuplicateAdd,
        description: format!("重复添加实体类型 '{tn1}'"),
      }),

      (
        RetrofitIntent::AddField { entity_type: et1, .. },
        RetrofitIntent::RemoveEntityType { type_name: tn2 },
      ) if et1 == tn2 => Some(ConflictEntry {
        intent_index_a: index_a,
        intent_index_b: index_b,
        conflict_type: ConflictType::DependencyOrder,
        description: format!("为实体类型 '{et1}' 添加字段的同时删除该实体类型"),
      }),

      _ => None,
    }
  }
}

#[cfg(all(test, feature = "sqlite"))]
mod tests {
  use super::*;
  use crate::retrofit::intent::{
    FieldDef, FieldType, LayoutDef, LayoutDirection, LayoutSection, LayoutStructure, LayoutTarget,
    SpacingDef, StyleDef, StyleProperty, StyleTarget, ThemeChanges, ThemeColors, ThemeDef,
    TypographyDef,
  };
  use crate::storage::sqlite::SqliteStore;

  fn make_add_field_intent() -> RetrofitIntent {
    RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "str".to_string(),
        field_type: FieldType::Number,
        label: "力量".to_string(),
        required: false,
        default_value: None,
        options: None,
      },
    }
  }

  #[test]
  fn test_noop_executor_execute() {
    let mut executor = NoOpExecutor;
    let result = executor.execute(&make_add_field_intent()).unwrap();
    assert!(result.success);
  }

  #[test]
  fn test_noop_executor_dry_run() {
    let executor = NoOpExecutor;
    let result = executor.dry_run(&make_add_field_intent()).unwrap();
    assert!(result.success);
  }

  #[test]
  fn test_storage_executor_add_entity_type() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::AddEntityType {
      type_name: "faction".to_string(),
      fields: vec![FieldDef {
        name: "name".to_string(),
        field_type: FieldType::Text,
        label: "名称".to_string(),
        required: true,
        default_value: None,
        options: None,
      }],
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);
    assert!(result.message.contains("faction"));

    let schema = storage.kv_get("schema:faction").unwrap();
    assert!(schema.is_some());
  }

  #[test]
  fn test_storage_executor_add_field() {
    let storage = SqliteStore::open_in_memory().unwrap();
    storage
      .kv_set(
        "schema:character",
        &serde_json::json!({"typeName":"character","fields":[]}).to_string(),
      )
      .unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let result = executor.execute(&make_add_field_intent()).unwrap();
    assert!(result.success);
    assert!(result.message.contains("str"));
  }

  #[test]
  fn test_storage_executor_remove_entity_type() {
    let storage = SqliteStore::open_in_memory().unwrap();
    storage
      .kv_set(
        "schema:character",
        &serde_json::json!({"typeName":"character","fields":[]}).to_string(),
      )
      .unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let result = executor
      .execute(&RetrofitIntent::RemoveEntityType { type_name: "character".to_string() })
      .unwrap();
    assert!(result.success);
  }

  #[test]
  fn test_storage_executor_add_view() {
    use crate::retrofit::intent::{ViewDef, ViewLayout};
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::AddView {
      entity_type: "character".to_string(),
      view: ViewDef {
        id: "char-card".to_string(),
        name: "角色卡片".to_string(),
        target_entity_type: "character".to_string(),
        layout: ViewLayout::Card,
        fields: vec!["name".to_string()],
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);
    let view = storage.kv_get("view:char-card").unwrap();
    assert!(view.is_some());
  }

  #[test]
  fn test_storage_executor_dry_run_add_entity_type() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::AddEntityType {
      type_name: "faction".to_string(),
      fields: vec![FieldDef {
        name: "name".to_string(),
        field_type: FieldType::Text,
        label: "名称".to_string(),
        required: true,
        default_value: None,
        options: None,
      }],
    };
    let result = executor.dry_run(&intent).unwrap();
    assert!(result.success);
  }

  #[test]
  fn test_conflict_add_remove_same_field() {
    let intents = vec![
      make_add_field_intent(),
      RetrofitIntent::RemoveField {
        entity_type: "character".to_string(),
        field_name: "str".to_string(),
      },
    ];
    let report = IntentConflictDetector::detect(&intents);
    assert!(report.has_conflicts);
    assert_eq!(report.conflicts[0].conflict_type, ConflictType::AddRemoveSameTarget);
  }

  #[test]
  fn test_conflict_duplicate_add() {
    let intents = vec![
      RetrofitIntent::AddEntityType {
        type_name: "faction".to_string(),
        fields: vec![FieldDef {
          name: "name".to_string(),
          field_type: FieldType::Text,
          label: "名称".to_string(),
          required: true,
          default_value: None,
          options: None,
        }],
      },
      RetrofitIntent::AddEntityType { type_name: "faction".to_string(), fields: vec![] },
    ];
    let report = IntentConflictDetector::detect(&intents);
    assert!(report.has_conflicts);
  }

  #[test]
  fn test_no_conflict_different_targets() {
    let intents = vec![
      RetrofitIntent::AddField {
        entity_type: "character".to_string(),
        field: FieldDef {
          name: "str".to_string(),
          field_type: FieldType::Number,
          label: "力量".to_string(),
          required: false,
          default_value: None,
          options: None,
        },
      },
      RetrofitIntent::AddField {
        entity_type: "location".to_string(),
        field: FieldDef {
          name: "str".to_string(),
          field_type: FieldType::Number,
          label: "力量".to_string(),
          required: false,
          default_value: None,
          options: None,
        },
      },
    ];
    let report = IntentConflictDetector::detect(&intents);
    assert!(!report.has_conflicts);
  }

  #[test]
  fn test_dependency_order_conflict() {
    let intents = vec![
      make_add_field_intent(),
      RetrofitIntent::RemoveEntityType { type_name: "character".to_string() },
    ];
    let report = IntentConflictDetector::detect(&intents);
    assert!(report.has_conflicts);
    assert_eq!(report.conflicts[0].conflict_type, ConflictType::DependencyOrder);
  }

  #[test]
  fn test_health_check_registry() {
    use crate::retrofit::changelog::ChangeLog;
    use crate::retrofit::guard::HealthCheckRegistry;
    let mut registry = HealthCheckRegistry::new();
    registry.register(Box::new(|_changelog, ec, _rc| {
      if ec == 0 {
        vec!["实体数量为零".to_string()]
      } else {
        vec![]
      }
    }));
    let changelog = ChangeLog::new("test");
    let issues = registry.run_all(&changelog, 0, 5);
    assert_eq!(issues.len(), 1);
  }

  #[test]
  fn test_storage_executor_set_theme() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::SetTheme {
      theme: ThemeDef {
        id: "dark".to_string(),
        name: "暗黑主题".to_string(),
        colors: ThemeColors {
          primary: "#6750A4".to_string(),
          secondary: "#625B71".to_string(),
          background: "#1C1B1F".to_string(),
          surface: "#2B2930".to_string(),
          text: "#E6E1E5".to_string(),
          text_secondary: "#CAC4D0".to_string(),
          accent: "#D0BCFF".to_string(),
          error: "#F2B8B5".to_string(),
          warning: "#F9DEDC".to_string(),
          success: "#A8DAB5".to_string(),
        },
        typography: TypographyDef {
          font_family: "Inter".to_string(),
          heading_size: "24px".to_string(),
          body_size: "14px".to_string(),
          caption_size: "12px".to_string(),
          line_height: "1.5".to_string(),
        },
        spacing: SpacingDef {
          xs: "4px".to_string(),
          sm: "8px".to_string(),
          md: "16px".to_string(),
          lg: "24px".to_string(),
          xl: "32px".to_string(),
        },
        border_radius: "8px".to_string(),
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);
    assert!(result.message.contains("dark"));

    let theme = storage.kv_get("theme:dark").unwrap();
    assert!(theme.is_some());

    let active = storage.kv_get("theme:__active__").unwrap();
    assert_eq!(active.as_deref(), Some("dark"));
  }

  #[test]
  fn test_storage_executor_modify_theme() {
    let storage = SqliteStore::open_in_memory().unwrap();
    storage
      .kv_set(
        "theme:dark",
        &serde_json::json!({
          "id": "dark",
          "name": "暗黑",
          "colors": { "primary": "#000" },
          "typography": { "fontFamily": "Roboto" },
          "spacing": { "xs": "4px" },
          "borderRadius": "4px"
        })
        .to_string(),
      )
      .unwrap();

    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyTheme {
      theme_id: "dark".to_string(),
      changes: ThemeChanges {
        name: Some("暗黑主题v2".to_string()),
        colors: None,
        typography: None,
        spacing: None,
        border_radius: Some("12px".to_string()),
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);

    let updated: serde_json::Value =
      serde_json::from_str(&storage.kv_get("theme:dark").unwrap().unwrap()).unwrap();
    assert_eq!(updated["name"], "暗黑主题v2");
    assert_eq!(updated["borderRadius"], "12px");
    assert_eq!(updated["colors"]["primary"], "#000");
  }

  #[test]
  fn test_storage_executor_modify_layout() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyLayout {
      layout: LayoutDef {
        id: "main-layout".to_string(),
        name: "主布局".to_string(),
        target: LayoutTarget::Global,
        structure: LayoutStructure {
          direction: LayoutDirection::Row,
          gap: "16px".to_string(),
          padding: "24px".to_string(),
          sections: vec![LayoutSection {
            id: "sidebar".to_string(),
            name: "侧边栏".to_string(),
            min_width: Some("240px".to_string()),
            max_width: None,
            grow: Some(0.0),
          }],
        },
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);
    assert!(result.message.contains("main-layout"));

    let layout = storage.kv_get("layout:main-layout").unwrap();
    assert!(layout.is_some());
  }

  #[test]
  fn test_storage_executor_modify_style_component() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyStyle {
      style: StyleDef {
        target: StyleTarget::Component { component_id: "hero-card".to_string() },
        properties: vec![
          StyleProperty {
            property: "background-color".to_string(),
            value: "#1a1a2e".to_string(),
            important: false,
          },
          StyleProperty {
            property: "border-radius".to_string(),
            value: "12px".to_string(),
            important: true,
          },
        ],
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);

    let stored = storage.kv_get("style:component:hero-card").unwrap();
    assert!(stored.is_some());
  }

  #[test]
  fn test_storage_executor_modify_style_merge() {
    let storage = SqliteStore::open_in_memory().unwrap();
    storage
      .kv_set(
        "style:component:hero-card",
        &serde_json::json!({
          "properties": [
            { "property": "background-color", "value": "#000", "important": false },
            { "property": "padding", "value": "16px", "important": false }
          ]
        })
        .to_string(),
      )
      .unwrap();

    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyStyle {
      style: StyleDef {
        target: StyleTarget::Component { component_id: "hero-card".to_string() },
        properties: vec![StyleProperty {
          property: "background-color".to_string(),
          value: "#1a1a2e".to_string(),
          important: true,
        }],
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);

    let stored: serde_json::Value =
      serde_json::from_str(&storage.kv_get("style:component:hero-card").unwrap().unwrap()).unwrap();
    let props = stored["properties"].as_array().unwrap();
    assert_eq!(props.len(), 2);

    let bg = props.iter().find(|p| p["property"] == "background-color").unwrap();
    assert_eq!(bg["value"], "#1a1a2e");
    assert_eq!(bg["important"], true);

    let padding = props.iter().find(|p| p["property"] == "padding").unwrap();
    assert_eq!(padding["value"], "16px");
  }

  #[test]
  fn test_storage_executor_dry_run_modify_theme_not_found() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyTheme {
      theme_id: "nonexistent".to_string(),
      changes: ThemeChanges {
        name: Some("x".to_string()),
        colors: None,
        typography: None,
        spacing: None,
        border_radius: None,
      },
    };
    let result = executor.dry_run(&intent).unwrap();
    assert!(!result.success);
    assert!(result.message.contains("不存在"));
  }

  #[test]
  fn test_storage_executor_modify_style_css_variable() {
    let storage = SqliteStore::open_in_memory().unwrap();
    let mut executor = StorageExecutor::new(&storage);
    let intent = RetrofitIntent::ModifyStyle {
      style: StyleDef {
        target: StyleTarget::CssVariable { variable_name: "brand-color".to_string() },
        properties: vec![StyleProperty {
          property: "--brand-color".to_string(),
          value: "#6750A4".to_string(),
          important: false,
        }],
      },
    };
    let result = executor.execute(&intent).unwrap();
    assert!(result.success);

    let stored = storage.kv_get("style:css-var:brand-color").unwrap();
    assert!(stored.is_some());
  }
}
