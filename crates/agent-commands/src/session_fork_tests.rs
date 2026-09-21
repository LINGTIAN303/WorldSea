use super::*;
use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use crate::session_store::{SessionKind, SessionRepository, SqliteSessionRepository};

fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
    OrchestratorMessage {
        role,
        content: content.into(),
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

fn record(id: &str) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        system_prompt: "系统提示".into(),
        prompt_sections: None,
        created_at: 100,
        message_count: 0,
        updated_at: 100,
        title: "会话标题".into(),
        pinned: false,
        kind: SessionKind::Chat,
        workdir: Some("D:/ws".into()),
        workspace_id: Some("ws-1".into()),
        project_id: Some("p1".into()),
        scene_id: Some("world".into()),
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
        system_prompt: Some("系统提示".into()),
        tools_json: None,
        tools_names: Vec::new(),
        material_ref: None,
        view_update,
    }
}

/// 父会话三面指纹（日志行 / 视图游标 / 事件流）——"父会话零影响"的对照断言
/// （全量逐字比对，强于哈希：无碰撞空间）
async fn fingerprint(store: &SqliteSessionRepository, id: &str) -> String {
    let log: Vec<(i64, String, i64)> = sqlx::query_as(
        "SELECT log_offset, msg_json, recorded_at FROM session_log WHERE session_id = ?1 ORDER BY log_offset",
    )
    .bind(id)
    .fetch_all(&store.pool)
    .await
    .unwrap();
    let live: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT position, log_offset FROM session_live WHERE session_id = ?1 ORDER BY position",
    )
    .bind(id)
    .fetch_all(&store.pool)
    .await
    .unwrap();
    let events: Vec<(i64, String, i64, i64, i64)> = sqlx::query_as(
        "SELECT event_seq, event_kind, added, dropped, kept FROM session_events WHERE session_id = ?1 ORDER BY event_seq",
    )
    .bind(id)
    .fetch_all(&store.pool)
    .await
    .unwrap();
    format!("{log:?}|{live:?}|{events:?}")
}

async fn ops_count(store: &SqliteSessionRepository, session_id: &str) -> i64 {
    sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM session_branch_ops WHERE session_id = ?1")
        .bind(session_id)
        .fetch_one(&store.pool)
        .await
        .unwrap()
        .0
}

async fn session_ids(store: &SqliteSessionRepository) -> Vec<String> {
    store.load_sessions().await.unwrap().into_iter().map(|s| s.id).collect()
}

