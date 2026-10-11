use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::error::CoreError;
use crate::models::entity::Entity;
use crate::models::relation::Relation;

/// 基于 `SQLite` 的存储后端，提供实体、关系、键值对和模块的持久化操作
///
/// 内部使用互斥锁包装数据库连接，保证线程安全
pub struct SqliteStore {
  conn: Mutex<Connection>,
}

impl SqliteStore {
  /// 打开指定路径的 `SQLite` 数据库文件
  ///
  /// 如果文件不存在则自动创建。打开后会设置 WAL 日志模式和启用外键约束，并初始化数据表。
  ///
  /// - `path` - 数据库文件路径
  /// - 返回打开成功的 `SqliteStore` 实例，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the database cannot be opened or PRAGMA setup fails.
  pub fn open(path: &str) -> Result<Self, CoreError> {
    if path.is_empty() {
      return Err(CoreError::InvalidArgument("数据库路径不能为空".to_string()));
    }

    let conn =
      Connection::open(path).map_err(|e| CoreError::storage(format!("SQLite 打开失败: {e}")))?;

    conn
      .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
      .map_err(|e| CoreError::storage(format!("PRAGMA 设置失败: {e}")))?;

    let store = Self { conn: Mutex::new(conn) };
    store.init_tables()?;
    Ok(store)
  }

