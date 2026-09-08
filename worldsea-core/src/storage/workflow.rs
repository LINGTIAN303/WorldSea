//! 工作流定义与运行历史的 Sqlite 存储
//!
//! 在 [`SqliteStore`] 之上提供 workflow-specific 的 CRUD。读写全程走
//! `with_conn` 闭包，与 `SqliteStore` 自身的 `Mutex<Connection>` 锁协议对齐。
//!
//! 主要表：
//!   * `workflows`            — 工作流定义（按 `(id, version)` 版本化）
//!   * `workflow_runs`        — 每次运行实例
//!   * `workflow_node_logs`   — 节点粒度日志（流式 chunk、result、heartbeat…）
//!   * `workflow_pending_dispatches` — 派发追踪（Phase 2 引擎使用）
//!   * `workflow_settings`    — 保留天数等设置 KV

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::CoreError;
use crate::workflow::parser::{parse_definition, serialize_definition, ParseFormat};
use crate::workflow::types::WorkflowDefinition;

/// 工作流定义摘要（用于列表）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkflowSummary {
  pub id: String,
  pub latest_version: u32,
  pub name: String,
  pub category: String,
  pub description: Option<String>,
  pub updated_at: i64,
}

/// 工作流运行摘要
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunSummary {
  pub run_id: String,
  pub workflow_id: String,
  pub workflow_version: u32,
  pub status: String,
  pub triggered_by: String,
  pub started_at: i64,
  pub completed_at: Option<i64>,
  pub error: Option<String>,
}

/// 工作流子存储。所有方法均在 `SqliteStore` 的全局锁内执行。
pub struct WorkflowStore<'a> {
  conn: &'a Connection,
}

impl<'a> WorkflowStore<'a> {
  pub fn new(conn: &'a Connection) -> Self {
    Self { conn }
  }

  /// 保存工作流定义（同 `(id, version)` 覆盖）
  pub fn save(&self, def: &WorkflowDefinition) -> Result<(), CoreError> {
    let now = now_ms();
    let json =
      serde_json::to_string(def).map_err(|e| CoreError::storage(format!("序列化失败: {e}")))?;
    self.conn
            .execute(
                "INSERT INTO workflows (id, version, name, category, description, definition_json, schema_version, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
                 ON CONFLICT(id, version) DO UPDATE SET
                    name=excluded.name, category=excluded.category, description=excluded.description,
                    definition_json=excluded.definition_json, updated_at=excluded.updated_at",
                params![def.id, def.version, def.name, def.category, def.description, json, def.schema_version, now],
            )
            .map_err(|e| CoreError::storage(format!("save workflow 失败: {e}")))?;
    Ok(())
  }

  /// 取最新版本的工作流定义
  pub fn get(&self, id: &str) -> Result<WorkflowDefinition, CoreError> {
    let json: String = self
      .conn
      .query_row(
        "SELECT definition_json FROM workflows WHERE id = ?1 ORDER BY version DESC LIMIT 1",
        params![id],
        |row| row.get(0),
      )
      .map_err(|_| CoreError::NotFound(format!("workflow 不存在: {id}")))?;
    parse_definition(&json, ParseFormat::Auto)
  }

  /// 取指定版本
  pub fn get_version(&self, id: &str, version: u32) -> Result<WorkflowDefinition, CoreError> {
    let json: String = self
      .conn
      .query_row(
        "SELECT definition_json FROM workflows WHERE id = ?1 AND version = ?2",
        params![id, version],
        |row| row.get(0),
      )
      .map_err(|_| CoreError::NotFound(format!("workflow {id}@v{version} 不存在")))?;
    parse_definition(&json, ParseFormat::Auto)
  }