#[tokio::test]
async fn fork_from_request_boundary_keeps_parent_untouched() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    store.save_session(&record("p")).await.unwrap();
    store
        .replace_messages("p", &[msg(MessageRole::User, "u1"), msg(MessageRole::Assistant, "a1")])
        .await
        .unwrap();
    // 快照链：req0 发送 [u1]；req1 发送 [u1, a1, u2]（u2 = 触发 req1 的新输入）
    store
        .append_request_snapshot("p", &snapshot(100, ViewUpdate::Full { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();
    store
        .append_request_snapshot(
            "p",
            &snapshot(200, ViewUpdate::Appended { messages: vec![msg(MessageRole::Assistant, "a1"), msg(MessageRole::User, "u2")] }),
        )
        .await
        .unwrap();
    let before = fingerprint(&store, "p").await;

    let out = store.fork_session("p", 1).await.unwrap();

    // 边界视图 = 请求 1 派发时的消息视图（含 u2，不含其响应及之后）
    let contents: Vec<&str> = out.view.iter().map(|m| m.content.as_str()).collect();
    assert_eq!(contents, ["u1", "a1", "u2"]);
    // 子会话头复制装配面；来源记录坐标精确
    assert_eq!(out.child.system_prompt, "系统提示");
    assert_eq!(out.child.title, "会话标题");
    assert_eq!(out.child.workdir.as_deref(), Some("D:/ws"));
    assert_eq!(out.child.scene_id.as_deref(), Some("world"));
    assert_eq!(out.child.message_count, 3);
    assert!(!out.child.pinned);
    assert_eq!(out.fork.forked_from_session, "p");
    assert_eq!(out.fork.forked_from_seq, 1);
    // 子会话落库：视图一致 + 独立坐标（日志从 0 起，不继承父坐标）
    assert_eq!(store.load_messages(&out.child.id).await.unwrap(), out.view);
    assert_eq!(store.load_live_offsets(&out.child.id).await.unwrap(), vec![0, 1, 2]);
    // 父会话零影响：三面指纹不变；括号已闭合（mark 清空）
    assert_eq!(fingerprint(&store, "p").await, before, "父会话三面应逐字不变");
    assert_eq!(ops_count(&store, "p").await, 0, "提交路径 mark 应已清");
    // 反查 + 已提交分叉不被冷修复误撤
    assert_eq!(store.list_forks_of("p").await.unwrap().len(), 1);
    assert!(store.reconcile_branch_residue().await.unwrap().is_empty());
    assert!(session_ids(&store).await.contains(&out.child.id), "已提交子会话不应被收敛撤销");
}

#[tokio::test]
async fn fork_refuses_unreconstructable_boundary() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    store.save_session(&record("p")).await.unwrap();
    store.replace_messages("p", &[msg(MessageRole::User, "u1")]).await.unwrap();

    // ① 无任何快照：不可重建
    let err = store.fork_session("p", 0).await.unwrap_err();
    assert!(matches!(err, CommandError::InvalidArgument(_)), "应拒绝并说明不可重建: {err:?}");
    // ② 目标序号不存在（链自 seq0 完整但无 seq99）
    store
        .append_request_snapshot("p", &snapshot(100, ViewUpdate::Full { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();
    assert!(store.fork_session("p", 99).await.is_err(), "边界序号不存在应拒绝");
    // ③ 父会话不存在
    assert!(matches!(store.fork_session("nope", 0).await.unwrap_err(), CommandError::SessionNotFound(_)));
    // 拒绝路径零残留：无子会话、无 mark（拒绝发生在落 mark 之前）
    assert_eq!(session_ids(&store).await, vec!["p".to_string()]);
    assert_eq!(ops_count(&store, "p").await, 0);
    // ④ 拒绝不污染可用边界：追加增量后 seq=1 可正常分叉
    store
        .append_request_snapshot(
            "p",
            &snapshot(200, ViewUpdate::Appended { messages: vec![msg(MessageRole::Assistant, "a1"), msg(MessageRole::User, "u2")] }),
        )
        .await
        .unwrap();
    let out = store.fork_session("p", 1).await.unwrap();
    assert_eq!(out.view.len(), 3);

    // ⑤ 链不完整（增量先于任何全量）：重建链拒绝（独立 store——坏链对该会话所有边界永久生效）
    let broken = SqliteSessionRepository::new_in_memory().await.unwrap();
    broken.save_session(&record("b")).await.unwrap();
    broken.replace_messages("b", &[msg(MessageRole::User, "u1")]).await.unwrap();
    broken
        .append_request_snapshot("b", &snapshot(100, ViewUpdate::Appended { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();
    assert!(broken.fork_session("b", 0).await.is_err(), "链不完整应拒绝");
}

#[tokio::test]
async fn forked_child_continues_independently() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    store.save_session(&record("p")).await.unwrap();
    store.replace_messages("p", &[msg(MessageRole::User, "u1")]).await.unwrap();
    store
        .append_request_snapshot("p", &snapshot(100, ViewUpdate::Full { messages: vec![msg(MessageRole::User, "u1")] }))
        .await
        .unwrap();

    let a = store.fork_session("p", 0).await.unwrap();
    let b = store.fork_session("p", 0).await.unwrap();
    assert_ne!(a.child.id, b.child.id, "同一边界可分叉出多个独立子会话");
    let parent_before = fingerprint(&store, "p").await;

    // 子会话独立追写：追加一轮新消息（不得回写父会话）
    let mut extended = a.view.clone();
    extended.push(msg(MessageRole::Assistant, "a1"));
    extended.push(msg(MessageRole::User, "u2"));
    store.replace_messages(&a.child.id, &extended).await.unwrap();

    assert_eq!(store.load_messages(&a.child.id).await.unwrap().len(), 3);
    assert_eq!(store.load_live_offsets(&a.child.id).await.unwrap(), vec![0, 1, 2]);
    assert_eq!(fingerprint(&store, "p").await, parent_before, "子会话追写不得触父会话");
    assert_eq!(store.load_messages(&b.child.id).await.unwrap().len(), 1, "兄弟子会话互不影响");
    assert_eq!(store.list_forks_of("p").await.unwrap().len(), 2);
}

#[tokio::test]
async fn fork_crash_residue_converged_after_restart() {
    // 真实文件库 + 重开 = 模拟进程退出后的装载（冷修复入口的执行条件）
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("fork.db").to_string_lossy().to_string();
    {
        let store = SqliteSessionRepository::new(&path).await.unwrap();
        store.save_session(&record("p")).await.unwrap();
        store.replace_messages("p", &[msg(MessageRole::User, "u1")]).await.unwrap();
        // 崩溃点注入：分叉中途——mark 已落、子会话行 + 视图已写、分叉记录未写、mark 未清
        let payload = serde_json::json!({"child_session_id": "child-x", "request_seq": 0}).to_string();
        store.begin_branch_op("fork", "p", Some(&payload)).await.unwrap();
        store.save_session(&record("child-x")).await.unwrap();
        store.replace_messages("child-x", &[msg(MessageRole::User, "u1")]).await.unwrap();
    } // drop store → 连接池关闭（进程退出）
    let store = SqliteSessionRepository::new(&path).await.unwrap();

    let residue = store.reconcile_branch_residue().await.unwrap();
    assert_eq!(residue.len(), 1, "装载期应检出 1 条残留");
    assert_eq!(residue[0].op.op, "fork");
    assert_eq!(residue[0].undone_child.as_deref(), Some("child-x"), "未提交子会话应被撤销");
    assert_eq!(session_ids(&store).await, vec!["p".to_string()], "半成品已回收，父会话完整保留");
    assert_eq!(ops_count(&store, "p").await, 0, "残留 mark 已清");
    assert!(store.reconcile_branch_residue().await.unwrap().is_empty(), "收敛幂等");
}
