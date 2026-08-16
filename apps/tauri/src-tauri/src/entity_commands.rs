//! 实体/关系/KV/文件命令层（TauriStorageBackend fallback 用）
//!
//! 背景：FileStorageBackend 绑定 projectDir 后以 cmd_fs_* 读写 JSON 文件为主存储；
//! 未绑定目录（启动早期 / 无项目）时前端降级到 TauriStorageBackend，它依赖
//! cmd_get_all_entities 等实体命令。本模块提供这些命令的 SQLite 实现（全局库），
//! 保证 fallback 路径可用，避免 "Command not found" 或 IPC 崩溃。
//!
//! 存储：应用数据目录下 entities.db（sqlx 0.8 + WAL，与 agent-commands 一致）。
//! 数据格式：实体/关系/文件均存原始 JSON 字符串（前端 serde 契约），
//! id/type/source_id 等独立列用于索引查询。

use std::sync::Arc;

use agent_runtime::scenario::ScenarioEntityProvider;
use agent_runtime::tool::{Tool, ToolError};
use async_trait::async_trait;
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::State;

/// 实体数据库（全局，未绑定 projectDir 时的兜底存储）
pub struct EntityDb {
    pool: SqlitePool,
}

impl EntityDb {
    /// 打开（不存在则创建）数据库文件并建表（幂等）
    pub async fn new(path: &str) -> Result<Arc<Self>, String> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await
            .map_err(|e| format!("打开实体数据库失败: {e}"))?;
        Self::init(&pool).await?;
        Ok(Arc::new(Self { pool }))
    }

    async fn init(pool: &SqlitePool) -> Result<(), String> {
        // sqlx 一次只执行一条语句，逐条建表
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS entities (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                data TEXT NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("创建 entities 表失败: {e}"))?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type)")
            .execute(pool)
            .await
            .map_err(|e| format!("创建 entities 索引失败: {e}"))?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS relations (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                data TEXT NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("创建 relations 表失败: {e}"))?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id)")
            .execute(pool)
            .await
            .map_err(|e| format!("创建 relations source 索引失败: {e}"))?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id)")
            .execute(pool)
            .await
            .map_err(|e| format!("创建 relations target 索引失败: {e}"))?;
        sqlx::query("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(pool)
            .await
            .map_err(|e| format!("创建 kv 表失败: {e}"))?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                entity_id TEXT,
                path TEXT,
                data TEXT NOT NULL,
                content TEXT
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| format!("创建 files 表失败: {e}"))?;
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity_id)")
            .execute(pool)
            .await
            .map_err(|e| format!("创建 files 索引失败: {e}"))?;
        Ok(())
    }

    /// 按类型查询实体并生成紧凑摘要（B1 场景上下文注入用）
    ///
    /// 对每个类型取前 `per_type_limit` 条，提取 `name` + `description` 拼成
    /// 人类可读的概览；某类型无实体则跳过。全部为空返回空串（调用方跳过段落）。
    pub async fn summarize_types(&self, types: &[&str], per_type_limit: usize) -> String {
        let mut sections: Vec<String> = Vec::new();
        for ty in types {
            let limit = per_type_limit as i64;
            let rows: Vec<(String,)> =
                sqlx::query_as("SELECT data FROM entities WHERE type = ? ORDER BY id LIMIT ?")
                    .bind(ty)
                    .bind(limit)
                    .fetch_all(&self.pool)
                    .await
                    .unwrap_or_default();
            if rows.is_empty() {
                continue;
            }
            let mut parts: Vec<String> = Vec::new();
            for (d,) in rows {
                let v: Value = serde_json::from_str(&d).unwrap_or(Value::Null);
                let name = v
                    .get("name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("（未命名）");
                let desc = v
                    .get("description")
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                // 截断描述避免摘要过长（保留前 120 字符）
                let desc = if desc.chars().count() > 120 {
                    let mut cut: String = desc.chars().take(120).collect();
                    cut.push('…');
                    cut
                } else {
                    desc.to_string()
                };
                parts.push(format!("- {name}：{desc}"));
            }
            sections.push(format!("【{}】\n{}", ty, parts.join("\n")));
        }
        if sections.is_empty() {
            String::new()
        } else {
            sections.join("\n\n")
        }
    }

    /// 列出全部实体（原始 JSON），供实体读取工具复用
    pub async fn list_all(&self) -> Result<Vec<Value>, String> {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM entities ORDER BY id")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| format!("查询全部实体失败: {e}"))?;
        Ok(rows
            .into_iter()
            .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
            .collect())
    }

    /// 按类型列出实体（原始 JSON），供实体读取工具复用
    pub async fn list_by_type(&self, entity_type: &str) -> Result<Vec<Value>, String> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT data FROM entities WHERE type = ? ORDER BY id")
                .bind(entity_type)
                .fetch_all(&self.pool)
                .await
                .map_err(|e| format!("按类型查询实体失败: {e}"))?;
        Ok(rows
            .into_iter()
            .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
            .collect())
    }

    /// 按 ID 获取单个实体（原始 JSON），供实体读取工具复用
    pub async fn get(&self, id: &str) -> Result<Option<Value>, String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT data FROM entities WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("查询实体失败: {e}"))?;
        Ok(row.map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null)))
    }
}

