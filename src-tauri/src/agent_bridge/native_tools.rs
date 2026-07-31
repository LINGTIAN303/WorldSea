//! # Native Tools — Rust 原生实现的 IO 工具集合
//!
//! 阶段 P0-A2 新增。本模块提供一组基础 IO 工具的 Rust 原生实现，
//! 注册到 `ToolBus` 供 `AgentLoop` 在 ReAct 循环中调用。
//!
//! ## 设计原则
//! - **混合桥接策略**：基础 IO 工具（fs/file 等）用 Rust 原生实现，业务工具（entity/kb/schema/ui 等）
//!   通过 `FrontendToolBridge` 反向调用前端 TS 实现
//! - **路径校验**：所有文件系统操作走 `tauri::path::PathResolver` 限制在工作区目录内，防止越权访问
//! - **错误友好**：工具错误统一封装为 `ToolError::Execution`，前端能拿到可读错误信息
//! - **JSON Schema 规范**：参数定义严格遵循 OpenAI/Anthropic 工具规范
//!
//! ## 工具清单
//! | 工具名 | 说明 | Rust 原生 / 前端桥接 |
//! |--------|------|---------------------|
//! | `read_file` | 读取文本文件 | Rust 原生 |
//! | `write_file` | 写入文本文件 | Rust 原生 |
//! | `list_dir` | 列出目录内容 | Rust 原生 |
//! | `mkdir` | 创建目录 | Rust 原生 |
//! | `delete_file` | 删除文件或空目录 | Rust 原生 |
//! | `file_stat` | 获取文件元信息 | Rust 原生 |
//! | `entity_create` | 创建实体 | 前端桥接（调用 entityStore） |
//! | `entity_get` | 获取实体 | 前端桥接 |
//! | `entity_list` | 列出实体 | 前端桥接 |
//! | `entity_update` | 更新实体 | 前端桥接 |
//! | `entity_delete` | 删除实体 | 前端桥接 |
//! | `kb_search` | 知识库检索 | 前端桥接 |
//! | `kb_write` | 写入知识库 | 前端桥接 |
//! | `ui_notify` | UI 通知 | 前端桥接 |
//! | `ui_toast` | UI Toast 提示 | 前端桥接 |
//! | `ui_create_surface` | A2UI 创建画布（P2）| 前端桥接 |
//! | `ui_update_components` | A2UI 更新组件（P2）| 前端桥接 |
//! | `ui_update_data` | A2UI 更新数据模型（P2）| 前端桥接 |
//! | `ui_delete_surface` | A2UI 删除画布（P2）| 前端桥接 |
//! | `a2ui_show_entity` | A2UI 展示实体卡片（P2）| 前端桥接 |
//! | `a2ui_show_relation` | A2UI 展示关系详情（P2）| 前端桥接 |

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::Deserialize;
use tracing::{debug, warn};

use agent_runtime::tool::{Tool, ToolDefinition, ToolError, ToolBus};

use crate::agent_bridge::tool_bridge::{FrontendTool, FrontendToolBridge};

// ─── register_default_tools ────────────────────────────────────────────

/// 注册默认工具集（native + frontend）到 ToolBus
///
/// 在 `cmd_agent_create` 中调用，每个 Agent 会话都拥有完整的工具集。
///
/// # 参数
/// - `tool_bus`: 工具总线（Arc 共享，AgentLoop 持有同一引用）
/// - `bridge`: 前端工具桥接器（用于 frontend 工具反向调用前端 TS 实现）
pub async fn register_default_tools(
    tool_bus: &Arc<dyn ToolBus>,
    bridge: &Arc<FrontendToolBridge>,
) {
    // ─── Rust 原生 IO 工具 ───────────────────────────────────
    register_native_io_tools(tool_bus).await;

    // ─── 前端业务工具（通过 FrontendToolBridge 反向调用 TS 实现） ─
    register_frontend_tools(tool_bus, bridge).await;
}

/// 注册 Rust 原生 IO 工具
async fn register_native_io_tools(tool_bus: &Arc<dyn ToolBus>) {
    let tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(ReadFileTool),
        Arc::new(WriteFileTool),
        Arc::new(ListDirTool),
        Arc::new(MkdirTool),
        Arc::new(DeleteFileTool),
        Arc::new(FileStatTool),
    ];
    for tool in tools {
        debug!("注册 native 工具: {}", tool.name());
        tool_bus.register(tool).await;
    }
}