  /// 在锁内执行闭包：允许在 `SqliteStore` 之上构建交叉表查询 / 子存储。
  ///
  /// 闭包参数是 `&Connection` — 直接给 `conn.execute` / `conn.query_row` 使用。
  /// `WorkflowStore::new(conn)` 接受 `&Connection` 形式借用。
  pub fn with_conn<R>(
    &self,
    f: impl FnOnce(&Connection) -> Result<R, CoreError>,
  ) -> Result<R, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    f(&conn)
  }

  /// 创建内存中的 `SQLite` 数据库
  ///
  /// 适用于测试或临时场景，数据不会持久化到磁盘。同样会设置 WAL 模式、启用外键约束并初始化数据表。
  ///
  /// - 返回内存数据库的 `SqliteStore` 实例，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the in-memory database cannot be created or PRAGMA setup fails.
  pub fn open_in_memory() -> Result<Self, CoreError> {
    let conn = Connection::open_in_memory()
      .map_err(|e| CoreError::storage(format!("SQLite 内存数据库创建失败: {e}")))?;

    conn
      .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
      .map_err(|e| CoreError::storage(format!("PRAGMA 设置失败: {e}")))?;

    let store = Self { conn: Mutex::new(conn) };
    store.init_tables()?;
    Ok(store)
  }

  fn init_tables(&self) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    conn
      .execute_batch(
        "CREATE TABLE IF NOT EXISTS entities (
                id          TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                properties  TEXT NOT NULL DEFAULT '{}',
                tags        TEXT NOT NULL DEFAULT '[]',
                avatar      TEXT,
                created_at  TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
            CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

            CREATE TABLE IF NOT EXISTS relations (
                id          TEXT PRIMARY KEY,
                type        TEXT NOT NULL,
                source_id   TEXT NOT NULL,
                target_id   TEXT NOT NULL,
                label       TEXT,
                properties  TEXT NOT NULL DEFAULT '{}',
                pair_id     TEXT,
                created_at  TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL DEFAULT ''
            );

            CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);
            CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
            CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
            CREATE INDEX IF NOT EXISTS idx_relations_pair ON relations(pair_id);

            CREATE TABLE IF NOT EXISTS modules (
                id          TEXT PRIMARY KEY,
                active      INTEGER NOT NULL DEFAULT 1,
                source      TEXT NOT NULL DEFAULT 'local',
                manifest    TEXT NOT NULL DEFAULT '{}',
                installed_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS kv_store (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workflows (
                id TEXT NOT NULL,
                version INTEGER NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'custom',
                description TEXT,
                definition_json TEXT NOT NULL,
                schema_version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (id, version)
            );
            CREATE INDEX IF NOT EXISTS idx_workflows_id_latest ON workflows(id, version DESC);
            CREATE INDEX IF NOT EXISTS idx_workflows_category ON workflows(category, updated_at DESC);

            CREATE TABLE IF NOT EXISTS workflow_runs (
                run_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                workflow_version INTEGER NOT NULL,
                status TEXT NOT NULL,
                triggered_by TEXT NOT NULL,
                params_json TEXT NOT NULL,
                context_snapshot TEXT,
                current_node_id TEXT,
                started_at INTEGER NOT NULL,
                completed_at INTEGER,
                error TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_runs_workflow_id ON workflow_runs(workflow_id, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status, started_at DESC);
            CREATE INDEX IF NOT EXISTS idx_runs_completed_at ON workflow_runs(completed_at) WHERE completed_at IS NOT NULL;

            CREATE TABLE IF NOT EXISTS workflow_node_logs (
                log_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload_json TEXT,
                ts INTEGER NOT NULL,
                FOREIGN KEY (run_id) REFERENCES workflow_runs(run_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_node_logs_run_id ON workflow_node_logs(run_id, ts ASC);

            CREATE TABLE IF NOT EXISTS workflow_pending_dispatches (
                request_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                node_id TEXT NOT NULL,
                protocol TEXT NOT NULL,
                dispatched_at INTEGER NOT NULL,
                last_heartbeat_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS workflow_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS files (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                path        TEXT NOT NULL,
                mime_type   TEXT NOT NULL DEFAULT '',
                size        INTEGER NOT NULL DEFAULT 0,
                entity_id   TEXT,
                tags        TEXT NOT NULL DEFAULT '[]',
                created_at  TEXT NOT NULL DEFAULT '',
                updated_at  TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
            CREATE INDEX IF NOT EXISTS idx_files_entity_id ON files(entity_id);

            CREATE TABLE IF NOT EXISTS file_contents (
                id           TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
                text_content TEXT,
                binary_data  TEXT
            );",
      )
      .map_err(|e| CoreError::storage(format!("建表失败: {e}")))?;

    drop(conn);
    Ok(())
  }

  /// 写入或替换一个实体
  ///
  /// 如果同 id 的实体已存在则覆盖，否则插入新记录。
  ///
  /// - `entity` - 要写入的实体引用
  /// - 返回写入成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the insert fails.
  pub fn put_entity(&self, entity: &Entity) -> Result<(), CoreError> {
    if entity.id.is_empty() {
      return Err(CoreError::InvalidArgument("实体 ID 不能为空".to_string()));
    }
    if entity.entity_type.is_empty() {
      return Err(CoreError::InvalidArgument("实体类型不能为空".to_string()));
    }

    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let props = serde_json::to_string(&entity.properties).unwrap_or_else(|_| "{}".to_string());
    let tags = serde_json::to_string(&entity.tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
            "INSERT OR REPLACE INTO entities (id, type, name, description, properties, tags, avatar, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                entity.id,
                entity.entity_type,
                entity.name,
                entity.description,
                props,
                tags,
                entity.avatar,
                entity.created_at,
                entity.updated_at,
            ],
        ).map_err(|e| CoreError::storage(format!("写入实体失败: {e}")))?;

    drop(conn);
    Ok(())
  }

  /// 根据 id 查询实体
  ///
  /// - `id` - 实体唯一标识
  /// - 返回 Some(Entity) 表示找到，None 表示不存在，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query preparation fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_entity(&self, id: &str) -> Result<Option<Entity>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, name, description, properties, tags, avatar, created_at, updated_at FROM entities WHERE id = ?1")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt.query_row(params![id], |row| Ok(entity_from_row(row))).ok();

    Ok(result)
  }

  /// 获取所有实体
  ///
  /// - 返回实体列表，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_all_entities(&self) -> Result<Vec<Entity>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, name, description, properties, tags, avatar, created_at, updated_at FROM entities")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let entities = stmt
      .query_map([], |row| Ok(entity_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询实体失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(entities)
  }

  /// 根据实体类型查询实体列表
  ///
  /// - `entity_type` - 实体类型名称
  /// - 返回匹配该类型的所有实体，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_entities_by_type(&self, entity_type: &str) -> Result<Vec<Entity>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, name, description, properties, tags, avatar, created_at, updated_at FROM entities WHERE type = ?1")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let entities = stmt
      .query_map(params![entity_type], |row| Ok(entity_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询实体失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(entities)
  }

  /// 根据 id 删除实体
  ///
  /// - `id` - 要删除的实体唯一标识
  /// - 返回 true 表示成功删除，false 表示实体不存在，删除失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn delete_entity(&self, id: &str) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let affected = conn
      .execute("DELETE FROM entities WHERE id = ?1", params![id])
      .map_err(|e| CoreError::storage(format!("删除实体失败: {e}")))?;
    drop(conn);
    Ok(affected > 0)
  }

  /// 根据 id 部分更新实体字段
  ///
  /// 仅更新 changes 对象中包含的字段，支持 `type`、`name`、`description`、`properties`、`tags`、`avatar`、`updatedAt`/`updated_at`。
  /// 如果 changes 为空对象则不做任何操作。
  ///
  /// - `id` - 要更新的实体唯一标识
  /// - `changes` - JSON 对象，包含需要更新的字段和值
  /// - 返回 true 表示更新成功，false 表示无字段需要更新或实体不存在，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, `changes` is not an object, or the update fails.
  pub fn update_entity(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    let obj = changes
      .as_object()
      .ok_or_else(|| CoreError::InvalidArgument("changes 必须是对象".to_string()))?;

    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for (key, value) in obj {
      match key.as_str() {
        "type" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("type = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "name" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("name = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "description" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("description = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "properties" => {
          let s = serde_json::to_string(value).unwrap_or_default();
          set_clauses.push("properties = ?".to_string());
          param_values.push(Box::new(s));
        }
        "tags" => {
          let s = serde_json::to_string(value).unwrap_or_default();
          set_clauses.push("tags = ?".to_string());
          param_values.push(Box::new(s));
        }
        "avatar" => {
          let s = value.as_str().map(ToString::to_string).unwrap_or_default();
          set_clauses.push("avatar = ?".to_string());
          param_values.push(Box::new(s));
        }
        "updatedAt" | "updated_at" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("updated_at = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        _ => {}
      }
    }

    if set_clauses.is_empty() {
      drop(conn);
      return Ok(false);
    }

    let sql = format!(
      "UPDATE entities SET {set_clauses} WHERE id = ?",
      set_clauses = set_clauses.join(", ")
    );

    param_values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> =
      param_values.iter().map(std::convert::AsRef::as_ref).collect();

    let affected = conn
      .execute(&sql, params.as_slice())
      .map_err(|e| CoreError::storage(format!("更新实体失败: {e}")))?;

    drop(conn);
    Ok(affected > 0)
  }

  /// 按实体类型统计实体数量
  ///
  /// - 返回 (类型名称, 该类型数量) 的元组列表，按数量降序排列，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn count_entities_by_type(&self) -> Result<Vec<(String, usize)>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT type, COUNT(*) as cnt FROM entities GROUP BY type ORDER BY cnt DESC")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt
      .query_map([], |row| {
        let type_name: String = row.get(0)?;
        let count: usize = row.get(1)?;
        Ok((type_name, count))
      })
      .map_err(|e| CoreError::storage(format!("统计实体失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(result)
  }

  /// 写入或替换一个关系
  ///
  /// 如果同 id 的关系已存在则覆盖，否则插入新记录。
  ///
  /// - `relation` - 要写入的关系引用
  /// - 返回写入成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the insert fails.
  pub fn put_relation(&self, relation: &Relation) -> Result<(), CoreError> {
    if relation.id.is_empty() {
      return Err(CoreError::InvalidArgument("关系 ID 不能为空".to_string()));
    }
    if relation.relation_type.is_empty() {
      return Err(CoreError::InvalidArgument("关系类型不能为空".to_string()));
    }
    if relation.source_id.is_empty() || relation.target_id.is_empty() {
      return Err(CoreError::InvalidArgument("关系源/目标 ID 不能为空".to_string()));
    }

    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let props = serde_json::to_string(&relation.properties).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
            "INSERT OR REPLACE INTO relations (id, type, source_id, target_id, label, properties, pair_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                relation.id,
                relation.relation_type,
                relation.source_id,
                relation.target_id,
                relation.label,
                props,
                relation.pair_id,
                relation.created_at,
                relation.updated_at,
            ],
        ).map_err(|e| CoreError::storage(format!("写入关系失败: {e}")))?;

    drop(conn);
    Ok(())
  }

  /// 根据 id 查询关系
  ///
  /// - `id` - 关系唯一标识
  /// - 返回 Some(Relation) 表示找到，None 表示不存在，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query preparation fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_relation(&self, id: &str) -> Result<Option<Relation>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, source_id, target_id, label, properties, pair_id, created_at, updated_at FROM relations WHERE id = ?1")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt.query_row(params![id], |row| Ok(relation_from_row(row))).ok();

    Ok(result)
  }

  /// 获取所有关系
  ///
  /// - 返回关系列表，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_all_relations(&self) -> Result<Vec<Relation>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, source_id, target_id, label, properties, pair_id, created_at, updated_at FROM relations")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let relations = stmt
      .query_map([], |row| Ok(relation_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询关系失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(relations)
  }

  /// 查询与指定实体相关的所有关系
  ///
  /// 返回该实体作为 `source_id` 或 `target_id` 出现的所有关系。
  ///
  /// - `entity_id` - 实体唯一标识
  /// - 返回与该实体相关的所有关系，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_relations_by_entity(&self, entity_id: &str) -> Result<Vec<Relation>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
            .prepare("SELECT id, type, source_id, target_id, label, properties, pair_id, created_at, updated_at FROM relations WHERE source_id = ?1 OR target_id = ?1")
            .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let relations = stmt
      .query_map(params![entity_id], |row| Ok(relation_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询关系失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(relations)
  }

  /// 根据 id 删除关系
  ///
  /// - `id` - 要删除的关系唯一标识
  /// - 返回 true 表示成功删除，false 表示关系不存在，删除失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn delete_relation(&self, id: &str) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let affected = conn
      .execute("DELETE FROM relations WHERE id = ?1", params![id])
      .map_err(|e| CoreError::storage(format!("删除关系失败: {e}")))?;
    drop(conn);
    Ok(affected > 0)
  }

  /// 删除与指定实体相关的所有关系
  ///
  /// 删除该实体作为 `source_id` 或 `target_id` 出现的所有关系记录。
  ///
  /// - `entity_id` - 实体唯一标识
  /// - 返回被删除的关系数量，删除失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn delete_relations_by_entity(&self, entity_id: &str) -> Result<usize, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let affected = conn
      .execute("DELETE FROM relations WHERE source_id = ?1 OR target_id = ?1", params![entity_id])
      .map_err(|e| CoreError::storage(format!("删除关系失败: {e}")))?;
    drop(conn);
    Ok(affected)
  }

  /// 根据键获取键值对中的值
  ///
  /// - `key` - 键名
  /// - 返回 Some(值) 表示找到，None 表示键不存在，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query preparation fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn kv_get(&self, key: &str) -> Result<Option<String>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT value FROM kv_store WHERE key = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt.query_row(params![key], |row| row.get::<_, String>(0)).ok();

    Ok(result)
  }

  /// 设置键值对
  ///
  /// 如果键已存在则覆盖其值，否则插入新记录。
  ///
  /// - `key` - 键名
  /// - `value` - 值内容
  /// - 返回写入成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the insert fails.
  pub fn kv_set(&self, key: &str, value: &str) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn
      .execute("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?1, ?2)", params![key, value])
      .map_err(|e| CoreError::storage(format!("KV 写入失败: {e}")))?;
    drop(conn);
    Ok(())
  }

  /// 删除指定键的键值对（不存在则静默成功）
  pub fn kv_delete(&self, key: &str) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn
      .execute("DELETE FROM kv_store WHERE key = ?1", params![key])
      .map_err(|e| CoreError::storage(format!("KV 删除失败: {e}")))?;
    Ok(())
  }

  /// 清空所有键值对
  pub fn kv_clear(&self) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn.execute("DELETE FROM kv_store", []).map_err(|e| CoreError::storage(format!("KV 清空失败: {e}")))?;
    Ok(())
  }

  /// 清空模块表
  pub fn clear_modules(&self) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn.execute("DELETE FROM modules", []).map_err(|e| CoreError::storage(format!("清空 modules 失败: {e}")))?;
    Ok(())
  }

  /// 获取所有键值对
  ///
  /// - 返回 (键, 值) 元组列表，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn kv_get_all(&self) -> Result<Vec<(String, String)>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT key, value FROM kv_store")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt
      .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
      .map_err(|e| CoreError::storage(format!("查询 KV 失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(result)
  }

  /// 写入或替换一个模块记录
  ///
  /// 如果同 `id` 的模块已存在则覆盖，否则插入新记录。`installed_at` 自动设置为当前时间。
  ///
  /// - `id` - 模块唯一标识
  /// - `active` - 模块是否激活
  /// - `source` - 模块来源标识
  /// - `manifest_json` - 模块清单的 JSON 字符串
  /// - 返回写入成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the insert fails.
  pub fn put_module(
    &self,
    id: &str,
    active: bool,
    source: &str,
    manifest_json: &str,
  ) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn.execute(
            "INSERT OR REPLACE INTO modules (id, active, source, manifest, installed_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
            params![id, i32::from(active), source, manifest_json],
        ).map_err(|e| CoreError::storage(format!("写入模块失败: {e}")))?;
    drop(conn);
    Ok(())
  }

  /// 根据 id 查询模块
  ///
  /// - `id` - 模块唯一标识
  /// - 返回 Some(JSON对象) 表示找到，None 表示不存在，查询失败时返回 `CoreError`。
  ///   返回的 JSON 对象包含 id、active、source、manifest、installedAt 字段
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query preparation fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_module(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, active, source, manifest, installed_at FROM modules WHERE id = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt
            .query_row(params![id], |row| {
                let manifest_str: String = row.get(3).unwrap_or_default();
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0).unwrap_or_default(),
                    "active": row.get::<_, i32>(1).unwrap_or(1) == 1,
                    "source": row.get::<_, String>(2).unwrap_or_default(),
                    "manifest": serde_json::from_str::<serde_json::Value>(&manifest_str).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::default())),
                    "installedAt": row.get::<_, String>(4).unwrap_or_default(),
                }))
            })
            .ok();

    Ok(result)
  }

  /// 获取所有模块
  ///
  /// - 返回模块 JSON 对象列表，每个对象包含 id、active、source、manifest、installedAt 字段，查询失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_all_modules(&self) -> Result<Vec<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, active, source, manifest, installed_at FROM modules")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let modules = stmt
            .query_map([], |row| {
                let manifest_str: String = row.get(3).unwrap_or_default();
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0).unwrap_or_default(),
                    "active": row.get::<_, i32>(1).unwrap_or(1) == 1,
                    "source": row.get::<_, String>(2).unwrap_or_default(),
                    "manifest": serde_json::from_str::<serde_json::Value>(&manifest_str).unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::default())),
                    "installedAt": row.get::<_, String>(4).unwrap_or_default(),
                }))
            })
            .map_err(|e| CoreError::storage(format!("查询模块失败: {e}")))?
            .filter_map(Result::ok)
            .collect();

    Ok(modules)
  }

  /// 根据 id 删除模块
  ///
  /// - `id` - 要删除的模块唯一标识
  /// - 返回 true 表示成功删除，false 表示模块不存在，删除失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn delete_module(&self, id: &str) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let affected = conn
      .execute("DELETE FROM modules WHERE id = ?1", params![id])
      .map_err(|e| CoreError::storage(format!("删除模块失败: {e}")))?;
    drop(conn);
    Ok(affected > 0)
  }

  /// 根据 id 部分更新模块字段
  ///
  /// 仅更新 changes 对象中包含的字段，支持 active、source、manifest。
  /// 如果 changes 为空对象则不做任何操作。
  ///
  /// - `id` - 要更新的模块唯一标识
  /// - `changes` - JSON 对象，包含需要更新的字段和值
  /// - 返回 true 表示更新成功，false 表示无字段需要更新或模块不存在，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, `changes` is not an object, or the update fails.
  pub fn update_module(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    let obj = changes
      .as_object()
      .ok_or_else(|| CoreError::InvalidArgument("changes 必须是对象".to_string()))?;

    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for (key, value) in obj {
      match key.as_str() {
        "active" => {
          let active = i32::from(value.as_bool().unwrap_or(true));
          set_clauses.push("active = ?".to_string());
          param_values.push(Box::new(active));
        }
        "source" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("source = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "manifest" => {
          let s = serde_json::to_string(value).unwrap_or_default();
          set_clauses.push("manifest = ?".to_string());
          param_values.push(Box::new(s));
        }
        _ => {}
      }
    }

    if set_clauses.is_empty() {
      drop(conn);
      return Ok(false);
    }

    let sql = format!(
      "UPDATE modules SET {set_clauses} WHERE id = ?",
      set_clauses = set_clauses.join(", ")
    );

    param_values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> =
      param_values.iter().map(std::convert::AsRef::as_ref).collect();

    let affected = conn
      .execute(&sql, params.as_slice())
      .map_err(|e| CoreError::storage(format!("更新模块失败: {e}")))?;

    drop(conn);
    Ok(affected > 0)
  }

  /// 根据 id 部分更新关系字段
  ///
  /// 仅更新 changes 对象中包含的字段，支持 `type`、`sourceId`/`source_id`、`targetId`/`target_id`、`label`、`properties`、`pairId`/`pair_id`、`updatedAt`/`updated_at`。
  /// 如果 changes 为空对象则不做任何操作。
  ///
  /// - `id` - 要更新的关系唯一标识
  /// - `changes` - JSON 对象，包含需要更新的字段和值
  /// - 返回 true 表示更新成功，false 表示无字段需要更新或关系不存在，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, `changes` is not an object, or the update fails.
  pub fn update_relation(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    let obj = changes
      .as_object()
      .ok_or_else(|| CoreError::InvalidArgument("changes 必须是对象".to_string()))?;

    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for (key, value) in obj {
      match key.as_str() {
        "type" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("type = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "sourceId" | "source_id" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("source_id = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "targetId" | "target_id" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("target_id = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "label" => {
          let s = value.as_str().map(ToString::to_string);
          set_clauses.push("label = ?".to_string());
          param_values.push(Box::new(s));
        }
        "properties" => {
          let s = serde_json::to_string(value).unwrap_or_default();
          set_clauses.push("properties = ?".to_string());
          param_values.push(Box::new(s));
        }
        "pairId" | "pair_id" => {
          let s = value.as_str().map(ToString::to_string);
          set_clauses.push("pair_id = ?".to_string());
          param_values.push(Box::new(s));
        }
        "updatedAt" | "updated_at" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("updated_at = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        _ => {}
      }
    }

    if set_clauses.is_empty() {
      drop(conn);
      return Ok(false);
    }

    let sql = format!(
      "UPDATE relations SET {set_clauses} WHERE id = ?",
      set_clauses = set_clauses.join(", ")
    );

    param_values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> =
      param_values.iter().map(std::convert::AsRef::as_ref).collect();

    let affected = conn
      .execute(&sql, params.as_slice())
      .map_err(|e| CoreError::storage(format!("更新关系失败: {e}")))?;

    drop(conn);
    Ok(affected > 0)
  }

  // ── 文件存储方法 ──────────────────────────────────────────

  /// 写入或替换一个文件及其内容
  ///
  /// 同时向 files 和 file_contents 表插入记录。如果同 id 已存在则覆盖。
  ///
  /// - `file_json` - 文件元数据的 JSON 字符串，包含 id、name、path、mimeType、size、entityId、tags、createdAt、updatedAt
  /// - `content_json` - 文件内容的 JSON 字符串，包含 id、textContent、binaryData
  /// - 返回写入成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, JSON parsing fails, or the insert fails.
  pub fn put_file(&self, file_json: &str, content_json: &str) -> Result<(), CoreError> {
    let file: serde_json::Value = serde_json::from_str(file_json)?;
    let content: serde_json::Value = serde_json::from_str(content_json)?;

    let id = file["id"].as_str().unwrap_or("").to_string();
    if id.is_empty() {
      return Err(CoreError::InvalidArgument("文件 ID 不能为空".to_string()));
    }

    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    conn.execute(
            "INSERT OR REPLACE INTO files (id, name, path, mime_type, size, entity_id, tags, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                file["name"].as_str().unwrap_or(""),
                file["path"].as_str().unwrap_or(""),
                file["mimeType"].as_str().unwrap_or(""),
                file["size"].as_i64().unwrap_or(0),
                file["entityId"].as_str(),
                serde_json::to_string(&file["tags"]).unwrap_or_else(|_| "[]".to_string()),
                file["createdAt"].as_str().unwrap_or(""),
                file["updatedAt"].as_str().unwrap_or(""),
            ],
        ).map_err(|e| CoreError::storage(format!("写入文件失败: {e}")))?;

    let text_content = content["textContent"].as_str();
    let binary_data = content["binaryData"].as_str();

    conn.execute(
            "INSERT OR REPLACE INTO file_contents (id, text_content, binary_data)
             VALUES (?1, ?2, ?3)",
            params![id, text_content, binary_data],
        ).map_err(|e| CoreError::storage(format!("写入文件内容失败: {e}")))?;

    drop(conn);
    Ok(())
  }

  /// 获取所有文件元数据
  ///
  /// - 返回文件 JSON 对象列表，每个对象包含 id、name、path、mimeType、size、entityId、tags、createdAt、updatedAt 字段
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_all_files(&self) -> Result<Vec<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, name, path, mime_type AS mimeType, size, entity_id AS entityId, tags, created_at AS createdAt, updated_at AS updatedAt FROM files")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let files = stmt
      .query_map([], |row| Ok(file_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询文件失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(files)
  }

  /// 根据 id 查询文件元数据
  ///
  /// - `id` - 文件唯一标识
  /// - 返回 Some(JSON对象) 表示找到，None 表示不存在
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_file(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, name, path, mime_type AS mimeType, size, entity_id AS entityId, tags, created_at AS createdAt, updated_at AS updatedAt FROM files WHERE id = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt.query_row(params![id], |row| Ok(file_from_row(row))).ok();
    Ok(result)
  }

  /// 根据路径查询文件元数据
  ///
  /// - `path` - 文件路径
  /// - 返回 Some(JSON对象) 表示找到，None 表示不存在
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_file_by_path(&self, path: &str) -> Result<Option<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, name, path, mime_type AS mimeType, size, entity_id AS entityId, tags, created_at AS createdAt, updated_at AS updatedAt FROM files WHERE path = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt.query_row(params![path], |row| Ok(file_from_row(row))).ok();
    Ok(result)
  }

  /// 根据关联实体 id 查询文件列表
  ///
  /// - `entity_id` - 关联的实体唯一标识
  /// - 返回与该实体关联的所有文件
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_files_by_entity(&self, entity_id: &str) -> Result<Vec<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, name, path, mime_type AS mimeType, size, entity_id AS entityId, tags, created_at AS createdAt, updated_at AS updatedAt FROM files WHERE entity_id = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let files = stmt
      .query_map(params![entity_id], |row| Ok(file_from_row(row)))
      .map_err(|e| CoreError::storage(format!("查询文件失败: {e}")))?
      .filter_map(Result::ok)
      .collect();

    Ok(files)
  }

  /// 根据 id 部分更新文件元数据字段
  ///
  /// 仅更新 changes 对象中包含的字段，支持 name、path、mimeType、size、entityId、tags、updatedAt/updated_at。
  /// 如果 changes 为空对象则不做任何操作。
  ///
  /// - `id` - 要更新的文件唯一标识
  /// - `changes` - JSON 对象，包含需要更新的字段和值
  /// - 返回 true 表示更新成功，false 表示无字段需要更新或文件不存在
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, `changes` is not an object, or the update fails.
  pub fn update_file(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;

    let obj = changes
      .as_object()
      .ok_or_else(|| CoreError::InvalidArgument("changes 必须是对象".to_string()))?;

    let mut set_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    for (key, value) in obj {
      match key.as_str() {
        "name" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("name = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "path" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("path = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "mimeType" | "mime_type" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("mime_type = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        "size" => {
          if let Some(n) = value.as_i64() {
            set_clauses.push("size = ?".to_string());
            param_values.push(Box::new(n));
          }
        }
        "entityId" | "entity_id" => {
          let s = value.as_str().map(ToString::to_string);
          set_clauses.push("entity_id = ?".to_string());
          param_values.push(Box::new(s));
        }
        "tags" => {
          let s = serde_json::to_string(value).unwrap_or_default();
          set_clauses.push("tags = ?".to_string());
          param_values.push(Box::new(s));
        }
        "updatedAt" | "updated_at" => {
          if let Some(s) = value.as_str() {
            set_clauses.push("updated_at = ?".to_string());
            param_values.push(Box::new(s.to_string()));
          }
        }
        _ => {}
      }
    }

    if set_clauses.is_empty() {
      drop(conn);
      return Ok(false);
    }

    let sql = format!(
      "UPDATE files SET {set_clauses} WHERE id = ?",
      set_clauses = set_clauses.join(", ")
    );

    param_values.push(Box::new(id.to_string()));

    let params: Vec<&dyn rusqlite::types::ToSql> =
      param_values.iter().map(std::convert::AsRef::as_ref).collect();

    let affected = conn
      .execute(&sql, params.as_slice())
      .map_err(|e| CoreError::storage(format!("更新文件失败: {e}")))?;

    drop(conn);
    Ok(affected > 0)
  }

  /// 根据 id 删除文件及其内容
  ///
  /// 同时删除 files 和 file_contents 表中的记录。
  ///
  /// - `id` - 要删除的文件唯一标识
  /// - 返回 true 表示成功删除，false 表示文件不存在
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn delete_file(&self, id: &str) -> Result<bool, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    // file_contents has ON DELETE CASCADE, so deleting from files is sufficient
    let affected = conn
      .execute("DELETE FROM files WHERE id = ?1", params![id])
      .map_err(|e| CoreError::storage(format!("删除文件失败: {e}")))?;
    drop(conn);
    Ok(affected > 0)
  }

  /// 根据 id 查询文件内容
  ///
  /// - `id` - 文件唯一标识
  /// - 返回 Some(JSON对象) 表示找到（包含 id、textContent、binaryData），None 表示不存在
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the query fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn get_file_content(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let mut stmt = conn
      .prepare("SELECT id, text_content AS textContent, binary_data AS binaryData FROM file_contents WHERE id = ?1")
      .map_err(|e| CoreError::storage(format!("查询准备失败: {e}")))?;

    let result = stmt
      .query_row(params![id], |row| {
        let text_content: Option<String> = row.get(1).unwrap_or(None);
        let binary_data: Option<String> = row.get(2).unwrap_or(None);
        Ok(serde_json::json!({
            "id": row.get::<_, String>(0).unwrap_or_default(),
            "textContent": text_content,
            "binaryData": binary_data,
        }))
      })
      .ok();

    Ok(result)
  }

  /// 清空所有实体记录
  ///
  /// 删除 entities 表中的全部数据。
  ///
  /// - 返回清空成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn clear_entities(&self) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn
      .execute("DELETE FROM entities", [])
      .map_err(|e| CoreError::storage(format!("清空实体失败: {e}")))?;
    drop(conn);
    Ok(())
  }

  /// 清空所有关系记录
  ///
  /// 删除 relations 表中的全部数据。
  ///
  /// - 返回清空成功或错误
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired or the delete fails.
  pub fn clear_relations(&self) -> Result<(), CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    conn
      .execute("DELETE FROM relations", [])
      .map_err(|e| CoreError::storage(format!("清空关系失败: {e}")))?;
    drop(conn);
    Ok(())
  }

  /// 批量导入实体
  ///
  /// 在事务中逐条插入或替换实体，任一条失败则整体回滚。
  ///
  /// - `entities` - 要导入的实体切片
  /// - 返回成功导入的实体数量，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, the transaction fails, or any insert fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn import_entities(&self, entities: &[Entity]) -> Result<usize, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let tx =
      conn.unchecked_transaction().map_err(|e| CoreError::storage(format!("事务开始失败: {e}")))?;

    let mut count = 0usize;
    for entity in entities {
      let props = serde_json::to_string(&entity.properties).unwrap_or_else(|_| "{}".to_string());
      let tags = serde_json::to_string(&entity.tags).unwrap_or_else(|_| "[]".to_string());

      tx.execute(
                "INSERT OR REPLACE INTO entities (id, type, name, description, properties, tags, avatar, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    entity.id, entity.entity_type, entity.name, entity.description,
                    props, tags, entity.avatar, entity.created_at, entity.updated_at,
                ],
            ).map_err(|e| CoreError::storage(format!("导入实体失败 (id={entity_id}): {e}", entity_id = entity.id)))?;
      count += 1;
    }

    tx.commit().map_err(|e| CoreError::storage(format!("事务提交失败: {e}")))?;
    Ok(count)
  }

  /// 批量导入关系
  ///
  /// 在事务中逐条插入或替换关系，任一条失败则整体回滚。
  ///
  /// - `relations` - 要导入的关系切片
  /// - 返回成功导入的关系数量，失败时返回 `CoreError`
  ///
  /// # Errors
  ///
  /// Returns `CoreError` if the lock cannot be acquired, the transaction fails, or any insert fails.
  #[allow(clippy::significant_drop_tightening)]
  pub fn import_relations(&self, relations: &[Relation]) -> Result<usize, CoreError> {
    let conn = self.conn.lock().map_err(|e| CoreError::Lock(e.to_string()))?;
    let tx =
      conn.unchecked_transaction().map_err(|e| CoreError::storage(format!("事务开始失败: {e}")))?;

    let mut count = 0usize;
    for relation in relations {
      let props = serde_json::to_string(&relation.properties).unwrap_or_else(|_| "{}".to_string());

      tx.execute(
                "INSERT OR REPLACE INTO relations (id, type, source_id, target_id, label, properties, pair_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    relation.id, relation.relation_type, relation.source_id, relation.target_id,
                    relation.label, props, relation.pair_id, relation.created_at, relation.updated_at,
                ],
            ).map_err(|e| CoreError::storage(format!("导入关系失败 (id={relation_id}): {e}", relation_id = relation.id)))?;
      count += 1;
    }

    tx.commit().map_err(|e| CoreError::storage(format!("事务提交失败: {e}")))?;
    Ok(count)
  }
}

