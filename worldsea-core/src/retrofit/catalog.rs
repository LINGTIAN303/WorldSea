use serde::{Deserialize, Serialize};

use crate::retrofit::intent::RetrofitIntent;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityCatalog {
  pub allowed_view_ids: Vec<String>,
  pub allowed_entity_types: Vec<String>,
  pub allowed_relation_types: Vec<String>,
  pub allowed_field_modifications: Vec<String>,
  pub allowed_action_targets: Vec<String>,
  pub allowed_css_properties: Vec<String>,
  pub allowed_layout_targets: Vec<String>,
  pub max_changes_per_session: usize,
  pub requires_confirmation: Vec<RetrofitIntentType>,
  pub forbidden: Vec<RetrofitIntentType>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RetrofitIntentType {
  AddView,
  ModifyView,
  RemoveView,
  AddField,
  ModifyField,
  RemoveField,
  AddAction,
  ModifyAction,
  RemoveAction,
  ModifySchema,
  AddEntityType,
  RemoveEntityType,
  AddRelationType,
  ModifyRelationType,
  RemoveRelationType,
  SetTheme,
  ModifyTheme,
  ModifyLayout,
  ModifyStyle,
}

impl CapabilityCatalog {
  #[must_use]
  pub fn permissive() -> Self {
    Self {
      allowed_view_ids: vec!["*".to_string()],
      allowed_entity_types: vec!["*".to_string()],
      allowed_relation_types: vec!["*".to_string()],
      allowed_field_modifications: vec!["*".to_string()],
      allowed_action_targets: vec!["*".to_string()],
      allowed_css_properties: vec!["*".to_string()],
      allowed_layout_targets: vec!["*".to_string()],
      max_changes_per_session: 100,
      requires_confirmation: vec![
        RetrofitIntentType::RemoveView,
        RetrofitIntentType::RemoveField,
        RetrofitIntentType::RemoveEntityType,
        RetrofitIntentType::RemoveRelationType,
        RetrofitIntentType::ModifySchema,
        RetrofitIntentType::ModifyAction,
        RetrofitIntentType::ModifyRelationType,
        RetrofitIntentType::SetTheme,
        RetrofitIntentType::ModifyLayout,
      ],
      forbidden: vec![],
    }
  }

  #[must_use]
  pub fn restrictive() -> Self {
    Self {
      allowed_view_ids: vec![],
      allowed_entity_types: vec![],
      allowed_relation_types: vec![],
      allowed_field_modifications: vec![],
      allowed_action_targets: vec![],
      allowed_css_properties: vec![],
      allowed_layout_targets: vec![],
      max_changes_per_session: 10,
      requires_confirmation: vec![
        RetrofitIntentType::AddView,
        RetrofitIntentType::ModifyView,
        RetrofitIntentType::RemoveView,
        RetrofitIntentType::AddField,
        RetrofitIntentType::ModifyField,
        RetrofitIntentType::RemoveField,
        RetrofitIntentType::AddAction,
        RetrofitIntentType::ModifyAction,
        RetrofitIntentType::RemoveAction,
        RetrofitIntentType::ModifySchema,
        RetrofitIntentType::AddEntityType,
        RetrofitIntentType::RemoveEntityType,
        RetrofitIntentType::AddRelationType,
        RetrofitIntentType::ModifyRelationType,
        RetrofitIntentType::RemoveRelationType,
        RetrofitIntentType::SetTheme,
        RetrofitIntentType::ModifyTheme,
        RetrofitIntentType::ModifyLayout,
        RetrofitIntentType::ModifyStyle,
      ],
      forbidden: vec![
        RetrofitIntentType::RemoveEntityType,
        RetrofitIntentType::RemoveRelationType,
        RetrofitIntentType::SetTheme,
      ],
    }
  }

  #[must_use]
  pub fn is_allowed(&self, intent_type: RetrofitIntentType) -> bool {
    !self.forbidden.contains(&intent_type)
  }

  #[must_use]
  pub fn requires_confirmation(&self, intent_type: RetrofitIntentType) -> bool {
    self.requires_confirmation.contains(&intent_type)
  }

  #[must_use]
  pub fn is_entity_type_allowed(&self, entity_type: &str) -> bool {
    self.allowed_entity_types.contains(&"*".to_string())
      || self.allowed_entity_types.contains(&entity_type.to_string())
  }

  #[must_use]
  pub fn is_view_id_allowed(&self, view_id: &str) -> bool {
    self.allowed_view_ids.contains(&"*".to_string())
      || self.allowed_view_ids.contains(&view_id.to_string())
  }

  #[must_use]
  pub fn is_relation_type_allowed(&self, relation_type: &str) -> bool {
    self.allowed_relation_types.contains(&"*".to_string())
      || self.allowed_relation_types.contains(&relation_type.to_string())
  }

  #[must_use]
  pub fn is_field_modification_allowed(&self, field_name: &str) -> bool {
    self.allowed_field_modifications.contains(&"*".to_string())
      || self.allowed_field_modifications.contains(&field_name.to_string())
  }

  #[must_use]
  pub fn is_action_target_allowed(&self, target: &str) -> bool {
    self.allowed_action_targets.contains(&"*".to_string())
      || self.allowed_action_targets.contains(&target.to_string())
  }

  #[must_use]
  pub fn is_css_property_allowed(&self, property: &str) -> bool {
    self.allowed_css_properties.contains(&"*".to_string())
      || self.allowed_css_properties.contains(&property.to_string())
  }

  #[must_use]
  pub fn is_layout_target_allowed(&self, target: &str) -> bool {
    self.allowed_layout_targets.contains(&"*".to_string())
      || self.allowed_layout_targets.contains(&target.to_string())
  }
}

impl RetrofitIntent {
  #[must_use]
  pub const fn intent_type(&self) -> RetrofitIntentType {
    match self {
      Self::AddView { .. } => RetrofitIntentType::AddView,
      Self::ModifyView { .. } => RetrofitIntentType::ModifyView,
      Self::RemoveView { .. } => RetrofitIntentType::RemoveView,
      Self::AddField { .. } => RetrofitIntentType::AddField,
      Self::ModifyField { .. } => RetrofitIntentType::ModifyField,
      Self::RemoveField { .. } => RetrofitIntentType::RemoveField,
      Self::AddAction { .. } => RetrofitIntentType::AddAction,
      Self::ModifyAction { .. } => RetrofitIntentType::ModifyAction,
      Self::RemoveAction { .. } => RetrofitIntentType::RemoveAction,
      Self::ModifySchema { .. } => RetrofitIntentType::ModifySchema,
      Self::AddEntityType { .. } => RetrofitIntentType::AddEntityType,
      Self::RemoveEntityType { .. } => RetrofitIntentType::RemoveEntityType,
      Self::AddRelationType { .. } => RetrofitIntentType::AddRelationType,
      Self::ModifyRelationType { .. } => RetrofitIntentType::ModifyRelationType,
      Self::RemoveRelationType { .. } => RetrofitIntentType::RemoveRelationType,
      Self::SetTheme { .. } => RetrofitIntentType::SetTheme,
      Self::ModifyTheme { .. } => RetrofitIntentType::ModifyTheme,
      Self::ModifyLayout { .. } => RetrofitIntentType::ModifyLayout,
      Self::ModifyStyle { .. } => RetrofitIntentType::ModifyStyle,
    }
  }
}
