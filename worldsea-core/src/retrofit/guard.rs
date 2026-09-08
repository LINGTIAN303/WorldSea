use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::retrofit::catalog::CapabilityCatalog;
use crate::retrofit::changelog::{ChangeLog, ChangeStatus};
use crate::retrofit::intent::RetrofitIntent;

pub type HealthCheckPredicate = Box<dyn Fn(&ChangeLog, usize, usize) -> Vec<String> + Send + Sync>;

pub struct HealthCheckRegistry {
  predicates: Vec<HealthCheckPredicate>,
}

impl HealthCheckRegistry {
  #[must_use]
  pub fn new() -> Self {
    Self { predicates: Vec::new() }
  }

  pub fn register(&mut self, predicate: HealthCheckPredicate) {
    self.predicates.push(predicate);
  }

  #[must_use]
  pub fn run_all(
    &self,
    changelog: &ChangeLog,
    entity_count: usize,
    relation_count: usize,
  ) -> Vec<String> {
    let mut all_issues = Vec::new();
    for pred in &self.predicates {
      all_issues.extend(pred(changelog, entity_count, relation_count));
    }
    all_issues
  }
}

impl Default for HealthCheckRegistry {
  fn default() -> Self {
    let mut registry = Self::new();
    registry.register(Box::new(|changelog, _ec, _rc| {
      let failed_count =
        changelog.records.iter().filter(|r| r.status == ChangeStatus::Failed).count();
      if failed_count > 0 {
        vec![format!("有 {failed_count} 个变更失败")]
      } else {
        vec![]
      }
    }));
    registry.register(Box::new(|changelog, _ec, _rc| {
      let staged_count =
        changelog.records.iter().filter(|r| r.status == ChangeStatus::Staged).count();
      if staged_count > 0 {
        vec![format!("有 {staged_count} 个变更仍处于暂存状态")]
      } else {
        vec![]
      }
    }));
    registry.register(Box::new(|_changelog, ec, rc| {
      if ec == 0 && rc == 0 {
        vec!["实体和关系数量均为零，数据可能被意外清空".to_string()]
      } else {
        vec![]
      }
    }));
    registry
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyReport {
  pub allowed: bool,
  pub intent_type: String,
  pub warnings: Vec<String>,
  pub blocked_reason: Option<String>,
  pub pre_check_passed: bool,
  pub post_check_passed: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResult {
  pub healthy: bool,
  pub entity_count: usize,
  pub relation_count: usize,
  pub issues: Vec<String>,
}

pub struct SafetyGuard {
  catalog: CapabilityCatalog,
  health_registry: HealthCheckRegistry,
}

impl SafetyGuard {
  #[must_use]
  pub fn new(catalog: CapabilityCatalog) -> Self {
    Self { catalog, health_registry: HealthCheckRegistry::default() }
  }

  pub fn register_health_check(&mut self, predicate: HealthCheckPredicate) {
    self.health_registry.register(predicate);
  }

  #[must_use]
  pub fn into_registry(self) -> HealthCheckRegistry {
    self.health_registry
  }

  #[must_use]
  pub const fn new_with_registry(
    catalog: CapabilityCatalog,
    registry: HealthCheckRegistry,
  ) -> Self {
    Self { catalog, health_registry: registry }
  }

  #[must_use]
  pub fn validate_intent(&self, intent: &RetrofitIntent) -> SafetyReport {
    let intent_type = intent.intent_type();
    let type_name = format!("{intent_type:?}");

    if !self.catalog.is_allowed(intent_type) {
      return SafetyReport {
        allowed: false,
        intent_type: type_name,
        warnings: vec![],
        blocked_reason: Some(format!("意图类型 {intent_type:?} 被能力目录禁止")),
        pre_check_passed: false,
        post_check_passed: None,
      };
    }

    let mut warnings = Vec::new();

    if let Some(reason) = self.check_intent_specific_rules(intent) {
      return SafetyReport {
        allowed: false,
        intent_type: type_name,
        warnings,
        blocked_reason: Some(reason),
        pre_check_passed: false,
        post_check_passed: None,
      };
    }

    if self.catalog.requires_confirmation(intent_type) {
      warnings.push(format!("意图类型 {intent_type:?} 需要用户确认"));
    }

    Self::check_destructive_warnings(intent, &mut warnings);

    SafetyReport {
      allowed: true,
      intent_type: type_name,
      warnings,
      blocked_reason: None,
      pre_check_passed: true,
      post_check_passed: None,
    }
  }

  #[must_use]
  pub fn post_check(
    &self,
    changelog: &ChangeLog,
    entity_count: usize,
    relation_count: usize,
  ) -> HealthCheckResult {
    let issues = self.health_registry.run_all(changelog, entity_count, relation_count);
    HealthCheckResult { healthy: issues.is_empty(), entity_count, relation_count, issues }
  }

  /// # Errors
  /// 没有可回滚的变更时返回错误
  pub fn auto_rollback(&self, changelog: &mut ChangeLog) -> Result<Vec<String>, CoreError> {
    let rolled_back = changelog.rollback_all();
    if rolled_back.is_empty() {
      return Err(CoreError::Validation("没有可回滚的变更".to_string()));
    }
    Ok(rolled_back)
  }

  #[allow(clippy::too_many_lines)]
  fn check_intent_specific_rules(&self, intent: &RetrofitIntent) -> Option<String> {
    match intent {
      RetrofitIntent::AddField { entity_type, field } => {
        if entity_type.is_empty() {
          return Some("实体类型不能为空".to_string());
        }
        if field.name.is_empty() {
          return Some("字段名不能为空".to_string());
        }
        if !self.catalog.is_entity_type_allowed(entity_type) {
          return Some(format!("实体类型 '{entity_type}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::ModifyField { entity_type, field_name, .. }
      | RetrofitIntent::RemoveField { entity_type, field_name } => {
        if entity_type.is_empty() || field_name.is_empty() {
          return Some("实体类型和字段名不能为空".to_string());
        }
        if !self.catalog.is_entity_type_allowed(entity_type) {
          return Some(format!("实体类型 '{entity_type}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::ModifyView { view_id, .. } | RetrofitIntent::RemoveView { view_id } => {
        if view_id.is_empty() {
          return Some("视图 ID 不能为空".to_string());
        }
        if !self.catalog.is_view_id_allowed(view_id) {
          return Some(format!("视图 '{view_id}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::AddView { entity_type, view } => {
        if entity_type.is_empty() {
          return Some("实体类型不能为空".to_string());
        }
        if view.id.is_empty() {
          return Some("视图 ID 不能为空".to_string());
        }
        if !self.catalog.is_entity_type_allowed(entity_type) {
          return Some(format!("实体类型 '{entity_type}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::ModifySchema { entity_type, changes } => {
        if entity_type.is_empty() {
          return Some("实体类型不能为空".to_string());
        }
        if changes.add_fields.is_empty()
          && changes.remove_fields.is_empty()
          && changes.modify_fields.is_empty()
        {
          return Some("Schema 变更不能为空".to_string());
        }
        if !self.catalog.is_entity_type_allowed(entity_type) {
          return Some(format!("实体类型 '{entity_type}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::AddEntityType { type_name, fields } => {
        if type_name.is_empty() {
          return Some("类型名不能为空".to_string());
        }
        if fields.is_empty() {
          return Some("新实体类型至少需要一个字段".to_string());
        }
      }
      RetrofitIntent::RemoveEntityType { type_name } => {
        if type_name.is_empty() {
          return Some("类型名不能为空".to_string());
        }
      }
      RetrofitIntent::AddRelationType { type_name, source_types, target_types } => {
        if type_name.is_empty() {
          return Some("类型名不能为空".to_string());
        }
        if source_types.is_empty() || target_types.is_empty() {
          return Some("关系类型必须指定源类型和目标类型".to_string());
        }
        if !self.catalog.is_relation_type_allowed(type_name) {
          return Some(format!("关系类型 '{type_name}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::AddAction { action, .. } => {
        if action.id.is_empty() {
          return Some("行为 ID 不能为空".to_string());
        }
        let target_str = match &action.target_type {
          crate::retrofit::intent::ActionTarget::Entity { entity_type } => entity_type.clone(),
          crate::retrofit::intent::ActionTarget::Relation { relation_type } => {
            relation_type.clone()
          }
          crate::retrofit::intent::ActionTarget::Global => "global".to_string(),
        };
        if !self.catalog.is_action_target_allowed(&target_str) {
          return Some(format!("行为目标 '{target_str}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::RemoveAction { action_id }
      | RetrofitIntent::ModifyAction { action_id, .. } => {
        if action_id.is_empty() {
          return Some("行为 ID 不能为空".to_string());
        }
      }
      RetrofitIntent::RemoveRelationType { type_name }
      | RetrofitIntent::ModifyRelationType { type_name, .. } => {
        if type_name.is_empty() {
          return Some("类型名不能为空".to_string());
        }
        if !self.catalog.is_relation_type_allowed(type_name) {
          return Some(format!("关系类型 '{type_name}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::SetTheme { theme } => {
        if theme.id.is_empty() {
          return Some("主题 ID 不能为空".to_string());
        }
        if theme.colors.primary.is_empty() || theme.colors.background.is_empty() {
          return Some("主题必须指定 primary 和 background 颜色".to_string());
        }
      }
      RetrofitIntent::ModifyTheme { theme_id, .. } => {
        if theme_id.is_empty() {
          return Some("主题 ID 不能为空".to_string());
        }
      }
      RetrofitIntent::ModifyLayout { layout } => {
        if layout.id.is_empty() {
          return Some("布局 ID 不能为空".to_string());
        }
        let target_str = match &layout.target {
          crate::retrofit::intent::LayoutTarget::Page { page_id } => format!("page:{page_id}"),
          crate::retrofit::intent::LayoutTarget::Panel { panel_id } => format!("panel:{panel_id}"),
          crate::retrofit::intent::LayoutTarget::Component { component_id } => {
            format!("component:{component_id}")
          }
          crate::retrofit::intent::LayoutTarget::Global => "global".to_string(),
        };
        if !self.catalog.is_layout_target_allowed(&target_str) {
          return Some(format!("布局目标 '{target_str}' 不在允许修改的范围内"));
        }
      }
      RetrofitIntent::ModifyStyle { style } => {
        for prop in &style.properties {
          if !self.catalog.is_css_property_allowed(&prop.property) {
            return Some(format!("CSS 属性 '{}' 不在允许修改的白名单中", prop.property));
          }
        }
        if let crate::retrofit::intent::StyleTarget::CssVariable { variable_name } = &style.target {
          if variable_name.is_empty() {
            return Some("CSS 变量名不能为空".to_string());
          }
        }
      }
    }
    None
  }

  fn check_destructive_warnings(intent: &RetrofitIntent, warnings: &mut Vec<String>) {
    match intent {
      RetrofitIntent::RemoveField { field_name, entity_type } => {
        warnings
          .push(format!("删除字段 '{field_name}' 将影响实体类型 '{entity_type}' 的所有现有数据"));
      }
      RetrofitIntent::RemoveEntityType { type_name } => {
        warnings.push(format!("删除实体类型 '{type_name}' 将永久丢失该类型的所有实体数据"));
      }
      RetrofitIntent::RemoveRelationType { type_name } => {
        warnings.push(format!("删除关系类型 '{type_name}' 将永久丢失该类型的所有关系数据"));
      }
      RetrofitIntent::RemoveView { view_id } => {
        warnings.push(format!("删除视图 '{view_id}' 不可恢复"));
      }
      RetrofitIntent::SetTheme { theme } => {
        warnings.push(format!("设置主题 '{}' 将替换当前全局主题", theme.id));
      }
      RetrofitIntent::ModifyLayout { layout } => {
        warnings.push(format!("修改布局 '{}' 可能影响现有界面结构", layout.id));
      }
      _ => {}
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::retrofit::catalog::RetrofitIntentType;
  use crate::retrofit::intent::{FieldDef, FieldType, ViewDef, ViewLayout};

  fn make_guard() -> SafetyGuard {
    SafetyGuard::new(CapabilityCatalog::permissive())
  }

  #[test]
  fn test_validate_allowed_intent() {
    let guard = make_guard();
    let intent = RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "strength".to_string(),
        field_type: FieldType::Number,
        label: "力量".to_string(),
        required: false,
        default_value: None,
        options: None,
      },
    };
    let report = guard.validate_intent(&intent);
    assert!(report.allowed);
    assert!(report.pre_check_passed);
  }

  #[test]
  fn test_validate_blocked_intent() {
    let mut catalog = CapabilityCatalog::restrictive();
    catalog.forbidden.push(RetrofitIntentType::AddEntityType);
    let guard = SafetyGuard::new(catalog);
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
    let report = guard.validate_intent(&intent);
    assert!(!report.allowed);
    assert!(report.blocked_reason.is_some());
  }

  #[test]
  fn test_validate_empty_field_name() {
    let guard = make_guard();
    let intent = RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "".to_string(),
        field_type: FieldType::Text,
        label: "名称".to_string(),
        required: false,
        default_value: None,
        options: None,
      },
    };
    let report = guard.validate_intent(&intent);
    assert!(!report.allowed);
  }

  #[test]
  fn test_destructive_warning() {
    let guard = make_guard();
    let intent = RetrofitIntent::RemoveField {
      entity_type: "character".to_string(),
      field_name: "strength".to_string(),
    };
    let report = guard.validate_intent(&intent);
    assert!(report.allowed);
    assert!(!report.warnings.is_empty());
  }

  #[test]
  fn test_post_check_healthy() {
    let guard = make_guard();
    let changelog = ChangeLog::new("s1");
    let result = guard.post_check(&changelog, 10, 5);
    assert!(result.healthy);
    assert!(result.issues.is_empty());
  }

  #[test]
  fn test_post_check_unhealthy() {
    let guard = make_guard();
    let changelog = ChangeLog::new("s1");
    let result = guard.post_check(&changelog, 0, 0);
    assert!(!result.healthy);
    assert!(!result.issues.is_empty());
  }

  #[test]
  fn test_auto_rollback() {
    let guard = make_guard();
    let mut changelog = ChangeLog::new("s1");
    let intent = RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "str".to_string(),
        field_type: FieldType::Number,
        label: "力量".to_string(),
        required: false,
        default_value: None,
        options: None,
      },
    };
    let id = changelog.record_change(intent, serde_json::json!({}), serde_json::json!({}));
    changelog.mark_applied(&id);
    let rolled = guard.auto_rollback(&mut changelog).unwrap();
    assert_eq!(rolled.len(), 1);
  }

  #[test]
  fn test_auto_rollback_empty() {
    let guard = make_guard();
    let mut changelog = ChangeLog::new("s1");
    let result = guard.auto_rollback(&mut changelog);
    assert!(result.is_err());
  }

  #[test]
  fn test_add_view_validation() {
    let guard = make_guard();
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
    let report = guard.validate_intent(&intent);
    assert!(report.allowed);
  }

  #[test]
  fn test_add_relation_type_validation() {
    let guard = make_guard();
    let intent = RetrofitIntent::AddRelationType {
      type_name: "ally".to_string(),
      source_types: vec!["character".to_string()],
      target_types: vec!["character".to_string()],
    };
    let report = guard.validate_intent(&intent);
    assert!(report.allowed);
  }

  #[test]
  fn test_empty_relation_type_rejected() {
    let guard = make_guard();
    let intent = RetrofitIntent::AddRelationType {
      type_name: "".to_string(),
      source_types: vec![],
      target_types: vec![],
    };
    let report = guard.validate_intent(&intent);
    assert!(!report.allowed);
  }
}
