// ─── 单元测试 ────────────────────────────────────────────

    use super::*;
    use agent_runtime::agent::prompt_sections::PromptSection;
    // S1 适配层：Bring RunObserver trait 进作用域以调用桥上方法
    use agent_patterns::orchestrator::RunObserver;

    fn cloud_config(api_key: &str) -> RuntimeProviderConfig {
        RuntimeProviderConfig::Cloud {
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            api_key: api_key.into(),
        }
    }

    /// W1（2026-09-18 工作区与环境对齐 dsh）：workdir / workspace root 现为**规范化形态**
    /// （canonicalize + 去 verbatim 前缀 + 分隔符统一 `/`）——断言期望值一律经此换算
    fn norm_path(p: &std::path::Path) -> String {
        crate::workspace_path::normalize_workdir(&p.to_string_lossy())
    }

    #[tokio::test]
    async fn scene_sovereignty_global_mode_forces_scene_root() {
        // 场景根主权（2026-09-10 领地判据）：workdir 落在 scenes_root 领地内（残留的其它
        // 场景根）= 场景模式 → 强制归本场景根；projectId 有无不影响判定
        let tmp = std::env::temp_dir().join(format!("ws-sovereignty-g-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let svc = AgentCommandService::new().with_scenes_root(Some(tmp.clone()));
        let stale = tmp.join("novel"); // 前端残留的上一个场景根
        std::fs::create_dir_all(&stale).unwrap();
        let info = svc
            .new_session(
                None,
                vec![],
                None,
                Some("coding".into()),
                Some(stale.clone()),
                None,
                Some("p1".into()), // 弱锚点恒非空也不影响
            )
            .await
            .unwrap();
        let expected = tmp.join("coding");
        assert_eq!(
            info.workdir.as_deref(),
            Some(norm_path(&expected).as_str()),
            "领地内残留 workdir 应强制为 scenes_root/<hint>"
        );
        // 领地外目录（未配置场景根时）不强制：scenes_root=None 路径维持原值
        let svc2 = AgentCommandService::new();
        let info2 = svc2
            .new_session(
                None,
                vec![],
                None,
                Some("coding".into()),
                Some(std::path::PathBuf::from("D:/elsewhere")),
                None,
                None,
            )
            .await
            .unwrap();
        assert_eq!(info2.workdir.as_deref(), Some("D:/elsewhere"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn scene_sovereignty_crossover_self_heals() {
        // 实测数据链异常回归（2026-09-10）：novel 会话携带残留 coding 场景根 + projectId
        // 恒非空 → 应被领地判定矫正回 scenes_root/novel（而非跨场景落根）
        let tmp = std::env::temp_dir().join(format!("ws-sovereignty-x-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let svc = AgentCommandService::new().with_scenes_root(Some(tmp.clone()));
        let stale_coding = tmp.join("coding");
        std::fs::create_dir_all(&stale_coding).unwrap();
        let info = svc
            .new_session(
                None,
                vec![],
                None,
                Some("novel".into()),
                Some(stale_coding.clone()),
                None,
                Some("290f0bae".into()), // 实测：前端弱锚点恒非空
            )
            .await
            .unwrap();
        let expected = tmp.join("novel");
        assert_eq!(
            info.workdir.as_deref(),
            Some(norm_path(&expected).as_str()),
            "novel 会话应自愈回 novel 场景根，而非落在 coding 根"
        );
        assert_eq!(info.scene_id.as_deref(), Some("novel"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn scene_sovereignty_project_mode_keeps_workdir() {
        // 场景根主权（2026-09-10 拍板）：项目模式 → 保留用户项目目录（领地外），不被场景根
        // 覆盖；工作区身份按（目录×场景）在 workspaces 复合去重（方案A）
        let tmp = std::env::temp_dir().join(format!("ws-sovereignty-p-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let scenes_root = tmp.join("scenes"); // 场景领地与项目目录分离（真实布局）
        std::fs::create_dir_all(&scenes_root).unwrap();
        let svc = AgentCommandService::new().with_scenes_root(Some(scenes_root));
        let project = tmp.join("my-project");
        std::fs::create_dir_all(&project).unwrap();
        let info = svc
            .new_session(
                None,
                vec![],
                None,
                Some("coding".into()),
                Some(project.clone()),
                None,
                Some("p1".into()),
            )
            .await
            .unwrap();
        assert_eq!(
            info.workdir.as_deref(),
            Some(norm_path(&project).as_str()),
            "项目模式应保留传入项目目录，不被场景根覆盖"
        );
        assert_eq!(info.scene_id.as_deref(), Some("coding"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn update_workdir_rejects_other_scene_root_but_allows_project() {
        // update_session_workdir 新规则（2026-09-10 拍板）：只拦「其它场景根」内目录；
        // 本场景根、项目目录放行（项目目录×场景=新项目目录，同目录跨场景可开）
        let tmp = std::env::temp_dir().join(format!("ws-sovereignty-w-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let svc = AgentCommandService::new().with_scenes_root(Some(tmp.clone()));
        let project = tmp.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        let info = svc
            .new_session(
                None,
                vec![],
                None,
                Some("coding".into()),
                Some(project.clone()),
                None,
                Some("p1".into()),
            )
            .await
            .unwrap();
        // ① 切到其它场景根（novel）→ 拒绝
        let novel_root = tmp.join("novel");
        std::fs::create_dir_all(&novel_root).unwrap();
        let err = svc
            .update_session_workdir(&info.id, Some(novel_root.to_string_lossy().to_string()))
            .await;
        assert!(err.is_err(), "切到其它场景根应被拒绝");
        // ② 切到本场景根子目录 → 放行
        let coding_sub = tmp.join("coding").join("sub");
        std::fs::create_dir_all(&coding_sub).unwrap();
        svc.update_session_workdir(&info.id, Some(coding_sub.to_string_lossy().to_string()))
            .await
            .unwrap();
        // ③ 切回项目目录 → 放行
        svc.update_session_workdir(&info.id, Some(project.to_string_lossy().to_string()))
            .await
            .unwrap();
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn update_session_workdir_syncs_workspace_id() {
        // 断链修复回归（2026-09-10）：切目录必须同步 workspace_id（ensure_workspace 新实体，
        // 按 root×scene 复合去重），否则重启恢复（restore_sessions 优先 workspace_id→root）
        // 会回退旧目录；切 None（不限定）应把 workdir 与 workspace_id 一并清空
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let dir_a = std::env::temp_dir().join(format!("ws-sync-a-{}", uuid::Uuid::new_v4()));
        let dir_b = std::env::temp_dir().join(format!("ws-sync-b-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::create_dir_all(&dir_b).unwrap();
        let info = svc
            .new_session(None, vec![], None, None, Some(dir_a.clone()), None, None)
            .await
            .unwrap();
        // ① 初始：new_session 已为 dir_a 实体化，workspace_id 指向 a 实体
        let sessions = store.load_sessions().await.unwrap();
        let s0 = sessions.iter().find(|x| x.id == info.id).unwrap();
        let ws_list0 = store.list_workspaces().await.unwrap();
        let ws_a = ws_list0
            .iter()
            .find(|w| w.root == norm_path(&dir_a))
            .expect("dir_a 应有 Workspace 实体");
        assert_eq!(s0.workspace_id.as_deref(), Some(ws_a.id.as_str()));
        // ② 切到 dir_b：workdir 与 workspace_id 应同步指向 b 的新实体（不残留 a）
        svc.update_session_workdir(&info.id, Some(dir_b.to_string_lossy().to_string()))
            .await
            .unwrap();
        let sessions = store.load_sessions().await.unwrap();
        let s1 = sessions.iter().find(|x| x.id == info.id).unwrap();
        assert_eq!(
            s1.workdir.as_deref(),
            Some(norm_path(&dir_b).as_str()),
            "切目录后 workdir 应落库"
        );
        let ws_b = store
            .list_workspaces()
            .await
            .unwrap()
            .into_iter()
            .find(|w| w.root == norm_path(&dir_b))
            .expect("dir_b 应新建 Workspace 实体");
        assert_ne!(ws_b.id, ws_a.id, "不同目录应为不同 Workspace 实体");
        assert_eq!(
            s1.workspace_id.as_deref(),
            Some(ws_b.id.as_str()),
            "切目录后 workspace_id 应同步新实体（断链修复点）"
        );
        // ③ 切 None：workdir 与 workspace_id 一并清空
        svc.update_session_workdir(&info.id, None).await.unwrap();
        let s2 = store
            .load_sessions()
            .await
            .unwrap()
            .into_iter()
            .find(|x| x.id == info.id)
            .unwrap();
        assert!(
            s2.workdir.is_none() && s2.workspace_id.is_none(),
            "切 None 应清空目录绑定（两参同步）"
        );
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    /// W1（2026-09-18 工作区与环境对齐 dsh）：路径身份规范化——
    /// 同目录不同写法（尾分隔符 / `.`）不得分裂出第二条 Workspace 实体
    #[tokio::test]
    async fn workdir_variants_share_one_workspace_entity() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let dir = std::env::temp_dir().join(format!("ws-norm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let variant_trailing = format!("{}{}", dir.to_string_lossy(), std::path::MAIN_SEPARATOR);
        let variant_dot = dir.join(".").to_string_lossy().to_string();
        let info_a = svc
            .new_session(None, vec![], None, None, Some(dir.clone()), None, None)
            .await
            .unwrap();
        let info_b = svc
            .new_session(
                None,
                vec![],
                None,
                None,
                Some(PathBuf::from(&variant_trailing)),
                None,
                None,
            )
            .await
            .unwrap();
        let info_c = svc
            .new_session(
                None,
                vec![],
                None,
                None,
                Some(PathBuf::from(&variant_dot)),
                None,
                None,
            )
            .await
            .unwrap();
        let sessions = store.load_sessions().await.unwrap();
        let ws_of = |id: &str| {
            sessions
                .iter()
                .find(|s| s.id == id)
                .and_then(|s| s.workspace_id.clone())
        };
        let (a, b, c) = (ws_of(&info_a.id), ws_of(&info_b.id), ws_of(&info_c.id));
        assert!(
            a.is_some() && a == b && b == c,
            "三种写法应共享同一 workspace_id: {a:?} / {b:?} / {c:?}"
        );
        let workspaces = store.list_workspaces().await.unwrap();
        assert_eq!(
            workspaces.len(),
            1,
            "同目录不同写法应只有一条 Workspace 实体: {workspaces:?}"
        );
        // 写穿 workdir 亦为规范化形态（前端分组 / 恢复同源）
        let s0 = sessions.iter().find(|s| s.id == info_a.id).unwrap();
        assert_eq!(s0.workdir.as_deref(), Some(norm_path(&dir).as_str()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// W2②（2026-09-18 工作区与环境对齐 dsh）：`workdir` 列 = 派生缓存——
    /// 与实体 root 漂移时（老数据 / 手工改库），启动恢复以实体为准并**写穿矫正**
    #[tokio::test]
    async fn restore_corrects_workdir_cache_from_entity() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let dir_a = std::env::temp_dir().join(format!("ws-cache-a-{}", uuid::Uuid::new_v4()));
        let dir_b = std::env::temp_dir().join(format!("ws-cache-b-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir_a).unwrap();
        std::fs::create_dir_all(&dir_b).unwrap();
        let info = svc
            .new_session(None, vec![], None, None, Some(dir_a.clone()), None, None)
            .await
            .unwrap();
        // 防 purge 误清：加一条历史消息（与 restore 其它用例同法）
        store
            .replace_messages(
                &info.id,
                &[agent_runtime::types::OrchestratorMessage {
                    role: agent_runtime::types::MessageRole::User,
                    content: "历史消息".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                }],
            )
            .await
            .unwrap();
        // 制造漂移：缓存列留在 A，workspace_id 指向 B 实体
        let ws_b = svc
            .ensure_workspace(&dir_b.to_string_lossy(), "b", None)
            .await
            .unwrap();
        store
            .update_workdir(&info.id, Some(&dir_a.to_string_lossy()), Some(&ws_b.id))
            .await
            .unwrap();
        // 启动恢复：实体权威值覆盖缓存列
        let restored = svc.restore_sessions().await.unwrap();
        let r = restored.iter().find(|s| s.id == info.id).unwrap();
        assert_eq!(
            r.workdir.as_deref(),
            Some(norm_path(&dir_b).as_str()),
            "恢复读路径应以实体 root 为准"
        );
        // 写穿：DB 缓存列已矫正（下次启动不再依赖内存矫正）
        let in_db = store
            .load_sessions()
            .await
            .unwrap()
            .into_iter()
            .find(|s| s.id == info.id)
            .unwrap();
        assert_eq!(
            in_db.workdir.as_deref(),
            Some(norm_path(&dir_b).as_str()),
            "漂移应写穿矫正"
        );
        assert_eq!(in_db.workspace_id.as_deref(), Some(ws_b.id.as_str()));
        let _ = std::fs::remove_dir_all(&dir_a);
        let _ = std::fs::remove_dir_all(&dir_b);
    }

    #[tokio::test]
    async fn restore_sessions_self_heals_cross_scene_workdir() {
        // 恢复链路主权自愈（2026-09-10 症状③）：历史脏数据（novel 会话 workdir=coding
        // 场景根，第三轮修正前落库形态）恢复时矫正回本场景根，并实体化两参写穿
        //（workspace_id 换绑新根实体），下次重启不再反复回退；有消息会话不被 purge 误清
        let tmp = std::env::temp_dir().join(format!("ws-restore-heal-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let coding_root = tmp.join("coding");
        std::fs::create_dir_all(&coding_root).unwrap();
        let dirty = SessionRecord {
            id: "dirty-novel".into(),
            system_prompt: String::new(),
            prompt_sections: None,
            created_at: 100,
            message_count: 1,
            updated_at: 100,
            title: "脏会话".into(),
            pinned: false,
            kind: SessionKind::Chat,
            workdir: Some(coding_root.to_string_lossy().to_string()),
            workspace_id: None,
            project_id: None,
            scene_id: Some("novel".into()),
        };
        store.save_session(&dirty).await.unwrap();
        // 加一条消息：模拟真实有内容的错位会话（同时防 purge 误清）
        store
            .replace_messages(
                "dirty-novel",
                &[agent_runtime::types::OrchestratorMessage {
                    role: agent_runtime::types::MessageRole::User,
                    content: "历史消息".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                }],
            )
            .await
            .unwrap();

        let svc = AgentCommandService::new()
            .with_scenes_root(Some(tmp.clone()))
            .with_session_store(store.clone());
        let restored = svc.restore_sessions().await.unwrap();
        assert_eq!(restored.len(), 1, "有消息脏会话应恢复（不被清理）");
        let novel_root = tmp.join("novel");
        assert_eq!(
            restored[0].workdir.as_deref(),
            Some(norm_path(&novel_root).as_str()),
            "恢复时应自愈回 novel 场景根"
        );
        // 写穿验证：DB 中 workdir 已矫正
        let in_db = store
            .load_sessions()
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.id == "dirty-novel")
            .unwrap();
        assert_eq!(
            in_db.workdir.as_deref(),
            Some(norm_path(&novel_root).as_str()),
            "自愈结果应落库（下次重启不再回退）"
        );
        // 实体化验证：novel 根新建 Workspace 实体且 workspace_id 换绑
        let novel_root_str = norm_path(&novel_root);
        let ws = store
            .list_workspaces()
            .await
            .unwrap()
            .into_iter()
            .find(|w| w.root == novel_root_str)
            .expect("novel 根应实体化");
        assert_eq!(
            in_db.workspace_id.as_deref(),
            Some(ws.id.as_str()),
            "workspace_id 应换绑新根实体"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[tokio::test]
    async fn restore_recovers_uncommitted_fork_residue() {
        // S3-c 装载期冷修复：上次进程中断遗留的 fork 残留（mark 未清）——半成品子会话
        // 必须由装载期撤销。注入点选「子会话已写视图但未记来源」：空会话清理不命中
        //（有活跃视图），只有分支残留收敛可回收 → 断言区分两条路径。
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let parent = SessionRecord {
            id: "p".into(),
            system_prompt: String::new(),
            prompt_sections: None,
            created_at: 100,
            message_count: 1,
            updated_at: 100,
            title: "父会话".into(),
            pinned: false,
            kind: SessionKind::Chat,
            workdir: None,
            workspace_id: None,
            project_id: None,
            scene_id: None,
        };
        store.save_session(&parent).await.unwrap();
        let msg = |content: &str| agent_runtime::types::OrchestratorMessage {
            role: agent_runtime::types::MessageRole::User,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        store.replace_messages("p", &[msg("历史消息")]).await.unwrap();
        // 崩溃点注入：分叉中途——mark 已落、子会话行 + 视图已写、来源记录未写、mark 未清
        let payload =
            serde_json::json!({"child_session_id": "half-child", "request_seq": 0}).to_string();
        store.begin_branch_op("fork", "p", Some(&payload)).await.unwrap();
        let half = SessionRecord { id: "half-child".into(), ..parent };
        store.save_session(&half).await.unwrap();
        store.replace_messages("half-child", &[msg("半成品")]).await.unwrap();

        let svc = AgentCommandService::new().with_session_store(store.clone());
        let restored = svc.restore_sessions().await.unwrap();
        assert_eq!(restored.len(), 1, "半成品子会话不应被重建为内存会话");
        assert_eq!(restored[0].id, "p");
        assert!(
            store.load_sessions().await.unwrap().iter().all(|s| s.id != "half-child"),
            "半成品子会话应从库中撤销"
        );
        let marks: i64 = sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM session_branch_ops")
            .fetch_one(&store.pool)
            .await
            .unwrap()
            .0;
        assert_eq!(marks, 0, "残留 mark 应清空");
    }

    #[tokio::test]
    async fn generate_session_title_falls_back_to_first_message() {
        // 标题兜底（2026-09-10 症状②）：LLM 生成失败（无 key → 两次重试均 Err）不再留
        // 「新会话」占位，改用首条消息截断写穿——运行期前端兜底与持久化一致，重启不回退
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc
            .new_session(None, vec![], None, None, None, None, None)
            .await
            .unwrap();
        let first = "一个倒数手法，该如何写比较好？请给出具体思路和示例。";
        let title = svc
            .generate_session_title(&info.id, first, "好的，我们来看…")
            .await
            .unwrap();
        assert_eq!(
            title,
            truncate_chars(first.trim(), 24),
            "LLM 失败应兜底为首条消息截断标题"
        );
        assert_ne!(title, "新会话", "兜底标题不得为占位值");
        // 落库 + meta 同步验证（重启恢复读此值）
        let in_db = store
            .load_sessions()
            .await
            .unwrap()
            .into_iter()
            .find(|r| r.id == info.id)
            .unwrap();
        assert_eq!(in_db.title, title, "兜底标题应写穿持久化");
        let listed = svc
            .list_sessions(Some(SessionKind::Chat))
            .await
            .unwrap()
            .into_iter()
            .find(|s| s.id == info.id)
            .unwrap();
        assert_eq!(listed.title, title, "内存 meta 应同步兜底标题");
    }

    #[tokio::test]
    async fn new_session_and_provider_config_roundtrip() {
        let svc = AgentCommandService::new();
        let info = svc
            .new_session(Some("测试助手".into()), vec![], Some(cloud_config("sk-test")), None, None, None, None)
            .await
            .unwrap();
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        // 回显真实配置（provider / model），而非 mock 占位
        assert_eq!(cfg.provider, "deepseek");
        assert_eq!(cfg.model, "deepseek-v4-flash");
        assert!(cfg.base_url.is_some());
    }

    /// A4 双端收口：结构化段建会话双列落库；动态刷新双列写穿
    #[tokio::test]
    async fn prompt_sections_persist_and_update_roundtrip() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());

        let info = svc
            .new_session(
                None,
                vec![
                    PromptSection::new("worldsea", 200, "系统说明"),
                    PromptSection::new("skill_index", 270, "技能索引"),
                ],
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        // 建会话写穿：段 JSON + 静态合集缓存文本（段组装产物）
        let records = store.load_sessions().await.unwrap();
        let rec = records.iter().find(|r| r.id == info.id).unwrap();
        assert!(
            rec.prompt_sections.as_deref().unwrap().contains("worldsea"),
            "段 JSON 应落库"
        );
        assert_eq!(rec.system_prompt, "系统说明\n\n技能索引");

        // 动态刷新（模拟规则/技能变更）：新段双列写穿
        svc.update_session_prompt_sections(
            &info.id,
            vec![PromptSection::new("worldsea", 200, "系统说明 v2")],
        )
        .await
        .unwrap();
        let records = store.load_sessions().await.unwrap();
        let rec = records.iter().find(|r| r.id == info.id).unwrap();
        assert_eq!(rec.system_prompt, "系统说明 v2");
        assert!(
            rec.prompt_sections.as_deref().unwrap().contains("系统说明 v2"),
            "刷新后段 JSON 应更新"
        );
    }

    /// 手动 /compact 写穿（05-§2.3 缺口 1）：压缩改写的活跃视图同步落库
    #[tokio::test]
    async fn compact_context_persists_compacted_view() {
        use agent_runtime::types::{MessageRole, OrchestratorMessage};

        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc
            .new_session(Some("系统".into()), vec![], None, None, None, None, None)
            .await
            .unwrap();

        // 造可裁内容：默认保留策略 keep_recent=12，推 20 轮 + 最新指令（受保护）
        let agent = svc.get_agent(&info.id).await.unwrap();
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..20 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}"),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        msgs.push(OrchestratorMessage {
            role: MessageRole::User,
            content: "最新指令：继续推进".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        agent.append_messages(msgs).await;
        let before_len = agent.get_messages().await.len();

        let outcome = svc.compact_context(&info.id).await.expect("手动压缩应成功");
        assert!(
            outcome.mode == "dropped" || outcome.mode == "folded",
            "应发生实际压缩，实际模式: {}",
            outcome.mode
        );
        let after_len = agent.get_messages().await.len();
        assert!(after_len < before_len, "压缩后内存视图应减少");

        // 写穿验证：store 活跃视图与内存一致（重启恢复不回退旧视图）
        let persisted = store.load_messages(&info.id).await.unwrap();
        assert_eq!(
            persisted.len(),
            after_len,
            "压缩后的活跃视图应已落库（05-§2.3 缺口 1）"
        );
        assert!(persisted.iter().any(|m| m.content.contains("最新指令")));
    }

    #[tokio::test]
    async fn new_session_with_entity_storage_root_ok() {
        // 方案A（2026-09-03）：显式实体存储根（默认项目 worlddata 语义）建会话不报错，
        // 且 workdir（Agent 工作区根）与会话归属保持独立——实体根不污染会话工作区字段。
        let svc = AgentCommandService::new();
        let info = svc
            .new_session(
                Some("测试".into()),
                vec![],
                None,
                None,
                Some(std::path::PathBuf::from("C:\\ws\\agent")),
                Some(std::path::PathBuf::from("C:\\ws\\worlddata")),
                None,
            )
            .await
            .unwrap();
        // W1：workdir 现为规范化形态（分隔符统一 `/`；`C:\ws\agent` 不存在 → 词法分支）
        assert_eq!(info.workdir.as_deref(), Some("C:/ws/agent"));
        // 会话可正常查询（Provider 为默认占位回显）
        let cfg = svc.get_provider_config(&info.id).await.unwrap();
        assert_eq!(cfg.provider, "deepseek");
    }

    #[tokio::test]
    async fn send_message_without_api_key_fails() {
        let svc = AgentCommandService::new();
        // 空 API Key 的 Cloud 配置 → 发送消息应报 Auth 错误（而非回显 mock）
        let info = svc
            .new_session(Some("测试助手".into()), vec![], Some(cloud_config("")), None, None, None, None)
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
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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

    /// S5-b：统一回传口——内核侧值 / 未知值拒绝回传（fail-closed：不唤醒等待方）
    #[tokio::test]
    async fn resolve_interaction_rejects_kernel_side_values() {
        use agent_runtime::confirmation::InteractionResponse;
        let svc = AgentCommandService::new();
        // 内核侧值（timeout / timed_out）与未知值不接受前端回传 → InvalidArgument
        for resp in [
            InteractionResponse::Permission {
                outcome: "timeout".into(),
            },
            InteractionResponse::HookReview {
                outcome: "timed_out".into(),
            },
            InteractionResponse::Permission {
                outcome: "yes".into(),
            },
        ] {
            let err = svc
                .resolve_interaction("nope", "ix-1", resp)
                .await
                .unwrap_err();
            assert!(matches!(err, CommandError::InvalidArgument(_)), "{err:?}");
        }
        // 合法回传 + 会话存在 + id 未知 → 唤醒失败（false，不报错）
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        let woke = svc
            .resolve_interaction(
                &info.id,
                "ix-missing",
                InteractionResponse::UserInput { answers: None },
            )
            .await
            .unwrap();
        assert!(!woke, "未知 id 不应唤醒");
        // 合法回传 + 会话不存在 → SessionNotFound
        let err = svc
            .resolve_interaction("nope", "ix-1", InteractionResponse::UserInput { answers: None })
            .await
            .unwrap_err();
        assert!(matches!(err, CommandError::SessionNotFound(_)), "{err:?}");
    }

    #[tokio::test]
    async fn list_and_delete_session() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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
        let s1 = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        let s2 = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        let removed = svc.clear_subagent_instance(&info.id, "coder").await.unwrap();
        assert!(!removed, "实例池中无该实例时清空应返回 false");
    }

    /// 删除会话后，其实例管理器也应随之移除（list 应报 session_not_found）
    #[tokio::test]
    async fn delete_session_removes_subagent_manager() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();

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
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
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

    /// 入口收敛后仅 /plan 命中（带空格、无空格紧贴、大小写均支持）
    #[test]
    fn is_plan_prefix_matches_plan_only() {
        assert!(is_plan_prefix("/plan 先调研再写"));
        assert!(is_plan_prefix("/plan先调研"), "无空格紧贴写法");
        assert!(is_plan_prefix("/PLAN 调研"), "大小写不敏感");
        // 已消除的模式前缀不再命中（指令层收敛，2026-09-09）
        assert!(!is_plan_prefix("/tot 难题"));
        assert!(!is_plan_prefix("/got 对比"));
        assert!(!is_plan_prefix("/supervisor 委派"));
        assert!(!is_plan_prefix("/multi 协作"));
    }

    /// 四管线前缀不被 /plan 前缀吞、普通文本不误判
    #[test]
    fn is_plan_prefix_ignores_pipeline_and_plain() {
        assert!(!is_plan_prefix("/调研 论文"), "四管线前缀归 force_pipeline");
        assert!(!is_plan_prefix("/写作 一章"));
        assert!(!is_plan_prefix("帮我写一封信"));
        assert!(!is_plan_prefix("plan 不是命令"), "裸词不命中，仅前置 / 前缀");
    }

    /// /plan 前缀无任务描述 → send_message 报错（不静默降级回 react）
    #[tokio::test]
    async fn send_message_mode_prefix_without_task_fails() {
        let svc = AgentCommandService::new();
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        let err = svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "/plan".into(),
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

    // ── M3-RK1：Supervisor 子 run 记账（2026-09-09 迁移：A 轨 RunStoreSubRunAccountant 删除，
    //    子 run 会计改由 SubAgentManager::delegate 内置 M3-1 承担，见 subagent.rs delegate）──

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

    impl Listener for TraceCollect {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            self.events.try_lock().unwrap().push(event.clone());
            ListenerOutcome::Continue
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

    /// A1 §6.2：折叠引用登记——折叠形外置坐标进入 `raw_ref`（context_anchor 侧）
    ///
    /// 只增不删：本批只验证「登记」与「幂等」；释放（release）留给甲3 接线。
    #[tokio::test]
    async fn fold_refs_are_registered_into_raw_ref() {
        use agent_memory::ext::ExtStore;
        use agent_runtime::anchor::{set_fold_meta, FoldMeta, FoldState};
        use agent_runtime::types::MessageRole;

        let dir = tempfile::tempdir().unwrap();
        let svc = AgentCommandService::default().with_memory_root(Some(dir.path().to_path_buf()));

        let hash = "abcdef0123456789";
        let plain = OrchestratorMessage {
            role: MessageRole::User,
            content: "普通消息".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        let mut folded = OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "折叠形（含锚点）".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        set_fold_meta(
            &mut folded,
            &FoldMeta {
                state: FoldState::Filled,
                raw: hash.into(),
                orig_bytes: 100,
                orig_count: 2,
                orig_tokens: 50,
            },
        );

        svc.register_fold_refs("sess-a", &[folded.clone(), plain.clone()])
            .await;

        // 登记生效：context_anchor 引用存在 → 不可 GC
        let store = ExtStore::open(dir.path().to_path_buf(), None).unwrap();
        assert_eq!(store.raw_ref_count(hash).await.unwrap(), 1);
        assert!(
            !store.is_gc_eligible(hash).await.unwrap(),
            "有上下文锚点引用 → 不可 GC"
        );

        // 幂等：重复登记不重复计数（主键 (hash, kind, owner) 去重）
        svc.register_fold_refs("sess-a", &[folded.clone(), plain.clone()])
            .await;
        assert_eq!(store.raw_ref_count(hash).await.unwrap(), 1);

        // 跨会话各记一条（owner_id = session_id 的粒度验证）
        svc.register_fold_refs("sess-b", &[folded, plain]).await;
        assert_eq!(
            store.raw_ref_count(hash).await.unwrap(),
            2,
            "两个会话各持一条上下文锚点引用"
        );

        // 无折叠消息 → 不产生新登记（零开销早退）
        let only_plain = vec![OrchestratorMessage {
            role: MessageRole::User,
            content: "无折叠".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        svc.register_fold_refs("sess-c", &only_plain).await;
        assert_eq!(
            store.raw_ref_count("0000000000000000").await.unwrap(),
            0,
            "无折叠消息不应产生任何登记"
        );
    }

    /// A1 §6.2：未配置 `memory_root`（无记忆环境）时登记静默跳过、不 panic
    #[tokio::test]
    async fn fold_refs_registration_skips_without_memory_root() {
        use agent_runtime::anchor::{set_fold_meta, FoldMeta, FoldState};

        let svc = AgentCommandService::default(); // memory_root = None
        let mut folded = OrchestratorMessage {
            role: agent_runtime::types::MessageRole::Assistant,
            content: "折叠形".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        };
        set_fold_meta(
            &mut folded,
            &FoldMeta {
                state: FoldState::Filled,
                raw: "abcdef0123456789".into(),
                orig_bytes: 10,
                orig_count: 1,
                orig_tokens: 5,
            },
        );
        // 无记忆根 → 不构造扩展库、不报错（登记是增强，不阻断）
        svc.register_fold_refs("sess-none", &[folded]).await;
    }

    /// A1 甲3：手动巡检入口在「无记忆根」时为无害空转；配了根则跑通一轮
    #[tokio::test]
    async fn memory_gc_entry_point_smoke() {
        // 无记忆根 → 空报告（不创建任何目录）
        let svc = AgentCommandService::default();
        let report = svc.run_memory_gc().await.unwrap();
        assert_eq!(report, agent_memory::evict::GcReport::default());

        // 有记忆根 → 一轮巡检跑通（空库无动作）
        let dir = tempfile::tempdir().unwrap();
        let svc = AgentCommandService::default().with_memory_root(Some(dir.path().to_path_buf()));
        let report = svc.run_memory_gc().await.unwrap();
        assert!(!report.did_something(), "空记忆根一轮巡检应无动作");
    }

    /// 丁3：project_id 贯通记忆访问器——会话的记忆三库落在对应项目分片
    ///
    /// 丁3 前 `build_memory_accessor` 硬编码 `None`，所有项目共用 `_default`；
    /// 本批起会话持久化的 `project_id` 一路贯通到三库（memories / ext / vec）分片。
    #[tokio::test]
    async fn new_session_memory_follows_project_shard() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let svc = AgentCommandService::default().with_memory_root(Some(root.clone()));

        // 项目 A 的会话 → 记忆落 projects/proj-alpha/
        let info = svc
            .new_session(None, vec![], None, None, None, None, Some("proj-alpha".into()))
            .await
            .unwrap();
        assert_eq!(info.project_id.as_deref(), Some("proj-alpha"));
        let shard_a = root.join("projects").join("proj-alpha");
        assert!(shard_a.join("memories.db").is_file(), "memories.db 应落项目分片");
        assert!(shard_a.join("memory_ext.db").is_file(), "扩展库应落同一分片");
        assert!(
            !root
                .join("projects")
                .join("_default")
                .join("memories.db")
                .exists(),
            "不得再落 _default（丁3 前所有项目共用该分片）"
        );

        // 项目 B → 独立分片（互不混淆）
        let _ = svc
            .new_session(None, vec![], None, None, None, None, Some("proj-beta".into()))
            .await
            .unwrap();
        assert!(
            root.join("projects").join("proj-beta").join("memories.db").is_file(),
            "另一项目应独立分片"
        );
    }

    // ─── 阶段 3 · A2 补齐②：压缩事务锁（括号事件 → 锁文件）────────────

    /// 压缩括号事件驱动锁文件落 / 解（Started 落锁；Finished·Failed 解锁；无关事件不动锁）
    #[test]
    fn compact_lock_listener_tracks_bracket_events() {
        let dir = tempfile::tempdir().unwrap();
        let store = agent_memory::raw_store::RawStore::open(dir.path()).unwrap();
        let listener = CompactLockListener {
            store: store.clone(),
            session_id: "sess-lock".into(),
        };

        // 左端：落锁（字段取自事件）
        let started = OrchestratorEvent::ContextCompactStarted {
            trigger: "auto".into(),
            before_tokens: 9_999,
            tier: 4,
        };
        assert_eq!(listener.call(&started), ListenerOutcome::Continue);
        let lock = store.read_compact_lock("sess-lock").expect("Started 应落锁");
        assert_eq!(lock.trigger, "auto");
        assert_eq!(lock.before_tokens, 9_999);
        assert_eq!(lock.pid, std::process::id(), "锁应记录落锁进程");

        // 右端：解锁（Finished）
        let finished = OrchestratorEvent::ContextCompactFinished {
            trigger: "auto".into(),
            mode: "folded".into(),
            before_tokens: 9_999,
            after_tokens: 5_000,
            saved_tokens: 4_999,
            folded_groups: 2,
            folded_messages: 4,
            dropped_messages: 0,
            skipped_protected_groups: 0,
            backfilled: 2,
        };
        assert_eq!(listener.call(&finished), ListenerOutcome::Continue);
        assert!(store.read_compact_lock("sess-lock").is_none(), "Finished 应解锁");

        // 异常右端同样解锁（Failed）
        let _ = listener.call(&started);
        assert!(store.read_compact_lock("sess-lock").is_some());
        let failed = OrchestratorEvent::ContextCompactFailed {
            trigger: "manual".into(),
            stage: "fold".into(),
            error: "boom".into(),
        };
        assert_eq!(listener.call(&failed), ListenerOutcome::Continue);
        assert!(store.read_compact_lock("sess-lock").is_none(), "Failed 应解锁");

        // 无关事件不触碰锁（锁保持到右端事件）
        let _ = listener.call(&started);
        let _ = listener.call(&OrchestratorEvent::Agent(
            agent_runtime::event::AgentEvent::AgentEnd,
        ));
        assert!(
            store.read_compact_lock("sess-lock").is_some(),
            "无关事件不应解锁"
        );
    }

    /// 装载期孤儿收敛：上次中断遗留的锁被检测（返回记录）并清理，幂等
    #[test]
    fn orphan_compact_lock_is_detected_and_cleared() {
        let dir = tempfile::tempdir().unwrap();
        let store = agent_memory::raw_store::RawStore::open(dir.path()).unwrap();
        // 模拟上次进程中断：手工留下一个锁文件
        let leftover = agent_memory::raw_store::CompactLock {
            session_id: "sess-orphan".into(),
            pid: 999_999,
            trigger: "auto".into(),
            before_tokens: 1,
            started_at_ms: 123,
        };
        let _ = store.acquire_compact_lock(&leftover).unwrap();

        let orphan =
            reconcile_orphan_compact_lock(&store, "sess-orphan").expect("应检出孤儿锁");
        assert_eq!(orphan.pid, 999_999, "返回记录应保留落锁进程供诊断");
        assert!(store.read_compact_lock("sess-orphan").is_none(), "检出后应清理");
        assert!(
            reconcile_orphan_compact_lock(&store, "sess-orphan").is_none(),
            "无锁时应为 None（幂等）"
        );
    }

    // ─── 阶段 3 · ④：请求快照 WAL（同步追加 + 异步落库 + 装载期补齐）────────────

    fn snap_session_record(id: &str) -> SessionRecord {
        SessionRecord {
            id: id.into(),
            system_prompt: "s".into(),
            prompt_sections: None,
            created_at: 1,
            message_count: 0,
            updated_at: 1,
            title: "快照测试".into(),
            pinned: false,
            kind: SessionKind::Chat,
            workdir: None,
            workspace_id: None,
            project_id: None,
            scene_id: None,
        }
    }

    fn sample_snapshot(
        captured_at_ms: u64,
        full: bool,
    ) -> agent_runtime::agent::request_snapshot::RequestSnapshot {
        use agent_runtime::agent::request_snapshot::{RequestSnapshot, ViewUpdate};
        use agent_runtime::types::{MessageRole, OrchestratorMessage};
        let messages = vec![OrchestratorMessage {
            role: MessageRole::User,
            content: format!("请求 {captured_at_ms}"),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        RequestSnapshot {
            captured_at_ms,
            purpose: "main".into(),
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            thinking_mode: None,
            thinking_level: None,
            silent: false,
            system_prompt: Some("系统提示".into()),
            tools_json: None,
            tools_names: Vec::new(),
            material_ref: None,
            view_update: if full {
                ViewUpdate::Full { messages }
            } else {
                ViewUpdate::Appended { messages }
            },
        }
    }

    /// 监听器同步追加 WAL 行；刷入落库后移除文件；重放幂等
    #[tokio::test]
    async fn snapshot_wal_listener_appends_and_flush_ingests() {
        use agent_runtime::event::OrchestratorEvent;

        let dir = tempfile::tempdir().unwrap();
        let store: Arc<dyn SessionRepository> =
            SqliteSessionRepository::new_in_memory().await.unwrap();
        store.save_session(&snap_session_record("s-wal")).await.unwrap();
        let path = request_snapshot::wal_path(dir.path(), "s-wal");
        let gate = Arc::new(request_snapshot::WalGate::new());
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let listener =
            request_snapshot::RequestSnapshotListener::new(path.clone(), tx, Arc::clone(&gate));

        // 同步追加两行（不经后台任务——验证回调自身的落盘行为）
        let _ = listener.call(&OrchestratorEvent::RequestSnapshotCaptured {
            snapshot: sample_snapshot(1_000, true),
        });
        let _ = listener.call(&OrchestratorEvent::RequestSnapshotCaptured {
            snapshot: sample_snapshot(1_001, false),
        });
        let lines = std::fs::read_to_string(&path).unwrap();
        assert_eq!(lines.lines().count(), 2, "两行应已同步落 WAL");

        // 装载期补齐（等价：直接刷入）
        request_snapshot::flush_wal(&store, "s-wal", &path, &gate).await;
        let records = store.load_request_snapshots("s-wal", 0, 10).await.unwrap();
        assert_eq!(records.len(), 2, "两行应已落库");
        assert!(!path.exists(), "刷入完成后 WAL 应被移除");

        // 重放（无文件）→ 幂等：不新增行、不报错
        request_snapshot::flush_wal(&store, "s-wal", &path, &gate).await;
        assert_eq!(
            store.load_request_snapshots("s-wal", 0, 10).await.unwrap().len(),
            2
        );
    }

    /// 装载期补齐：残留文件中的好行落库、坏行跳过、文件一并清除
    #[tokio::test]
    async fn snapshot_wal_recovery_skips_bad_lines() {
        let dir = tempfile::tempdir().unwrap();
        let store: Arc<dyn SessionRepository> =
            SqliteSessionRepository::new_in_memory().await.unwrap();
        store
            .save_session(&snap_session_record("s-recover"))
            .await
            .unwrap();
        let path = request_snapshot::wal_path(dir.path(), "s-recover");
        let good = serde_json::to_string(&sample_snapshot(2_000, true)).unwrap();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, format!("{good}\n这不是 JSON\n")).unwrap();

        let gate = Arc::new(request_snapshot::WalGate::new());
        request_snapshot::flush_wal(&store, "s-recover", &path, &gate).await;
        assert_eq!(
            store.load_request_snapshots("s-recover", 0, 10).await.unwrap().len(),
            1,
            "好行应落库（坏行跳过）"
        );
        assert!(!path.exists(), "补齐后文件应被移除");
    }

    /// 会话删除：WAL 文件清理幂等
    #[test]
    fn snapshot_wal_removed_with_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = request_snapshot::wal_path(dir.path(), "s-del");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "x\n").unwrap();
        request_snapshot::remove_wal_file(dir.path(), "s-del");
        assert!(!path.exists(), "文件应被清理");
        request_snapshot::remove_wal_file(dir.path(), "s-del"); // 幂等（不 panic）
    }

    /// S4-c：项目规则从工作区加载 / 重载（`{workdir}/.worldsea/permissions.json`）
    #[tokio::test]
    async fn reload_project_rules_loads_from_workdir() {
        let dir = std::env::temp_dir().join(format!("ws-proj-rules-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join(".worldsea")).unwrap();
        std::fs::write(
            dir.join(".worldsea/permissions.json"),
            r#"{"deny":["execute_command"]}"#,
        )
        .unwrap();
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc
            .new_session(None, vec![], None, None, Some(dir.clone()), None, None)
            .await
            .unwrap();
        // 装配期已加载；显式重载同样命中
        assert!(svc.reload_project_rules(&info.id).await.unwrap(), "应加载到项目规则");

        // 无规则目录 → 未声明（false）
        let plain = std::env::temp_dir().join(format!("ws-proj-rules-none-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&plain).unwrap();
        let info2 = svc
            .new_session(None, vec![], None, None, Some(plain.clone()), None, None)
            .await
            .unwrap();
        assert!(!svc.reload_project_rules(&info2.id).await.unwrap(), "无规则应返回 false");

        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&plain);
    }

    // ─── S3-e2：会话分支命令面（分叉 / 回滚 / 检查点）──────────────

    /// 捕获型监听器：断言分支事件确实广播（key 序列）
    struct CaptureEvents(std::sync::Mutex<Vec<&'static str>>);
    impl Listener for CaptureEvents {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            self.0.lock().unwrap().push(event.key());
            ListenerOutcome::Continue
        }
    }

    fn branch_msg(
        role: agent_runtime::types::MessageRole,
        content: &str,
    ) -> agent_runtime::types::OrchestratorMessage {
        agent_runtime::types::OrchestratorMessage {
            role,
            content: content.into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }
    }

    fn branch_snapshot(
        at: u64,
        update: agent_runtime::agent::request_snapshot::ViewUpdate,
    ) -> agent_runtime::agent::request_snapshot::RequestSnapshot {
        agent_runtime::agent::request_snapshot::RequestSnapshot {
            captured_at_ms: at,
            purpose: "main".into(),
            provider: "test".into(),
            model_id: "test-model".into(),
            temperature: None,
            max_tokens: None,
            top_p: None,
            top_k: None,
            thinking_mode: None,
            thinking_level: None,
            silent: false,
            system_prompt: None,
            tools_json: None,
            tools_names: Vec::new(),
            material_ref: None,
            view_update: update,
        }
    }

    /// 种子会话：两轮真实形态 + 快照链——
    /// 视图 [u1,a1,u2,a2]；seq0 发送 [u1]；seq1 发送 [u1,a1,u2]（u2 = 触发第 1 轮的新输入）
    async fn seed_two_rounds(store: &SqliteSessionRepository, session_id: &str) {
        use agent_runtime::agent::request_snapshot::ViewUpdate;
        use agent_runtime::types::MessageRole;
        store
            .replace_messages(
                session_id,
                &[
                    branch_msg(MessageRole::User, "u1"),
                    branch_msg(MessageRole::Assistant, "a1"),
                    branch_msg(MessageRole::User, "u2"),
                    branch_msg(MessageRole::Assistant, "a2"),
                ],
            )
            .await
            .unwrap();
        store
            .append_request_snapshot(
                session_id,
                &branch_snapshot(100, ViewUpdate::Full { messages: vec![branch_msg(MessageRole::User, "u1")] }),
            )
            .await
            .unwrap();
        store
            .append_request_snapshot(
                session_id,
                &branch_snapshot(
                    200,
                    ViewUpdate::Appended {
                        messages: vec![branch_msg(MessageRole::Assistant, "a1"), branch_msg(MessageRole::User, "u2")],
                    },
                ),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn fork_session_creates_live_child_and_emits() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        seed_two_rounds(&store, &info.id).await;
        let capture = Arc::new(CaptureEvents(Default::default()));
        let parent_agent = svc.get_agent(&info.id).await.unwrap();
        parent_agent
            .subscribe_key(agent_runtime::event::keys::CONVERSATION_FORKED, capture.clone())
            .await;
        // A2：备用 Key 池随分叉继承（父会话注入后子会话应可见同一池）
        parent_agent.set_api_key_pool(vec!["backup-1".into()]).await.unwrap();

        let child = svc.fork_session(&info.id, 1).await.unwrap();

        // 子会话可立即取用（内存态已注册），视图 = 边界视图（含 u2、不含其响应）
        let child_agent = svc.get_agent(&child.id).await.unwrap();
        let msgs = child_agent.get_messages().await;
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[2].content, "u2");
        assert_eq!(child.message_count, 3);
        assert_eq!(
            child_agent.current_api_key_pool().await,
            vec!["backup-1".to_string()],
            "备用 Key 池应随分叉继承"
        );
        // 会话列表可见
        let list = svc.list_sessions(None).await.unwrap();
        assert!(list.iter().any(|s| s.id == child.id));
        // 事件已广播（父会话总线）
        assert_eq!(capture.0.lock().unwrap().as_slice(), &["conversation_forked"]);
    }

    #[tokio::test]
    async fn rewind_session_syncs_live_agent_and_emits() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        seed_two_rounds(&store, &info.id).await;
        let capture = Arc::new(CaptureEvents(Default::default()));
        svc.get_agent(&info.id)
            .await
            .unwrap()
            .subscribe_key(agent_runtime::event::keys::CONVERSATION_REWOUND, capture.clone())
            .await;

        // 回滚到 seq1 = u2 那一轮发出时的状态（a2 被移出视图）
        svc.rewind_session(&info.id, 1).await.unwrap();

        // 内存态与存储双侧同步到边界视图；列表条数随之派生
        let msgs = svc.get_agent(&info.id).await.unwrap().get_messages().await;
        assert_eq!(msgs.len(), 3, "内存态应同步为回滚后的视图");
        assert_eq!(msgs[2].content, "u2");
        assert_eq!(store.load_messages(&info.id).await.unwrap().len(), 3);
        assert_eq!(
            svc.list_sessions(None)
                .await
                .unwrap()
                .iter()
                .find(|s| s.id == info.id)
                .unwrap()
                .message_count,
            3
        );
        assert_eq!(capture.0.lock().unwrap().as_slice(), &["conversation_rewound"]);
    }

    #[test]
    fn rewind_guard_rejects_streaming() {
        assert!(rewind_guard(false).is_ok(), "空闲会话应放行");
        let err = rewind_guard(true).unwrap_err();
        assert!(matches!(err, CommandError::InvalidArgument(_)), "运行中应拒绝: {err:?}");
    }

    #[tokio::test]
    async fn create_checkpoint_uses_latest_boundary_and_emits() {
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        seed_two_rounds(&store, &info.id).await;
        let capture = Arc::new(CaptureEvents(Default::default()));
        svc.get_agent(&info.id)
            .await
            .unwrap()
            .subscribe_key(agent_runtime::event::keys::CHECKPOINT_CREATED, capture.clone())
            .await;

        let id = svc.create_checkpoint(&info.id).await.unwrap();
        let cps = store.list_checkpoints(&info.id, 10).await.unwrap();
        assert_eq!(cps.len(), 1);
        assert_eq!(cps[0].id, id);
        assert_eq!(cps[0].request_seq, 1, "锚点 = 最后一次请求序号");
        assert_eq!(cps[0].kind, "manual");
        assert_eq!(capture.0.lock().unwrap().as_slice(), &["checkpoint_created"]);

        // 无请求边界的会话：拒绝（不以伪坐标打点）
        let fresh = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        assert!(svc.create_checkpoint(&fresh.id).await.is_err(), "无快照不应打点");
    }

    #[tokio::test]
    async fn list_checkpoint_refs_merges_task_resume() {
        use agent_runtime::long_task::{
            LongTaskCheckpoint, LongTaskMeta, LongTaskRecord, LongTaskStatus, LongTaskType,
        };
        let store = SqliteSessionRepository::new_in_memory().await.unwrap();
        let svc = AgentCommandService::new().with_session_store(store.clone());
        let info = svc.new_session(None, vec![], None, None, None, None, None).await.unwrap();
        seed_two_rounds(&store, &info.id).await;
        svc.create_checkpoint(&info.id).await.unwrap();
        let tasks = LongTaskRepository::new_in_memory().await.unwrap();
        let now = chrono::Utc::now();
        tasks
            .save(LongTaskRecord {
                task_id: "longtask-run".into(),
                task_type: LongTaskType::MainAgent,
                status: LongTaskStatus::Running,
                started_at: now,
                last_heartbeat_at: now,
                ended_at: None,
                turn_count: 0,
                current_tool: None,
                current_phase: None,
                checkpoint: LongTaskCheckpoint {
                    agent_messages: Vec::new(),
                    last_user_text: "t".into(),
                    skill_names: None,
                    chat_mode: None,
                    locked_chat_mode: None,
                },
                meta: LongTaskMeta { agent_type: None, prompt: "t".into(), pipeline_context: None },
            })
            .await
            .unwrap();

        let refs = svc.list_checkpoint_refs(&info.id, 10, Some(&tasks)).await.unwrap();
        assert_eq!(refs.len(), 2, "1 锚点 + 1 活跃任务断点");
        assert!(refs.iter().any(|r| r.kind() == CheckpointKind::TaskResume));
        assert!(refs.iter().any(|r| r.kind() == CheckpointKind::SessionAnchor));
        // 未注入长任务存储：只出锚点
        let refs = svc.list_checkpoint_refs(&info.id, 10, None).await.unwrap();
        assert_eq!(refs.len(), 1);
    }