fn entity_from_row(row: &rusqlite::Row) -> Entity {
  let props_str: String = row.get(4).unwrap_or_default();
  let tags_str: String = row.get(5).unwrap_or_default();

  Entity {
    id: row.get(0).unwrap_or_default(),
    entity_type: row.get(1).unwrap_or_default(),
    name: row.get(2).unwrap_or_default(),
    description: row.get(3).unwrap_or_default(),
    properties: serde_json::from_str(&props_str)
      .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::default())),
    tags: serde_json::from_str(&tags_str).unwrap_or_default(),
    avatar: row.get(6).unwrap_or(None),
    created_at: row.get(7).unwrap_or_default(),
    updated_at: row.get(8).unwrap_or_default(),
  }
}

fn relation_from_row(row: &rusqlite::Row) -> Relation {
  let props_str: String = row.get(5).unwrap_or_default();

  Relation {
    id: row.get(0).unwrap_or_default(),
    relation_type: row.get(1).unwrap_or_default(),
    source_id: row.get(2).unwrap_or_default(),
    target_id: row.get(3).unwrap_or_default(),
    label: row.get(4).unwrap_or(None),
    properties: serde_json::from_str(&props_str)
      .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::default())),
    pair_id: row.get(6).unwrap_or(None),
    created_at: row.get(7).unwrap_or_default(),
    updated_at: row.get(8).unwrap_or_default(),
  }
}

