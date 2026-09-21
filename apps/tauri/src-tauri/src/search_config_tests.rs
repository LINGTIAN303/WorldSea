//! 档 1 搜索配置存储单测（装配语义与引擎名归一）
//!
//! 口径：这些用例锁的是「配置怎么变成降级链输入」这条规则本身；
//! 跨栈（前端命令名 / 参数字段）由 `apps/tauri/src/agent/__tests__/search-config-contract.spec.ts` 守。

use super::*;

fn keys(tavily: &str, bing: &str, serpapi: &str) -> SearchKeys {
    SearchKeys {
        tavily: tavily.to_string(),
        bing: bing.to_string(),
        serpapi: serpapi.to_string(),
    }
}

// ─── 引擎名归一 ───────────────────────────────────────────

#[test]
fn normalize_engine_blank_falls_back_to_default() {
    assert_eq!(normalize_engine("").unwrap(), "tavily");
    assert_eq!(normalize_engine("   ").unwrap(), "tavily");
}

#[test]
fn normalize_engine_tolerates_case_and_padding() {
    assert_eq!(normalize_engine(" BING ").unwrap(), "bing");
    assert_eq!(normalize_engine("SerpApi").unwrap(), "serpapi");
}

#[test]
fn normalize_engine_rejects_unknown_instead_of_silently_switching() {
    // duckduckgo 是链内免 Key 兜底，不是可选项：传它必须报错，不能被当成「选了别的引擎」
    let err = normalize_engine("duckduckgo").unwrap_err();
    assert!(err.contains("duckduckgo"), "报错需回显非法值: {err}");
    assert!(err.contains("tavily"), "报错需给出可选清单: {err}");
}

