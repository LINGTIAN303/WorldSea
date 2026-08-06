//! # 命令层错误
//!
//! 统一命令层错误类型，`serde::Serialize` 以便 Tauri 命令返回给前端。
//! 使用 tag + content 结构，前端可据此区分错误类型。

use agent_runtime::agent::AgentError;
use agent_runtime::memory::MemoryError;

/// 命令层错误
#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    #[error("会话不存在: {0}")]
    SessionNotFound(String),

    #[error("Agent 执行错误: {0}")]
    Agent(String),

    #[error("参数错误: {0}")]
    InvalidArgument(String),

    #[error("未找到: {0}")]
    NotFound(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl From<AgentError> for CommandError {
    fn from(err: AgentError) -> Self {
        CommandError::Agent(err.to_string())
    }
}

impl From<MemoryError> for CommandError {
    fn from(err: MemoryError) -> Self {
        CommandError::Internal(format!("记忆操作失败: {err}"))
    }
}

impl CommandError {
    /// 便捷构造：会话不存在
    pub fn session_not_found(id: impl Into<String>) -> Self {
        CommandError::SessionNotFound(id.into())
    }

    /// 便捷构造：参数错误
    pub fn invalid_argument(msg: impl Into<String>) -> Self {
        CommandError::InvalidArgument(msg.into())
    }
}

// 为了让 Tauri 命令能序列化错误，命令层返回 `CommandError` 时需实现 Serialize。
// `CommandError` 的 `thiserror` 只提供 Display，这里手动实现 serde 序列化。
impl serde::Serialize for CommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("CommandError", 2)?;
        s.serialize_field("type", &self.error_type())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl CommandError {
    /// 错误类型标签（供前端区分）
    fn error_type(&self) -> &'static str {
        match self {
            CommandError::SessionNotFound(_) => "session_not_found",
            CommandError::Agent(_) => "agent_error",
            CommandError::InvalidArgument(_) => "invalid_argument",
            CommandError::NotFound(_) => "not_found",
            CommandError::Internal(_) => "internal",
        }
    }
}