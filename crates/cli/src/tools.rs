//! WorldSmith CLI 本地工具集（Phase F 迁移）
//!
//! 仅实现 CLI 场景可用的最小工具集（读/写/列目录/执行命令），
//! 与 Tauri 端 agent-commands 的工具集互补。LLM 通过 ReAct 循环调用这些工具。

use std::process::Command;

use agent_runtime::tool::{Tool, ToolError};
use async_trait::async_trait;
use serde_json::{json, Value};

fn str_arg(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::ArgsParse(format!("缺少字符串参数 `{key}`")))
}

/// 读取文件内容
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }
    fn description(&self) -> &str {
        "读取指定文件的文本内容，返回文件内容或错误信息"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件绝对路径或相对当前目录路径" }
            },
            "required": ["path"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let path = str_arg(&args, "path")?;
        match std::fs::read_to_string(&path) {
            Ok(content) => Ok(json!({ "ok": true, "content": content })),
            Err(e) => Err(ToolError::Execution(format!("读取失败 {path}: {e}"))),
        }
    }
}

/// 写入文件内容（自动创建父目录）
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }
    fn description(&self) -> &str {
        "将文本内容写入指定文件（覆盖写入，自动创建父目录）"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件绝对路径或相对当前目录路径" },
                "content": { "type": "string", "description": "要写入的文本内容" }
            },
            "required": ["path", "content"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let path = str_arg(&args, "path")?;
        let content = str_arg(&args, "content")?;
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        match std::fs::write(&path, content) {
            Ok(()) => Ok(json!({ "ok": true, "path": path })),
            Err(e) => Err(ToolError::Execution(format!("写入失败 {path}: {e}"))),
        }
    }
}

/// 列出目录内容
pub struct ListDirectoryTool;

#[async_trait]
impl Tool for ListDirectoryTool {
    fn name(&self) -> &str {
        "list_directory"
    }
    fn description(&self) -> &str {
        "列出指定目录下的条目（文件/子目录），返回名称与类型"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "目录路径（缺省为当前目录）" }
            }
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let path = args
            .get("path")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(".")
            .to_string();
        let entries = std::fs::read_dir(&path)
            .map_err(|e| ToolError::Execution(format!("读取目录失败 {path}: {e}")))?;
        let mut items = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            items.push(json!({ "name": name, "type": if is_dir { "dir" } else { "file" } }));
        }
        Ok(json!({ "ok": true, "path": path, "items": items }))
    }
}

/// 执行系统命令（本地自动化核心）
pub struct ExecuteCommandTool;

#[async_trait]
impl Tool for ExecuteCommandTool {
    fn name(&self) -> &str {
        "execute_command"
    }
    fn description(&self) -> &str {
        "在本地 Shell 中执行一条命令并返回标准输出与退出码（Windows 用 cmd，其他平台用 sh）"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "要执行的命令字符串" },
                "cwd": { "type": "string", "description": "工作目录（可选）" }
            },
            "required": ["command"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value, ToolError> {
        let command = str_arg(&args, "command")?;
        let cwd = args.get("cwd").and_then(|v| v.as_str()).filter(|s| !s.is_empty());
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", &command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &command]);
            c
        };
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) => return Err(ToolError::Execution(format!("命令启动失败: {e}"))),
        };
        Ok(json!({
            "ok": true,
            "exit_code": output.status.code(),
            "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
            "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        }))
    }
}

/// 组装 CLI 工具集（顺序即工具注册顺序）
pub fn build_cli_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(ReadFileTool),
        std::sync::Arc::new(WriteFileTool),
        std::sync::Arc::new(ListDirectoryTool),
        std::sync::Arc::new(ExecuteCommandTool),
    ]
}
