//! A2 戊1：语义检索配置命令（embedding 端点 / 模型 / 维度 / Key）
//!
//! 配置分两处落盘（均为本机应用数据目录，不入仓库）：
//! - **非敏感字段** → `{app_data}/worldsea/semantic.json`（enabled / api_url / model / dim / timeout）
//! - **API Key** → `secure_store.db`（与前端 key-store 同库；JSON 里不留明文）
//!
//! 保存后经**共享配置句柄**（`AgentCommandService::with_semantic_config` 注入的同一
//! Arc）即时生效到所有会话：访问器每次取用时读取最新配置，检索栈按配置指纹自动重建。
//!
//! 命令面：读配置 / 存配置 / 索引状态 / 重建索引（4 个；HTTP 桥同步注册）。

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use tauri::State;

use agent_commands::{AgentCommandService, SemanticConfig, SemanticStats};

use crate::secure_store::SecureStore;

/// SecureStore 中 API Key 的条目名
const KEY_NAME: &str = "semantic_embedding_api_key";

/// 默认值（面向已选定的 v1 端点：硅基流动 bge-m3，OpenAI 兼容 /v1/embeddings）
const DEFAULT_API_URL: &str = "https://api.siliconflow.cn/v1/embeddings";
const DEFAULT_MODEL: &str = "BAAI/bge-m3";
const DEFAULT_DIM: usize = 1024;
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// 前端读写的设置形状（**不回传 Key 明文**，只给「是否已配置」）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSettings {
    /// 是否启用语义检索（关闭 = 召回/去重走既有文本路径）
    pub enabled: bool,
    /// OpenAI 兼容端点（含 /v1/embeddings）
    pub api_url: String,
    /// 模型名（如 BAAI/bge-m3）
    pub model: String,
    /// 向量维度（须与模型一致；变更会触发索引重建）
    pub dim: usize,
    /// 请求超时（秒）
    pub timeout_secs: u64,
    /// Key 是否已配置（只读展示）
    pub api_key_set: bool,
}

/// 设置更新入参（`api_key = Some` 才会覆盖已有 Key；`clear_api_key` 显式清除）
#[derive(Debug, Clone, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSettingsPatch {
    pub enabled: Option<bool>,
    pub api_url: Option<String>,
    pub model: Option<String>,
    pub dim: Option<usize>,
    pub timeout_secs: Option<u64>,
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

/// 重建索引结果
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticRebuildResult {
    /// 本次索引的文档数（该会话的摘要条数）
    pub docs: usize,
    /// 重建后的索引状态
    pub stats: SemanticStats,
}

/// 磁盘上的持久化形状（非敏感字段）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    enabled: bool,
    api_url: String,
    model: String,
    dim: usize,
    timeout_secs: u64,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            api_url: DEFAULT_API_URL.into(),
            model: DEFAULT_MODEL.into(),
            dim: DEFAULT_DIM,
            timeout_secs: DEFAULT_TIMEOUT_SECS,
        }
    }
}

/// 语义检索配置存储（Tauri 管理状态）
pub struct SemanticStore {
    /// JSON 配置文件路径
    config_path: PathBuf,
    /// 安全存储（API Key）
    secure: Arc<SecureStore>,
    /// 共享配置句柄（与 AgentCommandService 同一实例；保存即生效）
    shared: Arc<RwLock<Option<SemanticConfig>>>,
}

impl SemanticStore {
    /// 构造（不读盘；调用方随后调 [`Self::load_into_shared`]）
    pub fn new(
        config_path: PathBuf,
        secure: Arc<SecureStore>,
        shared: Arc<RwLock<Option<SemanticConfig>>>,
    ) -> Self {
        Self {
            config_path,
            secure,
            shared,
        }
    }

    /// 启动加载：读 JSON + Key → 装配配置写进共享句柄
    ///
    /// 读盘失败按默认值处理（不阻断启动）；Key 缺失时 `enabled` 形同关闭
    /// （装配不出配置 → 召回走既有路径，行为安全）。
    pub async fn load_into_shared(&self) {
        let settings = self.read_persisted();
        let key = self.read_key().await.unwrap_or_default();
        let assembled = Self::assemble(&settings, &key);
        match &assembled {
            Some(cfg) => tracing::info!(
                model = %cfg.model,
                dim = cfg.dim,
                "语义检索已启用（A2 戊1）"
            ),
            None => {
                if settings.enabled {
                    tracing::warn!("语义检索已开启但配置不完整（缺 API Key / 端点 / 模型），按未启用处理");
                }
            }
        }
        if let Ok(mut guard) = self.shared.write() {
            *guard = assembled;
        }
    }