  /// 列出工作流（按 id 取最新 version），支持 category / keyword 过滤
  pub fn list(
    &self,
    category: Option<&str>,
    keyword: Option<&str>,
    limit: u32,
  ) -> Result<Vec<WorkflowSummary>, CoreError> {
    let mut sql = String::from(
      "SELECT w.id, w.version, w.name, w.category, w.description, w.updated_at
             FROM workflows w
             INNER JOIN (
                SELECT id, MAX(version) AS max_v FROM workflows GROUP BY id
             ) latest ON latest.id = w.id AND latest.max_v = w.version
             WHERE 1=1",
    );
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(cat) = category {
      sql.push_str(" AND w.category = ?");
      binds.push(Box::new(cat.to_string()));
    }
    if let Some(kw) = keyword {
      sql.push_str(" AND (w.name LIKE ? OR w.description LIKE ?)");
      let pattern = format!("%{kw}%");
      binds.push(Box::new(pattern.clone()));
      binds.push(Box::new(pattern));
    }
    sql.push_str(" ORDER BY w.updated_at DESC LIMIT ?");
    binds.push(Box::new(limit));
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let mut stmt = self.conn.prepare(&sql).map_err(|e| CoreError::storage(e.to_string()))?;
    let rows = stmt
      .query_map(&bind_refs[..], |row| {
        Ok(WorkflowSummary {
          id: row.get(0)?,
          latest_version: row.get::<_, u32>(1)?,
          name: row.get(2)?,
          category: row.get(3)?,
          description: row.get(4)?,
          updated_at: row.get(5)?,
        })
      })
      .map_err(|e| CoreError::storage(e.to_string()))?;
    rows.into_iter().map(|r| r.map_err(|e| CoreError::storage(e.to_string()))).collect()
  }

  /// 列出某 id 的所有版本号（降序）
  pub fn list_versions(&self, id: &str) -> Result<Vec<u32>, CoreError> {
    let mut stmt = self
      .conn
      .prepare("SELECT version FROM workflows WHERE id = ?1 ORDER BY version DESC")
      .map_err(|e| CoreError::storage(e.to_string()))?;
    let rows = stmt
      .query_map(params![id], |row| row.get::<_, u32>(0))
      .map_err(|e| CoreError::storage(e.to_string()))?;
    rows.into_iter().map(|r| r.map_err(|e| CoreError::storage(e.to_string()))).collect()
  }

  /// 删除工作流定义（含历史版本）；若仍有 runs 引用，则拒绝
  pub fn delete(&self, id: &str) -> Result<(), CoreError> {
    let count: i64 = self
      .conn
      .query_row("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?1", params![id], |row| {
        row.get(0)
      })
      .map_err(|e| CoreError::storage(e.to_string()))?;
    if count > 0 {
      return Err(CoreError::InvalidArgument(format!(
        "工作流 {id} 有 {count} 条运行记录，无法直接删除。请先 archive 或清空 runs"
      )));
    }
    self
      .conn
      .execute("DELETE FROM workflows WHERE id = ?1", params![id])
      .map_err(|e| CoreError::storage(format!("delete workflow 失败: {e}")))?;
    Ok(())
  }

