//! 交互协调器用例（S5-a）：三型往返 + kind 错配反证 + 统一随轮取消反证

use super::*;
use agent_engine::contracts::interaction::AskAnswer;

async fn wait_pending(broker: &InteractionBroker, n: usize) {
    for _ in 0..100 {
        if broker.pending_count().await == n {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("等待 {n} 条 pending 超时");
}

async fn first_pending_id(broker: &InteractionBroker) -> String {
    wait_pending(broker, 1).await;
    broker.pending.lock().await.keys().next().cloned().unwrap()
}

#[tokio::test]
async fn permission_resolve_wakes_waiter_and_is_idempotent() {
    let broker = Arc::new(InteractionBroker::new());
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let b2 = broker.clone();
    let bc = broadcaster.clone();
    let handle = tokio::spawn(async move {
        b2.request_permission(&bc, "execute_command", serde_json::json!({ "command": "shutdown now" }))
            .await
    });
    let id = first_pending_id(&broker).await;
    assert!(id.starts_with("ix-"), "统一 id 前缀: {id}");
    assert!(broker
        .resolve(&id, InteractionOutcome::Permission(ConfirmationOutcome::Denied))
        .await);
    assert_eq!(handle.await.unwrap(), ConfirmationOutcome::Denied);
    // 已解析的 id 再次 resolve → false（已处理）
    assert!(!broker
        .resolve(&id, InteractionOutcome::Permission(ConfirmationOutcome::Approved))
        .await);
}

#[tokio::test]
async fn resolve_rejects_kind_mismatch_without_waking() {
    // 反证①（S5 §五.1）：kind 错配即拒——不唤醒、不移除
    let broker = Arc::new(InteractionBroker::new());
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let b2 = broker.clone();
    let bc = broadcaster.clone();
    let handle = tokio::spawn(async move {
        b2.request_permission(&bc, "entity_delete", serde_json::json!({ "id": "x" })).await
    });
    let id = first_pending_id(&broker).await;
    // 用 user_input 结果去解析 permission 请求 → 拒
    assert!(!broker
        .resolve(&id, InteractionOutcome::UserInput(AskOutcome::Denied))
        .await);
    assert_eq!(broker.pending_count().await, 1, "错配不得移除等待方");
    // 正确 kind 仍可唤醒
    assert!(broker
        .resolve(&id, InteractionOutcome::Permission(ConfirmationOutcome::Skipped))
        .await);
    assert_eq!(handle.await.unwrap(), ConfirmationOutcome::Skipped);
}

#[tokio::test]
async fn permission_timeout_returns_timeout_and_clears_pending() {
    // D8：超时不再与「拒绝」混同——应产出独立的 Timeout 四值
    let broker = InteractionBroker::with_timeout(Duration::from_millis(30));
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let outcome = broker
        .request_permission(&broadcaster, "execute_command", serde_json::json!({}))
        .await;
    assert_eq!(outcome, ConfirmationOutcome::Timeout);
    assert!(!outcome.is_approved());
    assert_eq!(broker.pending_count().await, 0, "超时应清理 pending");
}

#[tokio::test]
async fn user_input_resolve_wakes_with_answers() {
    let broker = Arc::new(InteractionBroker::new());
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let b2 = broker.clone();
    let bc = broadcaster.clone();
    let handle = tokio::spawn(async move {
        b2.request_user_input(&bc, serde_json::json!([{ "id": "q1", "question": "继续吗？" }]))
            .await
    });
    let id = first_pending_id(&broker).await;
    let answers = vec![AskAnswer {
        id: "q1".into(),
        selected: vec!["Approve".into()],
        custom: None,
    }];
    assert!(broker
        .resolve(&id, InteractionOutcome::UserInput(AskOutcome::Answered(answers.clone())))
        .await);
    assert_eq!(handle.await.unwrap(), AskOutcome::Answered(answers));
    // 已解析的 id 再次 resolve → false（已处理）
    assert!(!broker
        .resolve(&id, InteractionOutcome::UserInput(AskOutcome::Denied))
        .await);
}

#[tokio::test]
async fn user_input_timeout_returns_timed_out_and_clears_pending() {
    let broker = InteractionBroker::with_ask_timeout(Duration::from_millis(30));
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let outcome = broker
        .request_user_input(&broadcaster, serde_json::json!([{ "id": "q1", "question": "继续？" }]))
        .await;
    assert_eq!(outcome, AskOutcome::TimedOut);
    assert_eq!(outcome.kind(), "timed_out");
    assert_eq!(broker.pending_count().await, 0, "超时应清理 pending");
    assert!(!broker
        .resolve("ix-any", InteractionOutcome::UserInput(AskOutcome::Denied))
        .await);
}

#[tokio::test]
async fn hook_review_roundtrip_and_timeout() {
    // 复核：放行 / 拒绝两分支 + 300s 兜底超时（此处缩短验证）→ TimedOut（fail-closed 由调用方收口）
    let broker = Arc::new(InteractionBroker::new());
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let b2 = broker.clone();
    let bc = broadcaster.clone();
    let handle = tokio::spawn(async move {
        b2.request_hook_review(&bc, "audit", "entity_delete", serde_json::json!({ "id": "x" }), "删除不可逆")
            .await
    });
    let id = first_pending_id(&broker).await;
    // kind 错配（permission 结果解析复核请求）→ 拒
    assert!(!broker
        .resolve(&id, InteractionOutcome::Permission(ConfirmationOutcome::Approved))
        .await);
    assert!(broker
        .resolve(&id, InteractionOutcome::HookReview(HookReviewOutcome::Approved))
        .await);
    assert_eq!(handle.await.unwrap(), HookReviewOutcome::Approved);

    // 超时分支
    let broker = InteractionBroker::with_hook_review_timeout(Duration::from_millis(30));
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let outcome = broker
        .request_hook_review(&broadcaster, "audit", "entity_delete", serde_json::json!({}), "复核")
        .await;
    assert_eq!(outcome, HookReviewOutcome::TimedOut);
    assert!(!outcome.is_approved(), "超时按拒绝 fail-closed");
    assert_eq!(broker.pending_count().await, 0, "超时应清理 pending");
}

#[tokio::test]
async fn cancel_all_wakes_every_kind_with_terminal_values() {
    // 反证②（S5 §五.2）：统一随轮取消——三型都收到内核侧终值，permission 亦被取消（旧缺口）
    let broker = Arc::new(InteractionBroker::new());
    let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
    let (b1, b2, b3) = (broker.clone(), broker.clone(), broker.clone());
    let (c1, c2, c3) = (broadcaster.clone(), broadcaster.clone(), broadcaster.clone());
    let h1 = tokio::spawn(async move {
        b1.request_permission(&c1, "execute_command", serde_json::json!({})).await
    });
    let h2 = tokio::spawn(async move { b2.request_user_input(&c2, serde_json::json!([])).await });
    let h3 = tokio::spawn(async move {
        b3.request_hook_review(&c3, "audit", "entity_delete", serde_json::json!({}), "复核").await
    });
    wait_pending(&broker, 3).await;
    let cancelled = broker.cancel_all().await;
    assert_eq!(cancelled.len(), 3, "三型都应被取消");
    assert!(cancelled.iter().any(|(_, k)| *k == InteractionKind::Permission));
    assert!(cancelled.iter().any(|(_, k)| *k == InteractionKind::UserInput));
    assert!(cancelled.iter().any(|(_, k)| *k == InteractionKind::HookReview));
    // permission：四值无「取消」值 → 收口为 Timeout（仍未执行）
    assert_eq!(h1.await.unwrap(), ConfirmationOutcome::Timeout);
    assert_eq!(h2.await.unwrap(), AskOutcome::Cancelled);
    assert_eq!(h3.await.unwrap(), HookReviewOutcome::Cancelled);
    // 清空后再取消 → 空列表（幂等）
    assert!(broker.cancel_all().await.is_empty());
}
