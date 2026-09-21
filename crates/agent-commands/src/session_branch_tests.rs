use super::*;
// `delete_session` 等经 trait 提供（存储方法面按仓储 trait 组织）
use crate::session_store::SessionRepository;

/// 造一个最小会话行（满足外键；不依赖 SessionRecord 构造面）
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

async fn count(store: &SqliteSessionRepository, sql: &str, bind: &str) -> i64 {
    sqlx::query_as::<_, (i64,)>(sql)
        .bind(bind)
        .fetch_one(&store.pool)
        .await
        .unwrap()
        .0
}

#[tokio::test]
async fn fork_roundtrip_and_idempotent() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "src").await;
    seed_session(&store, "new").await;

    store.record_fork("new", "src", 7).await.unwrap();
    let rec = store.read_fork("new").await.unwrap().expect("应有分叉记录");
    assert_eq!(rec.forked_from_session, "src");
    assert_eq!(rec.forked_from_seq, 7);

    // 幂等：重复写入（不同来源）不覆盖首写
    store.record_fork("new", "other", 9).await.unwrap();
    let rec = store.read_fork("new").await.unwrap().unwrap();
    assert_eq!(rec.forked_from_session, "src", "首写为准（ON CONFLICT DO NOTHING）");
    assert!(store.read_fork("src").await.unwrap().is_none(), "非分叉会话应无记录");
}

#[tokio::test]
async fn list_forks_of_reverse_lookup() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "src").await;
    seed_session(&store, "f1").await;
    seed_session(&store, "f2").await;
    store.record_fork("f1", "src", 3).await.unwrap();
    store.record_fork("f2", "src", 5).await.unwrap();

    let children = store.list_forks_of("src").await.unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0].session_id, "f1");
    assert_eq!(children[1].session_id, "f2");
}

#[tokio::test]
async fn checkpoint_prune_keeps_latest() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s1").await;
    for seq in 1..=5 {
        store
            .create_checkpoint("s1", seq, if seq % 2 == 0 { "auto" } else { "manual" })
            .await
            .unwrap();
    }
    let all = store.list_checkpoints("s1", 100).await.unwrap();
    assert_eq!(all.len(), 5);
    assert_eq!(all[0].request_seq, 5, "最新在前");

    let deleted = store.prune_checkpoints("s1", 2).await.unwrap();
    assert_eq!(deleted, 3);
    let left = store.list_checkpoints("s1", 100).await.unwrap();
    assert_eq!(left.len(), 2);
    assert_eq!(left[0].request_seq, 5);
    assert_eq!(left[1].request_seq, 4);
}

#[tokio::test]
async fn branch_op_bracket_and_reconcile() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s1").await;
    seed_session(&store, "s2").await;

    // 崩溃残留：s1 落 mark 未清
    let orphan = store
        .begin_branch_op("fork", "s1", Some("{\"forked_from_seq\":3}"))
        .await
        .unwrap();
    // 正常闭合：s2 落 mark 后清除
    let done = store.begin_branch_op("checkpoint", "s2", None).await.unwrap();
    store.finish_branch_op(&done).await.unwrap();
    store.finish_branch_op(&done).await.unwrap(); // 幂等：重复清除不报错

    let stale = store.reconcile_branch_ops("s1").await.unwrap();
    assert_eq!(stale.len(), 1);
    assert_eq!(stale[0].op_id, orphan);
    assert_eq!(stale[0].op, "fork");
    assert_eq!(count(&store, "SELECT COUNT(*) FROM session_branch_ops WHERE session_id = ?1", "s1").await, 0);
    assert_eq!(store.reconcile_branch_ops("s1").await.unwrap().len(), 0, "收敛幂等");

    let none = store.reconcile_branch_ops("s2").await.unwrap();
    assert!(none.is_empty(), "已闭合的 mark 不应被检出");
}

#[tokio::test]
async fn delete_session_cascades_branch_rows() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "src").await;
    seed_session(&store, "new").await;
    store.record_fork("new", "src", 1).await.unwrap();
    store.create_checkpoint("new", 1, "manual").await.unwrap();
    store.begin_branch_op("rewind", "new", None).await.unwrap();

    store.delete_session("new").await.unwrap();

    assert!(store.read_fork("new").await.unwrap().is_none(), "分叉记录应随会话级联删除");
    assert_eq!(store.list_checkpoints("new", 100).await.unwrap().len(), 0);
    assert_eq!(count(&store, "SELECT COUNT(*) FROM session_branch_ops WHERE session_id = ?1", "new").await, 0);
    assert!(store.read_fork("src").await.unwrap().is_none(), "源会话不受影响");
}
