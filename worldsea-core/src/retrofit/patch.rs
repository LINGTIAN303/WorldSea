use serde::{Deserialize, Serialize};

use crate::error::CoreError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum PatchOperation {
  Add { path: String, value: serde_json::Value },
  Remove { path: String },
  Replace { path: String, value: serde_json::Value },
  Move { from: String, path: String },
  Copy { from: String, path: String },
  Test { path: String, value: serde_json::Value },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonPatch {
  pub operations: Vec<PatchOperation>,
}

impl JsonPatch {
  #[must_use]
  pub const fn new() -> Self {
    Self { operations: Vec::new() }
  }

  #[must_use]
  pub const fn with_operations(operations: Vec<PatchOperation>) -> Self {
    Self { operations }
  }

  pub fn add(&mut self, path: impl Into<String>, value: serde_json::Value) {
    self.operations.push(PatchOperation::Add { path: path.into(), value });
  }

  pub fn remove(&mut self, path: impl Into<String>) {
    self.operations.push(PatchOperation::Remove { path: path.into() });
  }

  pub fn replace(&mut self, path: impl Into<String>, value: serde_json::Value) {
    self.operations.push(PatchOperation::Replace { path: path.into(), value });
  }

  #[must_use]
  pub const fn len(&self) -> usize {
    self.operations.len()
  }

  #[must_use]
  pub const fn is_empty(&self) -> bool {
    self.operations.is_empty()
  }

  /// # Errors
  /// 应用补丁失败时返回错误
  pub fn apply(&self, doc: &serde_json::Value) -> Result<serde_json::Value, CoreError> {
    let mut result = doc.clone();
    for (i, op) in self.operations.iter().enumerate() {
      result = Self::apply_one(op, result)
        .map_err(|e| CoreError::InvalidArgument(format!("操作 #{i} 失败: {e}")))?;
    }
    Ok(result)
  }

  fn apply_one(
    op: &PatchOperation,
    mut doc: serde_json::Value,
  ) -> Result<serde_json::Value, String> {
    match op {
      PatchOperation::Add { path, value } => {
        Self::set_at_pointer(&mut doc, path, value.clone())?;
        Ok(doc)
      }
      PatchOperation::Remove { path } => {
        Self::remove_at_pointer(&mut doc, path)?;
        Ok(doc)
      }
      PatchOperation::Replace { path, value } => {
        Self::get_at_pointer(&doc, path).ok_or_else(|| format!("路径 '{path}' 不存在"))?;
        Self::set_at_pointer(&mut doc, path, value.clone())?;
        Ok(doc)
      }
      PatchOperation::Move { from, path } => {
        let val = Self::get_at_pointer(&doc, from)
          .ok_or_else(|| format!("源路径 '{from}' 不存在"))?
          .clone();
        Self::remove_at_pointer(&mut doc, from)?;
        Self::set_at_pointer(&mut doc, path, val)?;
        Ok(doc)
      }
      PatchOperation::Copy { from, path } => {
        let val = Self::get_at_pointer(&doc, from)
          .ok_or_else(|| format!("源路径 '{from}' 不存在"))?
          .clone();
        Self::set_at_pointer(&mut doc, path, val)?;
        Ok(doc)
      }
      PatchOperation::Test { path, value } => {
        let actual =
          Self::get_at_pointer(&doc, path).ok_or_else(|| format!("路径 '{path}' 不存在"))?;
        if actual != value {
          return Err(format!("测试失败：路径 '{path}' 的值不匹配（期望 {value}，实际 {actual}）"));
        }
        Ok(doc)
      }
    }
  }

  fn parse_pointer(pointer: &str) -> Vec<String> {
    if pointer.is_empty() || pointer == "/" {
      return vec![String::new()];
    }
    let trimmed = pointer.strip_prefix('/').unwrap_or(pointer);
    trimmed.split('/').map(|s| s.replace("~1", "/").replace("~0", "~")).collect()
  }

  fn get_at_pointer<'a>(
    doc: &'a serde_json::Value,
    pointer: &str,
  ) -> Option<&'a serde_json::Value> {
    if pointer.is_empty() {
      return Some(doc);
    }
    let tokens = Self::parse_pointer(pointer);
    let mut current = doc;
    for token in &tokens {
      if token.is_empty() {
        continue;
      }
      match current {
        serde_json::Value::Object(map) => {
          current = map.get(token)?;
        }
        serde_json::Value::Array(arr) => {
          let idx: usize = token.parse().ok()?;
          current = arr.get(idx)?;
        }
        _ => return None,
      }
    }
    Some(current)
  }

  fn set_at_pointer(
    doc: &mut serde_json::Value,
    pointer: &str,
    value: serde_json::Value,
  ) -> Result<(), String> {
    if pointer.is_empty() {
      *doc = value;
      return Ok(());
    }
    let tokens = Self::parse_pointer(pointer);
    if tokens.is_empty() {
      return Err("空路径".to_string());
    }

    let mut current = doc;
    let last_idx = tokens.len() - 1;
    for (i, token) in tokens.iter().enumerate() {
      if i == last_idx {
        break;
      }
      if token.is_empty() {
        continue;
      }
      current = match current {
        serde_json::Value::Object(map) => {
          map.get_mut(token.as_str()).ok_or_else(|| format!("路径段 '{token}' 不存在"))?
        }
        serde_json::Value::Array(arr) => {
          let idx: usize = token.parse().map_err(|_| format!("无效数组索引 '{token}'"))?;
          arr.get_mut(idx).ok_or_else(|| format!("数组索引 {idx} 越界"))?
        }
        _ => return Err(format!("路径段 '{token}' 不是对象或数组")),
      };
    }

    let last_token = tokens.last().ok_or("空路径")?;
    match current {
      serde_json::Value::Object(map) => {
        map.insert(last_token.clone(), value);
        Ok(())
      }
      serde_json::Value::Array(arr) => {
        if last_token == "-" {
          arr.push(value);
        } else {
          let idx: usize =
            last_token.parse().map_err(|_| format!("无效数组索引 '{last_token}'"))?;
          if idx > arr.len() {
            return Err(format!("数组索引 {idx} 越界（长度 {}）", arr.len()));
          }
          arr.insert(idx, value);
        }
        Ok(())
      }
      _ => Err("目标不是对象或数组".to_string()),
    }
  }

  fn remove_at_pointer(doc: &mut serde_json::Value, pointer: &str) -> Result<(), String> {
    if pointer.is_empty() {
      *doc = serde_json::Value::Null;
      return Ok(());
    }
    let tokens = Self::parse_pointer(pointer);
    if tokens.is_empty() {
      return Err("空路径".to_string());
    }

    let mut current = doc;
    let last_idx = tokens.len() - 1;
    for (i, token) in tokens.iter().enumerate() {
      if i == last_idx {
        break;
      }
      if token.is_empty() {
        continue;
      }
      current = match current {
        serde_json::Value::Object(map) => {
          map.get_mut(token.as_str()).ok_or_else(|| format!("路径段 '{token}' 不存在"))?
        }
        serde_json::Value::Array(arr) => {
          let idx: usize = token.parse().map_err(|_| format!("无效数组索引 '{token}'"))?;
          arr.get_mut(idx).ok_or_else(|| format!("数组索引 {idx} 越界"))?
        }
        _ => return Err(format!("路径段 '{token}' 不是对象或数组")),
      };
    }

    let last_token = tokens.last().ok_or("空路径")?;
    match current {
      serde_json::Value::Object(map) => {
        map.remove(last_token.as_str()).ok_or_else(|| format!("键 '{last_token}' 不存在"))?;
        Ok(())
      }
      serde_json::Value::Array(arr) => {
        let idx: usize = last_token.parse().map_err(|_| format!("无效数组索引 '{last_token}'"))?;
        if idx >= arr.len() {
          return Err(format!("数组索引 {idx} 越界（长度 {}）", arr.len()));
        }
        arr.remove(idx);
        Ok(())
      }
      _ => Err("目标不是对象或数组".to_string()),
    }
  }
}

