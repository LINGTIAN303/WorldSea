use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::retrofit::catalog::CapabilityCatalog;
use crate::retrofit::changelog::ChangeLog;
use crate::retrofit::intent::RetrofitIntent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionPhase {
  Negotiate,
  Staging,
  Applying,
  Verifying,
  Accept,
  Repair,
  Completed,
  Aborted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrofitSession {
  pub id: String,
  pub phase: SessionPhase,
  pub catalog: CapabilityCatalog,
  pub changelog: ChangeLog,
  pub pending_intents: Vec<RetrofitIntent>,
  pub confirmed_intents: Vec<RetrofitIntent>,
  pub current_intent_index: usize,
  pub user_message: Option<String>,
}

impl RetrofitSession {
  #[must_use]
  pub fn new(id: &str, catalog: CapabilityCatalog) -> Self {
    Self {
      id: id.to_string(),
      phase: SessionPhase::Negotiate,
      catalog,
      changelog: ChangeLog::new(id),
      pending_intents: Vec::new(),
      confirmed_intents: Vec::new(),
      current_intent_index: 0,
      user_message: None,
    }
  }

  /// # Errors
  /// 当前阶段不允许提交意图或意图被能力目录禁止时返回错误
  pub fn submit_intent(&mut self, intent: RetrofitIntent) -> Result<(), CoreError> {
    if self.phase != SessionPhase::Negotiate && self.phase != SessionPhase::Repair {
      return Err(CoreError::InvalidArgument(format!("当前阶段 {:?} 不允许提交意图", self.phase)));
    }

    let intent_type = intent.intent_type();
    if !self.catalog.is_allowed(intent_type) {
      return Err(CoreError::Validation(format!("意图类型 {intent_type:?} 被能力目录禁止")));
    }

    if self.changelog.records.len() + self.pending_intents.len()
      >= self.catalog.max_changes_per_session
    {
      return Err(CoreError::Validation(format!(
        "已达到单次改造最大变更数 {}",
        self.catalog.max_changes_per_session
      )));
    }

    self.validate_intent_against_catalog(&intent)?;

    self.pending_intents.push(intent);
    Ok(())
  }

  /// # Errors
  /// 当前阶段不允许确认意图或没有待确认的意图时返回错误
  pub fn confirm_intents(&mut self) -> Result<Vec<RetrofitIntent>, CoreError> {
    if self.phase != SessionPhase::Negotiate && self.phase != SessionPhase::Repair {
      return Err(CoreError::InvalidArgument(format!("当前阶段 {:?} 不允许确认意图", self.phase)));
    }

    if self.pending_intents.is_empty() {
      return Err(CoreError::Validation("没有待确认的意图".to_string()));
    }

    let confirmed: Vec<RetrofitIntent> = self.pending_intents.drain(..).collect();
    self.confirmed_intents.extend(confirmed.clone());
    self.phase = SessionPhase::Staging;
    Ok(confirmed)
  }

  /// # Errors
  /// 当前阶段不允许开始应用时返回错误
  pub fn start_applying(&mut self) -> Result<(), CoreError> {
    if self.phase != SessionPhase::Staging {
      return Err(CoreError::InvalidArgument(format!("当前阶段 {:?} 不允许开始应用", self.phase)));
    }
    self.phase = SessionPhase::Applying;
    self.current_intent_index = 0;
    Ok(())
  }

  pub fn next_intent(&mut self) -> Option<&RetrofitIntent> {
    if self.current_intent_index < self.confirmed_intents.len() {
      let intent = &self.confirmed_intents[self.current_intent_index];
      self.current_intent_index += 1;
      Some(intent)
    } else {
      None
    }
  }

  pub fn stage_change(
    &mut self,
    intent: &RetrofitIntent,
    before: serde_json::Value,
    after: serde_json::Value,
  ) -> String {
    self.changelog.record_change(intent.clone(), before, after)
  }

  pub fn mark_applied(&mut self, change_id: &str) {
    self.changelog.mark_applied(change_id);
  }

  pub fn mark_failed(&mut self, change_id: &str) {
    self.changelog.mark_failed(change_id);
  }

  pub const fn finish_applying(&mut self) {
    self.phase = SessionPhase::Verifying;
  }

  pub const fn accept(&mut self) {
    self.phase = SessionPhase::Completed;
  }

  pub fn request_repair(&mut self, message: &str) {
    self.phase = SessionPhase::Repair;
    self.current_intent_index = 0;
    self.user_message = Some(message.to_string());
  }

  /// # Errors
  /// 当前阶段不允许转向时返回错误
  pub fn redirect(&mut self, message: &str) -> Result<(), CoreError> {
    if self.phase != SessionPhase::Applying && self.phase != SessionPhase::Staging {
      return Err(CoreError::InvalidArgument(format!("当前阶段 {:?} 不允许转向", self.phase)));
    }
    self.phase = SessionPhase::Negotiate;
    self.confirmed_intents.clear();
    self.current_intent_index = 0;
    self.user_message = Some(message.to_string());
    Ok(())
  }

  pub fn abort(&mut self) -> Vec<String> {
    self.phase = SessionPhase::Aborted;
    self.changelog.rollback_all()
  }

  pub fn rollback_last(&mut self) -> Option<String> {
    self.changelog.rollback_last()
  }

  #[must_use]
  pub fn requires_confirmation(&self, intent: &RetrofitIntent) -> bool {
    self.catalog.requires_confirmation(intent.intent_type())
  }

  fn validate_intent_against_catalog(&self, intent: &RetrofitIntent) -> Result<(), CoreError> {
    match intent {
      RetrofitIntent::ModifyView { view_id, .. } | RetrofitIntent::RemoveView { view_id } => {
        if !self.catalog.is_view_id_allowed(view_id) {
          return Err(CoreError::Validation(format!("视图 ID '{view_id}' 不在允许修改的范围内")));
        }
      }
      RetrofitIntent::AddField { entity_type, .. }
      | RetrofitIntent::ModifyField { entity_type, .. }
      | RetrofitIntent::RemoveField { entity_type, .. }
      | RetrofitIntent::ModifySchema { entity_type, .. }
      | RetrofitIntent::AddView { entity_type, .. } => {
        if !self.catalog.is_entity_type_allowed(entity_type) {
          return Err(CoreError::Validation(format!(
            "实体类型 '{entity_type}' 不在允许修改的范围内"
          )));
        }
      }
      RetrofitIntent::AddEntityType { .. }
      | RetrofitIntent::RemoveEntityType { .. }
      | RetrofitIntent::AddRelationType { .. }
      | RetrofitIntent::ModifyRelationType { .. }
      | RetrofitIntent::RemoveRelationType { .. }
      | RetrofitIntent::AddAction { .. }
      | RetrofitIntent::ModifyAction { .. }
      | RetrofitIntent::RemoveAction { .. }
      | RetrofitIntent::SetTheme { .. }
      | RetrofitIntent::ModifyTheme { .. }
      | RetrofitIntent::ModifyLayout { .. }
      | RetrofitIntent::ModifyStyle { .. } => {}
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::retrofit::catalog::RetrofitIntentType;
  use crate::retrofit::intent::{FieldDef, FieldType};

  fn make_add_field_intent() -> RetrofitIntent {
    RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "strength".to_string(),
        field_type: FieldType::Number,
        label: "力量".to_string(),
        required: false,
        default_value: None,
        options: None,
      },
    }
  }

  fn make_remove_entity_type_intent() -> RetrofitIntent {
    RetrofitIntent::RemoveEntityType { type_name: "character".to_string() }
  }

  #[test]
  fn test_session_lifecycle() {
    let catalog = CapabilityCatalog::permissive();
    let mut session = RetrofitSession::new("s1", catalog);

    assert_eq!(session.phase, SessionPhase::Negotiate);

    session.submit_intent(make_add_field_intent()).unwrap();
    session.confirm_intents().unwrap();
    assert_eq!(session.phase, SessionPhase::Staging);

    session.start_applying().unwrap();
    assert_eq!(session.phase, SessionPhase::Applying);

    session.finish_applying();
    assert_eq!(session.phase, SessionPhase::Verifying);

    session.accept();
    assert_eq!(session.phase, SessionPhase::Completed);
  }

  #[test]
  fn test_submit_in_wrong_phase() {
    let catalog = CapabilityCatalog::permissive();
    let mut session = RetrofitSession::new("s1", catalog);
    session.phase = SessionPhase::Applying;
    let result = session.submit_intent(make_add_field_intent());
    assert!(result.is_err());
  }

  #[test]
  fn test_forbidden_intent() {
    let mut catalog = CapabilityCatalog::restrictive();
    catalog.forbidden.push(RetrofitIntentType::RemoveEntityType);
    let mut session = RetrofitSession::new("s1", catalog);
    let result = session.submit_intent(make_remove_entity_type_intent());
    assert!(result.is_err());
  }

  #[test]
  fn test_redirect() {
    let catalog = CapabilityCatalog::permissive();
    let mut session = RetrofitSession::new("s1", catalog);
    session.submit_intent(make_add_field_intent()).unwrap();
    session.confirm_intents().unwrap();
    session.start_applying().unwrap();
    session.redirect("我改主意了").unwrap();
    assert_eq!(session.phase, SessionPhase::Negotiate);
  }

  #[test]
  fn test_abort() {
    let catalog = CapabilityCatalog::permissive();
    let mut session = RetrofitSession::new("s1", catalog);
    session.submit_intent(make_add_field_intent()).unwrap();
    session.confirm_intents().unwrap();
    let rolled = session.abort();
    assert_eq!(session.phase, SessionPhase::Aborted);
    assert!(rolled.is_empty());
  }

  #[test]
  fn test_repair_flow() {
    let catalog = CapabilityCatalog::permissive();
    let mut session = RetrofitSession::new("s1", catalog);
    session.submit_intent(make_add_field_intent()).unwrap();
    session.confirm_intents().unwrap();
    session.start_applying().unwrap();
    session.finish_applying();
    session.request_repair("字段显示有问题");
    assert_eq!(session.phase, SessionPhase::Repair);
    session.submit_intent(make_add_field_intent()).unwrap();
  }

  #[test]
  fn test_max_changes_limit() {
    let mut catalog = CapabilityCatalog::permissive();
    catalog.max_changes_per_session = 1;
    let mut session = RetrofitSession::new("s1", catalog);
    session.submit_intent(make_add_field_intent()).unwrap();
    let result = session.submit_intent(make_add_field_intent());
    assert!(result.is_err());
  }

  #[test]
  fn test_requires_confirmation() {
    let catalog = CapabilityCatalog::permissive();
    let session = RetrofitSession::new("s1", catalog);
    assert!(
      session.requires_confirmation(&RetrofitIntent::RemoveView { view_id: "v1".to_string() })
    );
    assert!(!session.requires_confirmation(&make_add_field_intent()));
  }
}
