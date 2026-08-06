// ─── 测试 ────────────────────────────────────────────

    use super::*;
    use async_trait::async_trait;
    use crate::backend::PromptResponse;
    use crate::tool::{EchoTool, SimpleToolBus};
    use crate::types::ToolCall;

    /// Mock 后端 — 返回预设响应
    struct MockBackend {
        responses: AsyncMutex<Vec<PromptResponse>>,
        last_options: AsyncMutex<Option<PromptCallOptions>>,
    }

    impl MockBackend {
        fn new(responses: Vec<PromptResponse>) -> Self {
            Self {
                responses: AsyncMutex::new(responses),
                last_options: AsyncMutex::new(None),
            }
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for MockBackend {
        async fn prompt(
            &self,
            _prompt: String,
            options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.last_options.lock().await = options;
            let mut responses = self.responses.lock().await;
            if responses.is_empty() {
                return Err(BackendError::Other("no more mock responses".into()));
            }
            Ok(responses.remove(0))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }

        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn run_returns_final_text_when_no_tool_calls() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "你好，我是助手",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("你好".into()).await.expect("应执行成功");

        assert_eq!(result, "你好，我是助手");
    }

    #[tokio::test]
    async fn run_executes_tool_calls_then_returns_final_text() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "我来调用 echo".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({"message": "hello"}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("工具返回了 hello"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("调用 echo 工具".into()).await.expect("应执行成功");

        assert_eq!(result, "工具返回了 hello");

        // 验证消息历史：user → assistant(含 tool_call) → toolResult → assistant(最终)
        let messages = agent.get_messages().await;
        assert_eq!(messages.len(), 4);
        assert!(matches!(messages[0].role, MessageRole::User));
        assert!(matches!(messages[1].role, MessageRole::Assistant));
        assert_eq!(messages[1].tool_calls.len(), 1);
        assert!(matches!(messages[2].role, MessageRole::ToolResult));
        assert_eq!(messages[2].tool_call_id, Some("call_1".into()));
        assert!(matches!(messages[3].role, MessageRole::Assistant));
    }

    #[tokio::test]
    async fn run_returns_error_when_max_iterations_exceeded() {
        // 每轮都返回工具调用，永远不结束
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 3,
            ..Default::default()
        });

        let result = agent.run("无限循环".into()).await;
        assert!(result.is_err());
        match result {
            Err(AgentError::MaxIterationsExceeded(3)) => {}
            _ => panic!("应返回 MaxIterationsExceeded(3)"),
        }
    }

    #[tokio::test]
    async fn abort_stops_loop() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "继续".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("最终回复"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus);
        agent.abort().await;

        let result = agent.run("测试中断".into()).await;
        assert!(matches!(result, Err(AgentError::Aborted)));
    }

    // ── failTask 终态闭环测试（2026-08-02 修复） ──
    // 修复前：run() 错误路径只广播 AgentEnd，前端误把失败任务标为 completed，failTask 永不触发。
    // 修复后：错误路径先广播 Error（前端 failTask）再广播 AgentEnd（前端清理 UI 状态）。

    /// 测试用：收集终态事件的监听器（Error / AgentEnd / StreamEnd）
    struct TerminalEventListener {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl EventListener for TerminalEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let label = match event {
                OrchestratorEvent::Agent(AgentEvent::Error { message }) => {
                    format!("error:{message}")
                }
                OrchestratorEvent::Agent(AgentEvent::AgentEnd) => "agent_end".into(),
                OrchestratorEvent::Agent(AgentEvent::StreamEnd { .. }) => "stream_end".into(),
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
        }
    }

    #[tokio::test]
    async fn run_error_broadcasts_error_then_agent_end() {
        // 每轮都返回工具调用，永不结束 → 超迭代错误
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 3,
            ..Default::default()
        });

        let listener = Arc::new(TerminalEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("无限循环".into()).await;
        assert!(result.is_err());

        // 断言事件序列：Error 先于 AgentEnd（前端 failTask 依赖此顺序）
        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("error:")),
            "错误路径应广播 Error 事件，实际: {collected:?}"
        );
        assert!(
            collected.iter().any(|e| e == "agent_end"),
            "错误路径应广播 AgentEnd 事件（前端清理 UI 状态），实际: {collected:?}"
        );
        let error_pos = collected
            .iter()
            .position(|e| e.starts_with("error:"))
            .unwrap();
        let end_pos = collected.iter().position(|e| e == "agent_end").unwrap();
        assert!(
            error_pos < end_pos,
            "Error 应先于 AgentEnd，实际顺序: {collected:?}"
        );
    }

    #[tokio::test]
    async fn run_success_broadcasts_agent_end_without_error() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("好的")]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);

        let listener = Arc::new(TerminalEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("你好".into()).await;
        assert!(result.is_ok());

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e == "agent_end"),
            "成功路径应广播 AgentEnd，实际: {collected:?}"
        );
        assert!(
            !collected.iter().any(|e| e.starts_with("error:")),
            "成功路径不应广播 Error，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn run_with_system_prompt_prepends_system_message() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "好的",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            system_prompt: Some("你是一个翻译助手".into()),
            ..Default::default()
        });

        let _ = agent.run("hello".into()).await.unwrap();

        let messages = agent.get_messages().await;
        assert!(!messages.is_empty());
        assert!(matches!(messages[0].role, MessageRole::System));
        assert_eq!(messages[0].content, "你是一个翻译助手");
    }

    #[tokio::test]
    async fn tool_failure_does_not_break_loop() {
        // 工具不存在，应继续循环并返回最终文本
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "调用不存在的工具".into(),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "nonexistent_tool".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
            },
            PromptResponse::text_only("工具失败，但我继续回复"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("调用不存在的工具".into()).await.expect("应执行成功");

        assert_eq!(result, "工具失败，但我继续回复");

        // 验证 toolResult 消息含错误信息
        let messages = agent.get_messages().await;
        assert_eq!(messages.len(), 4);
        assert!(matches!(messages[2].role, MessageRole::ToolResult));
        assert!(messages[2].content.contains("error"));
    }

    // ── Loop Engineering 批次5：内建 LoopController 驱动测试 ──

    /// 测试用：收集 LoopEng* 事件的监听器
    struct LoopEngEventListener {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl EventListener for LoopEngEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let label = match event {
                OrchestratorEvent::LoopEngRateLimitExceeded {
                    limit_type,
                    current,
                    max,
                    ..
                } => format!("rate_limit:{limit_type}:{current}/{max}"),
                OrchestratorEvent::LoopEngRetrying { attempt, .. } => {
                    format!("retrying:{attempt}")
                }
                OrchestratorEvent::LoopEngRetryExhausted { total_attempts, .. } => {
                    format!("retry_exhausted:{total_attempts}")
                }
                OrchestratorEvent::LoopEngRecovered {
                    recovery_method,
                    turn_count,
                    ..
                } => format!("recovered:{recovery_method}:{turn_count}"),
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
        }
    }

    #[tokio::test]
    async fn run_stops_on_rate_limit_exceeded() {
        // 每轮都返回工具调用，永不结束；但内建 LoopController 限制 max_turns=2
        let infinite_tool_call = PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: "call_loop".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let loop_config = LoopControlConfig {
            rate_limit: crate::loop_control::RateLimitConfig {
                max_turns: Some(2),
                max_tool_calls: None,
                max_tokens: None,
                max_duration: None,
            },
            ..LoopControlConfig::default()
        };
        // 用 with_loop_control 显式启用严格配置（验证独立于 with_config 的配置开关）
        let agent = AgentLoop::new(backend, tool_bus)
            .with_loop_control(Some(loop_config))
            .with_config(AgentLoopConfig {
                max_iterations: 100, // 不触发超迭代，验证是速率限制停止而非超迭代
                ..Default::default()
            });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("触发速率限制".into()).await;
        assert!(
            matches!(result, Err(AgentError::RateLimitExceeded(_))),
            "应返回 RateLimitExceeded，实际: {result:?}"
        );

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("rate_limit:turns:2/2")),
            "应广播 LoopEngRateLimitExceeded(turns 2/2)，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn default_lenient_config_does_not_stop_normal_loop() {
        // 回归保护：默认（宽松）配置下，正常对话任务不应被速率限制误停。
        // 覆盖待办"桌面端实测宽松配置默认不误停止"的单元级可重复验证——
        // 以真实默认 LoopControlConfig（100 turns / 200 tools / 100k tokens / 6h）
        // 运行一个"几轮工具调用后返回文本"的正常流，断言最终返回 Ok 且未广播速率限制事件。
        let tool_call = |id: &str| PromptResponse {
            text: "继续".into(),
            tool_calls: vec![ToolCall {
                id: id.into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
        };
        // 3 轮工具调用 + 1 轮最终文本 = 正常收敛，远低于默认 100 turns 上限
        let backend = Arc::new(MockBackend::new(vec![
            tool_call("call_1"),
            tool_call("call_2"),
            tool_call("call_3"),
            PromptResponse::text_only("任务完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        // 不显式 with_loop_control → 使用默认宽松配置（生产默认路径）
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            max_iterations: 100, // 不触发超迭代，验证是正常收敛而非被循环控制停止
            ..Default::default()
        });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("正常对话任务".into()).await;
        assert!(
            matches!(result.as_deref(), Ok("任务完成")),
            "正常流应收敛并返回最终文本，实际: {result:?}"
        );

        // 记录的 turns 应远低于默认上限（100），证明宽松配置未误停
        let turns = agent.loop_controller().rate_limiter.turns();
        assert!(
            turns < 10,
            "正常流 turns 应远低于默认上限，实际: {turns}"
        );

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            !collected.iter().any(|e| e.starts_with("rate_limit:")),
            "正常流不应广播速率限制事件，实际: {collected:?}"
        );
    }

    #[tokio::test]
    async fn llm_failure_emits_retry_events() {
        // backend 永远报错 → 触发重试 → 重试耗尽
        struct FailingBackend;

        #[async_trait]
        impl NodeBackendAccessor for FailingBackend {
            async fn prompt(
                &self,
                _prompt: String,
                _options: Option<PromptCallOptions>,
            ) -> Result<PromptResponse, BackendError> {
                Err(BackendError::Other("网络错误".into()))
            }
            async fn steer(&self, _text: String) -> Result<(), BackendError> {
                Ok(())
            }
            async fn get_messages(&self) -> Vec<OrchestratorMessage> {
                Vec::new()
            }
            async fn set_messages(
                &self,
                _messages: Vec<OrchestratorMessage>,
            ) -> Result<(), BackendError> {
                Ok(())
            }
            async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
                Ok(())
            }
        }

        let backend = Arc::new(FailingBackend);
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            llm_max_retries: 1,
            llm_retry_base_delay: std::time::Duration::from_millis(1),
            ..Default::default()
        });

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("测试重试".into()).await;
        assert!(result.is_err());

        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e == "retrying:1"),
            "应广播 LoopEngRetrying，实际: {collected:?}"
        );
        assert!(
            collected.iter().any(|e| e == "retry_exhausted:1"),
            "应广播 LoopEngRetryExhausted，实际: {collected:?}"
        );
        let retry_pos = collected.iter().position(|e| e == "retrying:1").unwrap();
        let exhausted_pos = collected
            .iter()
            .position(|e| e == "retry_exhausted:1")
            .unwrap();
        assert!(
            retry_pos < exhausted_pos,
            "retrying 应先于 retry_exhausted，实际顺序: {collected:?}"
        );
    }

    /// 软超时告警锁存后经 `reset()` 恢复 → 内建 emit `LoopEngRecovered`
    ///
    /// 验证恢复检测基于底层触发标志边沿（`is_alerted` true→false），
    /// 且不会在软超时锁存期（后续 check 返回 None）误发 Recovered。
    #[tokio::test]
    async fn soft_timeout_reset_emits_recovered() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse {
            text: "完成".into(),
            tool_calls: vec![],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("end_turn".into()),
        }]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        // warn_threshold=0 → 首轮 check 即触发软超时 Warning（锁存 warn_triggered）
        let loop_config = LoopControlConfig {
            soft_timeout: crate::loop_control::SoftTimeoutConfig {
                warn_threshold: std::time::Duration::from_millis(0),
                ..Default::default()
            },
            ..Default::default()
        };
        let agent = AgentLoop::new(backend, tool_bus).with_loop_control(Some(loop_config));

        // 触发软超时告警并锁存
        agent.loop_controller().check_all();
        assert!(agent.loop_controller().is_alerted(), "软超时应处于告警锁存态");

        let listener = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        // 第一帧：告警锁存期（is_alerted=true），不应 emit Recovered
        agent.emit_loop_recovered_if_needed().await;
        assert!(
            listener.events.lock().unwrap().is_empty(),
            "告警锁存期不应 emit Recovered"
        );

        // 模拟命令层 reset_counters / retry 路径：reset 清除软超时触发标志
        agent.loop_controller().soft_timeout.reset();
        assert!(!agent.loop_controller().is_alerted(), "reset 后应解除告警");

        // 第二帧：告警解除（true→false 边沿）→ emit Recovered（auto）
        agent.emit_loop_recovered_if_needed().await;
        let collected = listener.events.lock().unwrap().clone();
        assert!(
            collected.iter().any(|e| e.starts_with("recovered:auto:")),
            "应对告警解除 emit LoopEngRecovered(auto)，实际: {collected:?}"
        );
    }

    // ─── 阶段 3：记忆闭环（recall/inject/record_turn/archive 织入）───

    /// Mock 记忆访问器 — 记录调用并返回预设检索结果
    struct MockMemory {
        recall_calls: std::sync::Mutex<Vec<String>>,
        inject_calls: std::sync::Mutex<usize>,
        record_turn_calls: std::sync::Mutex<usize>,
        archive_calls: std::sync::Mutex<usize>,
    }

    impl MockMemory {
        fn new() -> Self {
            Self {
                recall_calls: std::sync::Mutex::new(Vec::new()),
                inject_calls: std::sync::Mutex::new(0),
                record_turn_calls: std::sync::Mutex::new(0),
                archive_calls: std::sync::Mutex::new(0),
            }
        }
    }

    #[async_trait]
    impl crate::memory::MemoryAccessor for MockMemory {
        async fn recall(
            &self,
            query: String,
            _options: Option<crate::memory::MemoryRecallOptions>,
        ) -> std::result::Result<Vec<crate::memory::MemoryRecallResult>, crate::memory::MemoryError>
        {
            self.recall_calls.lock().unwrap().push(query);
            Ok(vec![crate::memory::MemoryRecallResult {
                hook_id: "hook-1".into(),
                summary: "用户偏好：用 Rust 构建高性能 Agent".into(),
                score: 0.9,
                matched_fields: vec!["keywords".into()],
                created_at: 0,
                access_count: 1,
                keywords: vec!["rust".into()],
                tags: vec![],
                pinned: false,
            }])
        }

        async fn inject(
            &self,
            results: Vec<crate::memory::MemoryRecallResult>,
            _options: Option<crate::memory::MemoryInjectOptions>,
        ) -> std::result::Result<String, crate::memory::MemoryError> {
            *self.inject_calls.lock().unwrap() += 1;
            let first = results.first().map(|r| r.summary.clone()).unwrap_or_default();
            Ok(format!("# 相关记忆\n\n- {first}"))
        }

        async fn archive(
            &self,
            _source: Option<crate::memory::ArchiveSource>,
        ) -> std::result::Result<Option<crate::memory::MemoryArchiveResult>, crate::memory::MemoryError>
        {
            *self.archive_calls.lock().unwrap() += 1;
            Ok(None)
        }

        async fn get_archive_boundary(
            &self,
        ) -> std::result::Result<usize, crate::memory::MemoryError> {
            Ok(0)
        }

        async fn record_turn(
            &self,
            _user_message: String,
            _assistant_message: String,
        ) -> std::result::Result<(), crate::memory::MemoryError> {
            *self.record_turn_calls.lock().unwrap() += 1;
            Ok(())
        }
    }

    #[tokio::test]
    async fn run_injects_memory_into_system_prompt_and_archives() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "好的，我记住了",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let memory = Arc::new(MockMemory::new());

        let agent = AgentLoop::new(backend.clone(), tool_bus)
            .with_config(AgentLoopConfig {
                system_prompt: Some("你是世界构建助手".into()),
                ..Default::default()
            })
            .with_memory(Some(memory.clone()));

        let result = agent.run("继续构建 Rust 世界".into()).await.expect("应执行成功");
        assert_eq!(result, "好的，我记住了");

        // 1. recall 被调用，且 query 为最近 user 消息
        let recall_queries = memory.recall_calls.lock().unwrap().clone();
        assert_eq!(recall_queries, vec!["继续构建 Rust 世界".to_string()]);

        // 2. inject 被调用（注入记忆文本）
        assert_eq!(*memory.inject_calls.lock().unwrap(), 1);

        // 3. system prompt override 应拼入记忆（backend 记录 last_options）
        let last_options = backend.last_options.lock().await.clone().unwrap();
        let sys = last_options.system_prompt_override.unwrap_or_default();
        assert!(
            sys.contains("你是世界构建助手"),
            "system prompt 应保留，实际: {sys}"
        );
        assert!(
            sys.contains("用户偏好：用 Rust 构建高性能 Agent"),
            "记忆应注入 system prompt，实际: {sys}"
        );

        // 4. run 结束后 record_turn + archive 各调用一次
        assert_eq!(*memory.record_turn_calls.lock().unwrap(), 1);
        assert_eq!(*memory.archive_calls.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn run_without_memory_skips_memory_calls() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("ok")]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        // 不注入 memory → memory_context 恒 None，且不触发任何记忆调用
        let agent = AgentLoop::new(backend, tool_bus);
        let result = agent.run("测试".into()).await.expect("应执行成功");
        assert_eq!(result, "ok");
    }
