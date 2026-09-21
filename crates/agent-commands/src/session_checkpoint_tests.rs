use super::*;
use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use crate::session_store::SessionRepository;

fn msg(content: &str) -> OrchestratorMessage {
    OrchestratorMessage {
        role: MessageRole::User,
        content: content.into(),
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

fn snapshot(at: u64, content: &str) -> RequestSnapshot {
    RequestSnapshot {
        captured_at_ms: at,
        purpose: "main".into(),
        provider: "test".into(),
        model_id: "test-model".into(),
        temperature: None,
        max_tokens: None,
        top_p: None,
        top_k: None,
        thinking_mode: None,
        thinking_level: None,
        silent: false,
        system_prompt: None,
        tools_json: None,
        tools_names: Vec::new(),
        material_ref: None,
        view_update: ViewUpdate::Full { messages: vec![msg(content)] },
    }
}

async fn seed_session(store: &SqliteSessionRepository, id: &str) {
    sqlx::query(
        "INSERT INTO sessions (id, system_prompt, created_at, message_count, updated_at)
         VALUES (?1, 'sp', 0, 0, 0)",
    )
    .bind(id)
    .execute(&store.pool)
    .await
    .unwrap();
}

async fn ops_count(store: &SqliteSessionRepository, session_id: &str) -> i64 {
    sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM session_branch_ops WHERE session_id = ?1")
        .bind(session_id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
        .0
}

#[tokio::test]
async fn auto_checkpoint_fires_every_ten_requests() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;

    // 前 9 个请求：不打点
    for i in 0..9u64 {
        store.append_request_snapshot("s", &snapshot(100 + i, &format!("u{i}"))).await.unwrap();
    }
    assert!(store.list_checkpoints("s", 100).await.unwrap().is_empty(), "第 10 个请求前不应打点");

    // 第 10 个请求（seq=9）→ 打点一次
    store.append_request_snapshot("s", &snapshot(200, "u9")).await.unwrap();
    let cps = store.list_checkpoints("s", 100).await.unwrap();
    assert_eq!(cps.len(), 1, "第 10 个请求应打点");
    assert_eq!(cps[0].request_seq, 9);
    assert_eq!(cps[0].kind, "auto");

    // 第 11..20 个请求（seq=10..19）→ 第 20 个再打一次
    for i in 10..20u64 {
        store.append_request_snapshot("s", &snapshot(300 + i, &format!("u{i}"))).await.unwrap();
    }
    let cps = store.list_checkpoints("s", 100).await.unwrap();
    assert_eq!(cps.len(), 2, "第 10 / 20 个请求各打点一次");
    assert_eq!(cps[0].request_seq, 19, "最新在前");
    assert_eq!(cps[1].request_seq, 9);
    assert!(cps.iter().all(|c| c.kind == "auto"));
    assert_eq!(ops_count(&store, "s").await, 0, "括号已闭合");
}

#[tokio::test]
async fn manual_checkpoint_bracketed_and_retention_keeps_latest() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;

    // 手动打点（括号版，kind=manual）
    let id = checkpoint_now(&store, "s", 3, "manual").await.unwrap();
    let cps = store.list_checkpoints("s", 10).await.unwrap();
    assert_eq!(cps.len(), 1);
    assert_eq!(cps[0].id, id);
    assert_eq!(cps[0].request_seq, 3);
    assert_eq!(cps[0].kind, "manual");
    assert_eq!(ops_count(&store, "s").await, 0);

    // 保留策略：手动 + 自动合并计数，超出 CHECKPOINT_KEEP 淘汰最旧
    for seq in 0..CHECKPOINT_KEEP + 5 {
        checkpoint_now(&store, "s", seq, "auto").await.unwrap();
    }
    let cps = store.list_checkpoints("s", 1000).await.unwrap();
    assert_eq!(cps.len() as i64, CHECKPOINT_KEEP, "应淘汰至保留上限");
    assert_eq!(cps[0].request_seq, CHECKPOINT_KEEP + 4, "最新保留");
    assert_eq!(cps.last().unwrap().request_seq, 5, "淘汰按 (request_seq, created_at) 取最旧（含手动点）");
}