/// 场景实体访问器（SQLite 兜底库实现，B1 场景上下文注入）
///
/// 实现 `agent-runtime::scenario::ScenarioEntityProvider`，供 AgentLoop 在
/// 构建场景 system prompt 时拉取项目实体概览。当前基于全局 `EntityDb`（SQLite
/// 兜底库）读取；未来 per-project FileStorageBackend 接入后替换本实现即可。
pub struct SqliteScenarioEntityProvider {
    db: Arc<EntityDb>,
}

impl SqliteScenarioEntityProvider {
    pub fn new(db: Arc<EntityDb>) -> Self {
        Self { db }
    }
}

impl std::fmt::Debug for SqliteScenarioEntityProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SqliteScenarioEntityProvider").finish()
    }
}

#[async_trait]
impl ScenarioEntityProvider for SqliteScenarioEntityProvider {
    async fn entity_summary(&self, types: &[&str], per_type_limit: usize) -> String {
        self.db.summarize_types(types, per_type_limit).await
    }
}

// ─── 原生实体只读工具（B1 场景工具桥 MVP） ─────────────────────

/// 构造 worldbuilding 场景可用的原生实体只读工具集合
///
/// 工具名与 `WorldbuildingScenario::tool_ids()` 声明的 `entity_list` / `entity_get`
/// 一致，注册进 Rust `ToolBus` 后，场景启用时经 WhitelistToolBus 白名单对 LLM 可见、
/// 且可由 AgentLoop 直接执行（无需 TS↔Rust 双向桥）。数据源为全局 `EntityDb`。
pub fn entity_read_tools(db: Arc<EntityDb>) -> Vec<Arc<dyn Tool>> {
    vec![
        Arc::new(EntityListTool { db: db.clone() }),
        Arc::new(EntityGetTool { db }),
    ]
}

/// 实体读取工具：entity_list（列出实体，可按类型过滤）
pub struct EntityListTool {
    db: Arc<EntityDb>,
}

#[async_trait]
impl Tool for EntityListTool {
    fn name(&self) -> &str {
        "entity_list"
    }
    fn description(&self) -> &str {
        "列出项目中的已有实体（角色/区域/势力/事件/概念/物种/魔法等），可按类型过滤。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "entity_type": {
                    "type": "string",
                    "description": "(可选)实体类型过滤词，如 character/region/organization/event/concept/species/magic；不传则列出全部"
                }
            },
            "required": []
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let entity_type = args
            .get("entity_type")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let list = match entity_type {
            Some(t) => self
                .db
                .list_by_type(&t)
                .await
                .map_err(ToolError::Execution)?,
            None => self.db.list_all().await.map_err(ToolError::Execution)?,
        };
        Ok(serde_json::json!(list))
    }
}

/// 实体读取工具：entity_get（按 ID 获取单个实体）
///
/// C2 引用有效性校验：支持可选 `expected_type`，读取前校验引用 id 存在且类型匹配，
/// 防止悬空引用（实体已删）与类型错配（引用声明 type 与实际不符）导致 LLM 读到错误上下文。
pub struct EntityGetTool {
    db: Arc<EntityDb>,
}