impl Default for JsonPatch {
  fn default() -> Self {
    Self::new()
  }
}

pub struct JsonPatchDiff;

impl JsonPatchDiff {
  #[must_use]
  pub fn diff(before: &serde_json::Value, after: &serde_json::Value) -> JsonPatch {
    let mut operations = Vec::new();
    Self::diff_recursive(before, after, String::new(), &mut operations);
    JsonPatch { operations }
  }

  fn diff_recursive(
    before: &serde_json::Value,
    after: &serde_json::Value,
    path: String,
    ops: &mut Vec<PatchOperation>,
  ) {
    if before == after {
      return;
    }

    match (before, after) {
      (serde_json::Value::Object(b_map), serde_json::Value::Object(a_map)) => {
        for key in b_map.keys() {
          let sub_path = format!("{path}/{key}");
          if let Some(a_val) = a_map.get(key) {
            if let Some(b_val) = b_map.get(key) {
              Self::diff_recursive(b_val, a_val, sub_path, ops);
            }
          } else {
            ops.push(PatchOperation::Remove { path: sub_path });
          }
        }
        for key in a_map.keys() {
          if !b_map.contains_key(key) {
            let sub_path = format!("{path}/{key}");
            ops.push(PatchOperation::Add { path: sub_path, value: a_map[key].clone() });
          }
        }
      }
      (serde_json::Value::Array(b_arr), serde_json::Value::Array(a_arr)) => {
        let max_len = b_arr.len().max(a_arr.len());
        for i in 0..max_len {
          let sub_path = format!("{path}/{i}");
          match (b_arr.get(i), a_arr.get(i)) {
            (Some(b_val), Some(a_val)) => {
              Self::diff_recursive(b_val, a_val, sub_path, ops);
            }
            (Some(_), None) => {
              ops.push(PatchOperation::Remove { path: sub_path });
            }
            (None, Some(a_val)) => {
              ops.push(PatchOperation::Add { path: sub_path, value: a_val.clone() });
            }
            (None, None) => {}
          }
        }
      }
      _ => {
        ops.push(PatchOperation::Replace {
          path: if path.is_empty() { String::new() } else { path },
          value: after.clone(),
        });
      }
    }
  }

