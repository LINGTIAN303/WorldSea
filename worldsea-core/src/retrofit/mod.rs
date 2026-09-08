use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::retrofit::catalog::CapabilityCatalog;
use crate::retrofit::executor::{
  ConflictReport, ExecutionResult, IntentConflictDetector, IntentExecutor, NoOpExecutor,
};
use crate::retrofit::guard::{HealthCheckPredicate, HealthCheckResult, SafetyGuard};
use crate::retrofit::intent::RetrofitIntent;
use crate::retrofit::session::{RetrofitSession, SessionPhase};

pub mod a2ui;
pub mod catalog;
pub mod changelog;
pub mod executor;
pub mod guard;
pub mod intent;
pub mod patch;
pub mod session;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrofitResult {
  pub session_id: String,
  pub phase: SessionPhase,
  pub changes_applied: usize,
  pub changes_rolled_back: usize,
  pub health_check: Option<HealthCheckResult>,
  pub execution_results: Vec<ExecutionResult>,
  pub message: String,
}

pub struct RetrofitEngine {
  session: Option<RetrofitSession>,
  guard: SafetyGuard,
  executor: Box<dyn IntentExecutor>,
  execution_results: Vec<ExecutionResult>,
}

impl Default for RetrofitEngine {
  fn default() -> Self {
    Self::new()
  }
}

impl RetrofitEngine {
  #[must_use]
  pub fn new() -> Self {
    Self {
      session: None,
      guard: SafetyGuard::new(CapabilityCatalog::permissive()),
      executor: Box::new(NoOpExecutor),
      execution_results: Vec::new(),
    }
  }

  #[must_use]
  pub fn with_executor(executor: Box<dyn IntentExecutor>) -> Self {
    Self {
      session: None,
      guard: SafetyGuard::new(CapabilityCatalog::permissive()),
      executor,
      execution_results: Vec::new(),
    }
  }

  /// # Errors
  /// 已有活跃会话时返回错误，需先 `end_session` 或 `abort`
  pub fn begin_session(
    &mut self,
    session_id: &str,
    catalog: CapabilityCatalog,
  ) -> Result<(), CoreError> {
    if self.session.is_some() {
      return Err(CoreError::InvalidArgument(
        "已有活跃的改造会话，请先 end_session 或 abort".to_string(),
      ));
    }
    let preserved_registry = {
      let placeholder = SafetyGuard::new(CapabilityCatalog::permissive());
      std::mem::replace(&mut self.guard, placeholder).into_registry()
    };
    self.guard = SafetyGuard::new_with_registry(catalog.clone(), preserved_registry);
    self.execution_results.clear();
    self.session = Some(RetrofitSession::new(session_id, catalog));
    Ok(())
  }

  /// # Errors
  /// 没有活跃的改造会话时返回错误
  pub fn submit_intent(
    &mut self,
    intent: RetrofitIntent,
  ) -> Result<crate::retrofit::guard::SafetyReport, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;

    let report = self.guard.validate_intent(&intent);
    if !report.allowed {
      return Ok(report);
    }

