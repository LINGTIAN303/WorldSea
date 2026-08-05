//! # 子 Agent 规格持久化（SQLite）
//!
//! 子 Agent 规格注册表默认只在内存（`Arc<RwLock<Vec<SubAgentSpec>>>`），应用重启后
//! 用户在前端「子 Agent」标签页配置的规格会全部丢失。本模块提供**可选的持久化层**：
//! 把规格以 JSON 整条写入 SQLite，启动时加载进内存注册表、注册/删除时写穿。
//!
//! ## 为什么用 JSON 整条存储而非逐列拆字段
//! `SubAgentSpec`（id/name/description/system_prompt/tools_whitelist/max_iterations）已
//! derive `Serialize`/`Deserialize`。整条 JSON 存储让 `SubAgentSpec` 未来增删字段时**无需
//! 任何 schema 迁移**——旧 JSON 反序列化时缺字段走 serde 默认，新 JSON 直接入库。若逐列
//! 拆字段，每加一个字段就要跑一次 `ALTER TABLE`，维护成本高且易错。
//!
//! ## 架构
//! 存储层抽象为 [`SubAgentSpecStore`] trait（可测试），SQLite 实现为
//! [`SqliteSubAgentSpecStore`]。`AgentCommandService` 持有一个可选的
//! `Option<Arc<dyn SubAgentSpecStore>>`：
//! - `None`（默认）：纯内存，行为与改造前完全一致（单测/无持久化场景）。
//! - `Some`：构造时 `load_all` 装入内存注册表，此后注册/删除写穿到 SQLite。

use std::sync::Arc;

use agent_runtime::supervisor::SubAgentSpec;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::CommandError;

/// 子 Agent 规格持久化存储抽象
///
/// 独立为 trait 便于：单测用内存实现验证业务逻辑，不经真实 DB；真实场景用
/// [`SqliteSubAgentSpecStore`]。
#[async_trait::async_trait]
pub trait SubAgentSpecStore: Send + Sync {
    /// 加载全部规格（启动时装入内存注册表）
    async fn load_all(&self) -> Result<Vec<SubAgentSpec>, CommandError>;
    /// 写入/覆盖一条规格（写穿；同名 id 走 upsert）
    async fn upsert(&self, spec: &SubAgentSpec) -> Result<(), CommandError>;
    /// 删除一条规格，返回是否真的删除（id 不存在返回 `false`）
    async fn remove(&self, id: &str) -> Result<bool, CommandError>;
}

/// SQLite 实现：单表 `sub_agent_specs(id, spec_json, updated_at)`
pub struct SqliteSubAgentSpecStore {
    pool: SqlitePool,
}

impl SqliteSubAgentSpecStore {
    /// 打开（不存在则创建）数据库文件并建表（幂等，可重复调用）
    ///
    /// 用 WAL 日志模式：读写不互斥，适合"低频写 + 高频读"的规格注册表场景。
    pub async fn new(path: &str) -> Result<Arc<Self>, CommandError> {
        let opts = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal);
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(opts)
            .await
            .map_err(|e| CommandError::Internal(format!("打开子 Agent 规格数据库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Arc::new(Self { pool }))
    }

    /// 内存数据库（单测用）
    ///
    /// `sqlite::memory:` 每个连接独立，故限定 `max_connections = 1`，
    /// 保证同一 Pool 内数据跨多次查询可见（模拟"重启后仍能读到"）。
    pub async fn new_in_memory() -> Result<Arc<Self>, CommandError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .map_err(|e| CommandError::Internal(format!("打开内存规格库失败: {e}")))?;
        Self::init(&pool).await?;
        Ok(Arc::new(Self { pool }))
    }

    /// 建表（幂等）
    async fn init(pool: &SqlitePool) -> Result<(), CommandError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS sub_agent_specs (
                id         TEXT PRIMARY KEY,
                spec_json  TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )",
        )
        .execute(pool)
        .await
        .map_err(|e| CommandError::Internal(format!("初始化子 Agent 规格表失败: {e}")))?;
        Ok(())
    }
}

#[async_trait::async_trait]
impl SubAgentSpecStore for SqliteSubAgentSpecStore {
    async fn load_all(&self) -> Result<Vec<SubAgentSpec>, CommandError> {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT spec_json FROM sub_agent_specs")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("读取子 Agent 规格失败: {e}")))?;
        let mut specs = Vec::with_capacity(rows.len());
        for (json,) in rows {
            let spec: SubAgentSpec = serde_json::from_str(&json).map_err(|e| {
                CommandError::Internal(format!("解析子 Agent 规格 JSON 失败: {e}"))
            })?;
            specs.push(spec);
        }
        Ok(specs)
    }

    async fn upsert(&self, spec: &SubAgentSpec) -> Result<(), CommandError> {
        let json = serde_json::to_string(spec)
            .map_err(|e| CommandError::Internal(format!("序列化子 Agent 规格失败: {e}")))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        sqlx::query(
            "INSERT INTO sub_agent_specs (id, spec_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET spec_json = ?2, updated_at = ?3",
        )
        .bind(&spec.id)
        .bind(&json)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| CommandError::Internal(format!("写入子 Agent 规格失败: {e}")))?;
        Ok(())
    }

    async fn remove(&self, id: &str) -> Result<bool, CommandError> {
        let res = sqlx::query("DELETE FROM sub_agent_specs WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| CommandError::Internal(format!("删除子 Agent 规格失败: {e}")))?;
        Ok(res.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str, name: &str) -> SubAgentSpec {
        SubAgentSpec {
            id: id.into(),
            name: name.into(),
            description: format!("{name} 专长"),
            system_prompt: format!("你是{name}专家"),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(5),
        }
    }

    #[tokio::test]
    async fn upsert_load_remove_roundtrip() {
        let store = SqliteSubAgentSpecStore::new_in_memory().await.unwrap();
        assert!(store.load_all().await.unwrap().is_empty());

        store.upsert(&spec("coder", "代码助手")).await.unwrap();
        store.upsert(&spec("writer", "写作助手")).await.unwrap();
        let all = store.load_all().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|s| s.id == "coder"));

        // 同名 id 覆盖不产生重复
        store.upsert(&spec("coder", "新版代码助手")).await.unwrap();
        let all = store.load_all().await.unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|s| s.id == "coder" && s.name == "新版代码助手"));

        // 删除
        assert!(store.remove("coder").await.unwrap());
        assert!(!store.remove("coder").await.unwrap(), "重复删除应返回 false");
        let all = store.load_all().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "writer");
    }

    #[tokio::test]
    async fn persists_across_restart() {
        // 用临时文件模拟真实数据库；drop 掉旧 store（关闭连接池）后新建，
        // 模拟"应用重启"——数据应仍可加载。
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("specs.db");
        let path = db_path.to_str().unwrap().to_string();

        {
            let store = SqliteSubAgentSpecStore::new(&path).await.unwrap();
            store.upsert(&spec("coder", "代码助手")).await.unwrap();
        } // drop store → 连接池关闭

        let store = SqliteSubAgentSpecStore::new(&path).await.unwrap();
        let all = store.load_all().await.unwrap();
        assert_eq!(all.len(), 1, "重启后应能加载已持久化的规格");
        assert_eq!(all[0].id, "coder");
    }
}