fn file_from_row(row: &rusqlite::Row) -> serde_json::Value {
  let tags_str: String = row.get(6).unwrap_or_default();
  let entity_id: Option<String> = row.get(5).unwrap_or(None);

  serde_json::json!({
      "id": row.get::<_, String>(0).unwrap_or_default(),
      "name": row.get::<_, String>(1).unwrap_or_default(),
      "path": row.get::<_, String>(2).unwrap_or_default(),
      "mimeType": row.get::<_, String>(3).unwrap_or_default(),
      "size": row.get::<_, i64>(4).unwrap_or(0),
      "entityId": entity_id,
      "tags": serde_json::from_str::<serde_json::Value>(&tags_str).unwrap_or_else(|_| serde_json::Value::Array(vec![])),
      "createdAt": row.get::<_, String>(7).unwrap_or_default(),
      "updatedAt": row.get::<_, String>(8).unwrap_or_default(),
  })
}

impl super::StorageBackend for SqliteStore {
  fn put_entity(&self, entity: &Entity) -> Result<(), CoreError> {
    Self::put_entity(self, entity)
  }
  fn get_entity(&self, id: &str) -> Result<Option<Entity>, CoreError> {
    Self::get_entity(self, id)
  }
  fn get_all_entities(&self) -> Result<Vec<Entity>, CoreError> {
    Self::get_all_entities(self)
  }
  fn get_entities_by_type(&self, entity_type: &str) -> Result<Vec<Entity>, CoreError> {
    Self::get_entities_by_type(self, entity_type)
  }
  fn update_entity(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    Self::update_entity(self, id, changes)
  }
  fn delete_entity(&self, id: &str) -> Result<bool, CoreError> {
    Self::delete_entity(self, id)
  }
  fn count_entities_by_type(&self) -> Result<Vec<(String, usize)>, CoreError> {
    Self::count_entities_by_type(self)
  }
  fn clear_entities(&self) -> Result<(), CoreError> {
    Self::clear_entities(self)
  }
  fn import_entities(&self, entities: &[Entity]) -> Result<usize, CoreError> {
    Self::import_entities(self, entities)
  }

