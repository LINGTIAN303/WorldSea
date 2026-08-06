// ─── 测试 ────────────────────────────────────────────

    use super::*;
    use crate::types::MessageRole;

    fn make_test_checkpoint() -> LongTaskCheckpoint {
        LongTaskCheckpoint {
            agent_messages: vec![OrchestratorMessage {
                role: MessageRole::User,
                content: "test".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            }],
            last_user_text: "test prompt".into(),
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        }
    }

    #[tokio::test]
    async fn test_start_task_creates_running_record() {
        let manager = LongTaskManager::new();
        let record = manager
            .start_task(
                "test-1".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta {
                    prompt: "test prompt".into(),
                    ..Default::default()
                },
            )
            .await;

        assert_eq!(record.task_id, "test-1");
        assert_eq!(record.task_type, LongTaskType::MainAgent);
        assert_eq!(record.status, LongTaskStatus::Running);
        assert!(record.ended_at.is_none());
        assert!(manager.has_active_task().await);
    }

    #[tokio::test]
    async fn test_complete_task_sets_ended_at() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-2".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let completed = manager.complete_task().await;
        assert!(completed.is_some());
        let completed = completed.unwrap();
        assert_eq!(completed.status, LongTaskStatus::Completed);
        assert!(completed.ended_at.is_some());
        assert!(!manager.has_active_task().await);
    }

    #[tokio::test]
    async fn test_cancel_flag_cooperative() {
        let manager = LongTaskManager::new();
        assert!(!manager.is_cancel_requested());

        manager.request_cancel();
        assert!(manager.is_cancel_requested());

        // complete_task 后 flag 应被重置
        manager
            .start_task(
                "test-3".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;
        manager.request_cancel();
        assert!(manager.is_cancel_requested());

        manager.cancel_task().await;
        assert!(!manager.is_cancel_requested());
    }

    #[tokio::test]
    async fn test_checkpoint_updates_progress() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-4".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let new_checkpoint = LongTaskCheckpoint {
            agent_messages: vec![],
            last_user_text: "updated".into(),
            skill_names: Some(vec!["skill1".into()]),
            chat_mode: Some("advanced".into()),
            locked_chat_mode: None,
        };

        manager
            .checkpoint(
                Some(5),
                Some("echo".into()),
                Some("executing".into()),
                new_checkpoint,
            )
            .await;

        let active = manager.get_active_task().await.unwrap();
        assert_eq!(active.turn_count, 5);
        assert_eq!(active.current_tool.as_deref(), Some("echo"));
        assert_eq!(active.current_phase.as_deref(), Some("executing"));
        assert!(manager.is_checkpoint_dirty().await);
    }

    #[tokio::test]
    async fn test_resume_task_keeps_task_id() {
        let manager = LongTaskManager::new();
        let original_record = LongTaskRecord {
            task_id: "resumed-1".into(),
            task_type: LongTaskType::MainAgent,
            status: LongTaskStatus::Running,
            started_at: Utc::now() - chrono::Duration::seconds(60),
            last_heartbeat_at: Utc::now() - chrono::Duration::seconds(30),
            ended_at: None,
            turn_count: 10,
            current_tool: Some("echo".into()),
            current_phase: None,
            checkpoint: make_test_checkpoint(),
            meta: LongTaskMeta::default(),
        };

        manager.resume_task(original_record.clone()).await;

        let active = manager.get_active_task().await.unwrap();
        assert_eq!(active.task_id, "resumed-1");
        assert_eq!(active.turn_count, 10);
        // last_heartbeat_at 应被更新为 now
        assert!(active.last_heartbeat_at > original_record.last_heartbeat_at);
    }

    #[tokio::test]
    async fn test_heartbeat_status_transitions() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-5".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        // 刚启动应为 Alive
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Alive);

        // 模拟长时间未心跳
        {
            let mut active = manager.active_task.lock().await;
            if let Some(record) = active.as_mut() {
                record.last_heartbeat_at = Utc::now() - chrono::Duration::seconds(60);
            }
        }
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Stale);

        // 模拟崩溃（超过 5min）
        {
            let mut active = manager.active_task.lock().await;
            if let Some(record) = active.as_mut() {
                record.last_heartbeat_at = Utc::now() - chrono::Duration::seconds(400);
            }
        }
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Dead);
    }

    #[tokio::test]
    async fn test_fail_task_terminal_transition() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "fail-1".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        // 先请求取消，验证 fail_task 会重置 cancel flag
        manager.request_cancel();
        assert!(manager.is_cancel_requested());

        let failed = manager.fail_task("boom").await;
        assert!(failed.is_some());
        let failed = failed.unwrap();
        assert_eq!(failed.status, LongTaskStatus::Failed);
        assert!(failed.ended_at.is_some());
        // 终态：活跃任务被清空
        assert!(!manager.has_active_task().await);
        // 取消 flag 被重置、心跳回到 Alive
        assert!(!manager.is_cancel_requested());
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Alive);
    }

    #[tokio::test]
    async fn test_fail_task_no_active_returns_none() {
        let manager = LongTaskManager::new();
        assert!(manager.fail_task("boom").await.is_none());
    }

    #[tokio::test]
    async fn test_retry_task_keeps_running_and_marks_phase() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "retry-1".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let retried = manager.retry_task("llm timeout").await;
        assert!(retried.is_some());
        let retried = retried.unwrap();
        // 可重试失败：状态保持 Running，不设 ended_at
        assert_eq!(retried.status, LongTaskStatus::Running);
        assert!(retried.ended_at.is_none());
        // 错误记录到 current_phase（retry: 前缀）
        assert_eq!(retried.current_phase.as_deref(), Some("retry: llm timeout"));
        // 标记 dirty 供持久化
        assert!(manager.is_checkpoint_dirty().await);

        // 活跃任务仍是 Running（未被清除）
        assert!(manager.has_active_task().await);
        let active = manager.get_active_task().await.unwrap();
        assert_eq!(active.status, LongTaskStatus::Running);
    }

    #[tokio::test]
    async fn test_retry_task_truncates_long_error() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "retry-2".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let long_error = "x".repeat(500);
        let retried = manager.retry_task(&long_error).await.unwrap();
        let phase = retried.current_phase.unwrap();
        // 错误被截断到 100 字符（不含 "retry: " 前缀）
        assert!(phase.len() <= 100 + "retry: ".len());
    }

    #[tokio::test]
    async fn test_retry_task_no_active_returns_none() {
        let manager = LongTaskManager::new();
        assert!(manager.retry_task("boom").await.is_none());
    }

    #[tokio::test]
    async fn test_clear_retry_marker() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "retry-3".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        manager.retry_task("llm timeout").await;
        assert_eq!(
            manager.get_active_task().await.unwrap().current_phase.as_deref(),
            Some("retry: llm timeout")
        );

        manager.clear_retry_marker().await;
        let active = manager.get_active_task().await.unwrap();
        assert!(active.current_phase.is_none());
        // 状态仍为 Running（清除标记不影响状态）
        assert_eq!(active.status, LongTaskStatus::Running);
    }

    #[tokio::test]
    async fn test_clear_retry_marker_ignores_non_retry_phase() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "retry-4".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        // 非 retry 前缀的 phase 不应被清除
        manager
            .checkpoint(
                Some(1),
                Some("echo".into()),
                Some("executing".into()),
                make_test_checkpoint(),
            )
            .await;
        manager.clear_retry_marker().await;
        assert_eq!(
            manager.get_active_task().await.unwrap().current_phase.as_deref(),
            Some("executing")
        );
    }
