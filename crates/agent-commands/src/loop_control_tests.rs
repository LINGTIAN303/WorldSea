// ─── 测试 ────────────────────────────────────────────

    use super::*;

    fn make_entry(max_turns: Option<u32>) -> LoopControlEntry {
        let config = LoopControlConfig {
            rate_limit: agent_runtime::loop_control::RateLimitConfig {
                max_turns,
                ..Default::default()
            },
            ..Default::default()
        };
        let controller = Arc::new(LoopController::new(config.clone()));
        LoopControlEntry::new(controller, config)
    }

    #[tokio::test]
    async fn register_get_remove_roundtrip() {
        let registry = LoopControlRegistry::new();
        assert_eq!(registry.count().await, 0);
        assert!(registry.list().await.is_empty());

        registry.register("task_1", make_entry(None)).await.unwrap();
        assert_eq!(registry.count().await, 1);
        assert!(registry.contains("task_1").await);
        assert_eq!(registry.list().await, vec!["task_1"]);

        registry.remove("task_1").await.unwrap();
        assert_eq!(registry.count().await, 0);
        // 重复注册报 AlreadyExists
        registry.register("task_2", make_entry(None)).await.unwrap();
        let err = registry.register("task_2", make_entry(None)).await;
        assert!(matches!(err, Err(LoopControlRegistryError::AlreadyExists { .. })));
    }

    #[tokio::test]
    async fn get_missing_returns_not_found() {
        let registry = LoopControlRegistry::new();
        let err = registry.get("nope").await;
        assert!(matches!(err, Err(LoopControlRegistryError::NotFound { .. })));
    }

    #[tokio::test]
    async fn check_and_emit_broadcasts_rate_limit_event() {
        // 用内存监听器捕获广播的事件
        struct CaptureListener(std::sync::Mutex<Vec<OrchestratorEvent>>);
        impl EventListener for CaptureListener {
            fn on_event(&self, event: &OrchestratorEvent) {
                self.0.lock().unwrap().push(event.clone());
            }
        }

        let registry = LoopControlRegistry::new();
        // max_turns = 1 → 一轮后超限
        let entry = make_entry(Some(1));
        let capture = Arc::new(CaptureListener(std::sync::Mutex::new(Vec::new())));
        entry.subscribe(capture.clone()).await;
        registry.register("task_1", entry).await.unwrap();

        // 初始 check：无事件
        let r0 = registry.check_and_emit("task_1").await.unwrap();
        assert!(!r0.has_any);
        assert!(capture.0.lock().unwrap().is_empty());

        // 增加一轮后 check：触发 rate_limit 事件
        let entry = registry.get("task_1").await.unwrap();
        entry.controller.rate_limiter.inc_turns();

        let r1 = registry.check_and_emit("task_1").await.unwrap();
        assert!(r1.has_any);
        assert!(r1.should_stop);
        assert!(matches!(
            r1.rate_limit_exceeded,
            Some(RateLimitExceeded::Turns { current: 1, max: 1 })
        ));
        let captured = capture.0.lock().unwrap();
        assert!(captured.iter().any(|e| matches!(
            e,
            OrchestratorEvent::LoopEngRateLimitExceeded {
                task_id,
                limit_type,
                current: 1,
                max: 1,
            } if task_id == "task_1" && limit_type == "turns"
        )));
    }

    #[test]
    fn check_result_from_empty_check_should_be_falsy() {
        let check = LoopControlCheck {
            rate_limit_exceeded: None,
            soft_timeout_level: None,
            watchdog_alert: None,
        };
        let result = LoopControlCheckResult::from_check(check);
        assert!(!result.has_any);
        assert!(!result.should_stop);
    }

    #[test]
    fn status_from_entry_reports_counters() {
        let entry = make_entry(None);
        entry.controller.rate_limiter.inc_turns();
        entry.controller.rate_limiter.inc_tool_calls();
        entry.controller.rate_limiter.add_tokens(42);
        let status = LoopControlStatus::from_entry("t1", &entry);
        assert_eq!(status.task_id, "t1");
        assert_eq!(status.turns, 1);
        assert_eq!(status.tool_calls, 1);
        assert_eq!(status.tokens, 42);
        assert!(status.created_at > 0);
    }

    #[tokio::test]
    async fn reset_counters_clears_turn_count() {
        let entry = make_entry(None);
        entry.controller.rate_limiter.inc_turns();
        assert_eq!(entry.controller.rate_limiter.turns(), 1);
        entry.reset_counters();
        assert_eq!(entry.controller.rate_limiter.turns(), 0);
    }
