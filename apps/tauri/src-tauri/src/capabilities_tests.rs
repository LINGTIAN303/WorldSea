// A 批（2026-09-25）壳侧能力桥测试：声明校验 / 注册语义 / ACL 矩阵 / 回执认领 / 超时兜底。
//
// 注册表与在途表是**进程级全局态** → 所有用例经 TEST_LOCK 串行并各自清场
// （并行跑会互相踩：与 D1 批 pid 夹具同类教训）。

use super::*;

static TEST_LOCK: Mutex<()> = Mutex::new(());

fn decl(id: &str, acl: &[&str]) -> CapabilityDecl {
    CapabilityDecl {
        id: id.to_string(),
        summary: format!("{id} 的说明"),
        params: vec![],
        acl: acl.iter().map(|s| s.to_string()).collect(),
    }
}

/// 串行 + 清场；返回的 guard 必须活到用例结束。
fn setup() -> std::sync::MutexGuard<'static, ()> {
    let guard = TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    reset_for_test();
    guard
}

#[test]
fn decl_shape_is_validated() {
    let _guard = setup();

    assert!(validate_decl(&decl("", &[]), "main").unwrap_err().contains("id 不能为空"));
    assert!(validate_decl(&decl("views", &[]), "main").unwrap_err().contains("形状非法"));
    assert!(validate_decl(&decl("World.Views", &[]), "main").unwrap_err().contains("形状非法"));
    assert!(validate_decl(&decl("world.views", &[]), "shell").unwrap_err().contains("未知提供方"));
    assert!(validate_decl(&decl("world.views", &["dsh"]), "main")
        .unwrap_err()
        .contains("ACL 含未知调用方"));
    assert!(validate_decl(&decl("world.views.list", &["main"]), "workspace").is_ok());
}

#[test]
fn register_is_all_or_nothing_and_conflict_aware() {
    let _guard = setup();

    // 一条非法 → 整批拒绝，不留半登记
    let bad_batch = vec![decl("world.ok", &["main"]), decl("bad_shape", &["main"])];
    assert!(register(&bad_batch, "workspace").is_err());
    assert!(list().is_empty(), "整批拒绝后注册表必须为空");

    // 同提供方重复登记 → 覆盖（不叠加）
    let first = register(&[decl("world.views.list", &["main"])], "workspace").unwrap();
    assert_eq!(first, vec!["world.views.list".to_string()]);
    let mut updated = decl("world.views.list", &["main"]);
    updated.summary = "改过的说明".to_string();
    register(&[updated], "workspace").unwrap();
    let records = list();
    assert_eq!(records.len(), 1, "同提供方重复登记应覆盖而非叠加");
    assert_eq!(records[0].summary, "改过的说明");

    // 异提供方抢同名 → 冲突
    let error = register(&[decl("world.views.list", &["main"])], "main").unwrap_err();
    assert!(error.contains("CAPABILITY_CONFLICT"), "实际：{error}");
    // 冲突被拒后，原记录仍在（不被抹掉）
    assert_eq!(find("world.views.list").unwrap().provider, "workspace");
}

#[test]
fn acl_matrix_denies_by_default() {
    let _guard = setup();
    register(&[decl("world.views.list", &["main"])], "workspace").unwrap();
    register(&[decl("world.open.secret", &[])], "workspace").unwrap();

    let record = find("world.views.list").unwrap();
    assert!(check_acl(&record, "main").is_ok());
    let denied = check_acl(&record, "workspace").unwrap_err();
    assert!(denied.contains("CAPABILITY_FORBIDDEN"), "实际：{denied}");
    assert!(denied.contains("main"), "拒绝信息应列出可调方");

    let empty = find("world.open.secret").unwrap();
    assert!(check_acl(&empty, "main").unwrap_err().contains("空，无人可调"));
    assert!(check_acl(&empty, "workspace").unwrap_err().contains("空，无人可调"));

    // 未知调用方（不在 PROVIDERS 里的 label）一律拒
    assert!(check_acl(&record, "evil").unwrap_err().contains("未知调用方"));
}

#[test]
fn result_is_claimed_only_by_the_declared_provider() {
    let _guard = setup();
    let (call_id, mut rx) = {
        let rx = park_pending("cap-test-1", "workspace");
        ("cap-test-1".to_string(), rx)
    };
    assert!(is_pending(&call_id));

    // 冒名回执（不是该调用的提供方）→ 拒，且在途条目仍在
    let impostor = complete(&call_id, "main", Ok(serde_json::json!({"stolen": true}))).unwrap_err();
    assert!(impostor.contains("CAPABILITY_NO_PENDING"), "实际：{impostor}");
    assert!(is_pending(&call_id), "冒名回执不得消费在途条目");

    // 正主回执 → 通，等待方拿到值，条目出表；二次回执 → NO_PENDING
    complete(&call_id, "workspace", Ok(serde_json::json!({"id": "p1"}))).unwrap();
    assert!(!is_pending(&call_id));
    assert_eq!(rx.try_recv().unwrap().unwrap()["id"], "p1");
    assert!(complete(&call_id, "workspace", Ok(Value::Null))
        .unwrap_err()
        .contains("CAPABILITY_NO_PENDING"));

    // 未知 callId
    assert!(complete("cap-nope", "workspace", Ok(Value::Null))
        .unwrap_err()
        .contains("CAPABILITY_NO_PENDING"));
}

#[tokio::test]
async fn timeout_completes_pending_with_structured_error() {
    let _guard = setup();
    let call_id = "cap-test-timeout".to_string();
    let rx = park_pending(&call_id, "main");
    spawn_timeout(call_id.clone(), "main".to_string(), Duration::from_millis(50));

    let outcome = rx.await.expect("超时兜底必须回执，而非悬空");
    let error = outcome.unwrap_err();
    assert!(error.contains("CAPABILITY_TIMEOUT"), "实际：{error}");
    assert!(!is_pending(&call_id), "超时后条目应出表");
}

#[tokio::test]
async fn timeout_is_a_noop_when_call_already_completed() {
    let _guard = setup();
    let call_id = "cap-test-race".to_string();
    let rx = park_pending(&call_id, "main");
    spawn_timeout(call_id.clone(), "main".to_string(), Duration::from_millis(50));

    complete(&call_id, "main", Ok(serde_json::json!("first"))).unwrap();
    assert_eq!(rx.await.unwrap().unwrap(), "first");

    // 超时线程醒来时条目已出表 → 静默返回（不 panic、不覆盖已交付的结果）
    std::thread::sleep(Duration::from_millis(120));
    assert!(!is_pending(&call_id));
}

#[test]
fn list_is_sorted_and_unknown_id_is_none() {
    let _guard = setup();
    register(&[decl("world.b", &["main"]), decl("world.a", &["main"])], "workspace").unwrap();
    let ids: Vec<String> = list().into_iter().map(|r| r.id).collect();
    assert_eq!(ids, vec!["world.a".to_string(), "world.b".to_string()]);
    assert!(find("world.missing").is_none());
}
