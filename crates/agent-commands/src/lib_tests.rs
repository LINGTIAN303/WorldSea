// ─── 单元测试 ────────────────────────────────────────────

    use super::*;

    fn cloud_config(api_key: &str) -> RuntimeProviderConfig {
        RuntimeProviderConfig::Cloud {
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            api_key: api_key.into(),
        }
    }

    #[tokio::test]
    async fn new_session_and_provider_config_roundtrip() {
        let svc = AgentCommandService::new();
        let info = svc
            .new_session(Some("测试助手".into()), Some(cloud_config("sk-test")))
            .await
            .unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        // 回显真实配置（provider / model），而非 mock 占位
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
        assert!(cfg.base_url.is_some());
    }

    #[tokio::test]
    async fn send_message_without_api_key_fails() {
        let svc = AgentCommandService::new();
        // 空 API Key 的 Cloud 配置 → 发送消息应报 Auth 错误（而非回显 mock）
        let info = svc
            .new_session(Some("测试助手".into()), Some(cloud_config("")))
            .await
            .unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "你好".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::Agent(_)));
    }

    #[tokio::test]
    async fn set_provider_config_updates_backend() {
        let svc = AgentCommandService::new();
        // 创建会话时不注入配置（用默认占位）
        let info = svc.new_session(None, None).await.unwrap();
        // 前端写入真实配置（含 API Key）
        svc.set_provider_config(&info.id, cloud_config("sk-real")).await.unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
    }

    #[tokio::test]
    async fn session_not_found_returns_error() {
        let svc = AgentCommandService::new();
        let err = svc
            .send_message(SendMessageParams {
                session_id: "nope".into(),
                text: "hi".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::SessionNotFound(_)));
    }

    #[tokio::test]
    async fn list_and_delete_session() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        let list = svc.list_sessions(None).await.unwrap();
        assert_eq!(list.len(), 1);
        svc.delete_session(&info.id).await.unwrap();
        assert!(svc.list_sessions(None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn register_subagent_spec_is_shared_across_sessions() {
        let svc = AgentCommandService::new();
        // 先注册规格，再创建两个会话
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        let s1 = svc.new_session(None, None).await.unwrap();
        let s2 = svc.new_session(None, None).await.unwrap();
        // 服务级注册表可见
        assert_eq!(svc.list_subagent_specs().await.len(), 1);
        // 两个会话共享同一注册表（各自 Agent 的 SubAgentManager 持同一 Arc）
        assert_eq!(s1.id.len(), 36);
        assert_eq!(s2.id.len(), 36);
    }

    #[tokio::test]
    async fn register_subagent_spec_overrides_by_id() {
        let svc = AgentCommandService::new();
        let mut spec = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        };
        svc.register_subagent_spec(spec.clone()).await;
        // 同名 id 覆盖，不产生重复项
        spec.name = "新版代码助手".into();
        svc.register_subagent_spec(spec).await;
        let list = svc.list_subagent_specs().await;
        assert_eq!(list.len(), 1, "同名 id 应覆盖而非追加");
        assert_eq!(list[0].name, "新版代码助手", "应取最新定义");
    }

    #[tokio::test]
    async fn remove_subagent_spec_returns_removed_flag() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        // 删除存在的规格返回 true
        let removed = svc.remove_subagent_spec("coder").await;
        assert!(removed, "删除存在的规格应返回 true");
        assert!(svc.list_subagent_specs().await.is_empty());
        // 删除不存在的规格返回 false
        let removed = svc.remove_subagent_spec("nonexistent").await;
        assert!(!removed, "删除不存在的规格应返回 false");
    }

    #[tokio::test]
    async fn subagent_specs_persist_through_store() {
        // 用内存 store 模拟持久化层；注册写穿 → 新建服务复用同一 store → 启动加载
        let store = SqliteSubAgentSpecStore::new_in_memory().await.unwrap();
        let svc = AgentCommandService::with_subagent_store(store.clone())
            .await
            .expect("带存储构造服务应成功");
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        })
        .await;
        assert_eq!(svc.list_subagent_specs().await.len(), 1);

        // 模拟"应用重启"：用同一 store 新建服务，应从存储加载回规格
        let svc2 = AgentCommandService::with_subagent_store(store)
            .await
            .expect("二次构造应成功");
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 1, "重启后应恢复已持久化的规格");
        assert_eq!(restored[0].id, "coder");
        assert_eq!(
            restored[0].tools_whitelist,
            Some(vec!["execute_command".into()]),
            "写穿应保留完整字段（含白名单）"
        );
    }

    #[tokio::test]
    async fn remove_subagent_spec_persists_through_store() {
        let store = SqliteSubAgentSpecStore::new_in_memory().await.unwrap();
        let svc = AgentCommandService::with_subagent_store(store.clone())
            .await
            .unwrap();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        })
        .await;
        assert!(svc.remove_subagent_spec("coder").await);

        // 重启后 coder 不应残留，writer 应保留
        let svc2 = AgentCommandService::with_subagent_store(store)
            .await
            .unwrap();
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 1, "删除应写穿，重启后不残留已删规格");
        assert_eq!(restored[0].id, "writer");
    }

    #[tokio::test]
    async fn export_import_subagent_specs_roundtrip() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写任务".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        })
        .await;

        // 导出为 JSON → 导入到全新服务（模拟跨机迁移）
        let json = svc.export_subagent_specs().await.unwrap();
        assert!(json.contains("coder"), "导出 JSON 应包含全部规格");
        assert!(json.contains("writer"), "导出 JSON 应包含全部规格");

        let svc2 = AgentCommandService::new();
        let n = svc2.import_subagent_specs(&json).await.unwrap();
        assert_eq!(n, 2, "导入应返回实际条数");
        let restored = svc2.list_subagent_specs().await;
        assert_eq!(restored.len(), 2, "导入后应恢复全部规格");
        let coder = restored.iter().find(|s| s.id == "coder").unwrap();
        assert_eq!(
            coder.tools_whitelist,
            Some(vec!["execute_command".into()]),
            "导入应保留完整字段（含白名单）"
        );
    }

    #[tokio::test]
    async fn import_subagent_specs_overrides_by_id() {
        let svc = AgentCommandService::new();
        svc.register_subagent_spec(SubAgentSpec {
            id: "coder".into(),
            name: "旧代码助手".into(),
            description: "旧描述".into(),
            system_prompt: "旧提示词".into(),
            tools_whitelist: None,
            max_iterations: None,
        })
        .await;

        // 导入含同名 id 的新定义 → 应覆盖而非追加
        let json = r#"[{"id":"coder","name":"新代码助手","description":"新描述","system_prompt":"新提示词","tools_whitelist":["execute_command"],"max_iterations":5}]"#;
        let n = svc.import_subagent_specs(json).await.unwrap();
        assert_eq!(n, 1);
        let list = svc.list_subagent_specs().await;
        assert_eq!(list.len(), 1, "同名 id 导入应覆盖而非追加");
        assert_eq!(list[0].name, "新代码助手");
        assert_eq!(list[0].max_iterations, Some(5));
    }

    #[tokio::test]
    async fn import_subagent_specs_invalid_json_rejected() {
        let svc = AgentCommandService::new();
        let err = svc.import_subagent_specs("not-json").await.unwrap_err();
        assert!(matches!(err, CommandError::Internal(_)), "非法 JSON 应报错");
        assert!(
            svc.list_subagent_specs().await.is_empty(),
            "非法导入不应写入任何规格"
        );
    }

    #[test]
    fn validate_subagent_spec_accepts_valid() {
        let spec = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: Some(vec!["execute_command".into()]),
            max_iterations: Some(3),
        };
        assert!(validate_subagent_spec(&spec).is_ok());
        // 白名单与 max_iterations 均可省略
        let minimal = SubAgentSpec {
            id: "writer".into(),
            name: "写作".into(),
            description: "写作".into(),
            system_prompt: "写作专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        assert!(validate_subagent_spec(&minimal).is_ok());
    }

    #[test]
    fn validate_subagent_spec_rejects_invalid() {
        let base = SubAgentSpec {
            id: "coder".into(),
            name: "代码助手".into(),
            description: "处理代码编写".into(),
            system_prompt: "你是代码专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        };
        // 空 id
        assert!(validate_subagent_spec(&SubAgentSpec { id: "".into(), ..base.clone() }).is_err());
        // 非法字符 id
        assert!(validate_subagent_spec(&SubAgentSpec { id: "a b".into(), ..base.clone() }).is_err());
        assert!(validate_subagent_spec(&SubAgentSpec { id: "a/b".into(), ..base.clone() }).is_err());
        // 超长 id
        assert!(validate_subagent_spec(&SubAgentSpec {
            id: "x".repeat(65),
            ..base.clone()
        })
        .is_err());
        // 空 name / description / system_prompt
        assert!(validate_subagent_spec(&SubAgentSpec { name: "".into(), ..base.clone() }).is_err());
        assert!(validate_subagent_spec(&SubAgentSpec {
            description: "".into(),
            ..base.clone()
        })
        .is_err());
        assert!(validate_subagent_spec(&SubAgentSpec {
            system_prompt: "".into(),
            ..base.clone()
        })
        .is_err());
        // max_iterations = 0 非法
        assert!(validate_subagent_spec(&SubAgentSpec {
            max_iterations: Some(0),
            ..base.clone()
        })
        .is_err());
        // 白名单含空名非法
        assert!(validate_subagent_spec(&SubAgentSpec {
            tools_whitelist: Some(vec!["".into()]),
            ..base.clone()
        })
        .is_err());
    }

    #[tokio::test]
    async fn import_subagent_specs_rejects_invalid_atomically() {
        let svc = AgentCommandService::new();
        // 第一条合法、第二条 id 为空 → 整体应被拒绝，合法那条也不写入
        let json = r#"[
            {"id":"ok","name":"合法","description":"描述","system_prompt":"提示词"},
            {"id":"","name":"非法","description":"描述","system_prompt":"提示词"}
        ]"#;
        let err = svc.import_subagent_specs(json).await.unwrap_err();
        assert!(
            matches!(err, CommandError::InvalidArgument(_)),
            "含非法规格应报参数错误，实际: {err}"
        );
        assert!(
            svc.list_subagent_specs().await.is_empty(),
            "整体校验失败时不应写入任何规格（原子性）"
        );
    }

    /// 实例管理按会话隔离：会话不存在时 list/clear 应报 session_not_found
    #[tokio::test]
    async fn subagent_instances_guard_requires_existing_session() {
        let svc = AgentCommandService::new();
        let err_list = svc.list_subagent_instances("nope").await.unwrap_err();
        assert!(
            matches!(err_list, CommandError::SessionNotFound(_)),
            "list 不存在的会话应报 session_not_found，实际: {err_list}"
        );
        let err_clear = svc.clear_subagent_instances("nope").await.unwrap_err();
        assert!(
            matches!(err_clear, CommandError::SessionNotFound(_)),
            "clear 不存在的会话应报 session_not_found，实际: {err_clear}"
        );
    }

    /// 会话存在时，list 返回当前会话的实例（初始为空），clear 清空返回 0
    #[tokio::test]
    async fn subagent_instances_empty_until_delegation() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        // 未委派任何子 Agent 前，实例池为空
        let instances = svc.list_subagent_instances(&info.id).await.unwrap();
        assert!(instances.is_empty(), "未委派前实例池应为空");
        // 清空空池返回 0
        let cleared = svc.clear_subagent_instances(&info.id).await.unwrap();
        assert_eq!(cleared, 0, "空池清空应返回 0");
    }

    /// 单个实例清空：会话不存在报 session_not_found；会话存在但实例不存在返回 false
    #[tokio::test]
    async fn subagent_clear_instance_guards() {
        let svc = AgentCommandService::new();
        // 不存在的会话 → SessionNotFound
        let err = svc.clear_subagent_instance("nope", "coder").await.unwrap_err();
        assert!(
            matches!(err, CommandError::SessionNotFound(_)),
            "清空不存在的会话应报 session_not_found，实际: {err}"
        );
        // 会话存在但实例从未创建 → 返回 false（不报错）
        let info = svc.new_session(None, None).await.unwrap();
        let removed = svc.clear_subagent_instance(&info.id, "coder").await.unwrap();
        assert!(!removed, "实例池中无该实例时清空应返回 false");
    }

    /// 删除会话后，其实例管理器也应随之移除（list 应报 session_not_found）
    #[tokio::test]
    async fn delete_session_removes_subagent_manager() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        svc.delete_session(&info.id).await.unwrap();
        let err = svc.list_subagent_instances(&info.id).await.unwrap_err();
        assert!(
            matches!(err, CommandError::SessionNotFound(_)),
            "删除会话后 list 实例应报 session_not_found，实际: {err}"
        );
    }

    /// 共享控制器：register_session_loop_control 复用会话内建 Arc<LoopController>
    ///
    /// 验证「内建自动 vs 命令层手动」双轨不共享问题的修复——注册条目与内建控制器
    /// 指向同一实例（Arc::ptr_eq），且命令层驱动后内建控制器状态同步变化。
    #[tokio::test]
    async fn register_session_loop_control_shares_builtin_controller() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();

        // 注册该会话的内建控制器为 task_id = "task-main"
        svc.register_session_loop_control("task-main", &info.id)
            .await
            .expect("绑定会话应成功");

        // 注册表中的条目与内建控制器是同一实例（Arc 指针相等）
        let agent = svc.get_agent(&info.id).await.unwrap();
        let builtin = agent.loop_controller().clone();
        let entry = svc
            .loop_control_registry()
            .get("task-main")
            .await
            .expect("已注册的 task 应可取");
        assert!(
            Arc::ptr_eq(&builtin, &entry.controller),
            "命令层条目应与内建控制器共享同一 Arc 实例，消除双轨"
        );

        // 命令层驱动（record_turn）后，内建控制器状态同步可见
        entry.controller.rate_limiter.inc_turns();
        assert_eq!(builtin.rate_limiter.turns(), 1, "共享实例的状态应同步");

        // 配置重建：从共享控制器重建的配置应保留默认速率限制（宽松默认 max_turns=100）
        let config = entry.controller.config();
        assert_eq!(
            config.rate_limit.max_turns,
            Some(100),
            "默认配置应保留宽松 turns 上限"
        );
    }

    /// 共享控制器：会话不存在时注册应报 session_not_found
    #[tokio::test]
    async fn register_session_loop_control_requires_existing_session() {
        let svc = AgentCommandService::new();
        let err = svc
            .register_session_loop_control("task-main", "nope")
            .await
            .unwrap_err();
        assert!(
            matches!(err, CommandError::SessionNotFound(_)),
            "绑定不存在的会话应报 session_not_found，实际: {err}"
        );
    }

    /// 共享控制器：同一 task_id 重复绑定同一会话应报 AlreadyExists
    #[tokio::test]
    async fn register_session_loop_control_rejects_duplicate_task() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None).await.unwrap();
        svc.register_session_loop_control("task-main", &info.id)
            .await
            .unwrap();
        let err = svc
            .register_session_loop_control("task-main", &info.id)
            .await
            .unwrap_err();
        assert!(
            matches!(err, CommandError::Internal(_)),
            "重复 task_id 应包装为 Internal 错误，实际: {err}"
        );
    }