#[async_trait]
impl Tool for EntityGetTool {
    fn name(&self) -> &str {
        "entity_get"
    }
    fn description(&self) -> &str {
        "按 ID 获取单个实体的完整详情。可选 expected_type 用于校验引用类型一致性。"
    }
    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "id": { "type": "string", "description": "实体 ID" },
                "expected_type": {
                    "type": "string",
                    "description": "(可选)期望的实体类型；若不匹配将返回错误，防止引用错配"
                }
            },
            "required": ["id"]
        })
    }
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::ArgsParse("缺少 id 参数".into()))?;
        let expected_type = args
            .get("expected_type")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let entity = self
            .db
            .get(id)
            .await
            .map_err(ToolError::Execution)?;
        let Some(entity) = entity else {
            // 悬空引用：id 不存在
            return Ok(serde_json::json!({ "error": format!("实体 {id} 不存在（可能是悬空引用）") }));
        };
        // 类型匹配校验：引用声明类型与实际实体类型不一致时返回错误，避免 LLM 用错上下文
        if let Some(expected) = expected_type {
            let actual = entity.get("type").and_then(|t| t.as_str()).unwrap_or_default();
            if actual != expected {
                return Ok(serde_json::json!({
                    "error": format!("引用类型不匹配：期望 {expected}，实际 {actual}（id={id}）")
                }));
            }
        }
        Ok(entity)
    }
}

/// 解析 JSON 字符串为 Value（失败返回原始字符串错误）
fn parse_json(s: &str, what: &str) -> Result<Value, String> {
    serde_json::from_str(s).map_err(|e| format!("{what} JSON 解析失败: {e}"))
}

/// 顶层浅合并：changes 的字段覆盖 base（对应前端 updateEntity/updateRelation/updateFile 的 Partial 语义）
fn merge_json(base: &mut Value, changes: &Value) {
    if let (Value::Object(base_map), Value::Object(changes_map)) = (base, changes) {
        for (k, v) in changes_map {
            base_map.insert(k.clone(), v.clone());
        }
    }
}

/// 从 JSON 取字符串字段（前端实体/关系/文件类型为 camelCase 契约）
fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/* ═══════════════ 实体命令 ═══════════════ */

#[tauri::command]
pub async fn cmd_get_all_entities(state: State<'_, EntityDb>) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM entities ORDER BY id")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("查询全部实体失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_get_entity(
    state: State<'_, EntityDb>,
    id: String,
) -> Result<Option<Value>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM entities WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("查询实体失败: {e}"))?;
    Ok(row.map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null)))
}

