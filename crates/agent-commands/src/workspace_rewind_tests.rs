//! 工作区回滚用例（W 批）：倒序恢复 / 新建删除 / 幂等 / 失败明细 / 越界守卫 / 边界过滤

use super::*;

use crate::session_store::{SessionRepository, SqliteSessionRepository};

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!("ws-rewind-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    std::fs::create_dir_all(&p).unwrap();
    p
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

/// 已改写文件 → 回滚恢复 before 内容
#[tokio::test]
async fn record_and_rewind_restores_modified_file() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    let dir = tmp_dir("restore");
    let raw = RawStore::open(&dir).unwrap();
    let file = dir.join("a.md");
    std::fs::write(&file, "旧内容").unwrap();

    let before_hash = raw.store("旧内容").unwrap().content_hash;
    store
        .record_workspace_op("s", &file.to_string_lossy(), Some(&before_hash), "write")
        .await
        .unwrap();
    std::fs::write(&file, "新内容").unwrap();

    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(report.restored, 1, "应恢复一条");
    assert!(report.failed.is_empty(), "不应有失败: {:?}", report.failed);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "旧内容");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 新建文件（before=None）→ 回滚删除（已不存在按幂等计成功）
#[tokio::test]
async fn rewind_removes_created_file_and_is_idempotent() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    let dir = tmp_dir("created");
    let raw = RawStore::open(&dir).unwrap();
    let file = dir.join("new.md");
    store
        .record_workspace_op("s", &file.to_string_lossy(), None, "write")
        .await
        .unwrap();
    std::fs::write(&file, "新建").unwrap();

    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(report.removed, 1);
    assert!(!file.exists(), "新建文件应被删除");

    // 重复回滚：文件已不存在 → 仍计 removed（幂等），不报失败
    let again = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(again.removed, 1);
    assert!(again.failed.is_empty());
    let _ = std::fs::remove_dir_all(&dir);
}

/// 同一文件多次写：倒序撤销（LIFO）→ 末态 = 最早 before 内容
#[tokio::test]
async fn rewind_lifo_multiple_writes_end_at_earliest_before() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    let dir = tmp_dir("lifo");
    let raw = RawStore::open(&dir).unwrap();
    let file = dir.join("draft.md");
    std::fs::write(&file, "v1").unwrap();

    // 第 1 次写：before=v1 → 文件变 v2
    let h1 = raw.store("v1").unwrap().content_hash;
    store.record_workspace_op("s", &file.to_string_lossy(), Some(&h1), "edit").await.unwrap();
    std::fs::write(&file, "v2").unwrap();
    // 第 2 次写：before=v2 → 文件变 v3
    let h2 = raw.store("v2").unwrap().content_hash;
    store.record_workspace_op("s", &file.to_string_lossy(), Some(&h2), "edit").await.unwrap();
    std::fs::write(&file, "v3").unwrap();

    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(report.restored, 2);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "v1",
        "倒序撤销（v3→v2→v1）末态必须是 v1；正序会停在 v2（反证②锚点）"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// 边界过滤：只撤销 `>= target` 的变更（更早的运行保留）
#[tokio::test]
async fn rewind_filters_by_request_seq_inclusive() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    // 造两个请求边界（seq 0/1）
    for i in 0..2u64 {
        store
            .append_request_snapshot(
                "s",
                &agent_runtime::agent::request_snapshot::RequestSnapshot {
                    captured_at_ms: 100 + i,
                    purpose: "main".into(),
                    provider: "t".into(),
                    model_id: "m".into(),
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
                    view_update: agent_runtime::agent::request_snapshot::ViewUpdate::Full {
                        messages: Vec::new(),
                    },
                },
            )
            .await
            .unwrap();
    }
    let dir = tmp_dir("filter");
    let raw = RawStore::open(&dir).unwrap();
    let file = dir.join("f.md");
    std::fs::write(&file, "base").unwrap();

    let h = raw.store("base").unwrap().content_hash;
    store.record_workspace_op("s", &file.to_string_lossy(), Some(&h), "write").await.unwrap(); // 归 seq=1
    std::fs::write(&file, "changed").unwrap();

    // 回滚到 seq=2（> 全部 op 的归属）→ 无 op 命中，文件不动
    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 2).await.unwrap();
    assert_eq!(report.restored, 0);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "changed", "target 之后的变更才撤销");

    // 回滚到 seq=1（含）→ 命中
    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 1).await.unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "base");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 快照缺失 / 越界路径 → 进失败明细（不静默、不误写）