    session.submit_intent(intent)?;
    Ok(report)
  }

  #[must_use]
  pub fn detect_conflicts(&self) -> Option<ConflictReport> {
    self.session.as_ref().map(|s| IntentConflictDetector::detect(&s.pending_intents))
  }

  #[must_use]
  pub fn detect_conflicts_confirmed(&self) -> Option<ConflictReport> {
    self.session.as_ref().map(|s| IntentConflictDetector::detect(&s.confirmed_intents))
  }

  /// # Errors
  /// 没有活跃的改造会话时返回错误
  pub fn confirm_and_stage(&mut self) -> Result<ConfirmResult, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;

    let conflict_report = IntentConflictDetector::detect(&session.pending_intents);

    let confirmed = session.confirm_intents()?;

    Ok(ConfirmResult { confirmed_count: confirmed.len(), conflicts: conflict_report })
  }

  /// # Errors
  /// 没有活跃的改造会话或当前阶段不允许应用变更时返回错误
  pub fn apply_next(
    &mut self,
    before: serde_json::Value,
    after: serde_json::Value,
  ) -> Result<Option<ApplyResult>, CoreError> {
    let mut executor = std::mem::replace(&mut self.executor, Box::new(NoOpExecutor));
    let result = self.apply_next_with_executor(&mut *executor, before, after);
    self.executor = executor;
    result
  }

  /// # Errors
  /// 没有活跃的改造会话或当前阶段不允许应用变更时返回错误
  pub fn apply_next_with_executor(
    &mut self,
    executor: &mut dyn IntentExecutor,
    before: serde_json::Value,
    after: serde_json::Value,
  ) -> Result<Option<ApplyResult>, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;

    if session.phase == SessionPhase::Staging {
      session.start_applying()?;
    }

    if session.phase != SessionPhase::Applying {
      return Err(CoreError::InvalidArgument(format!(
        "当前阶段 {:?} 不允许应用变更",
        session.phase
      )));
    }

    let intent = session.next_intent().cloned();
    if let Some(intent) = intent {
      let change_id = session.stage_change(&intent, before, after);
      match executor.execute(&intent) {
        Ok(exec_result) => {
          if exec_result.success {
            session.mark_applied(&change_id);
          } else {
            session.mark_failed(&change_id);
          }
          let result = ApplyResult { change_id, execution: exec_result };
          self.execution_results.push(result.execution.clone());
          Ok(Some(result))
        }
        Err(e) => {
          session.mark_failed(&change_id);
          let exec_result = ExecutionResult {
            intent_id: format!("{:?}", intent.intent_type()),
            success: false,
            message: format!("执行失败: {e}"),
            side_effects: vec![],
          };
          self.execution_results.push(exec_result.clone());
          Ok(Some(ApplyResult { change_id, execution: exec_result }))
        }
      }
    } else {
      session.finish_applying();
      Ok(None)
    }
  }

  /// # Errors
  /// 没有活跃的改造会话或当前阶段不允许验收时返回错误
  pub fn verify_and_accept(
    &mut self,
    entity_count: usize,
    relation_count: usize,
  ) -> Result<RetrofitResult, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;

    if session.phase != SessionPhase::Verifying {
      return Err(CoreError::InvalidArgument(format!("当前阶段 {:?} 不允许验收", session.phase)));
    }

    let health = self.guard.post_check(&session.changelog, entity_count, relation_count);

    if !health.healthy {
      self.guard.auto_rollback(&mut session.changelog)?;
    }

    let applied = session.changelog.applied_changes().len();
    let rolled_back = session
      .changelog
      .records
      .iter()
      .filter(|r| matches!(r.status, crate::retrofit::changelog::ChangeStatus::RolledBack))
      .count();

    let results = self.execution_results.clone();
    session.accept();

    Ok(RetrofitResult {
      session_id: session.id.clone(),
      phase: SessionPhase::Completed,
      changes_applied: applied,
      changes_rolled_back: rolled_back,
      health_check: Some(health),
      execution_results: results,
      message: if applied == 0 && rolled_back > 0 {
        "改造完成（所有变更已自动回滚）".to_string()
      } else if rolled_back > 0 {
        format!("改造完成（{applied} 个变更保留，{rolled_back} 个变更已回滚）")
      } else {
        "改造完成".to_string()
      },
    })
  }

  /// # Errors
  /// 没有活跃的改造会话时返回错误
  pub fn request_repair(&mut self, message: &str) -> Result<(), CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;
    session.request_repair(message);
    Ok(())
  }

  /// # Errors
  /// 没有活跃的改造会话或当前阶段不允许转向时返回错误
  pub fn redirect(&mut self, message: &str) -> Result<(), CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;
    session.redirect(message)
  }

  /// # Errors
  /// 没有活跃的改造会话时返回错误
  pub fn rollback_last(&mut self) -> Result<Option<String>, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;
    Ok(session.rollback_last())
  }

  /// # Errors
  /// 没有活跃的改造会话时返回错误
  pub fn abort(&mut self) -> Result<Vec<String>, CoreError> {
    let session = self
      .session
      .as_mut()
      .ok_or_else(|| CoreError::InvalidArgument("没有活跃的改造会话".to_string()))?;
    Ok(session.abort())
  }

  #[must_use]
  pub const fn session(&self) -> Option<&RetrofitSession> {
    self.session.as_ref()
  }

  pub const fn session_mut(&mut self) -> Option<&mut RetrofitSession> {
    self.session.as_mut()
  }

  pub const fn end_session(&mut self) -> Option<RetrofitSession> {
    self.session.take()
  }

  pub fn register_health_check(&mut self, predicate: HealthCheckPredicate) {
    self.guard.register_health_check(predicate);
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmResult {
  pub confirmed_count: usize,
  pub conflicts: ConflictReport,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
  pub change_id: String,
  pub execution: ExecutionResult,
}

#[cfg(test)]
mod tests {
  use super::*;
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

  #[test]
  fn test_full_retrofit_lifecycle() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    let report = engine.submit_intent(make_add_field_intent()).unwrap();
    assert!(report.allowed);

    let confirm = engine.confirm_and_stage().unwrap();
    assert_eq!(confirm.confirmed_count, 1);

    let result =
      engine.apply_next(serde_json::json!({}), serde_json::json!({"strength": 10})).unwrap();
    assert!(result.is_some());
    assert!(result.unwrap().execution.success);

    let none = engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap();
    assert!(none.is_none());

    let verify = engine.verify_and_accept(10, 5).unwrap();
    assert_eq!(verify.phase, SessionPhase::Completed);
    assert_eq!(verify.changes_applied, 1);
    assert_eq!(verify.execution_results.len(), 1);
  }

  #[test]
  fn test_abort_lifecycle() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();

    let _rolled = engine.abort().unwrap();
    assert_eq!(engine.session().unwrap().phase, SessionPhase::Aborted);
  }

  #[test]
  fn test_redirect_lifecycle() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();
    engine.redirect("改主意了").unwrap();

    assert_eq!(engine.session().unwrap().phase, SessionPhase::Negotiate);
    assert!(engine.session().unwrap().confirmed_intents.is_empty());

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();
    while engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap().is_some() {}
    engine.verify_and_accept(10, 5).unwrap();
  }

  #[test]
  fn test_repair_lifecycle() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();
    while engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap().is_some() {}
    engine.request_repair("显示有问题").unwrap();

    assert_eq!(engine.session().unwrap().phase, SessionPhase::Repair);

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();
    while engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap().is_some() {}
    engine.verify_and_accept(10, 5).unwrap();
  }

  #[test]
  fn test_no_active_session() {
    let mut engine = RetrofitEngine::new();
    let result = engine.submit_intent(make_add_field_intent());
    assert!(result.is_err());
  }

  #[test]
  fn test_double_session_blocked() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("s1", CapabilityCatalog::permissive()).unwrap();
    let result = engine.begin_session("s2", CapabilityCatalog::permissive());
    assert!(result.is_err());
  }

  #[test]
  fn test_blocked_intent() {
    let mut catalog = CapabilityCatalog::restrictive();
    catalog.forbidden.push(crate::retrofit::catalog::RetrofitIntentType::RemoveEntityType);
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", catalog).unwrap();

    let report = engine
      .submit_intent(RetrofitIntent::RemoveEntityType { type_name: "character".to_string() })
      .unwrap();
    assert!(!report.allowed);
    assert!(report.blocked_reason.is_some());
  }

  #[test]
  fn test_conflict_detection() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine
      .submit_intent(RetrofitIntent::RemoveField {
        entity_type: "character".to_string(),
        field_name: "strength".to_string(),
      })
      .unwrap();

    let conflicts = engine.detect_conflicts().unwrap();
    assert!(conflicts.has_conflicts);
  }

  #[test]
  fn test_execution_results_tracked() {
    let mut engine = RetrofitEngine::new();
    engine.begin_session("test-session", CapabilityCatalog::permissive()).unwrap();

    engine.submit_intent(make_add_field_intent()).unwrap();
    engine.confirm_and_stage().unwrap();

    let apply = engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap();
    assert!(apply.is_some());
    assert!(apply.unwrap().execution.success);

    while engine.apply_next(serde_json::json!({}), serde_json::json!({})).unwrap().is_some() {}

    let result = engine.verify_and_accept(10, 5).unwrap();
    assert!(!result.execution_results.is_empty());
    assert!(result.execution_results[0].success);
  }
}