  fn put_relation(&self, relation: &Relation) -> Result<(), CoreError> {
    Self::put_relation(self, relation)
  }
  fn get_relation(&self, id: &str) -> Result<Option<Relation>, CoreError> {
    Self::get_relation(self, id)
  }
  fn get_all_relations(&self) -> Result<Vec<Relation>, CoreError> {
    Self::get_all_relations(self)
  }
  fn get_relations_by_entity(&self, entity_id: &str) -> Result<Vec<Relation>, CoreError> {
    Self::get_relations_by_entity(self, entity_id)
  }
  fn update_relation(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    Self::update_relation(self, id, changes)
  }
  fn delete_relation(&self, id: &str) -> Result<bool, CoreError> {
    Self::delete_relation(self, id)
  }
  fn delete_relations_by_entity(&self, entity_id: &str) -> Result<usize, CoreError> {
    Self::delete_relations_by_entity(self, entity_id)
  }
  fn clear_relations(&self) -> Result<(), CoreError> {
    Self::clear_relations(self)
  }
  fn import_relations(&self, relations: &[Relation]) -> Result<usize, CoreError> {
    Self::import_relations(self, relations)
  }

  fn kv_get(&self, key: &str) -> Result<Option<String>, CoreError> {
    Self::kv_get(self, key)
  }
  fn kv_set(&self, key: &str, value: &str) -> Result<(), CoreError> {
    Self::kv_set(self, key, value)
  }
  fn kv_get_all(&self) -> Result<Vec<(String, String)>, CoreError> {
    Self::kv_get_all(self)
  }
  fn kv_delete(&self, key: &str) -> Result<(), CoreError> {
    Self::kv_delete(self, key)
  }