#[tokio::test]
async fn rewind_reports_missing_snapshot_and_rewrites_nothing_outside() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    let dir = tmp_dir("fail");
    let raw = RawStore::open(&dir).unwrap();
    let outside = dir.parent().unwrap().join(format!("outside-{}.md", std::process::id()));
    std::fs::write(&outside, "外部文件").unwrap();

    store
        .record_workspace_op("s", &outside.to_string_lossy(), None, "write")
        .await
        .unwrap();
    // 快照缺失：伪造一条 before_hash 指向不存在坐标的 op（工作区内路径）
    let inside = dir.join("x.md");
    std::fs::write(&inside, "现在").unwrap();
    store
        .record_workspace_op("s", &inside.to_string_lossy(), Some("0011223344556677"), "write")
        .await
        .unwrap();

    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(report.failed.len(), 2, "越界 + 快照缺失各一条: {:?}", report.failed);
    assert!(report.failed.iter().any(|f| f.reason.contains("越出工作区")));
    assert!(report.failed.iter().any(|f| f.reason.contains("快照缺失")));
    assert!(outside.exists(), "越界文件不得被触碰");
    assert_eq!(std::fs::read_to_string(&inside).unwrap(), "现在", "快照缺失时不得改写");
    let _ = std::fs::remove_file(&outside);
    let _ = std::fs::remove_dir_all(&dir);
}

/// 装配级整链：真实 `WriteFileTool` 经 `FileOpRecorder` 落 ops → `rewind_workspace` 恢复
/// （防「命令/记录链断裂而单测恒绿」——UX 批走查教训：接线缺口要靠装配级用例兜底）
#[tokio::test]
async fn write_file_tool_records_before_via_recorder_and_rewinds() {
    use agent_runtime::tool::Tool;

    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    let dir = tmp_dir("tool");
    let raw = RawStore::open(&dir).unwrap();
    let file = dir.join("tool.md");
    std::fs::write(&file, "工具前").unwrap();

    let ctx = ToolContext {
        workdir: Some(dir.clone()),
        file_op_recorder: Some(Arc::new(WorkspaceFileOpRecorder::new(
            store.clone() as Arc<dyn SessionRepository>,
            raw.clone(),
            "s",
        ))),
        ..Default::default()
    };

    let out = crate::fs_tools::WriteFileTool
        .execute_with_ctx(
            &ctx,
            serde_json::json!({ "path": file.to_string_lossy(), "content": "工具后" }),
        )
        .await
        .unwrap();
    assert_eq!(out["ok"], true);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "工具后", "工具应已写入");

    // 记录链：ops 落表（归属边界 0——会话尚无请求快照）
    let ops = store.workspace_ops_from("s", 0).await.unwrap();
    assert_eq!(ops.len(), 1, "真实工具执行应经记录器落一条 op");
    assert_eq!(ops[0].op, "write");
    assert!(ops[0].before_hash.is_some(), "已存在文件应有 before 快照");

    // 回滚链：恢复到工具执行前
    let report = rewind_workspace(store.as_ref(), &raw, &dir, "s", 0).await.unwrap();
    assert_eq!(report.restored, 1);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "工具前");
    let _ = std::fs::remove_dir_all(&dir);
}

/// 查询面：`workspace_ops_from` 降序 + `recent_workspace_ops` 截断
#[tokio::test]
async fn ops_queries_descending_and_limited() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    for i in 0..3 {
        store
            .record_workspace_op("s", &format!("C:/w/f{i}.md"), None, "write")
            .await
            .unwrap();
    }
    let all = store.workspace_ops_from("s", 0).await.unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].path, "C:/w/f2.md", "降序按发生序（最新在前）");
    let limited = store.recent_workspace_ops("s", 2).await.unwrap();
    assert_eq!(limited.len(), 2);
    // 未知会话 → 空
    assert!(store.workspace_ops_from("nope", 0).await.unwrap().is_empty());
}
