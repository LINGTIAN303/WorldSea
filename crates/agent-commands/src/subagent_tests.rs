    use super::*;
    use agent_runtime::backend::{BackendError, PromptCallOptions, PromptResponse};
    use agent_runtime::event::EventListener;
    use agent_runtime::tool::SimpleToolBus;
    use agent_runtime::types::{MessageRole, OrchestratorMessage};

    /// 会阻塞的 mock backend：prompt 前 sleep，用于触发 delegate 超时
    struct SlowBackend {
        delay: std::time::Duration,
    }

    #[async_trait]
    impl NodeBackendAccessor for SlowBackend {
        async fn prompt(
            &self,
            prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            tokio::time::sleep(self.delay).await;
            Ok(PromptResponse::text_only(format!("[slow] {prompt}")))
        }
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(&self, _messages: Vec<OrchestratorMessage>) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
        async fn subscribe_events(&self, _listener: Arc<dyn EventListener>) {}
        async fn current_model(&self) -> String {
            "slow-model".into()
        }
        async fn update_provider(
            &self,
            _provider: String,
            _model_id: String,
            _api_key: Option<String>,
            _base_url: Option<String>,
        ) -> Result<(), BackendError> {
            Ok(())
        }
    }

    fn spec(id: &str, name: &str, system_prompt: &str) -> SubAgentSpec {
        SubAgentSpec {
            id: id.into(),
            name: name.into(),
            description: format!("{name} 专长"),
            system_prompt: system_prompt.into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        temp_dir: None,
        }
    }

    #[tokio::test]
    async fn register_and_list_specs() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;
        manager.register_spec(spec("writer", "写作助手", "你是写作专家")).await;
        let listed = manager.list_specs().await;
        assert_eq!(listed.len(), 2);
    }

    #[tokio::test]
    async fn delegate_to_unregistered_spec_errors() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        let err = manager.delegate("nope", "task").await.unwrap_err();
        assert!(matches!(err, ToolError::Other(_)));
    }

    #[tokio::test]
    async fn delegate_runs_sub_agent_and_returns_result() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        assert_eq!(result["sub_agent_id"], "coder");
        assert_eq!(result["name"], "代码助手");
        assert!(result["result"].as_str().unwrap().contains("收到"));
    }

    /// 规格未变更时应复用池中实例（同一 Arc），规格变更后应重建实例（不同 Arc）
    #[tokio::test]
    async fn get_or_create_agent_reuses_or_rebuilds_by_spec() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;

        let s1 = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s1.clone()).await;

        let a1 = manager.get_or_create_agent(&s1).await;
        // 相同规格：复用同一实例
        let a1_again = manager.get_or_create_agent(&s1).await;
        assert!(Arc::ptr_eq(&a1, &a1_again), "相同规格应复用池中实例");

        // 规格变更（system_prompt 不同）：应重建实例
        let s2 = SubAgentSpec {
            system_prompt: "你是资深代码专家（版本2）".into(),
            ..s1.clone()
        };
        manager.register_spec(s2.clone()).await;
        let a2 = manager.get_or_create_agent(&s2).await;
        assert!(!Arc::ptr_eq(&a1, &a2), "规格变更后应重建实例");

        // 变更后再次以 s2 委托，应复用新建的 a2，而非回退到 a1
        let a2_again = manager.get_or_create_agent(&s2).await;
        assert!(Arc::ptr_eq(&a2, &a2_again), "变更后的规格应持续复用新实例");
    }

    /// 规格变更重建实例时，应把旧实例的非 system 上下文迁移到新实例
    #[tokio::test]
    async fn spec_change_migrates_context_to_new_instance() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;

        let s1 = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s1.clone()).await;
        let a1 = manager.get_or_create_agent(&s1).await;

        // 给旧实例注入一条 user + assistant 消息（模拟已累积的对话上下文）
        a1.set_runtime_messages(vec![
            OrchestratorMessage {
                role: MessageRole::User,
                content: "帮我写一个排序算法".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "这是之前实现的快速排序".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            },
        ])
        .await
        .expect("注入旧上下文应成功");
        let old_msgs = a1.get_runtime_messages().await;
        assert_eq!(old_msgs.len(), 2, "旧实例应有 2 条非 system 消息");

        // 规格变更（system_prompt 不同）：应重建实例并迁移上下文
        let s2 = SubAgentSpec {
            system_prompt: "你是资深代码专家（版本2）".into(),
            ..s1.clone()
        };
        manager.register_spec(s2.clone()).await;
        let a2 = manager.get_or_create_agent(&s2).await;
        assert!(!Arc::ptr_eq(&a1, &a2), "规格变更后应重建实例");

        // 新实例应保留迁移过来的非 system 上下文
        let migrated = a2.get_runtime_messages().await;
        assert!(
            migrated.iter().any(|m| m.content.contains("排序算法")),
            "新实例应迁移旧实例的 user 消息上下文"
        );
        assert!(
            migrated.iter().any(|m| m.content.contains("快速排序")),
            "新实例应迁移旧实例的 assistant 消息上下文"
        );

        // 迁移后不应残留旧的 system 消息（新 system prompt 应生效）
        let old_system = migrated
            .iter()
            .filter(|m| m.role == MessageRole::System)
            .any(|m| m.content.contains("你是代码专家"));
        assert!(
            !old_system,
            "新实例不应残留旧 system prompt（应使用新规格的 system prompt）"
        );
    }

    /// delegate 应应用超时：子 Agent 阻塞超过 timeout 时返回 ToolError::Timeout，而非无限阻塞
    #[tokio::test]
    async fn delegate_applies_timeout() {
        let bus = Arc::new(SimpleToolBus::new());
        // 子 Agent 每次 prompt 阻塞 500ms，超时设为 50ms：必然触发超时
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(
            matches!(result, Err(ToolError::Timeout)),
            "阻塞超时的 delegate 应返回 ToolError::Timeout，实际: {result:?}"
        );
    }

    /// 委派超时后，子 Agent 实例状态应被正确清理：is_streaming 复位、aborted 未置位，
    /// 实例可继续复用（而非永久损坏）。
    #[tokio::test]
    async fn timeout_resets_subagent_streaming_state() {
        let bus = Arc::new(SimpleToolBus::new());
        // 子 Agent 每次 prompt 阻塞 500ms，超时设为 50ms：必然触发超时
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));

        let s = spec("coder", "代码助手", "你是代码专家");
        manager.register_spec(s.clone()).await;

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(matches!(result, Err(ToolError::Timeout)));

        // 超时后取回同一实例（池中缓存），应已复位：
        // - is_streaming 必须为 false（否则前端/并发判断误以为仍在流式）
        // - aborted 必须为 false（否则下次 run 立即返回 Aborted，实例永久损坏）
        let agent = manager.get_or_create_agent(&s).await;
        assert!(!agent.is_streaming(), "超时后 is_streaming 应复位为 false");
        let state = agent.get_state().await;
        assert!(!state.aborted, "超时后不应置位 aborted（实例应可继续复用）");
    }

    /// 记录收到的编排事件名（std Mutex，on_event 是同步回调）
    struct RecordingListener {
        events: std::sync::Mutex<Vec<String>>,
    }
    impl EventListener for RecordingListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let name = match event {
                OrchestratorEvent::SubAgentStarted { .. } => "start",
                OrchestratorEvent::SubAgentCompleted { .. } => "completed",
                OrchestratorEvent::SubAgentError { .. } => "error",
                _ => return,
            };
            self.events.lock().unwrap().push(name.to_string());
        }
    }

    /// 注入广播器后，delegate 成功路径应广播 start → completed 事件
    #[tokio::test]
    async fn delegate_broadcasts_start_then_completed() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone());
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        // 注入广播器 + 订阅记录器
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let rec = Arc::new(RecordingListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        broadcaster.write().await.subscribe(rec.clone());
        manager.set_broadcaster(broadcaster.clone());

        manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        let got = rec.events.lock().unwrap().clone();
        assert_eq!(got, vec!["start".to_string(), "completed".to_string()]);
    }

    /// 委派深度达到上限时应拒绝委派（返回 ToolError::Other），防止递归委派无限膨胀。
    ///
    /// 通过 DELEGATE_DEPTH.scope 手动把当前深度设为 max_delegate_depth（默认 3），
    /// 再调用 delegate，断言直接返回错误（此时不应执行子 Agent）。
    #[tokio::test]
    async fn delegate_rejects_when_depth_at_limit() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone());
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        // 手动把当前深度设为 3（= max_delegate_depth 默认值），应被拒绝
        let result = DELEGATE_DEPTH
            .scope(AtomicUsize::new(3), async {
                manager.delegate("coder", "帮我写个 hello world").await
            })
            .await;
        let err = result.expect_err("深度达到上限时应返回错误");
        assert!(
            matches!(err, ToolError::Other(_)),
            "深度超限应返回 ToolError::Other，实际: {err:?}"
        );
    }

    /// 委派深度未达上限时应正常执行（深度 scope 不误伤合法委派）。
    ///
    /// 手动设 depth=2（< max_delegate_depth=3），delegate 应成功运行子 Agent。
    #[tokio::test]
    async fn delegate_allows_within_depth_limit() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone());
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let result = DELEGATE_DEPTH
            .scope(AtomicUsize::new(2), async {
                manager.delegate("coder", "帮我写个 hello world").await
            })
            .await;
        result.expect("深度未达上限时应正常完成委派");
    }

    /// 自定义 max_delegate_depth 生效：设上限为 1，则 depth=1 已被拒绝、depth=0 正常执行。
    #[tokio::test]
    async fn delegate_respects_custom_max_depth() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_max_delegate_depth(1);
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        // depth=1 已达上限 1，应被拒绝
        let blocked = DELEGATE_DEPTH
            .scope(AtomicUsize::new(1), async {
                manager.delegate("coder", "帮我写个 hello world").await
            })
            .await;
        assert!(
            matches!(blocked, Err(ToolError::Other(_))),
            "depth=1 达到自定义上限 1 应被拒绝，实际: {blocked:?}"
        );

        // depth=0 未达上限，应正常执行
        let ok = DELEGATE_DEPTH
            .scope(AtomicUsize::new(0), async {
                manager.delegate("coder", "帮我写个 hello world").await
            })
            .await;
        ok.expect("depth=0 未达自定义上限应正常完成");
    }

    /// 注入广播器后，delegate 超时路径应广播 start → error 事件
    #[tokio::test]
    async fn delegate_broadcasts_start_then_error_on_timeout() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(SlowBackend {
            delay: std::time::Duration::from_millis(500),
        });
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = SubAgentManager::new(backend, bus.clone(), specs.clone())
            .with_delegate_timeout(std::time::Duration::from_millis(50));
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let rec = Arc::new(RecordingListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        broadcaster.write().await.subscribe(rec.clone());
        manager.set_broadcaster(broadcaster.clone());

        let result = manager.delegate("coder", "帮我写个 hello world").await;
        assert!(matches!(result, Err(ToolError::Timeout)));
        let got = rec.events.lock().unwrap().clone();
        assert_eq!(got, vec!["start".to_string(), "error".to_string()]);
    }

    /// 委派后应产生一个活跃实例，list_instances 能列出其信息（含消息数/流式状态）
    #[tokio::test]
    async fn list_instances_after_delegate() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        // 委派前无实例
        assert!(manager.list_instances().await.is_empty(), "委派前实例池应为空");

        manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        let instances = manager.list_instances().await;
        assert_eq!(instances.len(), 1, "委派后应产生 1 个活跃实例");
        let inst = &instances[0];
        assert_eq!(inst.sub_agent_id, "coder");
        assert_eq!(inst.name, "代码助手");
        assert!(!inst.is_streaming, "委派完成后不应处于流式状态");
        // 实例累积了至少 system 消息，message_count 应 > 0
        assert!(inst.message_count > 0, "实例应累积了上下文消息");
    }

    /// clear_instance 应移除单个实例；移除后下次委派会重建（全新上下文）
    #[tokio::test]
    async fn clear_instance_removes_single() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;

        manager.delegate("coder", "帮我写个 hello world").await.unwrap();
        assert_eq!(manager.list_instances().await.len(), 1);

        // 清空不存在的 id 返回 false
        assert!(!manager.clear_instance("nope").await, "清空不存在的 id 应返回 false");
        // 清空存在的 id 返回 true，且实例池清空
        assert!(manager.clear_instance("coder").await, "清空存在的 id 应返回 true");
        assert!(manager.list_instances().await.is_empty(), "清空后实例池应为空");

        // 再次委派会重建实例（懒加载）
        manager.delegate("coder", "再来一次").await.unwrap();
        assert_eq!(manager.list_instances().await.len(), 1, "再次委派应重建实例");
    }

    /// clear_instances 应清空全部实例并返回清空数量
    #[tokio::test]
    async fn clear_instances_removes_all() {
        let bus = Arc::new(SimpleToolBus::new());
        let backend: Arc<dyn NodeBackendAccessor> = Arc::new(crate::MockBackend::new());
        let specs = Arc::new(RwLock::new(Vec::new()));
        let manager = register_subagent_tools(&*bus, backend, bus.clone(), specs).await;
        manager.register_spec(spec("coder", "代码助手", "你是代码专家")).await;
        manager.register_spec(spec("writer", "写作助手", "你是写作专家")).await;

        manager.delegate("coder", "写代码").await.unwrap();
        manager.delegate("writer", "写文案").await.unwrap();
        assert_eq!(manager.list_instances().await.len(), 2);

        let cleared = manager.clear_instances().await;
        assert_eq!(cleared, 2, "应清空 2 个实例");
        assert!(manager.list_instances().await.is_empty(), "清空后实例池应为空");

        // 无实例时清空返回 0
        assert_eq!(manager.clear_instances().await, 0, "空池清空应返回 0");
    }
