// ─── 单元测试 ────────────────────────────────────────────

    use super::*;
    use crate::backend::{BackendError, PromptResponse};
    use crate::node::{AbortCheck, EventEmitter};
    use crate::types::OrchestratorState;
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

        async fn get_messages(&self) -> Vec<crate::types::OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<crate::types::OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }

        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用策略 — 固定返回指定的 target_id
    struct StubStrategy {
        target_id: String,
    }

    impl StubStrategy {
        fn new(target_id: impl Into<String>) -> Self {
            Self {
                target_id: target_id.into(),
            }
        }
    }

    #[async_trait]
    impl RoutingStrategy for StubStrategy {
        async fn route(
            &self,
            _input: &str,
            _targets: &[RouteTarget],
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<RouteResult, RoutingError> {
            Ok(RouteResult {
                target_id: self.target_id.clone(),
                reason: Some("stub".into()),
            })
        }
    }

    // ─── 测试桩：NodeContext 依赖 ────────────────────────────────────

    struct NoopEmitter;
    impl EventEmitter for NoopEmitter {
        fn emit(&self, _event: OrchestratorEvent) {}
    }

    struct NoopAbortCheck;
    #[async_trait]
    impl AbortCheck for NoopAbortCheck {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    // ─── 辅助函数 ────────────────────────────────────

    fn make_targets() -> Vec<RouteTarget> {
        vec![
            RouteTarget {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码任务".into(),
                keywords: Some(vec!["代码".into(), "函数".into()]),
            },
            RouteTarget {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档任务".into(),
                keywords: Some(vec!["文档".into(), "翻译".into()]),
            },
        ]
    }

    fn make_backend(response_text: &str) -> Arc<StubBackend> {
        Arc::new(StubBackend::new(response_text))
    }

    // ─── 策略测试 ────────────────────────────────────

    #[tokio::test]
    async fn llm_strategy_should_return_target_id_from_llm_response() {
        let backend = make_backend(r#"{"target_id":"coder","reason":"代码任务"}"#);
        let strategy = LlmRoutingStrategy::new();
        let result = strategy
            .route("写个函数", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "coder");
        assert_eq!(result.reason.as_deref(), Some("代码任务"));
        assert_eq!(backend.prompt_count(), 1);
    }

    #[tokio::test]
    async fn llm_strategy_should_skip_llm_call_when_single_target() {
        let backend = make_backend("should_not_be_called");
        let strategy = LlmRoutingStrategy::new();
        let single = vec![RouteTarget {
            id: "only".into(),
            name: "唯一".into(),
            description: "唯一目标".into(),
            keywords: None,
        }];
        let result = strategy.route("任何输入", &single, &*backend).await.unwrap();
        assert_eq!(result.target_id, "only");
        assert_eq!(backend.prompt_count(), 0);
    }

    #[tokio::test]
    async fn llm_strategy_should_parse_json_with_code_fence() {
        let backend = make_blueprint(r#"```json
{"target_id":"writer","reason":"文档任务"}
```"#);
        let strategy = LlmRoutingStrategy::new();
        let result = strategy
            .route("写文档", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "writer");
    }

    /// 辅助：与 make_backend 一致，独立命名便于阅读
    fn make_blueprint(response_text: &str) -> Arc<StubBackend> {
        Arc::new(StubBackend::new(response_text))
    }

    #[tokio::test]
    async fn llm_strategy_should_error_when_target_id_not_in_candidates() {
        let backend = make_backend(r#"{"target_id":"nonexistent","reason":"x"}"#);
        let strategy = LlmRoutingStrategy::new();
        let err = strategy
            .route("输入", &make_targets(), &*backend)
            .await
            .unwrap_err();
        assert!(matches!(err, RoutingError::Parse(_)));
    }

    #[tokio::test]
    async fn llm_strategy_should_error_when_no_targets() {
        let backend = make_backend("x");
        let strategy = LlmRoutingStrategy::new();
        let err = strategy.route("输入", &[], &*backend).await.unwrap_err();
        assert!(matches!(err, RoutingError::NoTargets));
    }

    #[tokio::test]
    async fn keyword_strategy_should_match_keyword_case_insensitive() {
        let backend = make_backend("should_not_be_called");
        let strategy = KeywordRoutingStrategy::new();
        let result = strategy
            .route("请帮我写一个函数", &make_targets(), &*backend)
            .await
            .unwrap();
        assert_eq!(result.target_id, "coder");
        assert_eq!(backend.prompt_count(), 0); // 关键词策略不调 LLM
    }

    #[tokio::test]
    async fn keyword_strategy_should_return_no_match_when_no_keyword_hit() {
        let backend = make_blueprint("x");
        let strategy = KeywordRoutingStrategy::new();
        let err = strategy
            .route("无关输入", &make_targets(), &*backend)
            .await
            .unwrap_err();
        assert!(matches!(err, RoutingError::NoMatch(_)));
    }

    // ─── RouterNode::execute 测试 ────────────────────────────────────

    #[tokio::test]
    async fn router_node_should_return_continue_with_next_node_id() {
        let backend = make_backend(r#"{"target_id":"coder","reason":"代码"}"#);
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new("写函数");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("coder"));
        assert!(result.summary.is_some());
    }

    #[tokio::test]
    async fn router_node_should_use_state_input_first() {
        let backend = make_backend(r#"{"target_id":"writer","reason":"文档"}"#);
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // state.input 有值，应优先使用
        let mut state = OrchestratorState::new("写文档");
        // 同时在 messages 中放入 user 消息，验证不会被误用
        state.messages.push(crate::types::OrchestratorMessage {
            role: MessageRole::User,
            content: "写代码".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });

        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        // state.input="写文档" → LLM 返回 writer
        assert_eq!(result.next_node_id.as_deref(), Some("writer"));
    }

    #[tokio::test]
    async fn router_node_should_fallback_when_no_match_and_fallback_configured() {
        // 使用关键词策略，输入不含任何关键词 → NoMatch → fallback
        let backend = make_backend("should_not_be_called");
        let mut targets = make_targets();
        // 加一个 fallback 目标
        targets.push(RouteTarget {
            id: "fallback".into(),
            name: "兜底".into(),
            description: "兜底分支".into(),
            keywords: None,
        });

        let config = RouterConfig {
            fallback_target_id: Some("fallback".into()),
        };
        let node = RouterNode::with_keyword_strategy(
            "router",
            "路由",
            targets,
            backend as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("无关输入");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("fallback"));
    }

    #[tokio::test]
    async fn router_node_should_error_when_no_match_and_no_fallback() {
        let backend = make_backend("should_not_be_called");
        let node = RouterNode::with_keyword_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new("无关输入");
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.as_deref().unwrap().contains("无匹配"));
    }

    #[tokio::test]
    async fn router_node_should_error_when_empty_input() {
        let backend = make_backend("should_not_be_called");
        let node = RouterNode::with_default_strategy(
            "router",
            "路由",
            make_targets(),
            backend as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new());
        let backend_ref: &dyn NodeBackendAccessor = &*node.backend;
        let emitter = NoopEmitter;
        let abort_check = NoopAbortCheck;
        let ctx = NodeContext {
            state: &mut state,
            backend: backend_ref,
            memory: None,
            emitter: &emitter,
            abort_check: &abort_check,
        };

        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
        assert!(result.error.as_deref().unwrap().contains("输入为空"));
    }

    // ─── 序列化测试 ────────────────────────────────────

    #[test]
    fn route_target_should_serialize_with_keywords() {
        let target = RouteTarget {
            id: "coder".into(),
            name: "代码专家".into(),
            description: "处理代码任务".into(),
            keywords: Some(vec!["代码".into(), "函数".into()]),
        };
        let json = serde_json::to_string(&target).unwrap();
        assert!(json.contains("\"id\":\"coder\""));
        assert!(json.contains("\"keywords\":[\"代码\",\"函数\"]"));
    }

    #[test]
    fn route_target_should_skip_keywords_when_none() {
        let target = RouteTarget {
            id: "fallback".into(),
            name: "兜底".into(),
            description: "兜底分支".into(),
            keywords: None,
        };
        let json = serde_json::to_string(&target).unwrap();
        assert!(!json.contains("keywords"));
    }

    #[test]
    fn route_result_should_skip_reason_when_none() {
        let result = RouteResult {
            target_id: "coder".into(),
            reason: None,
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"target_id\":\"coder\""));
        assert!(!json.contains("reason"));
    }

    // ─── 嵌套路由（路由树）演示测试 ────────────────────────────────────
    //
    // 演示"Router → Router → 专业 Agent"的链式决策。
    // 嵌套关系由编排图管理：Router A 的某个 target.id 指向 Router B 节点 id。
    // 这里通过两个独立的 RouterNode 模拟链式决策，验证：
    // 1. Router A 决策后返回 next_node_id = "router_b"
    // 2. Router B 接收新输入后继续决策，返回 next_node_id = "coder"
    // 3. 两次决策的事件独立发射，便于追踪路由链路

    #[tokio::test]
    async fn nested_router_should_chain_decisions_via_orchestrator_graph() {
        // Router A：顶层路由，根据输入类别路由到子 Router 或兜底
        // targets 包含另一个 Router 节点 id（"router_b"）作为下一跳
        let targets_a = vec![
            RouteTarget {
                id: "router_b".into(),
                name: "技术子路由".into(),
                description: "处理技术类任务，进一步细分到代码/文档".into(),
                keywords: Some(vec!["代码".into(), "文档".into(), "函数".into()]),
            },
            RouteTarget {
                id: "general_agent".into(),
                name: "通用 Agent".into(),
                description: "处理非技术类通用任务".into(),
                keywords: None,
            },
        ];

        let backend_a = make_backend(r#"{"target_id":"router_b","reason":"技术任务"}"#);
        let router_a = RouterNode::with_default_strategy(
            "router_a",
            "顶层路由",
            targets_a,
            backend_a as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // 第一跳：Router A 决策
        let mut state_a = OrchestratorState::new("帮我写一个排序函数");
        let backend_ref_a: &dyn NodeBackendAccessor = &*router_a.backend;
        let emitter_a = NoopEmitter;
        let abort_a = NoopAbortCheck;
        let ctx_a = NodeContext {
            state: &mut state_a,
            backend: backend_ref_a,
            memory: None,
            emitter: &emitter_a,
            abort_check: &abort_a,
        };
        let result_a = router_a.execute(ctx_a).await;
        assert_eq!(result_a.status, NodeStatus::Continue);
        // Router A 路由到 router_b（下一跳是另一个 Router 节点）
        assert_eq!(result_a.next_node_id.as_deref(), Some("router_b"));

        // 第二跳：Router B 接收原输入，进一步路由到专业 Agent
        // （实际编排中，Orchestrator 会把 state.input 透传给下一节点）
        let targets_b = vec![
            RouteTarget {
                id: "coder".into(),
                name: "代码专家".into(),
                description: "处理代码编写、调试、重构任务".into(),
                keywords: Some(vec!["代码".into(), "函数".into()]),
            },
            RouteTarget {
                id: "writer".into(),
                name: "文档专家".into(),
                description: "处理文档撰写、翻译、润色任务".into(),
                keywords: Some(vec!["文档".into(), "翻译".into()]),
            },
        ];

        let backend_b = make_backend(r#"{"target_id":"coder","reason":"代码任务"}"#);
        let router_b = RouterNode::with_default_strategy(
            "router_b",
            "技术子路由",
            targets_b,
            backend_b as Arc<dyn NodeBackendAccessor>,
            RouterConfig::default(),
        );

        // Router B 接收原输入继续决策
        let mut state_b = OrchestratorState::new("帮我写一个排序函数");
        let backend_ref_b: &dyn NodeBackendAccessor = &*router_b.backend;
        let emitter_b = NoopEmitter;
        let abort_b = NoopAbortCheck;
        let ctx_b = NodeContext {
            state: &mut state_b,
            backend: backend_ref_b,
            memory: None,
            emitter: &emitter_b,
            abort_check: &abort_b,
        };
        let result_b = router_b.execute(ctx_b).await;
        assert_eq!(result_b.status, NodeStatus::Continue);
        // Router B 路由到 coder（最终专业 Agent）
        assert_eq!(result_b.next_node_id.as_deref(), Some("coder"));

        // 验证：两次决策的 summary 独立，便于追踪路由链路
        assert!(result_a
            .summary
            .as_deref()
            .unwrap()
            .contains("技术子路由"));
        assert!(result_b.summary.as_deref().unwrap().contains("代码专家"));
    }
