use super::*;
use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
use agent_runtime::types::{MessageRole, OrchestratorMessage};

use crate::session_checkpoint::put_checkpoint;
use crate::session_store::{SessionRepository, SqliteSessionRepository};

fn msg(role: MessageRole, content: &str) -> OrchestratorMessage {
    OrchestratorMessage {
        role,
        content: content.into(),
        tool_calls: Vec::new(),
        tool_call_id: None,
        meta: None,
    }
}

fn snapshot(at: u64, purpose: &str, update: ViewUpdate) -> RequestSnapshot {
    RequestSnapshot {
        captured_at_ms: at,
        purpose: purpose.into(),
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
        view_update: update,
    }
}

/// 一轮对话视图（user + assistant），user 消息即「该边界的用户输入」
fn turn(user_text: &str) -> ViewUpdate {
    ViewUpdate::Full {
        messages: vec![
            msg(MessageRole::User, user_text),
            msg(MessageRole::Assistant, &format!("答复：{user_text}")),
        ],
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

/// 边界列表：降序 + 用户摘要 + 用途/模型透传
#[tokio::test]
async fn boundaries_listed_descending_with_user_text() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    for (i, text) in ["第一问", "第二问", "第三问"].iter().enumerate() {
        store
            .append_request_snapshot("s", &snapshot(100 + i as u64, "main", turn(text)))
            .await
            .unwrap();
    }

    let list = list_request_boundaries(store.as_ref(), "s", 0).await.unwrap();
    assert_eq!(list.len(), 3, "三个请求边界应全部列出");
    assert_eq!(
        list.iter().map(|b| b.request_seq).collect::<Vec<_>>(),
        vec![2, 1, 0],
        "必须降序（最新在前）"
    );
    assert_eq!(list[0].user_text.as_deref(), Some("第三问"), "摘要 = 该边界视图内最后一条 User 消息");
    assert_eq!(list[0].purpose, "main");
    assert_eq!(list[0].model_id, "test-model");
    assert!(list[0].checkpoint_id.is_none(), "未打点边界无检查点标注");
}

/// 检查点标注：只有打点过的边界带 id/kind
#[tokio::test]
async fn boundaries_mark_checkpoint_on_seq() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    for (i, text) in ["a", "b", "c"].iter().enumerate() {
        store
            .append_request_snapshot("s", &snapshot(200 + i as u64, "main", turn(text)))
            .await
            .unwrap();
    }
    let cp_id = put_checkpoint(&store, "s", 1, "manual").await.unwrap();

    let list = list_request_boundaries(store.as_ref(), "s", 0).await.unwrap();
    let marked: Vec<_> = list.iter().filter(|b| b.checkpoint_id.is_some()).collect();
    assert_eq!(marked.len(), 1, "只有打点边界带检查点标注");
    assert_eq!(marked[0].request_seq, 1);
    assert_eq!(marked[0].checkpoint_id.as_deref(), Some(cp_id.as_str()));
    assert_eq!(marked[0].checkpoint_kind.as_deref(), Some("manual"));
}

/// limit：>0 取最近 N 条；<=0 不截断
#[tokio::test]
async fn boundaries_limit_keeps_newest_zero_means_all() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    seed_session(&store, "s").await;
    for i in 0..5u64 {
        store
            .append_request_snapshot("s", &snapshot(300 + i, "main", turn(&format!("问{i}"))))
            .await
            .unwrap();
    }

    let newest_two = list_request_boundaries(store.as_ref(), "s", 2).await.unwrap();
    assert_eq!(
        newest_two.iter().map(|b| b.request_seq).collect::<Vec<_>>(),
        vec![4, 3],
        "limit=2 应取最新两条（降序）"
    );
    let all = list_request_boundaries(store.as_ref(), "s", 0).await.unwrap();
    assert_eq!(all.len(), 5, "limit<=0 不截断");
}

/// 空会话 / 未知会话：空列表（不报错）
#[tokio::test]
async fn boundaries_empty_for_unknown_session() {
    let store = SqliteSessionRepository::new_in_memory().await.unwrap();
    let list = list_request_boundaries(store.as_ref(), "nope", 0).await.unwrap();
    assert!(list.is_empty());
}

/// 摘要提取：坏 JSON / 无 User / 空白 → None（绝不猜锚点）；超长按字符截断
#[test]
fn extract_user_text_rejects_malformed_and_empty() {
    assert!(extract_user_text("不是 JSON").is_none(), "坏 JSON 必须返回 None");
    assert!(extract_user_text("{}").is_none(), "字段缺失同样 None");

    let assistant_only = serde_json::to_string(&snapshot(
        1,
        "main",
        ViewUpdate::Full { messages: vec![msg(MessageRole::Assistant, "只有助手消息")] },
    ))
    .unwrap();
    assert!(extract_user_text(&assistant_only).is_none(), "无 User 消息 → None");

    let blank = serde_json::to_string(&snapshot(1, "main", turn("   \n  "))).unwrap();
    assert!(extract_user_text(&blank).is_none(), "空白内容 → None");

    // 超长（中文按字符计）：截断到 120 字符
    let long = "长".repeat(200);
    let overflow = serde_json::to_string(&snapshot(1, "main", turn(&long))).unwrap();
    let text = extract_user_text(&overflow).expect("超长仍应提取");
    assert_eq!(text.chars().count(), USER_TEXT_PREVIEW_CHARS);

    // Appended 增量同口径（末条 User 消息）
    let appended = serde_json::to_string(&snapshot(
        1,
        "main",
        ViewUpdate::Appended {
            messages: vec![msg(MessageRole::User, "增量问"), msg(MessageRole::ToolResult, "工具结果")],
        },
    ))
    .unwrap();
    assert_eq!(extract_user_text(&appended).as_deref(), Some("增量问"), "Appended 同样提取末条 User");
}

/// 多条 User 消息时取**最后一条**（视图内末条 = 该边界的用户输入；供消息行匹配）
#[test]
fn extract_user_text_takes_last_user_message() {
    let multi = serde_json::to_string(&snapshot(
        1,
        "main",
        ViewUpdate::Full {
            messages: vec![
                msg(MessageRole::User, "旧问"),
                msg(MessageRole::Assistant, "旧答"),
                msg(MessageRole::User, "新问"),
                msg(MessageRole::Assistant, "新答"),
            ],
        },
    ))
    .unwrap();
    assert_eq!(
        extract_user_text(&multi).as_deref(),
        Some("新问"),
        "必须取视图内最后一条 User 消息（边界 = 本请求的用户输入）"
    );
}
