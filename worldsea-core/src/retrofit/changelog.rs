use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::retrofit::intent::RetrofitIntent;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeRecord {
  pub id: String,
  pub session_id: String,
  pub intent: RetrofitIntent,
  pub before: serde_json::Value,
  pub after: serde_json::Value,
  pub status: ChangeStatus,
  pub timestamp: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeStatus {
  Staged,
  Applied,
  RolledBack,
  Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeLog {
  pub session_id: String,
  pub records: Vec<ChangeRecord>,
}

impl ChangeLog {
  #[must_use]
  pub fn new(session_id: &str) -> Self {
    Self { session_id: session_id.to_string(), records: Vec::new() }
  }

  pub fn record_change(
    &mut self,
    intent: RetrofitIntent,
    before: serde_json::Value,
    after: serde_json::Value,
  ) -> String {
    let id = format!("ch-{}", self.records.len() + 1);
    let record = ChangeRecord {
      id: id.clone(),
      session_id: self.session_id.clone(),
      intent,
      before,
      after,
      status: ChangeStatus::Staged,
      timestamp: chrono_now(),
    };
    self.records.push(record);
    id
  }

  pub fn mark_applied(&mut self, change_id: &str) {
    if let Some(r) = self.records.iter_mut().find(|r| r.id == change_id) {
      r.status = ChangeStatus::Applied;
    }
  }

  pub fn mark_rolled_back(&mut self, change_id: &str) {
    if let Some(r) = self.records.iter_mut().find(|r| r.id == change_id) {
      r.status = ChangeStatus::RolledBack;
    }
  }

  pub fn mark_failed(&mut self, change_id: &str) {
    if let Some(r) = self.records.iter_mut().find(|r| r.id == change_id) {
      r.status = ChangeStatus::Failed;
    }
  }

  #[must_use]
  pub fn get_snapshot(&self, change_id: &str) -> Option<&ChangeRecord> {
    self.records.iter().find(|r| r.id == change_id)
  }

  #[must_use]
  pub fn applied_changes(&self) -> Vec<&ChangeRecord> {
    self.records.iter().filter(|r| r.status == ChangeStatus::Applied).collect()
  }

  #[must_use]
  pub fn staged_changes(&self) -> Vec<&ChangeRecord> {
    self.records.iter().filter(|r| r.status == ChangeStatus::Staged).collect()
  }

  /// # Errors
  /// 目标索引超出范围时返回空列表
  pub fn rollback_to(&mut self, target_index: usize) -> Result<Vec<String>, CoreError> {
    let total = self.records.len();
    let mut rolled_back = Vec::new();
    for i in (0..total).rev() {
      if i >= target_index && self.records[i].status == ChangeStatus::Applied {
        self.records[i].status = ChangeStatus::RolledBack;
        rolled_back.push(self.records[i].id.clone());
      }
    }
    Ok(rolled_back)
  }

  pub fn rollback_last(&mut self) -> Option<String> {
    for record in self.records.iter_mut().rev() {
      if record.status == ChangeStatus::Applied {
        record.status = ChangeStatus::RolledBack;
        return Some(record.id.clone());
      }
    }
    None
  }

  pub fn rollback_all(&mut self) -> Vec<String> {
    let mut rolled_back = Vec::new();
    for record in self.records.iter_mut().rev() {
      if record.status == ChangeStatus::Applied || record.status == ChangeStatus::Staged {
        record.status = ChangeStatus::RolledBack;
        rolled_back.push(record.id.clone());
      }
    }
    rolled_back
  }
}

fn chrono_now() -> String {
  let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
  format!("{}", now.as_millis())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::retrofit::intent::{FieldDef, FieldType};

  fn make_intent() -> RetrofitIntent {
    RetrofitIntent::AddField {
      entity_type: "character".to_string(),
      field: FieldDef {
        name: "strength".to_string(),
        field_type: FieldType::Number,
        label: "力量".to_string(),
        required: false,
        default_value: Some(serde_json::json!(10)),
        options: None,
      },
    }
  }

  #[test]
  fn test_record_change() {
    let mut log = ChangeLog::new("session-1");
    let id =
      log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({"strength": 10}));
    assert_eq!(id, "ch-1");
    assert_eq!(log.records.len(), 1);
    assert_eq!(log.records[0].status, ChangeStatus::Staged);
  }

  #[test]
  fn test_mark_applied() {
    let mut log = ChangeLog::new("session-1");
    let id = log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({}));
    log.mark_applied(&id);
    assert_eq!(log.records[0].status, ChangeStatus::Applied);
  }

  #[test]
  fn test_rollback_last() {
    let mut log = ChangeLog::new("session-1");
    let id1 = log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({}));
    let _id2 = log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({}));
    log.mark_applied(&id1);
    let rolled = log.rollback_last();
    assert!(rolled.is_some());
    assert_eq!(log.applied_changes().len(), 0);
  }

  #[test]
  fn test_rollback_all() {
    let mut log = ChangeLog::new("session-1");
    let id1 = log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({}));
    let _id2 = log.record_change(make_intent(), serde_json::json!({}), serde_json::json!({}));
    log.mark_applied(&id1);
    let rolled = log.rollback_all();
    assert_eq!(rolled.len(), 2);
  }

  #[test]
  fn test_get_snapshot() {
    let mut log = ChangeLog::new("session-1");
    let id = log.record_change(
      make_intent(),
      serde_json::json!({"before": true}),
      serde_json::json!({"after": true}),
    );
    let snap = log.get_snapshot(&id);
    assert!(snap.is_some());
    assert_eq!(snap.unwrap().before["before"], true);
  }
}