  fn put_module(
    &self,
    id: &str,
    active: bool,
    source: &str,
    manifest_json: &str,
  ) -> Result<(), CoreError> {
    Self::put_module(self, id, active, source, manifest_json)
  }
  fn get_module(&self, id: &str) -> Result<Option<serde_json::Value>, CoreError> {
    Self::get_module(self, id)
  }
  fn get_all_modules(&self) -> Result<Vec<serde_json::Value>, CoreError> {
    Self::get_all_modules(self)
  }
  fn update_module(&self, id: &str, changes: &serde_json::Value) -> Result<bool, CoreError> {
    Self::update_module(self, id, changes)
  }
  fn delete_module(&self, id: &str) -> Result<bool, CoreError> {
    Self::delete_module(self, id)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn make_entity(id: &str, etype: &str) -> Entity {
    Entity {
      id: id.to_string(),
      entity_type: etype.to_string(),
      name: format!("实体{id}"),
      description: "描述".to_string(),
      properties: serde_json::json!({"key": "value"}),
      tags: vec!["tag1".to_string()],
      avatar: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  fn make_relation(id: &str, rtype: &str, source: &str, target: &str) -> Relation {
    Relation {
      id: id.to_string(),
      relation_type: rtype.to_string(),
      source_id: source.to_string(),
      target_id: target.to_string(),
      label: Some("标签".to_string()),
      properties: serde_json::json!({}),
      pair_id: None,
      created_at: "2024-01-01".to_string(),
      updated_at: "2024-01-01".to_string(),
    }
  }

  #[test]
  fn test_open_in_memory() {
    let store = SqliteStore::open_in_memory();
    assert!(store.is_ok());
  }

  #[test]
  fn test_put_and_get_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    let entity = make_entity("e1", "character");
    store.put_entity(&entity).unwrap();
    let got = store.get_entity("e1").unwrap();
    assert!(got.is_some());
    assert_eq!(got.unwrap().id, "e1");
  }

  #[test]
  fn test_get_entity_not_found() {
    let store = SqliteStore::open_in_memory().unwrap();
    let got = store.get_entity("nonexistent").unwrap();
    assert!(got.is_none());
  }

  #[test]
  fn test_get_entities_by_type() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    store.put_entity(&make_entity("e2", "character")).unwrap();
    store.put_entity(&make_entity("e3", "region")).unwrap();
    let chars = store.get_entities_by_type("character").unwrap();
    assert_eq!(chars.len(), 2);
  }

  #[test]
  fn test_update_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    store.update_entity("e1", &serde_json::json!({"name": "新名称"})).unwrap();
    let got = store.get_entity("e1").unwrap().unwrap();
    assert_eq!(got.name, "新名称");
  }

