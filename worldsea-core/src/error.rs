use serde::Serialize;
use thiserror::Error;

/// 核心错误类型，涵盖存储、序列化、验证、迁移等场景的错误
///
/// 支持 `std::error::Error::source()` 错误链传播，可通过 `.source()` 获取底层原始错误。
/// 所有变体均实现 `Serialize`，可直接在 Tauri Command 中作为错误类型返回。
#[derive(Debug, Error, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CoreError {
  /// 存储层操作失败
  #[error("存储错误: {message}")]
  Storage {
    /// 错误描述
    message: String,
  },

  /// 锁获取失败
  #[error("锁获取失败: {0}")]
  Lock(String),

  /// 序列化失败
  #[error("序列化失败: {message}")]
  Serialize {
    /// 错误描述
    message: String,
  },

  /// 反序列化失败
  #[error("反序列化失败: {message}")]
  Deserialize {
    /// 错误描述
    message: String,
  },

  /// 数据验证未通过
  #[error("验证失败: {0}")]
  Validation(String),

  /// 数据迁移失败
  #[error("迁移失败: {0}")]
  Migration(String),

  /// 资源未找到
  #[error("未找到: {0}")]
  NotFound(String),

  /// 参数不合法
  #[error("参数错误: {0}")]
  InvalidArgument(String),

  /// IO 操作失败
  #[error("IO 错误: {message}")]
  Io {
    /// 错误描述
    message: String,
  },

  /// Schema 操作失败
  #[error("Schema 错误: {0}")]
  SchemaError(String),
}

impl CoreError {
  /// 创建存储错误，支持格式化消息
  pub fn storage(msg: impl std::fmt::Display) -> Self {
    Self::Storage { message: msg.to_string() }
  }

  /// 创建序列化错误
  pub fn serialize(msg: impl std::fmt::Display) -> Self {
    Self::Serialize { message: msg.to_string() }
  }

  /// 创建反序列化错误
  pub fn deserialize(msg: impl std::fmt::Display) -> Self {
    Self::Deserialize { message: msg.to_string() }
  }

  /// 创建 IO 错误
  pub fn io(msg: impl std::fmt::Display) -> Self {
    Self::Io { message: msg.to_string() }
  }
}

impl From<serde_json::Error> for CoreError {
  fn from(e: serde_json::Error) -> Self {
    Self::Deserialize { message: e.to_string() }
  }
}

#[cfg(feature = "sqlite")]
impl From<rusqlite::Error> for CoreError {
  fn from(e: rusqlite::Error) -> Self {
    Self::Storage { message: e.to_string() }
  }
}

impl From<std::io::Error> for CoreError {
  fn from(e: std::io::Error) -> Self {
    Self::Io { message: e.to_string() }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_storage_helper() {
    let err = CoreError::storage("msg");
    match err {
      CoreError::Storage { message } => assert_eq!(message, "msg"),
      _ => panic!("expected Storage variant"),
    }
  }

  #[test]
  fn test_serialize_helper() {
    let err = CoreError::serialize("msg");
    match err {
      CoreError::Serialize { message } => assert_eq!(message, "msg"),
      _ => panic!("expected Serialize variant"),
    }
  }

  #[test]
  fn test_deserialize_helper() {
    let err = CoreError::deserialize("msg");
    match err {
      CoreError::Deserialize { message } => assert_eq!(message, "msg"),
      _ => panic!("expected Deserialize variant"),
    }
  }

  #[test]
  fn test_io_helper() {
    let err = CoreError::io("msg");
    match err {
      CoreError::Io { message } => assert_eq!(message, "msg"),
      _ => panic!("expected Io variant"),
    }
  }

  #[test]
  fn test_from_serde_json_error() {
    let json_err: serde_json::Error = serde_json::from_str::<i32>("not a number").unwrap_err();
    let core_err: CoreError = json_err.into();
    match core_err {
      CoreError::Deserialize { .. } => {}
      _ => panic!("expected Deserialize variant"),
    }
  }

  #[test]
  fn test_from_io_error() {
    let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
    let core_err: CoreError = io_err.into();
    match core_err {
      CoreError::Io { message } => assert!(message.contains("file missing")),
      _ => panic!("expected Io variant"),
    }
  }

  #[test]
  fn test_display_formatting() {
    assert_eq!(format!("{}", CoreError::storage("disk full")), "存储错误: disk full");
    assert_eq!(format!("{}", CoreError::Lock("timeout".to_string())), "锁获取失败: timeout");
    assert_eq!(format!("{}", CoreError::serialize("bad data")), "序列化失败: bad data");
    assert_eq!(format!("{}", CoreError::deserialize("bad json")), "反序列化失败: bad json");
    assert_eq!(format!("{}", CoreError::Validation("invalid".to_string())), "验证失败: invalid");
    assert_eq!(format!("{}", CoreError::Migration("stuck".to_string())), "迁移失败: stuck");
    assert_eq!(format!("{}", CoreError::NotFound("gone".to_string())), "未找到: gone");
    assert_eq!(format!("{}", CoreError::InvalidArgument("bad".to_string())), "参数错误: bad");
    assert_eq!(format!("{}", CoreError::io("read err")), "IO 错误: read err");
  }
}
