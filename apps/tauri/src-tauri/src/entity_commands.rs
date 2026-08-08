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