  #[must_use]
  pub fn estimate_token_saving(
    before: &serde_json::Value,
    after: &serde_json::Value,
  ) -> TokenEstimate {
    let patch = Self::diff(before, after);
    let _before_tokens = Self::rough_token_count(before);
    let after_tokens = Self::rough_token_count(after);
    let patch_tokens = Self::rough_token_count(&serde_json::to_value(&patch).unwrap_or_default());

    TokenEstimate {
      full_send_tokens: after_tokens,
      patch_tokens,
      saved_tokens: after_tokens.saturating_sub(patch_tokens),
      saving_ratio: if after_tokens > 0 && patch_tokens < after_tokens {
        #[allow(clippy::cast_precision_loss)]
        {
          1.0 - (patch_tokens as f64 / after_tokens as f64)
        }
      } else {
        0.0
      },
      operation_count: patch.len(),
    }
  }

  fn rough_token_count(val: &serde_json::Value) -> usize {
    val.to_string().len() / 4
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenEstimate {
  pub full_send_tokens: usize,
  pub patch_tokens: usize,
  pub saved_tokens: usize,
  pub saving_ratio: f64,
  pub operation_count: usize,
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn test_patch_add() {
    let mut patch = JsonPatch::new();
    patch.add("/name", json!("Alice"));
    let doc = json!({});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["name"], "Alice");
  }

  #[test]
  fn test_patch_remove() {
    let mut patch = JsonPatch::new();
    patch.remove("/age");
    let doc = json!({"name": "Alice", "age": 30});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["name"], "Alice");
    assert!(result.get("age").is_none());
  }

