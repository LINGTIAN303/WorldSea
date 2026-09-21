use super::*;
use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use crate::session_store::SessionRepository;

fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
    OrchestratorMessage {
        role,
        content: content.into(),
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

fn snapshot(at: u64, view_update: ViewUpdate) -> RequestSnapshot {
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
        view_update,
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

/// 会话日志全量行（坐标 + 内容 JSON）——"日志不删"的逐字对照
async fn log_rows(store: &SqliteSessionRepository, id: &str) -> Vec<(i64, String)> {
    sqlx::query_as(
        "SELECT log_offset, msg_json FROM session_log WHERE session_id = ?1 ORDER BY log_offset",
    )
    .bind(id)
    .fetch_all(&store.pool)
    .await
    .unwrap()
}

async fn ops_count(store: &SqliteSessionRepository, session_id: &str) -> i64 {
    sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM session_branch_ops WHERE session_id = ?1")
        .bind(session_id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
        .0
}

/// 三轮会话：视图 [u1] → [u1,a1] → [u1,a1,u2]，快照链 Full@0 + Appended@1 + Appended@2
async fn seed_three_rounds(store: &SqliteSessionRepository) {
    seed_session(store, "s").await;
    store.replace_messages("s", &[msg(MessageRole::User, "u1")]).await.unwrap();
    store
        .append_request_snapshot("s", &snapshot(100, ViewUpdate::Full { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();
    store
        .replace_messages("s", &[msg(MessageRole::User, "u1"), msg(MessageRole::Assistant, "a1")])
        .await
        .unwrap();
    store
        .append_request_snapshot("s", &snapshot(200, ViewUpdate::Appended { messages: vec![msg(MessageRole::Assistant, "a1")] }))
        .await
        .unwrap();
    store
        .replace_messages(
            "s",
            &[msg(MessageRole::User, "u1"), msg(MessageRole::Assistant, "a1"), msg(MessageRole::User, "u2")],
        )
        .await
        .unwrap();
    store
        .append_request_snapshot("s", &snapshot(300, ViewUpdate::Appended { messages: vec![msg(MessageRole::User, "u2")] }))
        .await
        .unwrap();
}

#[tokio::test]
async fn rewind_view_equals_boundary_and_log_kept() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_three_rounds(&store).await;
    let log_before = log_rows(&store, "s").await;
    assert_eq!(log_before.len(), 3);

    // 结构级等值（复用 08 重建链断言）：回滚目标 = 重建链在 seq1 给出的视图
    let snapshots = store.load_request_snapshots("s", 0, i64::MAX).await.unwrap();
    let (_, expected) = reconstruct_request_view(&snapshots, 1).expect("链完整应可重建");
    let out = store.rewind_session("s", 1).await.unwrap();

    let contents: Vec<&str> = out.view.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents, ["u1", "a1"]);
    assert_eq!(store.load_messages("s").await.unwrap(), expected, "回滚后视图应与目标边界结构级等值");
    assert_eq!(out.target_seq, 1);
    assert_eq!(out.replace.dropped, 1, "u2 移出视图");
    assert_eq!(out.replace.added, 0, "无新版本入日志");
    // 日志不删：行与坐标逐字不变；仅活跃视图收缩
    assert_eq!(log_rows(&store, "s").await, log_before);
    assert_eq!(store.load_live_offsets("s").await.unwrap(), vec![0, 1]);
    let stats = store.session_log_stats("s").await.unwrap();
    assert_eq!(stats.log_len, 3);
    assert_eq!(stats.dropped_len, 1, "被移出视图的内容仍保留在日志");
    // 事件流留痕（trim）且括号已闭合
    let events = store.load_session_events("s", 0, 100).await.unwrap();
    assert_eq!(events.last().unwrap().event_kind, "trim");
    assert_eq!(ops_count(&store, "s").await, 0);

    // 幂等：已在目标边界 → noop（不产生新视图写入）
    let again = store.rewind_session("s", 1).await.unwrap();
    assert!(again.replace.is_noop(), "重复回滚同一边界应为 noop");

    // 可再前行：回到 seq2；u2 以新坐标重新入日志（同内容新版本，既有模型行为）
    let forward = store.rewind_session("s", 2).await.unwrap();
    assert_eq!(forward.view.len(), 3);
    assert_eq!(forward.replace.added, 1);
    let log_after = log_rows(&store, "s").await;
    assert_eq!(log_after.len(), 4, "重入视图的消息按新版本追加（日志只增）");
    assert_eq!(log_after[0..3].to_vec(), log_before, "既存行坐标与内容不变");
}

#[tokio::test]
async fn rewind_refuses_unreconstructable_boundary() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    store.replace_messages("s", &[msg(MessageRole::User, "u1")]).await.unwrap();

    // ① 无快照：不可重建
    let err = store.rewind_session("s", 0).await.unwrap_err();
    assert!(matches!(err, CommandError::InvalidArgument(_)), "应拒绝并说明不可重建: {err:?}");
    // ② 会话不存在
    assert!(matches!(store.rewind_session("nope", 0).await.unwrap_err(), CommandError::SessionNotFound(_)));
    // 拒绝路径零残留（拒绝发生在落 mark 之前）
    assert_eq!(ops_count(&store, "s").await, 0);
    // ③ 追加全量快照后可用：回滚到 seq0 = 初始视图
    store
        .append_request_snapshot("s", &snapshot(100, ViewUpdate::Full { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();
    let out = store.rewind_session("s", 0).await.unwrap();
    assert_eq!(out.view.len(), 1);
    assert_eq!(ops_count(&store, "s").await, 0);
}
