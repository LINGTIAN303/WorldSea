    use super::*;
    use super::node::{make_msg, render_template};
    use crate::backend::{BackendError, NodeBackendAccessor, PromptCallOptions, PromptResponse};
    use crate::event::{OrchestratorEndStatus, OrchestratorEvent};
    use crate::node::{AbortCheck, EventEmitter, NodeContext, OrchestratorNode};
    use crate::orchestrator::{DefaultOrchestrator, Orchestrator};
    use crate::patterns::shared::json::{extract_json_array, extract_json_object};
    use crate::types::{MessageRole, OrchestratorMessage, PlanItem, PlanItemStatus};
    use async_trait::async_trait;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex, RwLock};

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
        state: &'a mut crate::types::OrchestratorState,
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

    // ─── PlanNode 测试 ────────────────────────────────────────────────

    #[tokio::test]
    async fn plan_parses_direct_json_array() {
        let backend = ScriptedBackend::new(vec![
            r#"[{"title":"第一步","description":"调研"},{"title":"第二步"}]"#.into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("做一个产品调研");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);

        let node = PlanNode::new(PlanNodeConfig {
            id: "plan".into(),
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2);
        assert_eq!(plan[0].title, "第一步");
        assert_eq!(plan[0].description.as_deref(), Some("调研"));
        assert_eq!(plan[1].title, "第二步");
        assert_eq!(plan[0].order, 0);
        // 事件：PlanCreated 已广播
        let events = emitter.0.lock().unwrap();
        assert!(
            events.iter().any(|e| matches!(e, OrchestratorEvent::PlanCreated { .. })),
            "应广播 PlanCreated"
        );
    }

    #[tokio::test]
    async fn plan_parses_json_code_block_fallback() {
        let backend = ScriptedBackend::new(vec![
            "好的，计划如下：\n```json\n[{\"title\":\"A\"},{\"title\":\"B\"}]\n```\n完成".into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        assert_eq!(state.plan.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn plan_parse_failure_returns_error() {
        let backend = ScriptedBackend::new(vec!["抱歉，我无法生成计划".into()]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
        assert!(result.error.is_some());
    }

    #[tokio::test]
    async fn plan_filters_empty_titles_and_truncates() {
        let backend = ScriptedBackend::new(vec![
            r#"[{"title":"  "},{"title":"A"},{"title":"B"},{"title":"C"}]"#.into(),
        ]);
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = PlanNode::new(PlanNodeConfig {
            max_items: 2,
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2, "空标题过滤 + 截断到 max_items");
        assert_eq!(plan[0].title, "A");
    }

    // ─── ExecuteNode 测试 ─────────────────────────────────────────────

    fn plan_state(input: &str, titles: &[&str]) -> crate::types::OrchestratorState {
        let mut state = crate::types::OrchestratorState::new(input);
        state.plan = Some(
            titles
                .iter()
                .enumerate()
                .map(|(i, t)| PlanItem {
                    id: format!("item-{i}"),
                    title: t.to_string(),
                    description: None,
                    status: PlanItemStatus::Pending,
                    order: i as i32,
                    output: None,
                })
                .collect(),
        );
        state
    }

    #[tokio::test]
    async fn execute_runs_all_items_and_done() {
        let backend = ScriptedBackend::new(vec!["结果A".into(), "结果B".into()]);
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Done);
        let plan = state.plan.unwrap();
        assert!(plan.iter().all(|p| p.status == PlanItemStatus::Completed));
        assert_eq!(plan[0].output.as_deref(), Some("结果A"));
        // PlanStepUpdate 事件数 = 每项 InProgress + Completed = 2*2
        let events = emitter.0.lock().unwrap();
        let steps = events
            .iter()
            .filter(|e| matches!(e, OrchestratorEvent::PlanStepUpdate { .. }))
            .count();
        assert_eq!(steps, 4);
    }

    #[tokio::test]
    async fn execute_empty_plan_returns_error() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = crate::types::OrchestratorState::new("任务");
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
    }

    #[tokio::test]
    async fn execute_skip_failure_and_complete_rest() {
        // 1 个响应给 2 个步骤：第一步成功，第二步队列耗尽失败（Skip 策略跳过）
        let backend = ScriptedBackend::new(vec!["结果A".into()]);
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Done);
        let plan = state.plan.unwrap();
        assert_eq!(plan[0].status, PlanItemStatus::Completed, "第一步成功");
        assert_eq!(plan[1].status, PlanItemStatus::Failed, "第二步失败被跳过");
    }

    #[tokio::test]
    async fn execute_abort_failure_stops_plan() {
        let backend = ScriptedBackend::new(Vec::new());
        let mut state = plan_state("任务", &["步骤一", "步骤二"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig {
            on_failure: ExecuteFailurePolicy::Abort,
            ..Default::default()
        });
        let result = node.execute(ctx).await;
        assert_eq!(result.status, crate::node::NodeStatus::Error);
    }

    #[tokio::test]
    async fn execute_appends_new_tasks_dynamically() {
        let backend = ScriptedBackend::new(vec![
            "完成第一步 <new_tasks>[{\"title\":\"新增步骤\"}]</new_tasks>".into(),
        ]);
        let mut state = plan_state("任务", &["步骤一"]);
        let emitter = TestEmitter(Mutex::new(Vec::new()));
        let ctx = make_ctx(&mut state, &backend, &emitter);
        let node = ExecuteNode::new(ExecuteNodeConfig::default());
        let result = node.execute(ctx).await;
        // 动态追加的新步骤本轮未处理 → continue 回自身（下次 execute 继续）
        assert_eq!(result.status, crate::node::NodeStatus::Continue);
        assert_eq!(result.next_node_id.as_deref(), Some("execute"));
        let plan = state.plan.unwrap();
        assert_eq!(plan.len(), 2, "应追加新步骤");
        assert_eq!(plan[1].title, "新增步骤");
        assert_eq!(plan[1].order, 1);
        assert_eq!(plan[1].status, PlanItemStatus::Pending, "新步骤保持 pending");
    }

    // ─── 编排图集成测试（Plan→Execute 走 DefaultOrchestrator）────────────

    #[tokio::test]
    async fn plan_execute_via_orchestrator_graph() {
        // LLM 队列：计划 JSON + 两个步骤的执行结果
        let backend = Arc::new(ScriptedBackend::new(vec![
            r#"[{"title":"第一步"},{"title":"第二步"}]"#.into(),
            "结果A".into(),
            "结果B".into(),
        ]));
        let mut orch = DefaultOrchestrator::new().with_backend(backend);
        orch.add_node(Box::new(PlanNode::new(PlanNodeConfig {
            id: "plan".into(),
            next_node_id: Some("execute".into()),
            ..Default::default()
        })));
        orch.add_node(Box::new(ExecuteNode::new(ExecuteNodeConfig {
            id: "execute".into(),
            ..Default::default()
        })));
        orch.set_entry("plan");

        let result = orch.run("做一个调研".into(), None).await.unwrap();
        assert_eq!(result.status, OrchestratorEndStatus::Completed);
        assert_eq!(result.iterations, 2, "Plan + Execute 各执行一次");
        let plan = result.final_state.plan.unwrap();
        assert_eq!(plan.len(), 2);
        assert!(plan.iter().all(|p| p.status == PlanItemStatus::Completed));
        // final_message 提取最后一条 assistant（Execute 的最后输出）
        assert_eq!(result.final_message.as_deref(), Some("结果B"));
    }

    // ─── JSON 容错解析工具测试 ─────────────────────────────────────────

    #[test]
    fn extract_array_from_raw_and_block() {
        assert_eq!(extract_json_array(r#"[{"a":1}]"#).unwrap().len(), 1);
        assert_eq!(
            extract_json_array("说明\n```json\n[1,2]\n```\n结束").unwrap().len(),
            2
        );
        assert_eq!(extract_json_array("前缀[{\"t\":\"x\"}]后缀").unwrap().len(), 1);
        assert!(extract_json_array("没有数组").is_none());
    }

    #[test]
    fn extract_object_from_block() {
        let v = extract_json_object("```json\n{\"score\": 85}\n```").unwrap();
        assert_eq!(v["score"], 85);
        assert!(extract_json_object("plain text").is_none());
    }

    #[test]
    fn render_template_replaces_placeholders() {
        let out = render_template(
            "输入={{input}} 上条={{lastMessage}} 值={{k}}",
            "输入",
            "上一条",
            &[("k", "v")],
        );
        assert_eq!(out, "输入=输入 上条=上一条 值=v");
    }
