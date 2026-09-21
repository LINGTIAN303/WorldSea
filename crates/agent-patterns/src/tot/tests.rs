// ─── 单元测试 ────────────────────────────────────────────

    use super::*;
    use agent_kernel::backend::{BackendError, PromptResponse};
    use agent_kernel::node::{AbortCheck, EventEmitter};
    use agent_kernel::types::OrchestratorState;
    use async_trait::async_trait;
    use std::sync::Mutex;

    // ─── 测试桩：Backend ────────────────────────────────────

    /// 测试用 Backend — 按调用顺序返回预设的固定响应
    struct StubBackend {
        responses: Mutex<std::collections::VecDeque<String>>,
        prompt_count: Mutex<usize>,
    }

    impl StubBackend {
        fn new(responses: Vec<String>) -> Self {
            Self {
                responses: Mutex::new(responses.into_iter().collect()),
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
            let resp = self
                .responses
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_default();
            Ok(PromptResponse::text_only(resp))
        }

        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
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

    // ─── 测试桩：策略 ────────────────────────────────────

    /// 测试用探索策略 — 返回固定候选思维
    struct StubExploration {
        thoughts: Vec<String>,
    }

    #[async_trait]
    impl ExplorationStrategy for StubExploration {
        async fn expand(
            &self,
            _parent: &ThoughtNode,
            _context: &str,
            branch_factor: usize,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<Vec<String>, ToTError> {
            Ok(self.thoughts.iter().take(branch_factor).cloned().collect())
        }
    }

    /// 测试用评分策略 — 返回固定评分
    struct StubScoring {
        score: u8,
    }

    #[async_trait]
    impl ScoringStrategy for StubScoring {
        async fn score(
            &self,
            _node: &ThoughtNode,
            _context: &str,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<(u8, Option<String>), ToTError> {
            Ok((self.score, Some("stub score".into())))
        }
    }

    /// 测试用目标检查策略 — 总是返回 false
    struct StubGoalCheck;

    #[async_trait]
    impl GoalCheckStrategy for StubGoalCheck {
        async fn check_goal(
            &self,
            _node: &ThoughtNode,
            _context: &str,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<bool, ToTError> {
            Ok(false)
        }
    }

    // ─── 测试：JSON 解析 ────────────────────────────────────

    #[test]
    fn parse_exploration_response_should_handle_plain_json() {
        let text = r#"["思维1","思维2","思维3"]"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], "思维1");
    }

    #[test]
    fn parse_exploration_response_should_handle_code_fence() {
        let text = r#"```json
["a","b"]
```"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 2);
    }

    #[test]
    fn parse_exploration_response_should_flatten_nested_arrays() {
        // 推理模型常返回嵌套数组（每个思维是一个子数组），应展平为扁平字符串列表
        let text = r#"[["思维1","思维2"],["思维3"]]"#;
        let r = BeamSearchStrategy::parse_response(text).unwrap();
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], "思维1");
        assert_eq!(r[2], "思维3");
    }

    #[test]
    fn parse_scoring_response_should_extract_score_and_reasoning() {
        let text = r#"{"score":85,"reasoning":"思路清晰"}"#;
        let (s, r) = LlmScoringStrategy::parse_response(text).unwrap();
        assert_eq!(s, 85);
        assert_eq!(r.as_deref(), Some("思路清晰"));
    }

    #[test]
    fn parse_goal_check_response_should_extract_bool() {
        let text = r#"{"goal_reached":true,"reasoning":"已解决"}"#;
        let r = LlmGoalCheckStrategy::parse_response(text).unwrap();
        assert!(r);
    }

    #[test]
    fn parse_goal_check_response_should_handle_false() {
        let text = r#"{"goal_reached":false,"reasoning":"未解决"}"#;
        let r = LlmGoalCheckStrategy::parse_response(text).unwrap();
        assert!(!r);
    }

    // ─── 测试：终止原因 ────────────────────────────────────

    #[test]
    fn termination_reason_as_str_should_match() {
        assert_eq!(
            ToTTerminationReason::GoalReached.as_str(),
            "goal_reached"
        );
        assert_eq!(
            ToTTerminationReason::MaxDepthExceeded.as_str(),
            "max_depth_exceeded"
        );
        assert_eq!(
            ToTTerminationReason::ScoreConverged.as_str(),
            "score_converged"
        );
    }

    // ─── 测试：评分收敛检测 ────────────────────────────────────

    #[test]
    fn is_converged_should_return_true_when_diff_below_threshold() {
        let nodes = vec![
            ThoughtNode {
                id: "1".into(),
                content: "a".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(85),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
            ThoughtNode {
                id: "2".into(),
                content: "b".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(87),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
        ];
        let refs: Vec<&ThoughtNode> = nodes.iter().collect();
        assert!(ToTNode::is_converged(&refs, 5));
    }

    #[test]
    fn is_converged_should_return_false_when_diff_above_threshold() {
        let nodes = vec![
            ThoughtNode {
                id: "1".into(),
                content: "a".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(50),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
            ThoughtNode {
                id: "2".into(),
                content: "b".into(),
                parent_id: None,
                parents: Vec::new(),
                depth: 1,
                score: Some(90),
                score_reasoning: None,
                children: vec![],
                status: ThoughtNodeStatus::Scored,
            },
        ];
        let refs: Vec<&ThoughtNode> = nodes.iter().collect();
        assert!(!ToTNode::is_converged(&refs, 5));
    }

    // ─── 测试：ToTNode execute ────────────────────────────────────

    #[tokio::test]
    async fn tot_execute_should_terminate_on_max_depth() {
        // 使用 stub 策略，避免真实 LLM 调用
        let backend = Arc::new(StubBackend::new(vec![]));

        let config = ToTConfig {
            max_depth: 2,
            max_thoughts: 50,
            beam_width: 2,
            branch_factor: 2,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        };

        let node = ToTNode::new(
            "tot",
            "思维树",
            Arc::new(StubExploration {
                thoughts: vec!["候选1".into(), "候选2".into()],
            }),
            Arc::new(StubScoring { score: 80 }),
            Arc::new(StubGoalCheck),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("解决一个数学问题");
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
        // 应该是 Continue 或 Done（取决于是否触发目标）
        assert!(
            matches!(result.status, NodeStatus::Continue | NodeStatus::Done),
            "应为 Continue 或 Done，实际: {:?}",
            result.status
        );

        // 验证 state.messages 被写入
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(matches!(last.role, MessageRole::Assistant));
        assert!(last.content.contains("[ToT"));
    }

    #[tokio::test]
    async fn tot_execute_should_error_on_empty_context() {
        let backend = Arc::new(StubBackend::new(vec![]));
        let node = ToTNode::with_default_strategies(
            "tot",
            "思维树",
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            ToTConfig::default(),
        );

        let mut state = OrchestratorState::new(String::new());
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
        assert!(result.error.unwrap().contains("原始问题为空"));
    }

    #[tokio::test]
    async fn tot_execute_should_terminate_on_goal_reached() {
        let backend = Arc::new(StubBackend::new(vec![]));

        /// 目标检查策略 — 第二次调用返回 true（即第一个子节点达成目标）
        struct GoalOnSecondCall {
            call_count: Mutex<usize>,
        }

        #[async_trait]
        impl GoalCheckStrategy for GoalOnSecondCall {
            async fn check_goal(
                &self,
                _node: &ThoughtNode,
                _context: &str,
                _backend: &dyn NodeBackendAccessor,
            ) -> Result<bool, ToTError> {
                let mut count = self.call_count.lock().unwrap();
                *count += 1;
                // 根节点检查 + 第一个子节点检查 = true
                Ok(*count >= 2)
            }
        }

        let config = ToTConfig {
            max_depth: 5,
            max_thoughts: 50,
            beam_width: 2,
            branch_factor: 2,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        };

        let node = ToTNode::new(
            "tot",
            "思维树",
            Arc::new(StubExploration {
                thoughts: vec!["目标解".into(), "候选2".into()],
            }),
            Arc::new(StubScoring { score: 95 }),
            Arc::new(GoalOnSecondCall {
                call_count: Mutex::new(0),
            }),
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            config,
        );

        let mut state = OrchestratorState::new("求解问题");
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
        assert_eq!(result.status, NodeStatus::Done);
        assert!(result.summary.is_some());

        // 验证 state.messages 包含目标达成消息
        assert!(!state.messages.is_empty());
        let last = state.messages.last().unwrap();
        assert!(last.content.contains("[ToT 目标达成"));
    }

    // ─── 测试：树快照 ────────────────────────────────────

    #[tokio::test]
    async fn tree_snapshot_should_return_all_nodes() {
        let backend = Arc::new(StubBackend::new(vec![]));
        let node = ToTNode::with_default_strategies(
            "tot",
            "思维树",
            Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
            ToTConfig::default(),
        );

        // 手动插入几个节点
        {
            let mut tree = node.tree.write().await;
            tree.insert(
                "n1".into(),
                ThoughtNode {
                    id: "n1".into(),
                    content: "a".into(),
                    parent_id: None,
                    parents: Vec::new(),
                    depth: 0,
                    score: Some(80),
                    score_reasoning: None,
                    children: vec![],
                    status: ThoughtNodeStatus::Scored,
                },
            );
            tree.insert(
                "n2".into(),
                ThoughtNode {
                    id: "n2".into(),
                    content: "b".into(),
                    parent_id: Some("n1".into()),
                    parents: Vec::new(),
                    depth: 1,
                    score: Some(85),
                    score_reasoning: None,
                    children: vec![],
                    status: ThoughtNodeStatus::Scored,
                },
            );
        }

        let snapshot = node.tree_snapshot().await;
        assert_eq!(snapshot.len(), 2);
    }