  #[test]
  fn test_delete_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    let deleted = store.delete_entity("e1").unwrap();
    assert!(deleted);
    assert!(store.get_entity("e1").unwrap().is_none());
  }

  #[test]
  fn test_count_entities_by_type() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    store.put_entity(&make_entity("e2", "character")).unwrap();
    store.put_entity(&make_entity("e3", "region")).unwrap();
    let counts = store.count_entities_by_type().unwrap();
    assert_eq!(counts.len(), 2);
  }

  #[test]
  fn test_put_and_get_relation() {
    let store = SqliteStore::open_in_memory().unwrap();
    let rel = make_relation("r1", "knows", "e1", "e2");
    store.put_relation(&rel).unwrap();
    let got = store.get_relation("r1").unwrap();
    assert!(got.is_some());
    assert_eq!(got.unwrap().id, "r1");
  }

  #[test]
  fn test_get_relations_by_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_relation(&make_relation("r1", "knows", "e1", "e2")).unwrap();
    store.put_relation(&make_relation("r2", "knows", "e3", "e1")).unwrap();
    let rels = store.get_relations_by_entity("e1").unwrap();
    assert_eq!(rels.len(), 2);
  }

  #[test]
  fn test_delete_relations_by_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_relation(&make_relation("r1", "knows", "e1", "e2")).unwrap();
    store.put_relation(&make_relation("r2", "knows", "e3", "e1")).unwrap();
    let deleted = store.delete_relations_by_entity("e1").unwrap();
    assert_eq!(deleted, 2);
  }

  #[test]
  fn test_import_entities() {
    let store = SqliteStore::open_in_memory().unwrap();
    let entities = vec![make_entity("e1", "character"), make_entity("e2", "region")];
    let count = store.import_entities(&entities).unwrap();
    assert_eq!(count, 2);
    assert_eq!(store.get_all_entities().unwrap().len(), 2);
  }

  #[test]
  fn test_kv_operations() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.kv_set("key1", "value1").unwrap();
    let got = store.kv_get("key1").unwrap();
    assert_eq!(got, Some("value1".to_string()));
    let missing = store.kv_get("missing").unwrap();
    assert!(missing.is_none());
  }

  #[test]
  fn test_module_crud() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_module("mod1", true, "local", r#"{"name":"test"}"#).unwrap();
    let got = store.get_module("mod1").unwrap();
    assert!(got.is_some());
    let all = store.get_all_modules().unwrap();
    assert_eq!(all.len(), 1);
    store.update_module("mod1", &serde_json::json!({"active": false})).unwrap();
    let updated = store.get_module("mod1").unwrap().unwrap();
    assert_eq!(updated["active"], false);
    let deleted = store.delete_module("mod1").unwrap();
    assert!(deleted);
  }

  #[test]
  fn test_clear_entities() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    store.put_entity(&make_entity("e2", "region")).unwrap();
    store.clear_entities().unwrap();
    assert_eq!(store.get_all_entities().unwrap().len(), 0);
  }

  #[test]
  fn test_update_relation() {
    let store = SqliteStore::open_in_memory().unwrap();
    let rel = make_relation("r1", "knows", "e1", "e2");
    store.put_relation(&rel).unwrap();
    store.update_relation("r1", &serde_json::json!({"label": "新标签"})).unwrap();
    let got = store.get_relation("r1").unwrap().unwrap();
    assert_eq!(got.label, Some("新标签".to_string()));
  }

  #[test]
  fn test_clear_relations() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_relation(&make_relation("r1", "knows", "e1", "e2")).unwrap();
    store.put_relation(&make_relation("r2", "knows", "e3", "e4")).unwrap();
    store.clear_relations().unwrap();
    assert_eq!(store.get_all_relations().unwrap().len(), 0);
  }

  #[test]
  fn test_import_relations() {
    let store = SqliteStore::open_in_memory().unwrap();
    let rels =
      vec![make_relation("r1", "knows", "e1", "e2"), make_relation("r2", "located_in", "e1", "e3")];
    let count = store.import_relations(&rels).unwrap();
    assert_eq!(count, 2);
    assert_eq!(store.get_all_relations().unwrap().len(), 2);
  }

  #[test]
  fn test_concurrent_access() {
    use std::sync::Arc;
    use std::thread;

    let store = Arc::new(SqliteStore::open_in_memory().unwrap());
    let mut handles = Vec::new();

    for i in 0..4 {
      let s = Arc::clone(&store);
      handles.push(thread::spawn(move || {
        for j in 0..10 {
          let idx = i * 10 + j;
          let entity = Entity {
            id: format!("e{idx}"),
            entity_type: "character".to_string(),
            name: format!("实体{idx}"),
            description: "".to_string(),
            properties: serde_json::json!({}),
            tags: vec![],
            avatar: None,
            created_at: "2024-01-01".to_string(),
            updated_at: "2024-01-01".to_string(),
          };
          s.put_entity(&entity).unwrap();
        }
      }));
    }

    for h in handles {
      h.join().unwrap();
    }

    assert_eq!(store.get_all_entities().unwrap().len(), 40);
  }

  #[test]
  fn test_update_entity_empty_changes() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_entity(&make_entity("e1", "character")).unwrap();
    let result = store.update_entity("e1", &serde_json::json!({})).unwrap();
    assert!(!result);
  }

  #[test]
  fn test_update_relation_empty_changes() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.put_relation(&make_relation("r1", "knows", "e1", "e2")).unwrap();
    let result = store.update_relation("r1", &serde_json::json!({})).unwrap();
    assert!(!result);
  }

  #[test]
  fn test_delete_nonexistent_entity() {
    let store = SqliteStore::open_in_memory().unwrap();
    let result = store.delete_entity("ghost").unwrap();
    assert!(!result);
  }

  #[test]
  fn test_delete_nonexistent_relation() {
    let store = SqliteStore::open_in_memory().unwrap();
    let result = store.delete_relation("ghost").unwrap();
    assert!(!result);
  }

  #[test]
  fn test_get_relation_not_found() {
    let store = SqliteStore::open_in_memory().unwrap();
    let result = store.get_relation("nonexistent").unwrap();
    assert!(result.is_none());
  }

  #[test]
  fn test_kv_overwrite() {
    let store = SqliteStore::open_in_memory().unwrap();
    store.kv_set("key1", "value1").unwrap();
    store.kv_set("key1", "value2").unwrap();
    let got = store.kv_get("key1").unwrap();
    assert_eq!(got, Some("value2".to_string()));
  }
}