  /// 创建一次运行记录，返回新 run_id
  pub fn create_run(
    &self,
    workflow_id: &str,
    version: u32,
    triggered_by: &str,
    params_value: Value,
  ) -> Result<String, CoreError> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let params_json = serde_json::to_string(&params_value)
      .map_err(|e| CoreError::storage(format!("params 序列化失败: {e}")))?;
    let now = now_ms();
    self.conn
            .execute(
                "INSERT INTO workflow_runs (run_id, workflow_id, workflow_version, status, triggered_by, params_json, started_at)
                 VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?6)",
                params![run_id, workflow_id, version, triggered_by, params_json, now],
            )
            .map_err(|e| CoreError::storage(format!("create_run 失败: {e}")))?;
    Ok(run_id)
  }

  /// 更新 run 状态。`completed_at = None` 表示不修改（用于 `running` 等中间态）
  pub fn update_run_status(
    &self,
    run_id: &str,
    status: &str,
    completed_at: Option<i64>,
  ) -> Result<(), CoreError> {
    self.conn
            .execute(
                "UPDATE workflow_runs SET status = ?1, completed_at = COALESCE(?2, completed_at) WHERE run_id = ?3",
                params![status, completed_at, run_id],
            )
            .map_err(|e| CoreError::storage(format!("update_run_status 失败: {e}")))?;
    Ok(())
  }

  /// 追加节点日志
  pub fn append_node_log(
    &self,
    run_id: &str,
    node_id: &str,
    kind: &str,
    payload: Option<Value>,
  ) -> Result<(), CoreError> {
    let payload_json = match payload {
      Some(v) => Some(serde_json::to_string(&v).map_err(|e| CoreError::storage(e.to_string()))?),
      None => None,
    };
    let now = now_ms();
    self.conn
            .execute(
                "INSERT INTO workflow_node_logs (run_id, node_id, kind, payload_json, ts) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![run_id, node_id, kind, payload_json, now],
            )
            .map_err(|e| CoreError::storage(format!("append_node_log 失败: {e}")))?;
    Ok(())
  }

  /// 列出运行记录
  pub fn list_runs(
    &self,
    workflow_id: Option<&str>,
    status: Option<&str>,
    limit: u32,
  ) -> Result<Vec<RunSummary>, CoreError> {
    let mut sql = String::from(
            "SELECT run_id, workflow_id, workflow_version, status, triggered_by, started_at, completed_at, error
             FROM workflow_runs WHERE 1=1",
        );
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(wid) = workflow_id {
      sql.push_str(" AND workflow_id = ?");
      binds.push(Box::new(wid.to_string()));
    }
    if let Some(s) = status {
      sql.push_str(" AND status = ?");
      binds.push(Box::new(s.to_string()));
    }
    sql.push_str(" ORDER BY started_at DESC LIMIT ?");
    binds.push(Box::new(limit));
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let mut stmt = self.conn.prepare(&sql).map_err(|e| CoreError::storage(e.to_string()))?;
    let rows = stmt
      .query_map(&bind_refs[..], |row| {
        Ok(RunSummary {
          run_id: row.get(0)?,
          workflow_id: row.get(1)?,
          workflow_version: row.get(2)?,
          status: row.get(3)?,
          triggered_by: row.get(4)?,
          started_at: row.get(5)?,
          completed_at: row.get(6)?,
          error: row.get(7)?,
        })
      })
      .map_err(|e| CoreError::storage(e.to_string()))?;
    rows.into_iter().map(|r| r.map_err(|e| CoreError::storage(e.to_string()))).collect()
  }

  /// 取单条 run
  pub fn get_run(&self, run_id: &str) -> Result<RunSummary, CoreError> {
    self.conn
            .query_row(
                "SELECT run_id, workflow_id, workflow_version, status, triggered_by, started_at, completed_at, error
                 FROM workflow_runs WHERE run_id = ?1",
                params![run_id],
                |row| {
                    Ok(RunSummary {
                        run_id: row.get(0)?,
                        workflow_id: row.get(1)?,
                        workflow_version: row.get(2)?,
                        status: row.get(3)?,
                        triggered_by: row.get(4)?,
                        started_at: row.get(5)?,
                        completed_at: row.get(6)?,
                        error: row.get(7)?,
                    })
                },
            )
            .map_err(|_| CoreError::NotFound(format!("run {run_id} 不存在")))
  }

  /// 清理 N 天前已完成的 runs，返回被删条数
  pub fn purge_old_runs(&self, retention_days: u32) -> Result<u32, CoreError> {
    let cutoff = now_ms() - (retention_days as i64) * 86_400_000;
    let count = self
            .conn
            .execute(
                "DELETE FROM workflow_runs WHERE status IN ('completed','failed','cancelled') AND completed_at IS NOT NULL AND completed_at < ?1",
                params![cutoff],
            )
            .map_err(|e| CoreError::storage(format!("purge_old_runs 失败: {e}")))?;
    Ok(count as u32)
  }

  /// 清理过期 pending_dispatches
  pub fn purge_stale_pending_dispatches(&self, ttl_ms: i64) -> Result<u32, CoreError> {
    let cutoff = now_ms() - ttl_ms;
    let count = self
      .conn
      .execute("DELETE FROM workflow_pending_dispatches WHERE dispatched_at < ?1", params![cutoff])
      .map_err(|e| CoreError::storage(format!("purge_stale 失败: {e}")))?;
    Ok(count as u32)
  }

  /// 注册一次派发（用于 crash 恢复 + 心跳追踪）
  pub fn register_pending_dispatch(
    &self,
    request_id: &str,
    run_id: &str,
    node_id: &str,
    protocol: &str,
  ) -> Result<(), CoreError> {
    let now = now_ms();
    self.conn
            .execute(
                "INSERT INTO workflow_pending_dispatches (request_id, run_id, node_id, protocol, dispatched_at, last_heartbeat_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?5)
                 ON CONFLICT(request_id) DO UPDATE SET
                    run_id=excluded.run_id, node_id=excluded.node_id, protocol=excluded.protocol,
                    dispatched_at=excluded.dispatched_at, last_heartbeat_at=excluded.last_heartbeat_at",
                params![request_id, run_id, node_id, protocol, now],
            )
            .map_err(|e| CoreError::storage(format!("register_pending_dispatch 失败: {e}")))?;
    Ok(())
  }

  /// 更新心跳（TS 端定期调）
  pub fn update_pending_dispatch_heartbeat(&self, request_id: &str) -> Result<(), CoreError> {
    let now = now_ms();
    self
      .conn
      .execute(
        "UPDATE workflow_pending_dispatches SET last_heartbeat_at = ?1 WHERE request_id = ?2",
        params![now, request_id],
      )
      .map_err(|e| CoreError::storage(format!("update_heartbeat 失败: {e}")))?;
    Ok(())
  }

  /// 移除 pending（节点完成 / 取消时调用）
  pub fn remove_pending_dispatch(&self, request_id: &str) -> Result<(), CoreError> {
    self
      .conn
      .execute("DELETE FROM workflow_pending_dispatches WHERE request_id = ?1", params![request_id])
      .map_err(|e| CoreError::storage(format!("remove_pending 失败: {e}")))?;
    Ok(())
  }

  /// 列出某 run 还在 pending 的派发（hydrate / 监控用）
  pub fn list_pending_dispatches_for_run(
    &self,
    run_id: &str,
  ) -> Result<Vec<(String, String, String, String)>, CoreError> {
    let mut stmt = self
      .conn
      .prepare(
        "SELECT request_id, node_id, protocol, dispatched_at
                 FROM workflow_pending_dispatches WHERE run_id = ?1",
      )
      .map_err(|e| CoreError::storage(e.to_string()))?;
    let rows = stmt
      .query_map(params![run_id], |row| {
        Ok((
          row.get::<_, String>(0)?,
          row.get::<_, String>(1)?,
          row.get::<_, String>(2)?,
          row.get::<_, i64>(3)?.to_string(),
        ))
      })
      .map_err(|e| CoreError::storage(e.to_string()))?;
    rows.into_iter().map(|r| r.map_err(|e| CoreError::storage(e.to_string()))).collect()
  }

  /// 暴露只读访问，用于 engine 之类的强类型调用
  pub fn conn(&self) -> &Connection {
    self.conn
  }

  /// 序列化为 JSON/YAML
  pub fn serialize(
    &self,
    def: &WorkflowDefinition,
    format: ParseFormat,
  ) -> Result<String, CoreError> {
    serialize_definition(def, format).map_err(Into::into)
  }
}

fn now_ms() -> i64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as i64)
    .unwrap_or(0)
}