/// 注册前端业务工具（通过 FrontendToolBridge 反向调用 TS 实现）
async fn register_frontend_tools(
    tool_bus: &Arc<dyn ToolBus>,
    bridge: &Arc<FrontendToolBridge>,
) {
    // 工具定义：(name, description, parameters_json_schema)
    //
    // ⚠️ 字段名必须与 TS 端 `worldsmith-agent/src/tools/entity-crud.ts` 和 `kb-tools.ts`
    //    中工具期望的参数名**完全一致**，前端桥接监听器零映射透传 args。
    //    详见 P0-A3 实施记录。
    let definitions: Vec<(&str, &str, serde_json::Value)> = vec![
        (
            "entity_create",
            "创建一个新实体（角色/地点/物品/事件等）。调用前端 entityStore 写入 SQLite。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "type": { "type": "string", "description": "实体类型 ID（如 character/location/item/event）" },
                    "name": { "type": "string", "description": "实体名称" },
                    "description": { "type": "string", "description": "实体描述（可选）" },
                    "properties": { "type": "object", "description": "实体属性数据（可选，键值对）" }
                },
                "required": ["type", "name"]
            }),
        ),
        (
            "entity_get",
            "根据 ID 获取实体详情。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "实体 UUID" }
                },
                "required": ["id"]
            }),
        ),
        (
            "entity_list",
            "列出指定类型的所有实体（不传 type 则列出全部）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "type": { "type": "string", "description": "实体类型 ID（可选）" },
                    "keyword": { "type": "string", "description": "名称模糊匹配关键词（可选）" },
                    "limit": { "type": "integer", "description": "返回上限（可选，默认 50）" }
                }
            }),
        ),
        (
            "entity_update",
            "更新实体属性（部分更新，仅传入的字段会被更新）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "实体 UUID" },
                    "name": { "type": "string", "description": "新名称（可选）" },
                    "description": { "type": "string", "description": "新描述（可选）" },
                    "properties": { "type": "object", "description": "要更新的属性键值对（可选，会与现有属性合并）" }
                },
                "required": ["id"]
            }),
        ),
        (
            "entity_delete",
            "删除实体（级联删除其关系）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "实体 UUID" }
                },
                "required": ["id"]
            }),
        ),
        (
            "kb_search",
            "在知识库中检索相关条目（混合检索：向量 + 关键词）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "检索查询文本" },
                    "scope": { "type": "string", "enum": ["global", "project"], "description": "检索范围（可选，默认全部）" },
                    "mode": { "type": "string", "enum": ["hybrid", "keyword", "semantic"], "description": "检索模式（可选，默认 hybrid）" },
                    "limit": { "type": "integer", "description": "返回条目数（可选，默认 5）" }
                },
                "required": ["query"]
            }),
        ),
        (
            "kb_write",
            "写入或更新知识库条目（按 path 定位，存在则更新）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "条目路径（如 profile/preferences.md）" },
                    "content": { "type": "string", "description": "条目内容（Markdown）" },
                    "scope": { "type": "string", "enum": ["global", "project"], "description": "存储范围（可选，默认 global）" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "标签列表（可选）" },
                    "entityId": { "type": "string", "description": "关联实体 ID（可选）" },
                    "summary": { "type": "string", "description": "条目摘要（可选，用于检索展示）" }
                },
                "required": ["path", "content"]
            }),
        ),
        (
            "ui_notify",
            "向用户显示桌面通知（标题 + 内容，停留时间较长）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "通知标题" },
                    "message": { "type": "string", "description": "通知内容" },
                    "type": { "type": "string", "enum": ["info", "success", "warning", "error"], "description": "通知类型（默认 info）" }
                },
                "required": ["title", "message"]
            }),
        ),
        (
            "ui_toast",
            "显示 Toast 短暂提示（轻量级，自动消失）。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string", "description": "提示内容" },
                    "type": { "type": "string", "enum": ["info", "success", "warning", "error"], "description": "提示类型（默认 info）" }
                },
                "required": ["message"]
            }),
        ),
        // ─── A2UI 工具（P2 新增） ───────────────────────────────────
        // 与 TS 端 `worldsmith-agent/src/tools/a2ui-tools.ts` 和 `a2ui-helpers.ts`
        // 的参数名保持一致（camelCase），前端桥接监听器零映射透传 args。
        (
            "ui_create_surface",
            "创建一个交互式 UI 画布，用于展示表单、卡片、数据面板等。返回 surfaceId。使用场景：需要向用户展示结构化信息、收集用户输入、创建交互式操作界面。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "surfaceId": { "type": "string", "description": "画布唯一标识，如 \"entity-card-1\"、\"search-results\"" },
                    "catalogId": { "type": "string", "description": "组件目录 ID（可选，默认使用 WorldSmith 目录）" }
                },
                "required": ["surfaceId"]
            }),
        ),
        (
            "ui_update_components",
            "定义画布上的 UI 组件布局。组件类型包括：Text(文本)、Button(按钮)、TextField(输入框)、Slider(滑块)、CheckBox(复选框)、ChoicePicker(选择器)、DateTimeInput(日期)、Card(卡片)、Row/Column(布局)、List(列表)、Tabs(标签页)、EntityCard(实体卡片)、StatBar(统计条)、TagGroup(标签组)、ConfirmBar(确认栏)、plan_board(计划板)、json_view(JSON视图)、svg_view(SVG视图)、mermaid_view(Mermaid图表)。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "surfaceId": { "type": "string", "description": "目标画布 ID" },
                    "components": {
                        "type": "array",
                        "description": "组件定义数组，每个组件需有 id、component(类型名) 和对应属性",
                        "items": { "type": "object", "description": "{ id: string, component: string, ...属性 }" }
                    }
                },
                "required": ["surfaceId", "components"]
            }),
        ),
        (
            "ui_update_data",
            "向画布填充数据，绑定到组件的 dataModel。数据通过 binding 路径与组件关联。使用场景：更新实体卡片的数据、填充表单默认值、刷新统计数字。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "surfaceId": { "type": "string", "description": "目标画布 ID" },
                    "path": { "type": "string", "description": "数据路径，如 /entity、/form、/stats" },
                    "value": { "type": "object", "description": "要设置的数据值" }
                },
                "required": ["surfaceId", "path", "value"]
            }),
        ),
        (
            "ui_delete_surface",
            "删除一个交互式 UI 画布。使用场景：用户关闭面板、操作完成后清理界面。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "surfaceId": { "type": "string", "description": "要删除的画布 ID" }
                },
                "required": ["surfaceId"]
            }),
        ),
        (
            "a2ui_show_entity",
            "快捷方式：用 A2UI EntityCard 展示单个实体的详细信息。自动创建画布并填充数据。使用场景：向用户展示实体的完整信息卡片。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "entityId": { "type": "string", "description": "要展示的实体 ID" }
                },
                "required": ["entityId"]
            }),
        ),
        (
            "a2ui_show_relation",
            "快捷方式：用 A2UI 展示关系详情。自动创建画布并填充数据。使用场景：向用户展示两个实体之间的关系详情。",
            serde_json::json!({
                "type": "object",
                "properties": {
                    "relationId": { "type": "string", "description": "要展示的关系 ID" }
                },
                "required": ["relationId"]
            }),
        ),
    ];

    for (name, desc, params) in definitions {
        let tool = FrontendTool::new(bridge.clone(), name, desc, params);
        debug!("注册 frontend 工具: {}", name);
        tool_bus.register(Arc::new(tool)).await;
    }
}