#[tauri::command]
pub async fn cmd_get_entities_by_type(
    state: State<'_, EntityDb>,
    entity_type: String,
) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM entities WHERE type = ? ORDER BY id")
        .bind(&entity_type)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("按类型查询实体失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_put_entity(
    state: State<'_, EntityDb>,
    entity_json: String,
) -> Result<(), String> {
    let v = parse_json(&entity_json, "实体")?;
    let id = str_field(&v, "id").ok_or("实体缺少 id 字段")?;
    let ty = str_field(&v, "type").unwrap_or_default();
    sqlx::query("INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&ty)
        .bind(&entity_json)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("写入实体失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_update_entity(
    state: State<'_, EntityDb>,
    id: String,
    changes_json: String,
) -> Result<(), String> {
    let changes = parse_json(&changes_json, "实体变更")?;
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM entities WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("读取实体失败: {e}"))?;
    let Some((data,)) = row else {
        return Ok(()); // 目标不存在视为成功（幂等，对齐 Web 端 Dexie update 语义）
    };
    let mut merged = serde_json::from_str(&data).unwrap_or(Value::Object(Default::default()));
    merge_json(&mut merged, &changes);
    let ty = str_field(&merged, "type").unwrap_or_default();
    let out = serde_json::to_string(&merged).map_err(|e| format!("实体序列化失败: {e}"))?;
    sqlx::query("UPDATE entities SET type = ?, data = ? WHERE id = ?")
        .bind(&ty)
        .bind(&out)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("更新实体失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_delete_entity(state: State<'_, EntityDb>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM entities WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除实体失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_count_entities_by_type(
    state: State<'_, EntityDb>,
) -> Result<Vec<(String, i64)>, String> {
    sqlx::query_as("SELECT type, COUNT(*) FROM entities GROUP BY type")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("统计实体类型失败: {e}"))
}

#[tauri::command]
pub async fn cmd_clear_entities(state: State<'_, EntityDb>) -> Result<(), String> {
    sqlx::query("DELETE FROM entities")
        .execute(&state.pool)
        .await
        .map_err(|e| format!("清空实体失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_import_entities(
    state: State<'_, EntityDb>,
    entities_json: String,
) -> Result<usize, String> {
    let arr: Vec<Value> =
        serde_json::from_str(&entities_json).map_err(|e| format!("实体列表 JSON 解析失败: {e}"))?;
    for v in &arr {
        let id = str_field(v, "id").ok_or("实体缺少 id 字段")?;
        let ty = str_field(v, "type").unwrap_or_default();
        let data = serde_json::to_string(v).map_err(|e| format!("实体序列化失败: {e}"))?;
        sqlx::query("INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)")
            .bind(&id)
            .bind(&ty)
            .bind(&data)
            .execute(&state.pool)
            .await
            .map_err(|e| format!("导入实体失败: {e}"))?;
    }
    Ok(arr.len())
}

/* ═══════════════ 关系命令 ═══════════════ */

#[tauri::command]
pub async fn cmd_get_all_relations(state: State<'_, EntityDb>) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM relations ORDER BY id")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("查询全部关系失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_get_relations_by_entity(
    state: State<'_, EntityDb>,
    entity_id: String,
) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT data FROM relations WHERE source_id = ? OR target_id = ? ORDER BY id",
    )
    .bind(&entity_id)
    .bind(&entity_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| format!("按实体查询关系失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_put_relation(
    state: State<'_, EntityDb>,
    relation_json: String,
) -> Result<(), String> {
    let v = parse_json(&relation_json, "关系")?;
    let id = str_field(&v, "id").ok_or("关系缺少 id 字段")?;
    let source_id = str_field(&v, "sourceId").ok_or("关系缺少 sourceId 字段")?;
    let target_id = str_field(&v, "targetId").ok_or("关系缺少 targetId 字段")?;
    sqlx::query(
        "INSERT OR REPLACE INTO relations (id, source_id, target_id, data) VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&source_id)
    .bind(&target_id)
    .bind(&relation_json)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("写入关系失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_update_relation(
    state: State<'_, EntityDb>,
    id: String,
    changes_json: String,
) -> Result<(), String> {
    let changes = parse_json(&changes_json, "关系变更")?;
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM relations WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("读取关系失败: {e}"))?;
    let Some((data,)) = row else {
        return Ok(());
    };
    let mut merged = serde_json::from_str(&data).unwrap_or(Value::Object(Default::default()));
    merge_json(&mut merged, &changes);
    let source_id = str_field(&merged, "sourceId").unwrap_or_default();
    let target_id = str_field(&merged, "targetId").unwrap_or_default();
    let out = serde_json::to_string(&merged).map_err(|e| format!("关系序列化失败: {e}"))?;
    sqlx::query("UPDATE relations SET source_id = ?, target_id = ?, data = ? WHERE id = ?")
        .bind(&source_id)
        .bind(&target_id)
        .bind(&out)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("更新关系失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_delete_relation(state: State<'_, EntityDb>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM relations WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除关系失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_delete_relations_by_entity(
    state: State<'_, EntityDb>,
    entity_id: String,
) -> Result<u64, String> {
    let res = sqlx::query("DELETE FROM relations WHERE source_id = ? OR target_id = ?")
        .bind(&entity_id)
        .bind(&entity_id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除实体关联关系失败: {e}"))?;
    Ok(res.rows_affected())
}

#[tauri::command]
pub async fn cmd_clear_relations(state: State<'_, EntityDb>) -> Result<(), String> {
    sqlx::query("DELETE FROM relations")
        .execute(&state.pool)
        .await
        .map_err(|e| format!("清空关系失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_import_relations(
    state: State<'_, EntityDb>,
    relations_json: String,
) -> Result<usize, String> {
    let arr: Vec<Value> =
        serde_json::from_str(&relations_json).map_err(|e| format!("关系列表 JSON 解析失败: {e}"))?;
    for v in &arr {
        let id = str_field(v, "id").ok_or("关系缺少 id 字段")?;
        let source_id = str_field(v, "sourceId").unwrap_or_default();
        let target_id = str_field(v, "targetId").unwrap_or_default();
        let data = serde_json::to_string(v).map_err(|e| format!("关系序列化失败: {e}"))?;
        sqlx::query(
            "INSERT OR REPLACE INTO relations (id, source_id, target_id, data) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&source_id)
        .bind(&target_id)
        .bind(&data)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("导入关系失败: {e}"))?;
    }
    Ok(arr.len())
}

/* ═══════════════ KV 命令 ═══════════════ */

#[tauri::command]
pub async fn cmd_kv_get(
    state: State<'_, EntityDb>,
    key: String,
) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM kv WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("读取 KV 失败: {e}"))?;
    Ok(row.map(|(v,)| v))
}

#[tauri::command]
pub async fn cmd_kv_set(
    state: State<'_, EntityDb>,
    key: String,
    value: String,
) -> Result<(), String> {
    sqlx::query("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
        .bind(&key)
        .bind(&value)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("写入 KV 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_kv_delete(state: State<'_, EntityDb>, key: String) -> Result<(), String> {
    sqlx::query("DELETE FROM kv WHERE key = ?")
        .bind(&key)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除 KV 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_kv_get_all(state: State<'_, EntityDb>) -> Result<Vec<(String, String)>, String> {
    sqlx::query_as("SELECT key, value FROM kv ORDER BY key")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("读取全部 KV 失败: {e}"))
}

/* ═══════════════ 文件命令 ═══════════════ */

#[tauri::command]
pub async fn cmd_get_all_files(state: State<'_, EntityDb>) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM files ORDER BY id")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("查询全部文件失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_get_file(
    state: State<'_, EntityDb>,
    id: String,
) -> Result<Option<Value>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM files WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("查询文件失败: {e}"))?;
    Ok(row.map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null)))
}

#[tauri::command]
pub async fn cmd_get_file_by_path(
    state: State<'_, EntityDb>,
    path: String,
) -> Result<Option<Value>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM files WHERE path = ? LIMIT 1")
        .bind(&path)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("按路径查询文件失败: {e}"))?;
    Ok(row.map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null)))
}

