use super::*;
use agent_engine::contracts::checkpoints::{CheckpointAnchor, CheckpointKind};
use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::long_task::{
    LongTaskCheckpoint, LongTaskMeta, LongTaskRecord, LongTaskStatus, LongTaskType,
};
use agent_runtime::types::{MessageRole, OrchestratorMessage};
use chrono::{Duration, Utc};
use crate::long_task_store::LongTaskRepository;
use crate::session_store::SessionRepository;

/// 造一条长任务记录（心跳相对 now 偏移，供跨源排序断言）
fn task_record(task_id: &str, status: LongTaskStatus, heartbeat_offset_secs: i64) -> LongTaskRecord {
    let now = Utc::now();
    LongTaskRecord {
        task_id: task_id.into(),
        task_type: LongTaskType::MainAgent,
        status,
        started_at: now - Duration::seconds(heartbeat_offset_secs.abs() + 60),
        last_heartbeat_at: now + Duration::seconds(heartbeat_offset_secs),
        ended_at: None,
        turn_count: 0,
        current_tool: None,
        current_phase: None,
        checkpoint: LongTaskCheckpoint {
            agent_messages: Vec::new(),
            last_user_text: "任务".into(),
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        },
        meta: LongTaskMeta { agent_type: None, prompt: "t".into(), pipeline_context: None },
    }
}

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
    let id = put_checkpoint(&store, "s", 3, "manual").await.unwrap();
    let cps = store.list_checkpoints("s", 10).await.unwrap();
    assert_eq!(cps.len(), 1);
    assert_eq!(cps[0].id, id);
    assert_eq!(cps[0].request_seq, 3);
    assert_eq!(cps[0].kind, "manual");
    assert_eq!(ops_count(&store, "s").await, 0);

    // 保留策略：手动 + 自动合并计数，超出 CHECKPOINT_KEEP 淘汰最旧
    for seq in 0..CHECKPOINT_KEEP + 5 {
        put_checkpoint(&store, "s", seq, "auto").await.unwrap();
    }
    let cps = store.list_checkpoints("s", 1000).await.unwrap();
    assert_eq!(cps.len() as i64, CHECKPOINT_KEEP, "应淘汰至保留上限");
    assert_eq!(cps[0].request_seq, CHECKPOINT_KEEP + 4, "最新保留");
    assert_eq!(cps.last().unwrap().request_seq, 5, "淘汰按 (request_seq, created_at) 取最旧（含手动点）");
}

// ─── S3-e 检查点合并（方案 A）：统一引用视图 ──────────────────

#[tokio::test]
async fn list_checkpoint_refs_merges_anchors_and_running_tasks() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    put_checkpoint(&store, "s", 3, "manual").await.unwrap();
    put_checkpoint(&store, "s", 9, "auto").await.unwrap();
    let tasks = LongTaskRepository::new_in_memory().await.unwrap();
    // 活跃任务（心跳为 1h 前——比锚点旧，用于跨源排序断言）+ 终态任务（不应出现）
    tasks.save(task_record("longtask-run", LongTaskStatus::Running, -3600)).await.unwrap();
    tasks.save(task_record("longtask-done", LongTaskStatus::Completed, -10)).await.unwrap();

    let refs = list_checkpoint_refs(&*store, Some(&tasks), "s", 10).await.unwrap();
    assert_eq!(refs.len(), 3, "2 锚点 + 1 活跃任务断点（终态任务排除）");
    assert_eq!(refs.iter().filter(|r| r.kind() == CheckpointKind::SessionAnchor).count(), 2);
    let task_refs: Vec<_> = refs.iter().filter(|r| r.kind() == CheckpointKind::TaskResume).collect();
    assert_eq!(task_refs.len(), 1);
    assert_eq!(task_refs[0].id, "longtask-run");
    assert_eq!(task_refs[0].session_id, None, "任务断点未绑定会话（引用式）");
    assert!(matches!(
        task_refs[0].anchor,
        CheckpointAnchor::TaskProgress { ref task_id } if task_id == "longtask-run"
    ));
    assert_eq!(refs.last().unwrap().id, "longtask-run", "按 created_at_ms 降序——旧心跳排末位");
    // limit 截断（取最新）
    let refs = list_checkpoint_refs(&*store, Some(&tasks), "s", 2).await.unwrap();
    assert_eq!(refs.len(), 2);
    assert!(refs.iter().all(|r| r.kind() == CheckpointKind::SessionAnchor));

    // 未配置长任务存储：只出锚点（入口契约的 Option 面）
    let refs = list_checkpoint_refs(&*store, None, "s", 10).await.unwrap();
    assert_eq!(refs.len(), 2);
    assert!(refs.iter().all(|r| r.kind() == CheckpointKind::SessionAnchor));
}

#[tokio::test]
async fn anchor_prune_leaves_task_resume_untouched() {
    // 保留策略分治（方案 A 要点）：锚点按数量淘汰；任务断点随任务生命周期，不受锚点淘汰影响
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    put_checkpoint(&store, "s", 1, "manual").await.unwrap();
    let tasks = LongTaskRepository::new_in_memory().await.unwrap();
    tasks.save(task_record("longtask-run", LongTaskStatus::Running, 0)).await.unwrap();

    let deleted = store.prune_checkpoints("s", 0).await.unwrap();
    assert_eq!(deleted, 1, "锚点全量淘汰");

    let refs = list_checkpoint_refs(&*store, Some(&tasks), "s", 10).await.unwrap();
    assert_eq!(refs.len(), 1, "任务断点不参与锚点淘汰");
    assert_eq!(refs[0].kind(), CheckpointKind::TaskResume);
}