    /// 读盘（缺失/损坏 → 默认值）
    fn read_persisted(&self) -> PersistedSettings {
        std::fs::read_to_string(&self.config_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    async fn read_key(&self) -> Result<String, String> {
        Ok(self.secure.get(KEY_NAME).await?.unwrap_or_default())
    }

    /// 装配运行时配置：启用且四要素齐全才产出 `Some`
    fn assemble(settings: &PersistedSettings, api_key: &str) -> Option<SemanticConfig> {
        if !settings.enabled
            || settings.api_url.trim().is_empty()
            || settings.model.trim().is_empty()
            || settings.dim == 0
            || api_key.trim().is_empty()
        {
            return None;
        }
        Some(SemanticConfig {
            api_url: settings.api_url.trim().to_string(),
            api_key: api_key.trim().to_string(),
            model: settings.model.trim().to_string(),
            dim: settings.dim,
            timeout_secs: settings.timeout_secs.clamp(1, 300),
        })
    }

    /// 读设置（给前端；含 Key 是否已配置）
    pub async fn read_settings(&self) -> Result<SemanticSettings, String> {
        let p = self.read_persisted();
        let key_set = !self.read_key().await?.trim().is_empty();
        Ok(SemanticSettings {
            enabled: p.enabled,
            api_url: p.api_url,
            model: p.model,
            dim: p.dim,
            timeout_secs: p.timeout_secs,
            api_key_set: key_set,
        })
    }

    /// 应用更新：写 Key → 写 JSON → 重装共享配置
    pub async fn apply_patch(&self, patch: SemanticSettingsPatch) -> Result<SemanticSettings, String> {
        let mut p = self.read_persisted();
        if let Some(v) = patch.enabled {
            p.enabled = v;
        }
        if let Some(v) = patch.api_url {
            p.api_url = v.trim().to_string();
        }
        if let Some(v) = patch.model {
            p.model = v.trim().to_string();
        }
        if let Some(v) = patch.dim {
            p.dim = v;
        }
        if let Some(v) = patch.timeout_secs {
            p.timeout_secs = v.clamp(1, 300);
        }

        // Key：显式清除优先；否则仅在传入非空时覆盖（空串 = 保持不变）
        if patch.clear_api_key {
            self.secure.delete(KEY_NAME).await?;
        } else if let Some(key) = patch.api_key.as_deref() {
            let key = key.trim();
            if !key.is_empty() {
                self.secure.set(KEY_NAME, key).await?;
            }
        }

        // 启用前的完整性校验（宁可明确报错，不要「开着但不生效」）
        if p.enabled {
            let key = self.read_key().await?;
            if p.api_url.is_empty() || p.model.is_empty() || p.dim == 0 {
                return Err("启用语义检索需要完整配置：端点 / 模型 / 维度".into());
            }
            if key.trim().is_empty() {
                return Err("启用语义检索需要配置 API Key".into());
            }
        }

        // 落盘（原子性靠「先写临时文件再改名」不必要——单用户桌面，写入失败即报错）
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
        }
        let json = serde_json::to_string_pretty(&p).map_err(|e| format!("序列化配置失败: {e}"))?;
        std::fs::write(&self.config_path, json).map_err(|e| format!("写入配置失败: {e}"))?;

        // 即时生效：重装共享配置（所有会话的访问器引用同一 Arc）
        let key = self.read_key().await?;
        let assembled = Self::assemble(&p, &key);
        if let Ok(mut guard) = self.shared.write() {
            *guard = assembled;
        }
        tracing::info!(enabled = p.enabled, model = %p.model, "语义检索配置已更新（A2 戊1）");

        self.read_settings().await
    }
}

// ─── Tauri 命令 ──────────────────────────────────────────

/// 读取语义检索配置（不含 Key 明文）
#[tauri::command]
pub async fn cmd_semantic_config_get(
    store: State<'_, Arc<SemanticStore>>,
) -> Result<SemanticSettings, String> {
    store.read_settings().await
}

/// 更新语义检索配置（保存即生效；Key 走安全存储）
#[tauri::command]
pub async fn cmd_semantic_config_set(
    store: State<'_, Arc<SemanticStore>>,
    settings: SemanticSettingsPatch,
) -> Result<SemanticSettings, String> {
    store.apply_patch(settings).await
}

/// 语义索引状态（关键词 / 向量条数 + 维度）
#[tauri::command]
pub async fn cmd_semantic_status(
    svc: State<'_, AgentCommandService>,
) -> Result<SemanticStats, String> {
    Ok(svc.semantic_status().await)
}

/// 重建某会话的语义索引（返回索引文档数与重建后状态）
#[tauri::command]
pub async fn cmd_semantic_rebuild(
    svc: State<'_, AgentCommandService>,
    session_id: String,
) -> Result<SemanticRebuildResult, String> {
    let docs = svc
        .rebuild_semantic_index(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(SemanticRebuildResult {
        docs,
        stats: svc.semantic_status().await,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assemble_requires_complete_config() {
        let mut p = PersistedSettings {
            enabled: true,
            ..Default::default()
        };
        // 缺 Key → None
        assert!(SemanticStore::assemble(&p, "").is_none());
        // 禁用 → None（即使齐备）
        assert!(SemanticStore::assemble(&p, "sk-x").is_some());
        p.enabled = false;
        assert!(SemanticStore::assemble(&p, "sk-x").is_none());
        // 维度 0 / 端点空 → None
        p.enabled = true;
        p.dim = 0;
        assert!(SemanticStore::assemble(&p, "sk-x").is_none());
        p.dim = 1024;
        p.api_url = "  ".into();
        assert!(SemanticStore::assemble(&p, "sk-x").is_none());
    }

    #[test]
    fn assemble_trims_and_clamps() {
        let p = PersistedSettings {
            enabled: true,
            api_url: " https://api.siliconflow.cn/v1/embeddings ".into(),
            model: " BAAI/bge-m3 ".into(),
            dim: 1024,
            timeout_secs: 9999,
        };
        let cfg = SemanticStore::assemble(&p, " sk-key ").unwrap();
        assert_eq!(cfg.api_url, "https://api.siliconflow.cn/v1/embeddings");
        assert_eq!(cfg.model, "BAAI/bge-m3");
        assert_eq!(cfg.api_key, "sk-key");
        assert_eq!(cfg.timeout_secs, 300, "超时应被夹到上限");
    }
}
