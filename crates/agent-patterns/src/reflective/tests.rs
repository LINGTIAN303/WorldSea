    use super::*;
    use super::node::make_msg;
    use agent_kernel::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse};
    use agent_kernel::event::{OrchestratorEvent};
    use agent_kernel::node::{AbortCheck, EventEmitter, NodeContext, NodeStatus, OrchestratorNode};
    use agent_kernel::types::{
        MessageRole, OrchestratorMessage, OrchestratorState, ReflectionIssue, ReflectionResult,
        ReflectionSeverity,
    };
    use async_trait::async_trait;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    // ─── 共享测试桩（S4 迁移自 plan_execute::tests，2026-09-01）─────────────

    /// 测试桩后端 — 每次 prompt 弹出队列中的下一条响应
    pub struct ScriptedBackend(pub Mutex<VecDeque<String>>);

    impl ScriptedBackend {
        pub fn new(responses: Vec<String>) -> Self {
            Self(Mutex::new(responses.into_iter().collect()))
        }
        pub fn push(&self, s: impl Into<String>) {
            self.0.lock().unwrap().push_back(s.into());
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for ScriptedBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            match self.0.lock().unwrap().pop_front() {
                Some(text) => Ok(PromptResponse::text_only(text)),
                // 队列耗尽 = 模拟 LLM 调用失败（走 execute 失败分支）
                None => Err(BackendError::Network("测试队列耗尽（模拟 LLM 调用失败）".into())),
            }
        }
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(&self, _m: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _i: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    /// 测试用事件收集器
    pub struct TestEmitter(pub Mutex<Vec<OrchestratorEvent>>);

    impl EventEmitter for TestEmitter {
        fn emit(&self, event: OrchestratorEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    pub struct TestAbort;

    #[async_trait]
    impl AbortCheck for TestAbort {
        fn is_aborted(&self) -> bool {
            false
        }
        async fn wait_if_paused(&self) {}
    }

    /// 构造 NodeContext（供单测直接调 execute）
    pub fn make_ctx<'a>(
        state: &'a mut OrchestratorState,
        backend: &'a dyn NodeBackendAccessor,
        emitter: &'a dyn EventEmitter,
    ) -> NodeContext<'a> {
        NodeContext {
            state,
            backend,
            memory: None,
            emitter,
            abort_check: &TestAbort,
        }
    }

    /// 造一个"已有一条 assistant 输出"的状态
    fn state_with_output(input: &str, output: &str) -> OrchestratorState {
        let mut state = OrchestratorState::new(input);
        state
            .messages
            .push(make_msg(MessageRole::Assistant, output.to_string()));
        state
    }

    // ─── ReflectionNode 测试 ──────────────────────────────────────────

    #[tokio::test]
    async fn reflection_passed_returns_done() {
        let backend = ScriptedBackend::new(vec![
            r#"{"score": 92, "issues": [], "suggestions": []}"#.into(),
        ]);
        let mut state = state_with_output("任务", "一段输出");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ReflectionNode::new(ReflectionNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done, "92 >= 70 应通过");
        let reflections = state.reflections.unwrap();
        assert_eq!(reflections.len(), 1);
        assert_eq!(reflections[0].score, 92);
        // system 评审消息已写入
        assert!(state
            .messages
            .iter()
            .any(|m| m.role == MessageRole::System && m.content.contains("评审结果")));
        // 事件
        assert!(emitter
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|e| matches!(e, OrchestratorEvent::ReflectionResult { .. })));
    }

    #[tokio::test]
    async fn reflection_failed_continues_to_next() {
        let backend = ScriptedBackend::new(vec![
            r#"{"score": 40, "issues": [{"severity":"error","description":"错误1"}], "suggestions":["改进1"]}"#
                .into(),
        ]);
        let mut state = state_with_output("任务", "一段输出");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ReflectionNode::new(ReflectionNodeConfig {
            next_node_id: Some("refine".into()),
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue, "40 < 70 应 continue");
        assert_eq!(result.next_node_id.as_deref(), Some("refine"));
        let reflections = state.reflections.unwrap();
        assert_eq!(reflections[0].issues.len(), 1);
        assert_eq!(reflections[0].suggestions, vec!["改进1".to_string()]);
    }

    #[tokio::test]
    async fn reflection_no_target_returns_done() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = OrchestratorState::new("任务"); // 无 assistant 消息
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ReflectionNode::new(ReflectionNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done, "无目标应直接 done");
    }

    #[tokio::test]
    async fn reflection_parse_failure_returns_error() {
        let backend = ScriptedBackend::new(vec!["这不是 JSON".into()]);
        let mut state = state_with_output("任务", "输出");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ReflectionNode::new(ReflectionNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
    }

    #[tokio::test]
    async fn reflection_parse_from_code_block() {
        let backend = ScriptedBackend::new(vec![
            "评审如下：\n```json\n{\"score\": 88, \"issues\": [], \"suggestions\": [\"x\"]}\n```".into(),
        ]);
        let mut state = state_with_output("任务", "输出");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ReflectionNode::new(ReflectionNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done);
        assert_eq!(state.reflections.unwrap()[0].score, 88);
    }

    // ─── RefineNode 测试 ──────────────────────────────────────────────

    fn state_with_reflection(score: u32) -> OrchestratorState {
        let mut state = state_with_output("任务", "初始输出");
        state.reflections = Some(vec![ReflectionResult {
            target: "初始输出".into(),
            score,
            issues: vec![ReflectionIssue {
                severity: ReflectionSeverity::Warning,
                description: "缺少细节".into(),
            }],
            suggestions: vec!["补充细节".into()],
            iteration: 1,
        }]);
        state
    }

    #[tokio::test]
    async fn refine_no_reflection_returns_error() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = RefineNode::new(RefineNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Error);
    }

    #[tokio::test]
    async fn refine_converged_by_score_returns_done() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = state_with_reflection(95); // 95 >= min_score(90)
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = RefineNode::new(RefineNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done, "评分达标应收敛");
        assert!(result.summary.as_deref().unwrap_or("").contains("收敛"));
    }

    #[tokio::test]
    async fn refine_converged_by_max_iterations_returns_done() {
        // 3 次评审后收敛（max_iterations=3）
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = state_with_reflection(50);
        state.reflections = Some(vec![
            ReflectionResult { target: "输出1".into(), score: 50, issues: vec![], suggestions: vec![], iteration: 1 },
            ReflectionResult { target: "输出2".into(), score: 55, issues: vec![], suggestions: vec![], iteration: 2 },
            ReflectionResult { target: "输出3".into(), score: 60, issues: vec![], suggestions: vec![], iteration: 3 },
        ]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = RefineNode::new(RefineNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done, "达到最大迭代数应收敛");
    }

    #[tokio::test]
    async fn refine_not_converged_refines_and_loops_back() {
        let backend = ScriptedBackend::new(vec!["修正后的输出".into()]);
        let mut state = state_with_reflection(50); // 1 次评审，未收敛
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = RefineNode::new(RefineNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("reflection"));
        // 修正后的内容作为新 assistant 消息（在原始输出之后）
        let msgs = state.messages;
        let last = msgs.last().unwrap();
        assert_eq!(last.role, MessageRole::Assistant);
        assert_eq!(last.content, "修正后的输出");
    }

    #[tokio::test]
    async fn refine_converged_by_no_improvement() {
        // 连续 2 轮无提升（no_improvement_rounds=2）→ 需 3 条评审记录
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = state_with_reflection(60);
        state.reflections = Some(vec![
            ReflectionResult { target: "输出1".into(), score: 60, issues: vec![], suggestions: vec![], iteration: 1 },
            ReflectionResult { target: "输出2".into(), score: 58, issues: vec![], suggestions: vec![], iteration: 2 },
            ReflectionResult { target: "输出3".into(), score: 58, issues: vec![], suggestions: vec![], iteration: 3 },
        ]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = RefineNode::new(RefineNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, NodeStatus::Done, "连续无改进应收敛");
    }
