// ─── 单元测试 ────────────────────────────────────────────

    use super::*;
    use agent_kernel::backend::{BackendError, PromptResponse};
    use agent_kernel::event::OrchestratorEvent;
    use agent_kernel::node::{AbortCheck, EventEmitter};
    use agent_kernel::tool::SimpleToolBus;
    use agent_kernel::types::OrchestratorState;
    use async_trait::async_trait;
    use std::sync::Mutex;

    // ─── 测试桩：Backend ────────────────────────────────────

    /// 测试用 Backend — 返回预设的固定响应
    struct StubBackend {
        response_text: String,
        prompt_count: Mutex<usize>,
    }

    impl StubBackend {
        fn new(response_text: impl Into<String>) -> Self {
            Self {
                response_text: response_text.into(),
                prompt_count: Mutex::new(0),
            }
        }

        fn prompt_count(&self) -> usize {
            *self.prompt_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for StubBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.prompt_count.lock().unwrap() += 1;
            Ok(PromptResponse::text_only(self.response_text.clone()))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }

        async fn get_messages(&self) -> Vec<agent_kernel::types::OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<agent_kernel::types::OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用策略 — 固定返回指定的 sub_agent_id
    struct StubStrategy {
        sub_agent_id: String,
    }

    impl StubStrategy {
        fn new(sub_agent_id: impl Into<String>) -> Self {
            Self {
                sub_agent_id: sub_agent_id.into(),
            }
        }
    }

    #[async_trait]
    impl AssignmentStrategy for StubStrategy {
        async fn assign(
            &self,
            task: &str,
            _candidates: &[SubAgentSpec],
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<AssignmentResult, AssignmentError> {
            Ok(AssignmentResult {
                sub_agent_id: self.sub_agent_id.clone(),
                task_description: task.to_string(),
                reasoning: Some("stub strategy".into()),
            })
        }
    }

    // ─── 测试桩：事件/中断 ────────────────────────────────────

    struct NoopEmitter;
    impl EventEmitter for NoopEmitter {
        fn emit(&self, _event: OrchestratorEvent) {}
    }

    struct NoopAbort;
    #[async_trait]
    impl AbortCheck for NoopAbort {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    fn make_specs() -> Vec<SubAgentSpec> {
        vec![
            SubAgentSpec {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码编写、调试、重构任务".into(),
                system_prompt: "你是代码工程师".into(),
                tools_whitelist: None,
                max_iterations: Some(5),
            },
            SubAgentSpec {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档撰写、翻译、润色任务".into(),
                system_prompt: "你是文档工程师".into(),
                tools_whitelist: None,
                max_iterations: Some(5),
            },
        ]
    }

    // ─── 测试：LlmAssignmentStrategy 解析 ────────────────────────────────────

    #[test]
    fn parse_response_should_handle_plain_json() {
        let text = r#"{"sub_agent_id":"coder","task_description":"写一个函数","reasoning":"代码任务"}"#;
        let r = LlmAssignmentStrategy::parse_response(text).unwrap();
        assert_eq!(r.sub_agent_id, "coder");
        assert_eq!(r.task_description, "写一个函数");
        assert_eq!(r.reasoning.as_deref(), Some("代码任务"));
    }

    #[test]
    fn parse_response_should_handle_code_fence() {
        let text = r#"```json
{"sub_agent_id":"writer","task_description":"写文档","reasoning":"文档任务"}
```"#;
        let r = LlmAssignmentStrategy::parse_response(text).unwrap();
        assert_eq!(r.sub_agent_id, "writer");
    }

    #[test]
    fn parse_response_should_fail_on_invalid_json() {
        let text = "not a json";
        let r = LlmAssignmentStrategy::parse_response(text);
        assert!(r.is_err());
    }

    #[test]
    fn format_candidates_should_include_all_fields() {
        let specs = make_specs();
        let s = LlmAssignmentStrategy::format_candidates(&specs);
        assert!(s.contains("coder"));
        assert!(s.contains("代码专家"));
        assert!(s.contains("writer"));
        assert!(s.contains("文档专家"));
    }

    // ─── 测试：策略端到端 ────────────────────────────────────

    #[tokio::test]
    async fn llm_strategy_single_candidate_should_skip_llm_call() {
        let backend = StubBackend::new("should not be called");
        let spec = SubAgentSpec {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一候选".into(),
            system_prompt: "你是唯一".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy
            .assign("任务", &[spec], &backend)
            .await
            .unwrap();
        assert_eq!(r.sub_agent_id, "only");
        assert_eq!(backend.prompt_count(), 0); // 单一候选不应调用 LLM
    }

    #[tokio::test]
    async fn llm_strategy_multi_candidates_should_call_llm() {
        let response = r#"{"sub_agent_id":"coder","task_description":"写函数","reasoning":"代码任务"}"#;
        let backend = StubBackend::new(response);
        let specs = make_specs();
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("写一个函数", &specs, &backend).await.unwrap();
        assert_eq!(r.sub_agent_id, "coder");
        assert_eq!(backend.prompt_count(), 1);
    }

    #[tokio::test]
    async fn llm_strategy_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn llm_strategy_invalid_sub_agent_id_should_error() {
        let response = r#"{"sub_agent_id":"unknown","task_description":"x","reasoning":"y"}"#;
        let backend = StubBackend::new(response);
        let specs = make_specs();
        let strategy = LlmAssignmentStrategy::new();
        let r = strategy.assign("任务", &specs, &backend).await;
        assert!(matches!(r, Err(AssignmentError::Parse(_))));
    }

    // ─── 测试：SupervisorNode execute ────────────────────────────────────

    /// 注意：SupervisorNode::execute 会调用 AgentLoop::run，
    /// 而 AgentLoop 会调用 backend.prompt 走 ReAct 循环。
    /// 这里用 StubBackend 返回固定响应，让 AgentLoop 一轮结束（无 tool_calls）。
    #[tokio::test]
    async fn supervisor_execute_should_assign_and_collect_output() {
        // 子 Agent 调用 backend 时返回文本（无 tool_calls，AgentLoop 一轮结束）
        let backend = Arc::new(StubBackend::new("子 Agent 完成的任务输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let strategy = Arc::new(StubStrategy::new("coder"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        // 构造 ctx
        let mut state = OrchestratorState::new("写一个 hello world");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert!(result.summary.is_some());

        // 验证 state.messages 被写入
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(matches!(last.role, MessageRole::Assistant));
        assert!(last.content.contains("[Supervisor → 代码专家]"));
        assert!(last.content.contains("子 Agent 完成的任务输出"));

        // 验证 meta
        let meta = last.meta.as_ref().expect("meta should exist");
        assert_eq!(meta.get("sub_agent_id").and_then(|v| v.as_str()), Some("coder"));
    }

    #[tokio::test]
    async fn supervisor_execute_with_empty_task_should_error() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let node = SupervisorNode::with_default_strategy(
            "sup",
            "监督者",
            make_specs(),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new()); // 空 input
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.unwrap().contains("任务为空"));
    }

    #[tokio::test]
    async fn supervisor_execute_with_invalid_strategy_result_should_error() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 策略返回不存在的 sub_agent_id
        let strategy = Arc::new(StubStrategy::new("non_existent"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.unwrap().contains("子 Agent 不存在"));
    }

    // ─── 测试：lazy 初始化 ────────────────────────────────────

    #[tokio::test]
    async fn agent_pool_should_lazy_init_and_cache() {
        let backend = Arc::new(StubBackend::new("output"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let node = SupervisorNode::with_default_strategy(
            "sup",
            "监督者",
            make_specs(),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let spec = &node.specs()[0];

        // 第一次调用：创建
        let a1 = node.get_or_create_agent(spec).await;
        // 第二次调用：应命中缓存（同一 Arc）
        let a2 = node.get_or_create_agent(spec).await;

        // Arc 指针相等性检查
        assert!(Arc::ptr_eq(&a1, &a2));

        // 池中应只有 1 个实例
        let pool = node.agents.read().await;
        assert_eq!(pool.len(), 1);
    }

    // ─── 测试：事件触发序列 ────────────────────────────────────

    /// 捕获事件发射器 — 把所有 emit 的事件存入 Vec 供断言
    struct CapturingEmitter {
        events: Mutex<Vec<OrchestratorEvent>>,
    }

    impl CapturingEmitter {
        fn new() -> Self {
            Self {
                events: Mutex::new(Vec::new()),
            }
        }

        fn events(&self) -> Vec<OrchestratorEvent> {
            self.events.lock().unwrap().clone()
        }
    }

    impl EventEmitter for CapturingEmitter {
        fn emit(&self, event: OrchestratorEvent) {
            self.events.lock().unwrap().push(event);
        }
    }

    /// 辅助：判断事件是否为 Supervisor 相关事件
    fn is_supervisor_event(event: &OrchestratorEvent) -> bool {
        matches!(
            event,
            OrchestratorEvent::SupervisorTaskAssigned { .. }
                | OrchestratorEvent::SubAgentStarted { .. }
                | OrchestratorEvent::SubAgentCompleted { .. }
                | OrchestratorEvent::SubAgentError { .. }
                | OrchestratorEvent::SupervisorError { .. }
        )
    }

    #[tokio::test]
    async fn execute_should_emit_full_event_sequence_on_success() {
        let backend = Arc::new(StubBackend::new("子 Agent 输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("写一个函数");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);

        let events = emitter.events();
        let sup_events: Vec<_> = events.iter().filter(|e| is_supervisor_event(e)).collect();

        // 应有 3 个事件：SupervisorTaskAssigned → SubAgentStarted → SubAgentCompleted
        assert_eq!(sup_events.len(), 3, "应有 3 个 supervisor 事件");

        // 验证事件类型顺序
        assert!(
            matches!(sup_events[0], OrchestratorEvent::SupervisorTaskAssigned { .. }),
            "第 1 个事件应为 SupervisorTaskAssigned"
        );
        assert!(
            matches!(sup_events[1], OrchestratorEvent::SubAgentStarted { .. }),
            "第 2 个事件应为 SubAgentStarted"
        );
        assert!(
            matches!(sup_events[2], OrchestratorEvent::SubAgentCompleted { .. }),
            "第 3 个事件应为 SubAgentCompleted"
        );

        // 验证 SupervisorTaskAssigned 载荷
        if let OrchestratorEvent::SupervisorTaskAssigned {
            node_id,
            sub_agent_id,
            sub_agent_name,
            task_description,
            reasoning,
        } = &events[0]
        {
            assert_eq!(node_id, "sup");
            assert_eq!(sub_agent_id, "coder");
            assert_eq!(sub_agent_name, "代码专家");
            assert_eq!(task_description, "写一个函数");
            assert!(reasoning.is_some(), "应有 reasoning");
        } else {
            panic!("第 1 个事件类型错误");
        }

        // 验证 SubAgentCompleted 载荷
        if let OrchestratorEvent::SubAgentCompleted {
            output_chars, duration_ms, ..
        } = &events[2]
        {
            assert_eq!(*output_chars, "子 Agent 输出".len());
            assert!(*duration_ms > 0 || *duration_ms == 0, "duration_ms 应为非负数");
        } else {
            panic!("第 3 个事件类型错误");
        }
    }

    #[tokio::test]
    async fn execute_should_emit_supervisor_error_when_spec_not_found() {
        let backend = Arc::new(StubBackend::new(""));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 策略返回不存在的 sub_agent_id
        let strategy = Arc::new(StubStrategy::new("non_existent"));
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            SupervisorConfig::default(),
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);

        let events = emitter.events();
        // 应只触发 1 个 SupervisorError 事件（stage="spec_lookup"）
        let sup_errors: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::SupervisorError { .. }))
            .collect();
        assert_eq!(sup_errors.len(), 1);

        if let OrchestratorEvent::SupervisorError { node_id, stage, error } = &events[0] {
            assert_eq!(node_id, "sup");
            assert_eq!(stage, "spec_lookup");
            assert!(error.contains("子 Agent 不存在"));
        } else {
            panic!("应为 SupervisorError 事件");
        }
    }

    // ─── 测试：RoundRobinAssignmentStrategy ────────────────────────────────────

    #[tokio::test]
    async fn round_robin_should_select_in_order() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = RoundRobinAssignmentStrategy::new();

        // 第 1 次：candidates[0] = coder
        let r1 = strategy.assign("任务1", &specs, &backend).await.unwrap();
        assert_eq!(r1.sub_agent_id, "coder");

        // 第 2 次：candidates[1] = writer
        let r2 = strategy.assign("任务2", &specs, &backend).await.unwrap();
        assert_eq!(r2.sub_agent_id, "writer");

        // 第 3 次：循环回 candidates[0] = coder
        let r3 = strategy.assign("任务3", &specs, &backend).await.unwrap();
        assert_eq!(r3.sub_agent_id, "coder");

        // 第 4 次：candidates[1] = writer
        let r4 = strategy.assign("任务4", &specs, &backend).await.unwrap();
        assert_eq!(r4.sub_agent_id, "writer");
    }

    #[tokio::test]
    async fn round_robin_with_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = RoundRobinAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn round_robin_should_keep_task_description_unchanged() {
        let backend = StubBackend::new("");
        let specs = make_specs();
        let strategy = RoundRobinAssignmentStrategy::new();

        let r = strategy.assign("原任务描述", &specs, &backend).await.unwrap();
        assert_eq!(r.task_description, "原任务描述");
        assert!(r.reasoning.is_some());
    }

    // ─── 测试：LoadBasedAssignmentStrategy ────────────────────────────────────

    #[tokio::test]
    async fn load_based_should_select_least_loaded_on_tie_by_id_order() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = LoadBasedAssignmentStrategy::new();

        // 首次：两者负载都是 0，平局选 ID 字典序最小 → "coder"
        let r1 = strategy.assign("任务1", &specs, &backend).await.unwrap();
        assert_eq!(r1.sub_agent_id, "coder");
        assert_eq!(strategy.count_of("coder"), 1);
        assert_eq!(strategy.count_of("writer"), 0);

        // 第二次：coder=1, writer=0，选 writer
        let r2 = strategy.assign("任务2", &specs, &backend).await.unwrap();
        assert_eq!(r2.sub_agent_id, "writer");
        assert_eq!(strategy.count_of("coder"), 1);
        assert_eq!(strategy.count_of("writer"), 1);

        // 第三次：coder=1, writer=1，平局选 ID 字典序最小 → "coder"
        let r3 = strategy.assign("任务3", &specs, &backend).await.unwrap();
        assert_eq!(r3.sub_agent_id, "coder");
        assert_eq!(strategy.count_of("coder"), 2);
        assert_eq!(strategy.count_of("writer"), 1);
    }

    #[tokio::test]
    async fn load_based_with_empty_candidates_should_error() {
        let backend = StubBackend::new("");
        let strategy = LoadBasedAssignmentStrategy::new();
        let r = strategy.assign("任务", &[], &backend).await;
        assert!(matches!(r, Err(AssignmentError::NoCandidates)));
    }

    #[tokio::test]
    async fn load_based_single_candidate_should_skip_min_lookup() {
        let backend = StubBackend::new("");
        let spec = SubAgentSpec {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一候选".into(),
            system_prompt: "你是唯一".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        let strategy = LoadBasedAssignmentStrategy::new();

        let r = strategy.assign("任务", &[spec], &backend).await.unwrap();
        assert_eq!(r.sub_agent_id, "only");
        assert_eq!(strategy.count_of("only"), 1);
    }

    #[tokio::test]
    async fn load_based_should_balance_over_multiple_assignments() {
        let backend = StubBackend::new("");
        let specs = make_specs(); // [coder, writer]
        let strategy = LoadBasedAssignmentStrategy::new();

        // 执行 6 次分配，应均衡为 coder=3, writer=3
        for _ in 0..6 {
            strategy.assign("任务", &specs, &backend).await.unwrap();
        }

        assert_eq!(strategy.count_of("coder"), 3);
        assert_eq!(strategy.count_of("writer"), 3);
    }

    // ─── 测试：Supervisor 多轮协调 ────────────────────────────────────

    /// 多轮协调测试：max_rounds=2，子 Agent 输出不包含 [TASK_COMPLETE]，
    /// 应执行 2 轮，每轮都触发完整事件序列。
    #[tokio::test]
    async fn supervisor_multi_round_should_run_all_rounds_without_complete_marker() {
        let backend = Arc::new(StubBackend::new("子 Agent 输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 2,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("写一个函数");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert!(result.summary.is_some());
        // summary 应包含"多轮协调"和"达到最大轮次"
        let summary = result.summary.unwrap();
        assert!(summary.contains("多轮协调"));
        assert!(summary.contains("达到最大轮次"));
        assert!(summary.contains("共 2 轮"));

        // state.messages 应有 2 条（每轮一条）
        let supervisor_msgs: Vec<_> = state
            .messages
            .iter()
            .filter(|m| m.meta.as_ref().and_then(|meta| meta.get("round")).is_some())
            .collect();
        assert_eq!(supervisor_msgs.len(), 2, "应有 2 条轮次消息");

        // 验证 meta 中的 round 字段
        let round1 = supervisor_msgs[0].meta.as_ref().unwrap();
        assert_eq!(round1.get("round").and_then(|v| v.as_u64()), Some(1));
        let round2 = supervisor_msgs[1].meta.as_ref().unwrap();
        assert_eq!(round2.get("round").and_then(|v| v.as_u64()), Some(2));

        // 多轮模式下消息内容应包含轮次前缀
        assert!(supervisor_msgs[0].content.contains("[轮 1/2]"));
        assert!(supervisor_msgs[1].content.contains("[轮 2/2]"));
    }

    /// 多轮协调测试：max_rounds=3，子 Agent 输出包含 [TASK_COMPLETE]，
    /// 应在第一轮后提前结束。
    #[tokio::test]
    async fn supervisor_multi_round_should_early_complete_with_marker() {
        // 子 Agent 输出包含 [TASK_COMPLETE] 标记
        let backend = Arc::new(StubBackend::new("任务已完成 [TASK_COMPLETE]"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 3,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = CapturingEmitter::new();
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        let summary = result.summary.unwrap();
        // 应只执行 1 轮就提前完成
        assert!(summary.contains("共 1 轮"));
        assert!(summary.contains("提前完成"));

        // state.messages 应只有 1 条
        let supervisor_msgs: Vec<_> = state
            .messages
            .iter()
            .filter(|m| m.meta.as_ref().and_then(|meta| meta.get("round")).is_some())
            .collect();
        assert_eq!(supervisor_msgs.len(), 1);
    }

    /// 单轮模式（max_rounds=1）行为兼容性测试：不应在消息中加轮次前缀
    #[tokio::test]
    async fn supervisor_single_round_should_not_add_round_prefix() {
        let backend = Arc::new(StubBackend::new("输出"));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let strategy = Arc::new(StubStrategy::new("coder"));
        let config = SupervisorConfig {
            max_rounds: 1,
            ..Default::default()
        };
        let node = SupervisorNode::new(
            "sup",
            "监督者",
            make_specs(),
            strategy,
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            tool_bus as Arc<dyn ToolBus>,
            config,
        );

        let mut state = OrchestratorState::new("任务");
        let emitter = NoopEmitter;
        let abort = NoopAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend: &*backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);

        // 单轮模式下消息不应包含轮次前缀
        let last = state.messages.last().unwrap();
        assert!(!last.content.contains("[轮"));
        assert!(last.content.contains("[Supervisor → 代码专家]"));
    }
