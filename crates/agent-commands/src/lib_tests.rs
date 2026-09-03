// ─── 单元测试 ────────────────────────────────────────────

    use super::*;
    // S1 适配层：Bring RunObserver trait 进作用域以调用桥上方法
    use agent_patterns::orchestrator::RunObserver;

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
            .new_session(Some("测试助手".into()), Some(cloud_config("sk-test")), None, None, None, None)
            .await
            .unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        // 回显真实配置（provider / model），而非 mock 占位
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
        assert!(cfg.base_url.is_some());
    }

    #[tokio::test]
    async fn new_session_with_entity_storage_root_ok() {
        // 方案A（2026-09-03）：显式实体存储根（默认项目 worlddata 语义）建会话不报错，
        // 且 workdir（Agent 工作区根）与会话归属保持独立——实体根不污染会话工作区字段。
        let svc = AgentCommandService::new();
        let info = svc
            .new_session(
                Some("测试".into()),
                None,
                None,
                Some(std::path::PathBuf::from("C:\\ws\\agent")),
                Some(std::path::PathBuf::from("C:\\ws\\worlddata")),
                None,
            )
            .await
            .unwrap();
        assert_eq!(info.workdir.as_deref(), Some("C:\\ws\\agent"));
        // 会话可正常查询（Provider 为默认占位回显）
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        assert_eq!(cfg.provider, "deepseek");
    }

    #[tokio::test]
    async fn send_message_without_api_key_fails() {
        let svc = AgentCommandService::new();
        // 空 API Key 的 Cloud 配置 → 发送消息应报 Auth 错误（而非回显 mock）
        let info = svc
            .new_session(Some("测试助手".into()), Some(cloud_config("")), None, None, None, None)
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
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
        temp_dir: None,
        })
        .await;
        let s1 = svc.new_session(None, None, None, None, None, None).await.unwrap();
        let s2 = svc.new_session(None, None, None, None, None, None).await.unwrap();
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
        temp_dir: None,
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
        temp_dir: None,
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
        temp_dir: None,
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
        temp_dir: None,
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: Some(3),
        temp_dir: None,
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
        temp_dir: None,
        })
        .await;
        svc.register_subagent_spec(SubAgentSpec {
            id: "writer".into(),
            name: "写作助手".into(),
            description: "处理写作任务".into(),
            system_prompt: "你是写作专家".into(),
            tools_whitelist: None,
            max_iterations: None,
        temp_dir: None,
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
        temp_dir: None,
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
        temp_dir: None,
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
        temp_dir: None,
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
        temp_dir: None,
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
        let removed = svc.clear_subagent_instance(&info.id, "coder").await.unwrap();
        assert!(!removed, "实例池中无该实例时清空应返回 false");
    }

    /// 删除会话后，其实例管理器也应随之移除（list 应报 session_not_found）
    #[tokio::test]
    async fn delete_session_removes_subagent_manager() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();

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

        // 配置重建：从共享控制器重建的配置应保留默认速率限制
        // （max_turns 已退役=None，轮数预算职责移交 AgentLoopConfig.total_steps；其余维度保留宽松默认）
        let config = entry.controller.config();
        assert_eq!(
            config.rate_limit.max_turns,
            None,
            "默认配置应关闭轮数限制（职责移交 total_steps）"
        );
        assert_eq!(
            config.rate_limit.max_tool_calls,
            Some(200),
            "默认配置应保留工具调用次数兜底"
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
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
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

    // ── M5-RK1：模式前缀分流 ─────────────────────────────────

    /// 五个模式前缀全部命中（带空格与无空格两种写法）
    #[test]
    fn extract_mode_prefix_matches_all_five() {
        assert_eq!(extract_mode_prefix("/plan 先调研再写"), Some(ModePrefix::Plan));
        assert_eq!(extract_mode_prefix("/tot 难题"), Some(ModePrefix::Tot));
        assert_eq!(extract_mode_prefix("/got 对比"), Some(ModePrefix::Got));
        assert_eq!(extract_mode_prefix("/supervisor 委派"), Some(ModePrefix::Supervisor));
        assert_eq!(extract_mode_prefix("/multi 协作"), Some(ModePrefix::Multi));
        // 无空格紧贴写法
        assert_eq!(extract_mode_prefix("/tot难题"), Some(ModePrefix::Tot));
        // 大小写不敏感
        assert_eq!(extract_mode_prefix("/TOT 难题"), Some(ModePrefix::Tot));
    }

    /// 四管线前缀不被模式前缀吞、普通文本不误判
    #[test]
    fn extract_mode_prefix_ignores_pipeline_and_plain() {
        assert_eq!(extract_mode_prefix("/调研 论文"), None, "四管线前缀归 force_pipeline");
        assert_eq!(extract_mode_prefix("/写作 一章"), None);
        assert_eq!(extract_mode_prefix("帮我写一封信"), None);
        assert_eq!(extract_mode_prefix("tot 不是命令"), None, "裸词不命中，仅前置 / 前缀");
    }

    /// 模式前缀后缺任务描述 → send_message 报错（不静默降级回 react）
    #[tokio::test]
    async fn send_message_mode_prefix_without_task_fails() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "/tot".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(
            matches!(err, CommandError::Internal(_)),
            "缺任务描述应报错，实际: {err}"
        );
    }

    /// /multi 前缀 → 明确引导错误（无 spec 时不允许黑盒失败）
    #[tokio::test]
    async fn send_message_multi_prefix_guides_to_panel() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "/multi 协作任务".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        assert!(
            matches!(err, CommandError::Agent(_)),
            "应返回引导错误，实际: {err}"
        );
    }

    /// /supervisor 前缀 → 无注册规格时引导错误（明确差什么，不静默走 plan_execute）
    #[tokio::test]
    async fn send_message_supervisor_prefix_requires_specs() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "/supervisor 拆解任务".into(),
                images: vec![],
                mode: None,
            })
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("子 Agent") || matches!(err, CommandError::Agent(_)),
            "应提示需配置子 Agent 规格，实际: {msg}"
        );
    }

    /// X1：编排路径收口——用户/终稿消息入环 + message_count 回写 + 写穿持久化 + 重启恢复派生计数。
    /// 编排引擎本身不触碰会话历史，收口逻辑（send_message 两处编排早退路径共用）独立单测覆盖；
    /// 真实编排需 LLM，走 #[ignore] e2e。
    #[tokio::test]
    async fn orchestration_turn_finalizes_persistence_and_count() {
        let store: Arc<dyn SessionRepository> =
            SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(Arc::clone(&store));
        let info = svc.new_session(None, None, None, None, None, None).await.unwrap();

        svc.finalize_orchestration_turn(&info.id, "/plan 写文档", Some("终稿内容"))
            .await;

        // ① 消息入环：用户消息 + 终稿（历史含 system 首条，按角色断言）
        let msgs = svc.get_messages(&info.id).await.unwrap();
        assert!(msgs
            .iter()
            .any(|m| m.role == MessageRole::User && m.content == "/plan 写文档"));
        assert!(msgs
            .iter()
            .any(|m| m.role == MessageRole::Assistant && m.content == "终稿内容"));

        // ② message_count 回写（侧栏「N 条」，与 react 路径同口径 = 环内消息总数）
        let list = svc.list_sessions(None).await.unwrap();
        assert_eq!(list[0].message_count, msgs.len() as u32);

        // ③ 写穿持久化（刷新/重启后的恢复源）
        let persisted = store.load_messages(&info.id).await.unwrap();
        assert_eq!(persisted.len(), msgs.len());

        // ④ 重启恢复：计数从 messages 表派生（不读 sessions 列，杜绝「重启归 0」）
        let svc2 = AgentCommandService::new().with_session_store(store);
        let restored = svc2.restore_sessions().await.unwrap();
        assert_eq!(restored[0].message_count, msgs.len() as u32);
        let restored_msgs = svc2.get_messages(&restored[0].id).await.unwrap();
        assert_eq!(restored_msgs.len(), msgs.len());
    }

    // ── M3-RK1：Supervisor 图节点委派路径子 run 记账器 ──

    /// RunStoreSubRunAccountant：begin 建子 run 挂到当前顶层 run，finish 收口
    #[tokio::test]
    async fn run_store_sub_run_accountant_hooks_parent_and_finishes() {
        use agent_runtime::sub_agent_pool::SubRunAccountant;
        let store = Arc::new(RunStore::new());
        // 先建顶层 run（supervisor 自身）
        let top = store.create("sess-1", None, Some("supervisor".to_string())).await;
        assert_eq!(store.current_top_run().await.as_deref(), Some(top.as_str()));

        let acc = RunStoreSubRunAccountant { store: Arc::clone(&store) };
        // begin：子 run 挂到顶层（父=current_top），session 继承
        let sub = acc.begin(None, "writer", "写作助手").await.unwrap();
        let sub_run = store.get(&sub).await.unwrap();
        assert_eq!(sub_run.parent_run_id.as_deref(), Some(top.as_str()), "子 run 应挂父 run");
        assert_eq!(sub_run.session_id, "sess-1", "子 run 应继承父 run 的 session");
        assert_eq!(sub_run.pipeline.as_deref(), Some("sub:writer"));

        // finish：completed + 摘要
        acc.finish(&sub, "completed", Some("结果摘要".into())).await;
        let sub_run = store.get(&sub).await.unwrap();
        assert_eq!(sub_run.status, RunStatus::Completed);
        assert_eq!(sub_run.converge_reason, Some(ConvergeReason::GoalReached));
        assert_eq!(sub_run.final_message.as_deref(), Some("结果摘要"));

        // finish error 语义
        let sub2 = acc.begin(None, "coder", "代码助手").await.unwrap();
        acc.finish(&sub2, "error", Some("失败".into())).await;
        let sub2_run = store.get(&sub2).await.unwrap();
        assert_eq!(sub2_run.status, RunStatus::Error);
        assert_eq!(sub2_run.converge_reason, None);
    }

    // ═══ S1 适配层：B 轨命令层契约辅助（编排双轨收拢试点）═══

    /// 构造 B 轨终局报告（blackboard 为追加语义快照：v 数组[当前值]）
    fn b_rail_report(reason: b_rail::TerminalReason, blackboard: serde_json::Value) -> b_rail::RunReport {
        let result = blackboard
            .get("result.draft")
            .and_then(|v| v.as_array())
            .and_then(|a| a.last())
            .cloned();
        b_rail::RunReport {
            reason,
            steps: vec![],
            usage: b_rail::Usage::default(),
            result,
            blackboard,
            elapsed: std::time::Duration::from_millis(1),
        }
    }

    #[test]
    fn b_rail_terminal_maps_kernel_contract() {
        // Done → Completed + GoalReached + final_message
        let done = b_rail_report(
            b_rail::TerminalReason::Done,
            serde_json::json!({ "result.draft": ["最终结论"] }),
        );
        let (s, r, m, e) = b_rail_terminal(&done);
        assert_eq!(s, OrchestratorEndStatus::Completed);
        assert_eq!(r, Some(ConvergeReason::GoalReached));
        assert_eq!(m.as_deref(), Some("最终结论"));
        assert!(e.is_none());

        // Fatal → Error
        let fatal = b_rail_report(
            b_rail::TerminalReason::Fatal(b_rail::NodeError::fatal("replan", "重规划耗尽")),
            serde_json::json!({ "result.draft": ["部分结果"] }),
        );
        let (s, r, m, e) = b_rail_terminal(&fatal);
        assert_eq!(s, OrchestratorEndStatus::Error);
        assert_eq!(r, None);
        assert_eq!(m.as_deref(), Some("部分结果"));
        assert!(e.unwrap().contains("重规划耗尽"));

        // Governed → Aborted
        let governed = b_rail_report(
            b_rail::TerminalReason::Governed("用户取消".into()),
            serde_json::json!({ "result.draft": ["退出前结果"] }),
        );
        let (s, r, _, e) = b_rail_terminal(&governed);
        assert_eq!(s, OrchestratorEndStatus::Aborted);
        assert_eq!(r, Some(ConvergeReason::Aborted));
        assert!(e.is_some());
    }

    #[test]
    fn b_rail_artifacts_translate_plan_and_execution() {
        let report = b_rail_report(
            b_rail::TerminalReason::Done,
            serde_json::json!({
                "pne.plan": [{ "steps": ["步骤1", "步骤2"] }],
                "result.draft": ["执行完毕的成稿"]
            }),
        );
        let artifacts = b_rail_artifacts("run-1", &report);
        // 两类物齐全 + 归属 run
        assert_eq!(artifacts.len(), 2);
        assert!(artifacts.iter().all(|a| a.run_id == "run-1"));
        // Plan 物：2 个步骤映射 2 个 PlanItem，id/order 顺序正确
        let plan = artifacts.iter().find(|a| matches!(a.kind, ArtifactKind::Plan(_))).unwrap();
        assert!(plan.artifact_id.starts_with("run-1-"));
        match &plan.kind {
            ArtifactKind::Plan(items) => {
                assert_eq!(items.len(), 2);
                assert_eq!(items[0].title, "步骤1");
                assert_eq!(items[0].order, 0);
                assert_eq!(items[1].title, "步骤2");
                assert_eq!(items[1].order, 1);
            }
            _ => panic!("应为 Plan 物"),
        }
        // Execution 物：result.draft 正文 + Completed
        let exec = artifacts.iter().find(|a| matches!(a.kind, ArtifactKind::Execution { .. })).unwrap();
        match &exec.kind {
            ArtifactKind::Execution { step_results, status } => {
                assert_eq!(*status, ExecStatus::Completed);
                assert_eq!(step_results.len(), 1);
                assert_eq!(step_results[0].output.as_deref(), Some("执行完毕的成稿"));
            }
            _ => panic!("应为 Execution 物"),
        }
    }

    #[test]
    fn b_rail_trace_bridge_dispatches_kernel_trace_events() {
        // 收集器 + 订阅到广播器
        let collected: Arc<tokio::sync::Mutex<Vec<OrchestratorEvent>>> = Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let collector = TraceCollect { events: Arc::clone(&collected) };
        let broadcaster = Arc::new(tokio::sync::RwLock::new(EventBroadcaster::new()));
        {
            let mut b = broadcaster.try_write().unwrap();
            b.subscribe(Arc::new(collector));
        }
        let bridge = BRailTraceBridge { target: broadcaster, run_id: "r-1".into() };

        // 阶段进入 → TracePhaseEntered
        bridge.on_phase("plan_execute", "plan", None, "生成执行计划");
        // 阶段结果 → TracePhaseResult（Success + 摘要）
        bridge.on_phase("plan_execute", "plan", Some(b_rail::PhaseStatus::Success), "生成 2 个步骤");

        let events = collected.try_lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        match &events[0] {
            OrchestratorEvent::TracePhaseEntered { run_id, phase, .. } => {
                assert_eq!(run_id, "r-1");
                assert_eq!(phase, "plan");
            }
            _ => panic!("应为 TracePhaseEntered"),
        }
        match &events[1] {
            OrchestratorEvent::TracePhaseResult { run_id, phase, status, summary, .. } => {
                assert_eq!(run_id, "r-1");
                assert_eq!(phase, "plan");
                assert_eq!(*status, TracePhaseStatus::Success);
                assert_eq!(summary, "生成 2 个步骤");
            }
            _ => panic!("应为 TracePhaseResult"),
        }
    }

    /// 事件收集器（BRailTraceBridge 断言用）
    struct TraceCollect {
        events: Arc<tokio::sync::Mutex<Vec<OrchestratorEvent>>>,
    }

    impl EventListener for TraceCollect {
        fn on_event(&self, event: &OrchestratorEvent) {
            self.events.try_lock().unwrap().push(event.clone());
        }
    }

    // ═══ 2026-09-02 B 轨步骤工具化：BusToolHandle 桥接 ToolBus + 事件广播 ═══

    // invoke 是 b_rail::ToolHandle trait 方法——比 impl 声明晚的模块内方法调用需 trait 在作用域
    use agent_patterns::orchestrator::ToolHandle as _;

    /// 测试用固定工具（回显参数），避免依赖外部工具注册面
    struct FixedEchoTool;
    #[async_trait::async_trait]
    impl Tool for FixedEchoTool {
        fn name(&self) -> &str {
            "echo"
        }
        fn description(&self) -> &str {
            "回显（测试用）"
        }
        fn parameters(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object" })
        }
        async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, agent_runtime::ToolError> {
            Ok(args)
        }
    }

    /// BusToolHandle 工具总线桥：成功路径广播 ToolCallStart/End（前端归入计划步骤）
    #[tokio::test]
    async fn bus_tool_handle_success_broadcasts_call_events() {
        // 注册一个真实工具（echo 测试工具），走完整 ToolBus 执行
        let bus = Arc::new(SimpleToolBus::new());
        bus.register(Arc::new(FixedEchoTool)).await;

        let collected: Arc<tokio::sync::Mutex<Vec<OrchestratorEvent>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let collector = TraceCollect { events: Arc::clone(&collected) };
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        {
            let mut b = broadcaster.try_write().unwrap();
            b.subscribe(Arc::new(collector));
        }
        let handle = BusToolHandle {
            bus,
            ctx: agent_runtime::ToolContext::default(),
            broadcaster,
        };
        let call = b_rail::ToolCall::new("c1", "echo", serde_json::json!({ "message": "hi" }));
        let obs = handle.invoke(&call).await.unwrap();
        assert!(obs.ok, "echo 工具成功");

        let events = collected.try_lock().unwrap().clone();
        assert_eq!(events.len(), 2, "应广播 ToolCallStart + ToolCallEnd");
        match &events[0] {
            OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallStart {
                tool_call_id,
                name,
                ..
            }) => {
                assert_eq!(tool_call_id, "c1");
                assert_eq!(name, "echo");
            }
            _ => panic!("首事件应为 ToolCallStart"),
        }
        match &events[1] {
            OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallEnd {
                tool_call_id,
                status,
                ..
            }) => {
                assert_eq!(tool_call_id, "c1");
                assert_eq!(status, "success");
            }
            _ => panic!("次事件应为 ToolCallEnd"),
        }
    }

    /// BusToolHandle 失败路径：广播 failed 状态，观察非 ok
    #[tokio::test]
    async fn bus_tool_handle_failure_broadcasts_failed() {
        let bus = Arc::new(SimpleToolBus::new()); // 未注册 echo → 工具不存在
        let collected: Arc<tokio::sync::Mutex<Vec<OrchestratorEvent>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let collector = TraceCollect { events: Arc::clone(&collected) };
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        {
            let mut b = broadcaster.try_write().unwrap();
            b.subscribe(Arc::new(collector));
        }
        let handle = BusToolHandle {
            bus,
            ctx: agent_runtime::ToolContext::default(),
            broadcaster,
        };
        let call = b_rail::ToolCall::new("c1", "echo", serde_json::json!({}));
        let obs = handle.invoke(&call).await.unwrap();
        assert!(!obs.ok, "工具不存在应失败");

        let events = collected.try_lock().unwrap().clone();
        assert_eq!(events.len(), 2);
        match &events[1] {
            OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallEnd {
                status,
                error,
                ..
            }) => {
                assert_eq!(status, "failed");
                assert!(error.is_some(), "失败应携带错误摘要");
            }
            _ => panic!("次事件应为 ToolCallEnd(failed)"),
        }
    }

    // ═══ S2 双跑对齐：归一化口径 ═══

    #[test]
    fn normalize_trace_sequence_filters_by_run_and_shapes() {
        let events = vec![
            OrchestratorEvent::TracePipeStarted { run_id: "r1".into(), pipeline: "quick-plan".into(), reason: None },
            OrchestratorEvent::TracePhaseEntered { run_id: "r1".into(), phase: "plan".into(), reason: None },
            OrchestratorEvent::TracePhaseResult { run_id: "r1".into(), phase: "plan".into(), status: TracePhaseStatus::Success, summary: "2 步".into(), artifact_id: None },
            OrchestratorEvent::TracePhaseEntered { run_id: "r2".into(), phase: "plan".into(), reason: None },
            OrchestratorEvent::TracePhaseResult { run_id: "r1".into(), phase: "execute".into(), status: TracePhaseStatus::Success, summary: "ok".into(), artifact_id: None },
            OrchestratorEvent::TracePipeFinished { run_id: "r1".into(), status: OrchestratorEndStatus::Completed, reason: Some(ConvergeReason::GoalReached), final_message: Some("结论".into()) },
            OrchestratorEvent::TracePipeFinished { run_id: "r2".into(), status: OrchestratorEndStatus::Completed, reason: None, final_message: None },
        ];
        // r1：完整五元序列 + 事件族降维 + 带状态
        let seq = normalize_trace_sequence(&events, "r1");
        assert_eq!(
            seq,
            vec![
                "pipe_started".to_string(),
                "enter:plan".to_string(),
                "result:plan:Success".to_string(),
                "result:execute:Success".to_string(),
                "pipe_finished".to_string(),
            ]
        );
        // r2：仅自身事件（与 r1 隔离）
        let seq_r2 = normalize_trace_sequence(&events, "r2");
        assert_eq!(seq_r2, vec!["enter:plan".to_string(), "pipe_finished".to_string()]);
    }

    #[test]
    fn normalize_trace_sequence_folds_repeated_phase() {
        // S2 骨架形状对齐（2026-09-01 用户拍板）：execute 重复进入/退出（LLM 拆多步）
        // 折叠为首次 enter + 末次 result，A/B 只比对管线骨架而非步骤轮次。
        let events = vec![
            OrchestratorEvent::TracePipeStarted { run_id: "r1".into(), pipeline: "quick-plan".into(), reason: None },
            OrchestratorEvent::TracePhaseEntered { run_id: "r1".into(), phase: "plan".into(), reason: None },
            OrchestratorEvent::TracePhaseResult { run_id: "r1".into(), phase: "plan".into(), status: TracePhaseStatus::Success, summary: "2 步".into(), artifact_id: None },
            OrchestratorEvent::TracePhaseEntered { run_id: "r1".into(), phase: "execute".into(), reason: None },
            OrchestratorEvent::TracePhaseResult { run_id: "r1".into(), phase: "execute".into(), status: TracePhaseStatus::Success, summary: "步1".into(), artifact_id: None },
            // 第二轮的 execute enter/result（应被折叠：enter 不再重复，result 取末次）
            OrchestratorEvent::TracePhaseEntered { run_id: "r1".into(), phase: "execute".into(), reason: None },
            OrchestratorEvent::TracePhaseResult { run_id: "r1".into(), phase: "execute".into(), status: TracePhaseStatus::Success, summary: "步2".into(), artifact_id: None },
            OrchestratorEvent::TracePipeFinished { run_id: "r1".into(), status: OrchestratorEndStatus::Completed, reason: Some(ConvergeReason::GoalReached), final_message: Some("结论".into()) },
        ];
        let seq = normalize_trace_sequence(&events, "r1");
        assert_eq!(
            seq,
            vec![
                "pipe_started".to_string(),
                "enter:plan".to_string(),
                "result:plan:Success".to_string(),
                "enter:execute".to_string(),
                "result:execute:Success".to_string(),
                "pipe_finished".to_string(),
            ],
            "重复 execute phase 应折叠为骨架（首次 enter + 末次 result）"
        );
    }

    #[test]
    fn artifact_kind_names_lists_in_order() {
        let artifacts = vec![
            HandoverArtifact {
                artifact_id: "a".into(),
                run_id: "r".into(),
                from_node: "plan".into(),
                kind: ArtifactKind::Plan(vec![]),
                summary: "".into(),
                produced_at: 0,
            },
            HandoverArtifact {
                artifact_id: "b".into(),
                run_id: "r".into(),
                from_node: "exec".into(),
                kind: ArtifactKind::Execution { step_results: vec![], status: ExecStatus::Completed },
                summary: "".into(),
                produced_at: 0,
            },
            HandoverArtifact {
                artifact_id: "c".into(),
                run_id: "r".into(),
                from_node: "explore".into(),
                kind: ArtifactKind::Exploration { best_path: "p".into(), score: 80, explored: 3, term_reason: "t".into() },
                summary: "".into(),
                produced_at: 0,
            },
        ];
        assert_eq!(
            artifact_kind_names(&artifacts),
            vec!["Plan".to_string(), "Execution".to_string(), "Exploration".to_string()]
        );
    }