#[test]
fn prefs_corrupt_input_still_yields_legal_engine() {
    let empty: PersistedPrefs = serde_json::from_str("{}").unwrap();
    assert_eq!(empty.engine_or_default(), "tavily");
    let broken: PersistedPrefs = serde_json::from_str(r#"{"engine":"nope"}"#).unwrap();
    assert_eq!(broken.engine_or_default(), "tavily");
}

// ─── 装配语义（断点 A 的根因面：配了什么就用什么，没配就兜底） ───

#[test]
fn assemble_only_uses_active_engines_key() {
    let all = keys("t-key", "b-key", "s-key");
    let cfg = SearchConfigStore::assemble("bing", &all);
    assert_eq!(cfg.bing_key.as_deref(), Some("b-key"));
    assert!(
        cfg.tavily_key.is_none(),
        "未选中的引擎不得越权顶在用户所选之前"
    );
    assert!(cfg.serpapi_key.is_none());
}

#[test]
fn assemble_without_active_key_leaves_chain_to_fallback() {
    let only_tavily = keys("t-key", "", "");
    let cfg = SearchConfigStore::assemble("serpapi", &only_tavily);
    assert!(cfg.tavily_key.is_none(), "选了 SerpAPI 就不该偷用存着的 Tavily Key");
    assert!(cfg.serpapi_key.is_none());
    assert!(cfg.bing_key.is_none());
}

#[test]
fn assemble_trims_key_and_ignores_surrounding_space() {
    let cfg = SearchConfigStore::assemble("tavily", &keys("  t-key  ", "", ""));
    assert_eq!(cfg.tavily_key.as_deref(), Some("t-key"));
}

#[test]
fn assemble_non_selectable_engine_yields_empty_config() {
    let cfg = SearchConfigStore::assemble("duckduckgo", &keys("t-key", "b-key", "s-key"));
    assert!(cfg.tavily_key.is_none() && cfg.bing_key.is_none() && cfg.serpapi_key.is_none());
}

#[test]
fn chain_with_empty_config_offers_only_duckduckgo() {
    // 装配结果为空 → 链的尝试顺序必须只剩免 Key 兜底（这正是修复前的线上实况）
    let chain = SearchProviderChain::new(SearchConfig::default());
    let order = chain.ordered_provider_ids();
    assert_eq!(order, vec!["duckduckgo".to_string()]);
}

#[test]
fn chain_with_assembled_bing_key_puts_bing_before_fallback() {
    let cfg = SearchConfigStore::assemble("bing", &keys("t-key", "b-key", ""));
    let chain = SearchProviderChain::new(cfg);
    assert_eq!(
        chain.ordered_provider_ids(),
        vec!["bing".to_string(), "duckduckgo".to_string()],
        "已配置引擎须排在免 Key 兜底之前"
    );
}

// ─── 视图与入参形状 ───────────────────────────────────────

#[test]
fn view_never_carries_plaintext_but_reports_set_state() {
    let order = ["tavily".to_string(), "duckduckgo".to_string()];
    let view = view_of("tavily", &keys("secret-value", "", "s-key"), &order);
    let json = serde_json::to_string(&view).unwrap();
    assert!(
        !json.contains("secret-value"),
        "视图不得回传 Key 明文: {json}"
    );
    assert!(json.contains(r#""tavilyKeySet":true"#), "camelCase: {json}");
    assert!(json.contains(r#""activeKeySet":true"#));
    assert!(json.contains(r#""serpapiKeySet":true"#));
    assert!(
        json.contains(r#""providerOrder":["tavily","duckduckgo"]"#),
        "视图需带链上实际尝试顺序（可观测：配了什么就打谁）: {json}"
    );
}

#[test]
fn view_active_key_set_follows_engine_switch() {
    let only_tavily = keys("t-key", "", "");
    assert!(view_of("tavily", &only_tavily, &[]).active_key_set);
    assert!(
        !view_of("bing", &only_tavily, &[]).active_key_set,
        "切到未配置的引擎应报「未配置」，不能沿用上一个引擎的状态"
    );
}

#[test]
fn patch_accepts_camel_case_and_clear_defaults_false() {
    let patch: SearchSettingsPatch =
        serde_json::from_str(r#"{"engine":"bing","apiKey":"  k  ","clearApiKey":true}"#).unwrap();
    assert_eq!(patch.engine.as_deref(), Some("bing"));
    assert_eq!(patch.api_key.as_deref(), Some("  k  "));
    assert!(patch.clear_api_key);
    // 缺省：只给 engine 时不动 Key、不清除（切引擎不应误删已存 Key）
    let bare: SearchSettingsPatch = serde_json::from_str(r#"{"engine":"serpapi"}"#).unwrap();
    assert!(bare.api_key.is_none());
    assert!(!bare.clear_api_key);
}

#[test]
fn key_slot_naming_is_one_to_one_with_selectable_engines() {
    assert_eq!(key_name_for("tavily"), Some(KEY_TAVILY));
    assert_eq!(key_name_for("bing"), Some(KEY_BING));
    assert_eq!(key_name_for("serpapi"), Some(KEY_SERPAPI));
    assert_eq!(key_name_for("duckduckgo"), None);
    assert_eq!(key_name_for("google"), None);
}

// ─── 装配接线（端到端过一遍真存储，防「摘掉启动加载」这类变异无人报红） ───

/// 每次调用取一对独立临时路径（测试并行，禁用同名）
fn temp_paths(tag: &str) -> (PathBuf, PathBuf) {
    let stamp = format!(
        "worldsea_search_cfg_{}_{}_{}",
        std::process::id(),
        tag,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    );
    let dir = std::env::temp_dir();
    (dir.join(format!("{stamp}.json")), dir.join(format!("{stamp}.db")))
}

#[tokio::test]
async fn apply_patch_writes_through_to_chain() {
    let (prefs, db) = temp_paths("write");
    let secure = SecureStore::new(db.to_str().unwrap()).await.unwrap();
    let chain = Arc::new(SearchProviderChain::new(SearchConfig::default()));
    let store = SearchConfigStore::new(prefs.clone(), secure, chain.clone());

    store
        .apply_patch(SearchSettingsPatch {
            engine: Some("serpapi".into()),
            api_key: Some("  s-secret  ".into()),
            clear_api_key: false,
        })
        .await
        .unwrap();

    // 保存即生效：无需重启，链上已带 trim 后的 Key，且尝试顺序把所选引擎排在前
    let cfg = chain.config();
    assert_eq!(cfg.serpapi_key.as_deref(), Some("s-secret"));
    assert_eq!(cfg.tavily_key, None, "只应装配所选引擎");
    assert_eq!(
        chain.ordered_provider_ids(),
        vec!["serpapi".to_string(), "duckduckgo".to_string()]
    );

    let view = store.read_settings().await.unwrap();
    assert_eq!(view.engine, "serpapi");
    assert!(view.active_key_set);
    assert!(!view.tavily_key_set);

    secure_cleanup(&db, &prefs);
}

#[tokio::test]
async fn load_into_chain_restores_saved_config_after_restart() {
    let (prefs, db) = temp_paths("restart");
    let db_path = db.to_str().unwrap().to_string();
    {
        let secure = SecureStore::new(&db_path).await.unwrap();
        let chain = Arc::new(SearchProviderChain::new(SearchConfig::default()));
        let store = SearchConfigStore::new(prefs.clone(), secure, chain);
        store
            .apply_patch(SearchSettingsPatch {
                engine: Some("bing".into()),
                api_key: Some("b-secret".into()),
                clear_api_key: false,
            })
            .await
            .unwrap();
    }

    // 重开进程：链先以 default 建好，仅靠启动那次 load_into_chain 恢复配置
    let secure = SecureStore::new(&db_path).await.unwrap();
    let chain = Arc::new(SearchProviderChain::new(SearchConfig::default()));
    assert_eq!(
        chain.ordered_provider_ids(),
        vec!["duckduckgo".to_string()],
        "未加载前只该有兜底"
    );
    SearchConfigStore::new(prefs.clone(), secure, chain.clone())
        .load_into_chain()
        .await;

    let cfg = chain.config();
    assert_eq!(cfg.bing_key.as_deref(), Some("b-secret"));
    assert_eq!(
        chain.ordered_provider_ids(),
        vec!["bing".to_string(), "duckduckgo".to_string()]
    );

    secure_cleanup(&db, &prefs);
}

#[tokio::test]
async fn apply_patch_rejects_unknown_engine_without_touching_chain() {
    let (prefs, db) = temp_paths("reject");
    let secure = SecureStore::new(db.to_str().unwrap()).await.unwrap();
    let chain = Arc::new(SearchProviderChain::new(SearchConfig::default()));
    let store = SearchConfigStore::new(prefs.clone(), secure, chain.clone());

    let err = store
        .apply_patch(SearchSettingsPatch {
            engine: Some("google".into()),
            api_key: Some("x".into()),
            clear_api_key: false,
        })
        .await
        .unwrap_err();
    assert!(err.contains("google"), "报错需回显非法引擎: {err}");
    assert!(
        !prefs.exists(),
        "非法引擎不得留下半成品配置文件"
    );
    assert_eq!(
        chain.ordered_provider_ids(),
        vec!["duckduckgo".to_string()],
        "报错路径不得改动链"
    );

    secure_cleanup(&db, &prefs);
}

fn secure_cleanup(db: &PathBuf, prefs: &PathBuf) {
    let _ = std::fs::remove_file(db);
    let _ = std::fs::remove_file(prefs);
    let _ = std::fs::remove_file(format!("{}-wal", db.display()));
    let _ = std::fs::remove_file(format!("{}-shm", db.display()));
}
