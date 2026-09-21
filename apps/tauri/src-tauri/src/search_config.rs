//! B3 搜索配置存储（引擎偏好 + Provider API Key，落 JSON / SecureStore 并装配降级链）
//! 详细设计见 docs/details/注释/apps/tauri/search-config.md

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::search_commands::{SearchConfig, SearchProviderChain};
use crate::secure_store::SecureStore;

/// 可选引擎（与设置面板 `searchEngineOptions` 同集合；DuckDuckGo 只作免 Key 兜底，不可选）
pub const VALID_ENGINES: [&str; 3] = ["tavily", "bing", "serpapi"];
/// 缺省引擎（与 `web_search` 工具侧默认值一致）
const DEFAULT_ENGINE: &str = "tavily";

// SecureStore 条目名：一处定义，跨栈守卫与排查以此为准
const KEY_TAVILY: &str = "web_search_tavily_key";
const KEY_BING: &str = "web_search_bing_key";
const KEY_SERPAPI: &str = "web_search_serpapi_key";

/// 归一化引擎名：空 → 缺省；未知 → 明确报错（不静默回落到别的引擎）
pub fn normalize_engine(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return Ok(DEFAULT_ENGINE.to_string());
    }
    if VALID_ENGINES.contains(&trimmed.as_str()) {
        return Ok(trimmed);
    }
    Err(format!(
        "不支持的搜索引擎: {raw}（可选 {}）",
        VALID_ENGINES.join(" / ")
    ))
}

/// 引擎 → SecureStore 条目名；不可选引擎（如 duckduckgo）无 Key 槽位
fn key_name_for(engine: &str) -> Option<&'static str> {
    match engine {
        "tavily" => Some(KEY_TAVILY),
        "bing" => Some(KEY_BING),
        "serpapi" => Some(KEY_SERPAPI),
        _ => None,
    }
}

/// 落盘偏好（不含 Key 明文）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PersistedPrefs {
    pub engine: String,
}

impl PersistedPrefs {
    /// 引擎字段缺失/损坏时回落缺省值，且回落结果仍是合法值
    fn engine_or_default(&self) -> String {
        normalize_engine(&self.engine).unwrap_or_else(|_| DEFAULT_ENGINE.to_string())
    }
}

/// 三引擎 Key 快照（明文只在内存内，用于装配与视图计算）
#[derive(Debug, Clone, Default)]
struct SearchKeys {
    tavily: String,
    bing: String,
    serpapi: String,
}

impl SearchKeys {
    fn of(&self, engine: &str) -> &str {
        match engine {
            "tavily" => &self.tavily,
            "bing" => &self.bing,
            "serpapi" => &self.serpapi,
            _ => "",
        }
    }

    fn set_of(&mut self, engine: &str, value: &str) {
        match engine {
            "tavily" => self.tavily = value.to_string(),
            "bing" => self.bing = value.to_string(),
            "serpapi" => self.serpapi = value.to_string(),
            _ => {}
        }
    }
}

/// 前端视图：**不回传 Key 明文**，只给引擎与各引擎「是否已配置」
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSettingsView {
    pub engine: String,
    pub tavily_key_set: bool,
    pub bing_key_set: bool,
    pub serpapi_key_set: bool,
    /// 当前引擎是否已具备 Key（false = 实际只走免 Key 兜底）
    pub active_key_set: bool,
    /// 链上的实际尝试顺序（Provider id；供面板显示「现在真的会先打谁」）
    pub provider_order: Vec<String>,
}

/// 更新入参：`engine` 与 `apiKey` 可单传或同传
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchSettingsPatch {
    pub engine: Option<String>,
    /// 仅非空时覆盖**当前生效引擎**的 Key（空串 = 保持不变，对齐 A2 语义检索的 Key 语义）
    pub api_key: Option<String>,
    /// 显式清除当前引擎的 Key
    #[serde(default)]
    pub clear_api_key: bool,
}

/// 搜索配置存储：偏好落 JSON、Key 落 SecureStore、装配结果写进降级链
pub struct SearchConfigStore {
    prefs_path: PathBuf,
    secure: Arc<SecureStore>,
    chain: Arc<SearchProviderChain>,
}

impl SearchConfigStore {
    /// 构造（不读盘；调用方随后调 [`Self::load_into_chain`]）
    pub fn new(
        prefs_path: PathBuf,
        secure: Arc<SecureStore>,
        chain: Arc<SearchProviderChain>,
    ) -> Self {
        Self {
            prefs_path,
            secure,
            chain,
        }
    }