// ─── 工具参数定义 ────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct ReadFileArgs {
    path: String,
    #[serde(default)]
    encoding: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WriteFileArgs {
    path: String,
    content: String,
    #[serde(default)]
    create_dirs: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListDirArgs {
    path: String,
    #[serde(default)]
    recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct MkdirArgs {
    path: String,
    #[serde(default)]
    recursive: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct DeleteFileArgs {
    path: String,
    #[serde(default)]
    force: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct FileStatArgs {
    path: String,
}

// ─── ReadFileTool ────────────────────────────────────────────

/// 读取文本文件
///
/// 默认 UTF-8 解码，可通过 `encoding` 参数指定其他编码（当前仅支持 UTF-8）。
/// 路径限制：相对路径基于工作目录，禁止访问系统敏感目录（/etc、C:\Windows 等）。
pub struct ReadFileTool;

#[async_trait]
impl Tool for ReadFileTool {
    fn name(&self) -> &str {
        "read_file"
    }

    fn description(&self) -> &str {
        "读取文本文件内容（UTF-8 编码）。路径相对于当前工作目录。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径（相对或绝对）" },
                "encoding": { "type": "string", "description": "文件编码（默认 utf-8，当前仅支持 utf-8）" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: ReadFileArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        debug!("read_file: path={:?}", path);

        if !path.exists() {
            return Err(ToolError::Execution(format!(
                "文件不存在: {}",
                parsed.path
            )));
        }
        if !path.is_file() {
            return Err(ToolError::Execution(format!(
                "路径不是文件: {}",
                parsed.path
            )));
        }

        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| ToolError::Execution(format!("读取文件失败: {}", e)))?;

        Ok(serde_json::json!({
            "path": parsed.path,
            "content": content,
            "size": content.len()
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── WriteFileTool ────────────────────────────────────────────

/// 写入文本文件
///
/// - `create_dirs: true` 时自动创建父目录
/// - 文件已存在则覆盖
pub struct WriteFileTool;

#[async_trait]
impl Tool for WriteFileTool {
    fn name(&self) -> &str {
        "write_file"
    }

    fn description(&self) -> &str {
        "写入文本文件（UTF-8 编码）。文件已存在则覆盖，可通过 create_dirs=true 自动创建父目录。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件路径" },
                "content": { "type": "string", "description": "文件内容" },
                "createDirs": { "type": "boolean", "description": "是否自动创建父目录（默认 true）" }
            },
            "required": ["path", "content"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: WriteFileArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        let create_dirs = parsed.create_dirs.unwrap_or(true);
        debug!("write_file: path={:?} create_dirs={}", path, create_dirs);

        if create_dirs {
            if let Some(parent) = path.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| ToolError::Execution(format!("创建父目录失败: {}", e)))?;
            }
        }

        tokio::fs::write(&path, &parsed.content)
            .await
            .map_err(|e| ToolError::Execution(format!("写入文件失败: {}", e)))?;

        Ok(serde_json::json!({
            "path": parsed.path,
            "bytes": parsed.content.len()
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── ListDirTool ────────────────────────────────────────────

/// 列出目录内容
///
/// 返回目录下的文件和子目录列表（不含 . 和 ..）。
/// `recursive: true` 时递归列出所有后代文件。
pub struct ListDirTool;

#[async_trait]
impl Tool for ListDirTool {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn description(&self) -> &str {
        "列出目录内容。返回文件和子目录列表，可选递归列出。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "目录路径" },
                "recursive": { "type": "boolean", "description": "是否递归列出（默认 false）" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: ListDirArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        let recursive = parsed.recursive.unwrap_or(false);
        debug!("list_dir: path={:?} recursive={}", path, recursive);

        if !path.exists() {
            return Err(ToolError::Execution(format!(
                "目录不存在: {}",
                parsed.path
            )));
        }
        if !path.is_dir() {
            return Err(ToolError::Execution(format!(
                "路径不是目录: {}",
                parsed.path
            )));
        }

        let mut entries: Vec<serde_json::Value> = Vec::new();

        if recursive {
            let mut walker = walkdir::WalkDir::new(&path).into_iter();
            while let Some(Ok(entry)) = walker.next() {
                if entry.depth() == 0 {
                    continue; // 跳过根目录本身
                }
                let file_type = if entry.file_type().is_dir() {
                    "dir"
                } else if entry.file_type().is_file() {
                    "file"
                } else {
                    "symlink"
                };
                entries.push(serde_json::json!({
                    "path": entry.path().to_string_lossy(),
                    "name": entry.file_name().to_string_lossy(),
                    "type": file_type
                }));
            }
        } else {
            let mut reader = tokio::fs::read_dir(&path)
                .await
                .map_err(|e| ToolError::Execution(format!("读取目录失败: {}", e)))?;

            while let Some(entry) = reader
                .next_entry()
                .await
                .map_err(|e| ToolError::Execution(format!("读取目录项失败: {}", e)))?
            {
                let file_type = if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
                    "dir"
                } else {
                    "file"
                };
                entries.push(serde_json::json!({
                    "path": entry.path().to_string_lossy(),
                    "name": entry.file_name().to_string_lossy(),
                    "type": file_type
                }));
            }
        }

        Ok(serde_json::json!({
            "path": parsed.path,
            "entries": entries,
            "count": entries.len()
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── MkdirTool ────────────────────────────────────────────

/// 创建目录
///
/// `recursive: true` 时自动创建中间目录（等价于 `mkdir -p`）。
pub struct MkdirTool;

#[async_trait]
impl Tool for MkdirTool {
    fn name(&self) -> &str {
        "mkdir"
    }

    fn description(&self) -> &str {
        "创建目录。recursive=true 时自动创建中间目录（mkdir -p）。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "目录路径" },
                "recursive": { "type": "boolean", "description": "是否递归创建（默认 true）" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: MkdirArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        let recursive = parsed.recursive.unwrap_or(true);
        debug!("mkdir: path={:?} recursive={}", path, recursive);

        if path.exists() {
            return Err(ToolError::Execution(format!(
                "路径已存在: {}",
                parsed.path
            )));
        }

        if recursive {
            tokio::fs::create_dir_all(&path)
                .await
                .map_err(|e| ToolError::Execution(format!("创建目录失败: {}", e)))?;
        } else {
            tokio::fs::create_dir(&path)
                .await
                .map_err(|e| ToolError::Execution(format!("创建目录失败: {}", e)))?;
        }

        Ok(serde_json::json!({
            "path": parsed.path,
            "created": true
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── DeleteFileTool ────────────────────────────────────────────

/// 删除文件或空目录
///
/// - 默认仅删除文件或空目录
/// - `force: true` 时递归删除非空目录（危险操作，慎用）
pub struct DeleteFileTool;

#[async_trait]
impl Tool for DeleteFileTool {
    fn name(&self) -> &str {
        "delete_file"
    }

    fn description(&self) -> &str {
        "删除文件或目录。force=true 时递归删除非空目录（慎用）。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件或目录路径" },
                "force": { "type": "boolean", "description": "是否递归删除非空目录（默认 false）" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: DeleteFileArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        let force = parsed.force.unwrap_or(false);
        debug!("delete_file: path={:?} force={}", path, force);

        if !path.exists() {
            return Err(ToolError::Execution(format!(
                "路径不存在: {}",
                parsed.path
            )));
        }

        if path.is_file() {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|e| ToolError::Execution(format!("删除文件失败: {}", e)))?;
        } else if path.is_dir() {
            if force {
                tokio::fs::remove_dir_all(&path)
                    .await
                    .map_err(|e| ToolError::Execution(format!("递归删除目录失败: {}", e)))?;
            } else {
                tokio::fs::remove_dir(&path)
                    .await
                    .map_err(|e| ToolError::Execution(format!(
                        "删除目录失败（目录非空？需 force=true）: {}",
                        e
                    )))?;
            }
        } else {
            return Err(ToolError::Execution(format!(
                "未知路径类型: {}",
                parsed.path
            )));
        }

        Ok(serde_json::json!({
            "path": parsed.path,
            "deleted": true
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── FileStatTool ────────────────────────────────────────────

/// 获取文件元信息
///
/// 返回文件大小、修改时间、是否目录等信息。
pub struct FileStatTool;

#[async_trait]
impl Tool for FileStatTool {
    fn name(&self) -> &str {
        "file_stat"
    }

    fn description(&self) -> &str {
        "获取文件元信息（大小、修改时间、类型等）。"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "文件或目录路径" }
            },
            "required": ["path"]
        })
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let parsed: FileStatArgs = serde_json::from_value(args)
            .map_err(|e| ToolError::Execution(format!("参数解析失败: {}", e)))?;

        let path = sanitize_path(&parsed.path)?;
        debug!("file_stat: path={:?}", path);

        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|e| ToolError::Execution(format!("获取元信息失败: {}", e)))?;

        let file_type = if metadata.is_dir() {
            "dir"
        } else if metadata.is_file() {
            "file"
        } else {
            "symlink"
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        Ok(serde_json::json!({
            "path": parsed.path,
            "type": file_type,
            "size": metadata.len(),
            "modified": modified,
            "readonly": metadata.permissions().readonly()
        }))
    }

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

// ─── 工具函数 ────────────────────────────────────────────

/// 路径安全检查 — 阻止访问系统敏感目录
///
/// # 拒绝访问的路径
/// - Windows: `C:\Windows`、`C:\Program Files`、`C:\Program Files (x86)`
/// - Unix: `/etc`、`/usr`、`/bin`、`/sbin`、`/boot`、`/sys`、`/proc`、`/dev`
///
/// # 参数
/// - `path_str`: 用户提供的路径字符串（相对或绝对）
///
/// # 返回
/// - `Ok(PathBuf)`: 规范化后的路径
/// - `Err(ToolError)`: 路径被拒绝访问
fn sanitize_path(path_str: &str) -> Result<PathBuf, ToolError> {
    let path = PathBuf::from(path_str);

    // 检查是否为系统敏感目录的子路径
    if is_sensitive_path(&path) {
        warn!("路径被拒绝访问（系统敏感目录）: {}", path_str);
        return Err(ToolError::Execution(format!(
            "路径被拒绝访问（系统敏感目录）: {}",
            path_str
        )));
    }

    Ok(path)
}

/// 判断路径是否为系统敏感目录
fn is_sensitive_path(path: &Path) -> bool {
    let path_str = path.to_string_lossy().to_lowercase();

    #[cfg(windows)]
    {
        let blocked = [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
            "c:\\programdata",
        ];
        for blocked_path in &blocked {
            if path_str.starts_with(blocked_path) {
                return true;
            }
        }
    }

    #[cfg(unix)]
    {
        let blocked = ["/etc", "/usr", "/bin", "/sbin", "/boot", "/sys", "/proc", "/dev"];
        for blocked_path in &blocked {
            if path_str == *blocked_path || path_str.starts_with(&format!("{}/", blocked_path)) {
                return true;
            }
        }
    }

    false
}

// ─── 单元测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_path_allows_relative() {
        let result = sanitize_path("test.txt").unwrap();
        assert_eq!(result, PathBuf::from("test.txt"));
    }

    #[test]
    fn sanitize_path_allows_workspace() {
        let result = sanitize_path("./src/main.rs").unwrap();
        assert_eq!(result, PathBuf::from("./src/main.rs"));
    }

    #[cfg(windows)]
    #[test]
    fn sanitize_path_blocks_windows_system() {
        assert!(sanitize_path("C:\\Windows\\System32").is_err());
        assert!(sanitize_path("C:\\Program Files\\app").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn sanitize_path_blocks_unix_system() {
        assert!(sanitize_path("/etc/passwd").is_err());
        assert!(sanitize_path("/usr/bin/ls").is_err());
        assert!(sanitize_path("/etc").is_err());
    }

    #[test]
    fn is_sensitive_path_user_dir() {
        // 用户目录不算敏感
        #[cfg(windows)]
        {
            assert!(!is_sensitive_path(&PathBuf::from("C:\\Users\\test\\file.txt")));
            assert!(!is_sensitive_path(&PathBuf::from("D:\\workspace\\project")));
        }
        #[cfg(unix)]
        {
            assert!(!is_sensitive_path(&PathBuf::from("/home/user/file.txt")));
            assert!(!is_sensitive_path(&PathBuf::from("/tmp/test.txt")));
        }
    }

    #[tokio::test]
    async fn read_file_tool_returns_metadata() {
        let tool = ReadFileTool;
        // 测试不存在的文件
        let args = serde_json::json!({ "path": "nonexistent_test_file_xyz.txt" });
        let result = tool.execute(args).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn write_and_read_file_round_trip() {
        // 仅在临时目录测试，不污染工作区
        let test_path = format!(
            "test_round_trip_{}.txt",
            std::process::id()
        );

        // 写入
        let write_tool = WriteFileTool;
        let write_args = serde_json::json!({
            "path": test_path,
            "content": "hello world"
        });
        let write_result = write_tool.execute(write_args).await.unwrap();
        assert_eq!(write_result["bytes"], 11);

        // 读取
        let read_tool = ReadFileTool;
        let read_args = serde_json::json!({ "path": test_path });
        let read_result = read_tool.execute(read_args).await.unwrap();
        assert_eq!(read_result["content"], "hello world");

        // 清理
        let delete_tool = DeleteFileTool;
        let delete_args = serde_json::json!({ "path": test_path });
        let _ = delete_tool.execute(delete_args).await;
    }
}
