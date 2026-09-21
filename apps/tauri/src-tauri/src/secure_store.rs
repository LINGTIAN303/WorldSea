//! 安全存储命令（cmd_secure_store / cmd_secure_load / cmd_secure_delete）
//!
//! 背景：前端 `packages/agent-runtime/src/providers/key-store.ts` 在 Tauri 环境优先走 Keyring
//! （`cmd_secure_store`），但 Tauri 端此前从未注册这些命令 → Keyring 检测失败 → 每次都降级到
//! localStorage 加密存储（且每次都打 `cmd_secure_store not found` 警告）。前端降级后 key 仍可
//! 存取，但存于浏览器 localStorage，且不符合桌面应用「密钥落系统数据目录」的惯例。
//!
//! 本模块补齐这三个命令：用 SQLite（应用数据目录 `secure_store.db`）持久化，key→value 明文落库。
//! 说明：此处按前端 `key-store.ts` 的降级层次，value 本身由前端 AES-GCM 加密后再交本命令存储
//! （前端 `storeApiKey` 先 encrypt 再 tauriStore）。因此本命令不做二次加密，仅做持久化——
//! 保持与 Web 降级路径一致的安全级别。若未来需要强 Keyring（系统凭据管理器），可在此替换实现。

use std::sync::Arc;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::State;

/// 安全存储数据库（key → value 加密串）
pub struct SecureStore {
    pool: SqlitePool,
}

impl SecureStore {
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
            .map_err(|e| format!("打开安全存储数据库失败: {e}"))?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS secure_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .map_err(|e| format!("创建 secure_store 表失败: {e}"))?;
        Ok(Arc::new(Self { pool }))
    }

    /// 写入（覆盖语义，幂等）
    pub(crate) async fn set(&self, key: &str, value: &str) -> Result<(), String> {
        sqlx::query("INSERT OR REPLACE INTO secure_store (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("写入安全存储失败: {e}"))?;
        Ok(())
    }

    /// 读取（无返回 None）
    pub(crate) async fn get(&self, key: &str) -> Result<Option<String>, String> {
        let row: Option<(String,)> = sqlx::query_as("SELECT value FROM secure_store WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| format!("读取安全存储失败: {e}"))?;
        Ok(row.map(|(v,)| v))
    }

    /// 删除（返回是否命中）
    pub(crate) async fn delete(&self, key: &str) -> Result<bool, String> {
        let res = sqlx::query("DELETE FROM secure_store WHERE key = ?")
            .bind(key)
            .execute(&self.pool)
            .await
            .map_err(|e| format!("删除安全存储失败: {e}"))?;
        Ok(res.rows_affected() > 0)
    }
}

/// 写入 / 更新安全存储项（覆盖语义）
///
/// 注意 State 键为 `Arc<SecureStore>`——manage 的是 `Arc<Self>`（new 返回 Arc），
/// 取裸 `SecureStore` 会 state() panic（2026-08-29 修复的存量 bug）。
#[tauri::command]
pub async fn cmd_secure_store(state: State<'_, Arc<SecureStore>>, key: String, value: String) -> Result<(), String> {
    state.set(&key, &value).await
}

/// 读取安全存储项（不存在的 key 返回空字符串，与前端 key-store 期望一致）
#[tauri::command]
pub async fn cmd_secure_load(state: State<'_, Arc<SecureStore>>, key: String) -> Result<String, String> {
    Ok(state.get(&key).await?.unwrap_or_default())
}

/// 删除安全存储项（不存在视为成功）
#[tauri::command]
pub async fn cmd_secure_delete(state: State<'_, Arc<SecureStore>>, key: String) -> Result<(), String> {
    let _ = state.delete(&key).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时文件库（避免污染真实数据目录）
    ///
    /// 路径必须**逐次独占**：只按进程号命名的话，同二进制内的多个测试会共用一个文件，
    /// 并行时 `remove_file` + 并发建表会撞 `SQLITE_BUSY`（code: 5 database is locked）。
    async fn temp_store() -> Arc<SecureStore> {
        let path = temp_db_path();
        let _ = std::fs::remove_file(&path);
        SecureStore::new(path.to_str().unwrap()).await.expect("建临时库失败")
    }

    fn temp_db_path() -> std::path::PathBuf {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "ws_secure_test_{}_{}.db",
            std::process::id(),
            n
        ))
    }

    #[tokio::test]
    async fn set_get_roundtrip() {
        let s = temp_store().await;
        s.set("provider:deepseek", "sk-encrypted").await.unwrap();
        let v = s.get("provider:deepseek").await.unwrap();
        assert_eq!(v.as_deref(), Some("sk-encrypted"));
    }

    #[tokio::test]
    async fn get_missing_returns_none() {
        let s = temp_store().await;
        assert_eq!(s.get("ghost").await.unwrap(), None);
    }

    #[tokio::test]
    async fn set_overwrites() {
        let s = temp_store().await;
        s.set("k", "v1").await.unwrap();
        s.set("k", "v2").await.unwrap();
        assert_eq!(s.get("k").await.unwrap().as_deref(), Some("v2"));
    }

    #[tokio::test]
    async fn delete_removes_and_reports() {
        let s = temp_store().await;
        s.set("k", "v").await.unwrap();
        assert!(s.delete("k").await.unwrap());
        assert_eq!(s.get("k").await.unwrap(), None);
        // 再删不存在 → false 但不报错
        assert!(!s.delete("k").await.unwrap());
    }
}