  #[test]
  fn test_patch_replace() {
    let mut patch = JsonPatch::new();
    patch.replace("/age", json!(31));
    let doc = json!({"name": "Alice", "age": 30});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["age"], 31);
  }

  #[test]
  fn test_patch_move() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Move {
      from: "/old_name".to_string(),
      path: "/new_name".to_string(),
    }]);
    let doc = json!({"old_name": "Alice"});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["new_name"], "Alice");
    assert!(result.get("old_name").is_none());
  }

  #[test]
  fn test_patch_copy() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Copy {
      from: "/name".to_string(),
      path: "/alias".to_string(),
    }]);
    let doc = json!({"name": "Alice"});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["name"], "Alice");
    assert_eq!(result["alias"], "Alice");
  }

  #[test]
  fn test_patch_test_success() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Test {
      path: "/name".to_string(),
      value: json!("Alice"),
    }]);
    let doc = json!({"name": "Alice"});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["name"], "Alice");
  }

  #[test]
  fn test_patch_test_failure() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Test {
      path: "/name".to_string(),
      value: json!("Bob"),
    }]);
    let doc = json!({"name": "Alice"});
    let result = patch.apply(&doc);
    assert!(result.is_err());
  }

  #[test]
  fn test_patch_nested_path() {
    let mut patch = JsonPatch::new();
    patch.add("/user/profile/age", json!(25));
    let doc = json!({"user": {"profile": {}}});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["user"]["profile"]["age"], 25);
  }

  #[test]
  fn test_patch_array_add() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Add {
      path: "/items/-".to_string(),
      value: json!("new_item"),
    }]);
    let doc = json!({"items": ["a", "b"]});
    let result = patch.apply(&doc).unwrap();
    assert_eq!(result["items"].as_array().unwrap().len(), 3);
    assert_eq!(result["items"][2], "new_item");
  }

  #[test]
  fn test_diff_no_change() {
    let before = json!({"name": "Alice", "age": 30});
    let after = json!({"name": "Alice", "age": 30});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert!(patch.is_empty());
  }

  #[test]
  fn test_diff_simple_change() {
    let before = json!({"name": "Alice", "age": 30});
    let after = json!({"name": "Bob", "age": 30});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert_eq!(patch.len(), 1);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result["name"], "Bob");
  }

  #[test]
  fn test_diff_add_field() {
    let before = json!({"name": "Alice"});
    let after = json!({"name": "Alice", "age": 30});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert_eq!(patch.len(), 1);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result["age"], 30);
  }

  #[test]
  fn test_diff_remove_field() {
    let before = json!({"name": "Alice", "age": 30});
    let after = json!({"name": "Alice"});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert_eq!(patch.len(), 1);
    let result = patch.apply(&before).unwrap();
    assert!(result.get("age").is_none());
  }

  #[test]
  fn test_diff_nested() {
    let before = json!({"user": {"name": "Alice", "level": 1}});
    let after = json!({"user": {"name": "Alice", "level": 2}});
    let patch = JsonPatchDiff::diff(&before, &after);
    assert_eq!(patch.len(), 1);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result["user"]["level"], 2);
  }

  #[test]
  fn test_diff_array_change() {
    let before = json!({"items": ["a", "b", "c"]});
    let after = json!({"items": ["a", "x", "c"]});
    let patch = JsonPatchDiff::diff(&before, &after);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result["items"][1], "x");
  }

  #[test]
  fn test_diff_roundtrip() {
    let before = json!({
      "name": "WorldSea",
      "version": 1,
      "entities": [
        {"id": "e1", "type": "character"},
        {"id": "e2", "type": "location"}
      ],
      "settings": {
        "theme": "dark",
        "language": "zh"
      }
    });
    let after = json!({
      "name": "WorldSea Pro",
      "version": 2,
      "entities": [
        {"id": "e1", "type": "character"},
        {"id": "e2", "type": "faction"}
      ],
      "settings": {
        "theme": "light",
        "language": "zh",
        "autosave": true
      }
    });
    let patch = JsonPatchDiff::diff(&before, &after);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result, after);
  }

  #[test]
  fn test_token_estimate() {
    let before = json!({
      "entities": [
        {"id": "e1", "type": "character", "name": "Alice", "level": 5, "hp": 100},
        {"id": "e2", "type": "character", "name": "Bob", "level": 3, "hp": 80},
        {"id": "e3", "type": "location", "name": "Castle", "region": "north"}
      ],
      "settings": {"theme": "dark", "language": "zh", "autosave": false}
    });
    let after = json!({
      "entities": [
        {"id": "e1", "type": "character", "name": "Alice", "level": 6, "hp": 100},
        {"id": "e2", "type": "character", "name": "Bob", "level": 3, "hp": 80},
        {"id": "e3", "type": "location", "name": "Castle", "region": "north"}
      ],
      "settings": {"theme": "dark", "language": "zh", "autosave": false}
    });
    let estimate = JsonPatchDiff::estimate_token_saving(&before, &after);
    assert!(estimate.operation_count > 0);
    assert!(estimate.saving_ratio > 0.0);
  }

  #[test]
  fn test_patch_replace_nonexistent_fails() {
    let patch = JsonPatch::with_operations(vec![PatchOperation::Replace {
      path: "/missing".to_string(),
      value: json!("value"),
    }]);
    let doc = json!({});
    let result = patch.apply(&doc);
    assert!(result.is_err());
  }

  #[test]
  fn test_patch_remove_from_array() {
    let patch =
      JsonPatch::with_operations(vec![PatchOperation::Remove { path: "/items/1".to_string() }]);
    let doc = json!({"items": ["a", "b", "c"]});
    let result = patch.apply(&doc).unwrap();
    let arr = result["items"].as_array().unwrap();
    assert_eq!(arr.len(), 2);
    assert_eq!(arr[0], "a");
    assert_eq!(arr[1], "c");
  }

  #[test]
  fn test_diff_theme_change() {
    let before = json!({
      "colors": {"primary": "#000", "secondary": "#111"},
      "typography": {"fontFamily": "Roboto"},
      "borderRadius": "4px"
    });
    let after = json!({
      "colors": {"primary": "#6750A4", "secondary": "#111"},
      "typography": {"fontFamily": "Inter"},
      "borderRadius": "8px"
    });
    let patch = JsonPatchDiff::diff(&before, &after);
    let result = patch.apply(&before).unwrap();
    assert_eq!(result, after);
    assert!(patch.len() < 4);
  }
}