    /// 启动装配：读盘 + 读 Key → 写进链，使重启后无需任何前端注入即按已保存配置生效
    pub async fn load_into_chain(&self) {
        let engine = self.read_persisted().engine_or_default();
        let keys = self.read_keys().await.unwrap_or_default();
        if keys.of(&engine).trim().is_empty() {
            tracing::warn!(
                engine = %engine,
                "联网搜索未配置所选引擎的 API Key，实际走 DuckDuckGo 免 Key 兜底"
            );
        } else {
            tracing::info!(engine = %engine, "联网搜索已按已保存配置装配（档 1）");
        }
        self.chain.set_config(Self::assemble(&engine, &keys));
    }

    /// 读设置（给前端，不含明文）
    pub async fn read_settings(&self) -> Result<SearchSettingsView, String> {
        let engine = self.read_persisted().engine_or_default();
        let keys = self.read_keys().await?;
        Ok(view_of(&engine, &keys, &self.chain.ordered_provider_ids()))
    }

    /// 应用更新：校验引擎 → 写 Key → 写偏好 → 重装链 → 回视图（保存即生效，无需重启）
    pub async fn apply_patch(
        &self,
        patch: SearchSettingsPatch,
    ) -> Result<SearchSettingsView, String> {
        let mut prefs = self.read_persisted();
        let mut engine = prefs.engine_or_default();
        if let Some(raw) = patch.engine.as_deref() {
            engine = normalize_engine(raw)?;
        }
        if engine != prefs.engine {
            prefs.engine = engine.clone();
            self.write_persisted(&prefs)?;
        }

        let mut keys = self.read_keys().await?;
        if let (Some(slot), incoming) = (
            key_name_for(&engine),
            patch.api_key.as_deref().map(str::trim).unwrap_or(""),
        ) {
            if patch.clear_api_key {
                self.secure.delete(slot).await?;
                keys.set_of(&engine, "");
            } else if !incoming.is_empty() {
                self.secure.set(slot, incoming).await?;
                keys.set_of(&engine, incoming);
            }
        }

        self.chain.set_config(Self::assemble(&engine, &keys));
        Ok(view_of(&engine, &keys, &self.chain.ordered_provider_ids()))
    }

    /// 装配运行时配置：**只把当前引擎的 Key 交给链**，其余引擎即便存有 Key 也不越权顶上
    /// （否则切引擎后旧 Key 会悄悄优先于用户所选，面板的引擎选择失去意义）
    fn assemble(engine: &str, keys: &SearchKeys) -> SearchConfig {
        let active = keys.of(engine).trim();
        let mut cfg = SearchConfig::default();
        if active.is_empty() {
            return cfg;
        }
        match engine {
            "tavily" => cfg.tavily_key = Some(active.to_string()),
            "bing" => cfg.bing_key = Some(active.to_string()),
            "serpapi" => cfg.serpapi_key = Some(active.to_string()),
            _ => {}
        }
        cfg
    }

    async fn read_keys(&self) -> Result<SearchKeys, String> {
        Ok(SearchKeys {
            tavily: self.secure.get(KEY_TAVILY).await?.unwrap_or_default(),
            bing: self.secure.get(KEY_BING).await?.unwrap_or_default(),
            serpapi: self.secure.get(KEY_SERPAPI).await?.unwrap_or_default(),
        })
    }

    /// 读盘（缺失/损坏 → 默认值）
    fn read_persisted(&self) -> PersistedPrefs {
        std::fs::read_to_string(&self.prefs_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn write_persisted(&self, prefs: &PersistedPrefs) -> Result<(), String> {
        if let Some(parent) = self.prefs_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;
        }
        let raw = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
        std::fs::write(&self.prefs_path, raw).map_err(|e| format!("写入搜索配置失败: {e}"))
    }
}

fn view_of(engine: &str, keys: &SearchKeys, provider_order: &[String]) -> SearchSettingsView {
    SearchSettingsView {
        engine: engine.to_string(),
        tavily_key_set: !keys.tavily.trim().is_empty(),
        bing_key_set: !keys.bing.trim().is_empty(),
        serpapi_key_set: !keys.serpapi.trim().is_empty(),
        active_key_set: !keys.of(engine).trim().is_empty(),
        provider_order: provider_order.to_vec(),
    }
}

// ─── Tauri 命令 ──────────────────────────────────────────

/// 读取联网搜索配置（不含 Key 明文）
#[tauri::command]
pub async fn cmd_search_config_get(
    store: State<'_, Arc<SearchConfigStore>>,
) -> Result<SearchSettingsView, String> {
    store.read_settings().await
}

/// 更新联网搜索配置（保存即生效；Key 走安全存储）
#[tauri::command]
pub async fn cmd_search_config_set(
    store: State<'_, Arc<SearchConfigStore>>,
    settings: SearchSettingsPatch,
) -> Result<SearchSettingsView, String> {
    store.apply_patch(settings).await
}

#[cfg(test)]
#[path = "search_config_tests.rs"]
mod tests;