#[tauri::command]
pub async fn cmd_get_files_by_entity(
    state: State<'_, EntityDb>,
    entity_id: String,
) -> Result<Vec<Value>, String> {
    let rows: Vec<(String,)> = sqlx::query_as("SELECT data FROM files WHERE entity_id = ? ORDER BY id")
        .bind(&entity_id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| format!("按实体查询文件失败: {e}"))?;
    Ok(rows
        .into_iter()
        .map(|(d,)| serde_json::from_str(&d).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn cmd_put_file(
    state: State<'_, EntityDb>,
    file_json: String,
    content_json: String,
) -> Result<(), String> {
    let v = parse_json(&file_json, "文件")?;
    let id = str_field(&v, "id").ok_or("文件缺少 id 字段")?;
    let entity_id = str_field(&v, "entityId");
    let path = str_field(&v, "path");
    sqlx::query(
        "INSERT OR REPLACE INTO files (id, entity_id, path, data, content) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&entity_id)
    .bind(&path)
    .bind(&file_json)
    .bind(&content_json)
    .execute(&state.pool)
    .await
    .map_err(|e| format!("写入文件失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_update_file(
    state: State<'_, EntityDb>,
    id: String,
    changes_json: String,
) -> Result<(), String> {
    let changes = parse_json(&changes_json, "文件变更")?;
    let row: Option<(String,)> = sqlx::query_as("SELECT data FROM files WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("读取文件失败: {e}"))?;
    let Some((data,)) = row else {
        return Ok(());
    };
    let mut merged = serde_json::from_str(&data).unwrap_or(Value::Object(Default::default()));
    merge_json(&mut merged, &changes);
    let entity_id = str_field(&merged, "entityId");
    let path = str_field(&merged, "path");
    let out = serde_json::to_string(&merged).map_err(|e| format!("文件序列化失败: {e}"))?;
    sqlx::query("UPDATE files SET entity_id = ?, path = ?, data = ? WHERE id = ?")
        .bind(&entity_id)
        .bind(&path)
        .bind(&out)
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("更新文件失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_delete_file(state: State<'_, EntityDb>, id: String) -> Result<(), String> {
    sqlx::query("DELETE FROM files WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(|e| format!("删除文件失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_get_file_content(
    state: State<'_, EntityDb>,
    id: String,
) -> Result<Option<Value>, String> {
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT content FROM files WHERE id = ?")
        .bind(&id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| format!("查询文件内容失败: {e}"))?;
    Ok(row
        .and_then(|(c,)| c)
        .map(|c| serde_json::from_str(&c).unwrap_or(Value::Null)))
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// 建一个临时文件库的 EntityDb（避免污染真实实体库）
    async fn temp_db() -> Arc<EntityDb> {
        let path = std::env::temp_dir()
            .join(format!("ws_entity_test_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        EntityDb::new(path.to_str().unwrap()).await.expect("建临时库失败")
    }

    /// 直接插入一条实体（测试模块内可访问私有 pool）
    async fn put(db: &EntityDb, id: &str, ty: &str, name: &str) {
        let data = serde_json::json!({ "id": id, "type": ty, "name": name, "description": "测试实体" });
        sqlx::query("INSERT OR REPLACE INTO entities (id, type, data) VALUES (?, ?, ?)")
            .bind(id)
            .bind(ty)
            .bind(data.to_string())
            .execute(&db.pool)
            .await
            .expect("插入实体失败");
    }

    #[tokio::test]
    async fn entity_list_tool_works() {
        let db = temp_db().await;
        put(&db, "c1", "character", "艾琳").await;
        put(&db, "r1", "region", "龙脊山").await;

        let tools = entity_read_tools(db.clone());
        // 全量列出
        let all = tools[0].execute(serde_json::json!({})).await.unwrap();
        let arr = all.as_array().expect("应返回数组");
        assert_eq!(arr.len(), 2);
        // 按类型过滤
        let chars = tools[0]
            .execute(serde_json::json!({ "entity_type": "character" }))
            .await
            .unwrap();
        let carr = chars.as_array().unwrap();
        assert_eq!(carr.len(), 1);
        assert_eq!(carr[0]["name"], "艾琳");
    }

    #[tokio::test]
    async fn entity_get_tool_works() {
        let db = temp_db().await;
        put(&db, "c1", "character", "艾琳").await;

        let tools = entity_read_tools(db.clone());
        let got = tools[1]
            .execute(serde_json::json!({ "id": "c1" }))
            .await
            .unwrap();
        assert_eq!(got["name"], "艾琳");
        // 缺失 id → 参数错误
        assert!(tools[1].execute(serde_json::json!({})).await.is_err());
        // 不存在实体 → 返回 error 对象（非 Err）
        let missing = tools[1]
            .execute(serde_json::json!({ "id": "nope" }))
            .await
            .unwrap();
        assert!(missing.get("error").is_some());
    }

    #[tokio::test]
    async fn entity_get_reference_validity_check() {
        let db = temp_db().await;
        put(&db, "c1", "character", "艾琳").await;

        let tools = entity_read_tools(db.clone());
        // 类型匹配 → 正常返回实体
        let ok = tools[1]
            .execute(serde_json::json!({ "id": "c1", "expected_type": "character" }))
            .await
            .unwrap();
        assert!(ok.get("error").is_none());
        assert_eq!(ok["name"], "艾琳");
        // 类型不匹配 → 返回 error（防引用错配）
        let mismatch = tools[1]
            .execute(serde_json::json!({ "id": "c1", "expected_type": "region" }))
            .await
            .unwrap();
        let err = mismatch.get("error").and_then(|e| e.as_str()).unwrap_or("");
        assert!(err.contains("类型不匹配"), "意外响应: {mismatch}");
        // 悬空引用（id 不存在）→ 返回 error 且提示悬空
        let dangling = tools[1]
            .execute(serde_json::json!({ "id": "ghost", "expected_type": "character" }))
            .await
            .unwrap();
        let derr = dangling.get("error").and_then(|e| e.as_str()).unwrap_or("");
        assert!(derr.contains("悬空引用"), "意外响应: {dangling}");
    }
}
