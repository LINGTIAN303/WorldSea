// ─── 测试 ────────────────────────────────────────────

    use super::*;
    use crate::agent::prompt_sections::PromptSection;
    use crate::event_bus::{Listener, ListenerOutcome};
    use async_trait::async_trait;
    use crate::backend::PromptResponse;
    use crate::router_decider::{RouterDecider, RouterDecision};
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;
    use crate::tool::{EchoTool, SimpleToolBus};
    use crate::tool_hook::{ToolHookAction, ToolLifecycleHook};
    use crate::types::ToolCall;

    /// Mock 后端 — 返回预设响应
    struct MockBackend {
        responses: AsyncMutex<Vec<PromptResponse>>,
        last_options: AsyncMutex<Option<PromptCallOptions>>,
        /// 阶段 3 测试开关：置位后 `set_messages` 返回错误
        /// （验证压缩失败路径的括号右端 `ContextCompactFailed`）
        fail_set_messages: AtomicBool,
        /// 阶段 3 测试：请求派发时间线（与 CompactEventRecorder 共写，验证压缩先于请求）
        timeline: Option<Arc<std::sync::Mutex<Vec<String>>>>,
        /// 阶段 3 测试：旁路调用（压缩摘要）返回的摘要文本；`None` = 不实现（返回错误 → 回退）
        side_call_summary: Option<String>,
        /// 阶段 3 测试：旁路调用次数（预算上限契约）
        side_calls: AtomicUsize,
        /// 阶段 3 测试：最近一次旁路调用收到的指令（模板契约）与历史长度（暖前缀契约）
        last_side_instruction: AsyncMutex<Option<String>>,
        last_side_history_len: AsyncMutex<usize>,
        /// A5 契约测试：错误注入队列（每次 prompt 先弹错误——供按码路由断言）
        prompt_errors: AsyncMutex<Vec<BackendError>>,
    }

    impl MockBackend {
        fn new(responses: Vec<PromptResponse>) -> Self {
            Self {
                responses: AsyncMutex::new(responses),
                last_options: AsyncMutex::new(None),
                fail_set_messages: AtomicBool::new(false),
                timeline: None,
                side_call_summary: None,
                side_calls: AtomicUsize::new(0),
                last_side_instruction: AsyncMutex::new(None),
                last_side_history_len: AsyncMutex::new(0),
                prompt_errors: AsyncMutex::new(Vec::new()),
            }
        }

        /// A5：注入按序弹出的错误（先于响应队列消费）
        fn with_prompt_errors(mut self, errors: Vec<BackendError>) -> Self {
            self.prompt_errors = AsyncMutex::new(errors);
            self
        }

        /// 令 `set_messages` 失败的 Mock（压缩失败路径契约测试用）
        fn failing_set_messages(responses: Vec<PromptResponse>) -> Self {
            let backend = Self::new(responses);
            backend.fail_set_messages.store(true, Ordering::SeqCst);
            backend
        }

        /// 注入共享时间线（压缩时机契约测试：压缩事件与请求派发共写同一序列）
        fn with_timeline(mut self, timeline: Arc<std::sync::Mutex<Vec<String>>>) -> Self {
            self.timeline = Some(timeline);
            self
        }

        /// 提供压缩摘要的旁路调用实现（阶段 3 · D4 摘要契约测试）
        fn with_side_call_summary(mut self, summary: &str) -> Self {
            self.side_call_summary = Some(summary.to_string());
            self
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for MockBackend {
        async fn prompt(
            &self,
            _prompt: String,
            options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            if let Some(timeline) = &self.timeline {
                if let Ok(mut tl) = timeline.lock() {
                    tl.push("prompt".to_string());
                }
            }
            // A5：注入错误优先（供按码路由断言——不可重试即时失败 / 溢出压缩重发）
            {
                let mut errors = self.prompt_errors.lock().await;
                if !errors.is_empty() {
                    return Err(errors.remove(0));
                }
            }
            *self.last_options.lock().await = options;
            let mut responses = self.responses.lock().await;
            if responses.is_empty() {
                return Err(BackendError::Other("no more mock responses".into()));
            }
            Ok(responses.remove(0))
        }

        /// 阶段 3 · D4：压缩摘要旁路调用（记录指令/历史供契约断言；`None` → 错误 → 回退）
        async fn prompt_side_call(
            &self,
            _system_prompt: Option<String>,
            history: Vec<OrchestratorMessage>,
            instruction: String,
            _options: PromptCallOptions,
        ) -> Result<PromptResponse, BackendError> {
            self.side_calls.fetch_add(1, Ordering::SeqCst);
            *self.last_side_instruction.lock().await = Some(instruction);
            *self.last_side_history_len.lock().await = history.len();
            match &self.side_call_summary {
                Some(summary) => {
                    let mut response = PromptResponse::text_only(summary.clone());
                    response.input_tokens = Some(10);
                    response.output_tokens = Some(20);
                    Ok(response)
                }
                None => Err(BackendError::Other("旁路调用未实现（测试替身）".into())),
            }
        }

        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }

        async fn set_messages(
            &self,
            _messages: Vec<OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            if self.fail_set_messages.load(Ordering::SeqCst) {
                return Err(BackendError::Other("注入的 set_messages 失败".into()));
            }
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

    /// E3-1（2026-09-18，观测期）：工具上下文携带按档位派生的沙箱戳记——
    /// plan → 只读；interact / autopilot → 工作区写；无工作区 → 不携带（设计见 crate::sandbox）
    #[tokio::test]
    async fn tool_ctx_carries_sandbox_stamp_derived_from_level_and_workdir() {
        use crate::confirmation::ConfirmationPolicy;
        use crate::permission_rules::SecurityLevel;
        use crate::sandbox::SandboxMode;
        use std::path::PathBuf;

        for (level, expected) in [
            (SecurityLevel::Plan, SandboxMode::ReadOnly),
            (SecurityLevel::Interact, SandboxMode::WorkspaceWrite),
            (SecurityLevel::Autopilot, SandboxMode::WorkspaceWrite),
        ] {
            let agent = AgentLoop::new(
                Arc::new(MockBackend::new(vec![])),
                Arc::new(SimpleToolBus::new()),
            )
            .with_config(AgentLoopConfig {
                workdir: Some(PathBuf::from("/ws")),
                confirmation_policy: Some(ConfirmationPolicy {
                    security_level: level,
                    ..Default::default()
                }),
                ..Default::default()
            });
            let spec = agent
                .tool_ctx(None)
                .sandbox
                .unwrap_or_else(|| panic!("{level:?} 应携带沙箱戳记"));
            assert_eq!(spec.mode, expected, "{level:?}");
            assert_eq!(spec.root, PathBuf::from("/ws"), "{level:?}");
        }
        // 无工作区 → 不携带（Agent 命令路径已由 W3 fail-safe 拒绝；戳记语义为不启用）
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        assert!(agent.tool_ctx(None).sandbox.is_none());
    }

    /// X1：append_messages 追加消息入环（不触发执行）——命令层编排路径收口的入环基础
    #[tokio::test]
    async fn append_messages_extends_history_without_run() {
        use crate::types::{MessageRole, OrchestratorMessage};
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        let before = agent.get_messages().await.len();
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "/plan 写文档".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: "终稿".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        let after = agent.get_messages().await;
        assert_eq!(after.len(), before + 2);
        assert_eq!(after.last().unwrap().content, "终稿");
    }

    /// A1 己1③：工具结果截断改为「保头 + 保尾」——尾部结论不再丢失
    #[test]
    fn clamp_tool_result_keeps_head_and_tail() {
        use super::tools::{clamp_tool_result, TOOL_RESULT_STR_LIMIT};

        let head_marker = "HEAD_BEGIN";
        let tail_marker = "TAIL_END";
        let original = format!(
            "{head_marker}{}{tail_marker}",
            "x".repeat(TOOL_RESULT_STR_LIMIT + 5_000)
        );
        let mut value = serde_json::Value::String(original);
        clamp_tool_result(&mut value);
        let out = value.as_str().unwrap();

        assert!(out.starts_with(head_marker), "头部应保留");
        assert!(out.ends_with(tail_marker), "尾部应保留（旧实现只保头部）");
        assert!(out.contains("已截断"), "应标注省略");
        // 内容预算受控：首 + 尾 = LIMIT，外加省略标记
        assert!(
            out.len() < TOOL_RESULT_STR_LIMIT + 200,
            "总长应受控，实际 {}",
            out.len()
        );
    }

    /// A1 己1③：截断在多字节字符边界安全（旧实现与新版都必须不劈开 UTF-8）
    #[test]
    fn clamp_tool_result_is_utf8_boundary_safe() {
        use super::tools::clamp_tool_result;

        // 全中文长串（每字 3 字节）：按字节硬切必落在字符中间
        let mut value = serde_json::Value::String("中".repeat(20_000));
        clamp_tool_result(&mut value);
        let out = value.as_str().unwrap();

        assert!(out.contains("已截断"), "超限应被截断");
        assert!(out.starts_with('中'), "头部应从完整字符开始");
        assert!(out.ends_with('中'), "尾部应到完整字符结束");
    }

    /// A1 己1③：未超限的字符串原样保留（不引入无谓改动）
    #[test]
    fn clamp_tool_result_noop_when_within_limit() {
        use super::tools::clamp_tool_result;

        let mut value = serde_json::Value::String("短内容".into());
        clamp_tool_result(&mut value);
        assert_eq!(value.as_str().unwrap(), "短内容");
    }

    // ─── A1 己1①：原文外置（截断前先保原文） ──────────────────

    /// ★ 核心契约：截断**之前**把完整原文交给外置器，标注附带坐标
    #[test]
    fn clamp_externalizes_full_text_before_truncating() {
        use super::tools::{clamp_tool_result_with, TOOL_RESULT_STR_LIMIT};
        use crate::raw_context::{parse_externalized_hash, RawRef};
        use std::sync::{Arc, Mutex};

        // 记录 sink 收到的原文，并返回固定坐标
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen2 = Arc::clone(&seen);
        let sink: crate::raw_context::RawContextSink = Arc::new(move |text: &str| {
            seen2.lock().unwrap().push(text.to_string());
            Some(RawRef {
                content_hash: "0123456789abcdef".into(),
                byte_len: text.len(),
            })
        });

        let original = format!("HEAD{}TAIL", "x".repeat(TOOL_RESULT_STR_LIMIT + 5_000));
        let mut value = serde_json::Value::String(original.clone());
        clamp_tool_result_with(&mut value, &sink);
        let out = value.as_str().unwrap();

        // ① sink 收到的是**完整原文**（不是截断后的）
        let captured = seen.lock().unwrap();
        assert_eq!(captured.len(), 1, "应恰好外置一次");
        assert_eq!(captured[0].len(), original.len(), "外置的必须是完整原文");
        assert!(captured[0].contains("HEAD") && captured[0].ends_with("TAIL"));

        // ② 标注里带上了坐标，且可被反解
        assert_eq!(
            parse_externalized_hash(out).as_deref(),
            Some("0123456789abcdef"),
            "截断标注须附外置坐标: {out}"
        );
        // ③ 截断本身照常（保头 + 保尾）
        assert!(out.starts_with("HEAD"));
        assert!(out.ends_with("TAIL"));
        assert!(out.contains("已截断"));
    }

    /// 外置器返回 `None`（超闸门 / IO 失败 / 未注入）→ 退回纯截断，功能不中断
    #[test]
    fn clamp_falls_back_to_plain_truncation_when_sink_declines() {
        use super::tools::{clamp_tool_result_with, TOOL_RESULT_STR_LIMIT};
        use crate::raw_context::parse_externalized_hash;

        let declining: crate::raw_context::RawContextSink = Arc::new(|_| None);
        let original = format!("HEAD{}TAIL", "y".repeat(TOOL_RESULT_STR_LIMIT * 2));
        let mut value = serde_json::Value::String(original);
        clamp_tool_result_with(&mut value, &declining);
        let out = value.as_str().unwrap();

        assert!(out.starts_with("HEAD") && out.ends_with("TAIL"), "截断照常生效");
        assert!(out.contains("已截断"));
        assert!(
            parse_externalized_hash(out).is_none(),
            "未外置则不应出现坐标（避免指向不存在的内容）: {out}"
        );
    }

    /// 未超限的内容**不触发外置**（避免为小内容白写文件）
    #[test]
    fn clamp_does_not_externalize_within_limit() {
        use super::tools::clamp_tool_result_with;
        use std::sync::atomic::{AtomicUsize, Ordering};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let counting: crate::raw_context::RawContextSink = Arc::new(move |_| {
            calls2.fetch_add(1, Ordering::SeqCst);
            None
        });

        let mut value = serde_json::Value::String("短内容".into());
        clamp_tool_result_with(&mut value, &counting);
        assert_eq!(calls.load(Ordering::SeqCst), 0, "未超限不应触发外置");
        assert_eq!(value.as_str().unwrap(), "短内容");
    }

    /// 嵌套结构里每个超长字符串**各自**外置（坐标不同 → 可分别取回）
    #[test]
    fn clamp_externalizes_each_long_string_independently() {
        use super::tools::{clamp_tool_result_with, TOOL_RESULT_STR_LIMIT};
        use crate::raw_context::{parse_externalized_hash, RawContextSink, RawRef};
        use std::sync::atomic::{AtomicUsize, Ordering};

        let n = Arc::new(AtomicUsize::new(0));
        let n2 = Arc::clone(&n);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = n2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        let big = "z".repeat(TOOL_RESULT_STR_LIMIT + 100);
        let mut value = serde_json::json!({
            "stdout": big.clone(),
            "stderr": big.clone(),
            "small": "ok",
            "__meta": { "op": "bash" },
        });
        clamp_tool_result_with(&mut value, &sink);

        assert_eq!(n.load(Ordering::SeqCst), 2, "两个超长字段应各自外置一次");
        let out = value.to_string();

        // 断言「各自拿到独立坐标且都可解析」——**不假设遍历顺序**
        // （serde_json 的 Map 默认按键排序，`stderr` 先于 `stdout`）
        let h_stdout = parse_externalized_hash(value["stdout"].as_str().unwrap()).expect("应可解析");
        let h_stderr = parse_externalized_hash(value["stderr"].as_str().unwrap()).expect("应可解析");
        assert_ne!(h_stdout, h_stderr, "两条内容应各自独立外置（坐标不同）");
        // 短字段与 `__meta` 键不受影响
        assert_eq!(value["small"], "ok");
        assert!(out.contains("bash"), "__meta 应原样保留");
    }

    /// A1 己2②：预算裁剪边界对齐 tool 配对——不得切出悬空 tool_call_id
    ///
    /// 构造：7 条小消息 + assistant(带 tool_calls, 20KB) + toolResult(12KB) + 11 条大消息。
    /// 朴素按字节裁剪会得到 drop=8，恰好把 toolResult 留在保留区首位 → 悬空 tool_call_id → 400。
    #[tokio::test]
    async fn context_budget_cut_aligns_to_tool_pairing() {
        use crate::types::{MessageRole, OrchestratorMessage};

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        let mut msgs = Vec::new();
        for i in 0..7 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: "a".repeat(4_000),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        msgs.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "b".repeat(20_000),
            tool_calls: vec![ToolCall {
                id: "call_1".into(),
                name: "echo".into(),
                args: serde_json::json!({}),
            }],
            tool_call_id: None,
            meta: None,
        });
        msgs.push(OrchestratorMessage {
            role: MessageRole::ToolResult,
            content: "c".repeat(12_000),
            tool_calls: Vec::new(),
            tool_call_id: Some("call_1".into()),
            meta: None,
        });
        for _ in 0..11 {
            msgs.push(OrchestratorMessage {
                role: MessageRole::User,
                content: "d".repeat(12_000),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;

        let kept = agent.get_messages().await;
        assert!(!kept.is_empty(), "应发生裁剪");
        assert_ne!(
            kept[0].role,
            MessageRole::ToolResult,
            "保留区首条不得是 toolResult——否则其 tool_call 已丢，构成悬空"
        );
        // 全量不变量：任何 toolResult 都必须有仍在保留区的 assistant(tool_calls) 声明
        let mut declared: Vec<String> = Vec::new();
        for m in &kept {
            match m.role {
                MessageRole::Assistant => {
                    declared.extend(m.tool_calls.iter().map(|tc| tc.id.clone()))
                }
                MessageRole::ToolResult => {
                    let id = m.tool_call_id.clone().unwrap_or_default();
                    assert!(declared.contains(&id), "悬空 tool_call_id: {id}");
                }
                _ => {}
            }
        }
    }

    /// A1 己2①：预算裁剪接入保留契约后，**System 锚点与最近一轮 user 输入必须存活**
    ///
    /// 用显式预算（窗口 4K × 0.25 → 触发点 950）制造**深度裁剪**——深到「按旧实现
    /// 从头逐条丢」会把 System 锚点也吃掉（旧实现第一个丢的就是它，下一轮重推 →
    /// 落到列表末尾，即位置漂移）。
    ///
    /// ```text
    /// 0     System（小）      ← 旧实现第一个丢 → 下一轮重推到末尾（位置漂移）
    /// 1-4   陈旧小消息（user/assistant 交替）
    /// 5     user「最新指令」   ← 本轮最后一条 user，契约硬保护
    /// 6-15  陈旧大消息（assistant）← 真正的体量所在
    /// ```
    ///
    /// 「单轮 ≥6 次工具调用把最新 user 挤出保留窗口」的靶心场景由
    /// `retention::tests::latest_user_survives_heavy_tool_turn` 覆盖（那里能精确构造
    /// 条数挤压），本用例只管端到端接线。
    #[tokio::test]
    async fn context_budget_preserves_system_anchor_and_latest_user() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
            retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
            ..Default::default()
        });

        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "你是 WorldSea 的助手".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        // 陈旧小消息：user / assistant 交替（真实对话形态；
        // 若全用 user 角色，「最后一条 user」会落到末尾的陈旧消息上，测不到靶心）
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧小消息 {i}"),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        // 本轮最后一条 user —— 契约硬保护
        msgs.push(OrchestratorMessage {
            role: MessageRole::User,
            content: "最新指令：重构这个模块".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        // 其后的助手工作产出（体量所在，可裁）
        for i in 0..10 {
            msgs.push(OrchestratorMessage {
                role: MessageRole::Assistant,
                content: format!("陈旧大消息 {i}：{}", "x".repeat(2_000)),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        let total = msgs.len();
        assert_eq!(total, 16);
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;
        let kept = agent.get_messages().await;

        assert!(kept.len() < total, "应发生裁剪，实际保留 {} 条", kept.len());
        assert_eq!(
            kept[0].role,
            MessageRole::System,
            "System 锚点必须仍在首位（旧实现会先丢它 → 位置漂移）"
        );
        assert!(
            kept.iter().any(|m| m.content.contains("最新指令")),
            "最近一轮 user 原始输入必须存活"
        );
        // 深度裁剪确实深入到了 user 之后的内容
        assert!(
            kept.len() <= 6,
            "深度裁剪应只剩受保护内容，实际 {} 条: {:?}",
            kept.len(),
            kept.iter().map(|m| (m.role, m.content.chars().take(12).collect::<String>())).collect::<Vec<_>>()
        );
    }

    /// A1 己2①：裁剪是**选择性删除**而非前缀删除——夹在陈旧内容里的打标消息得以存活
    #[tokio::test]
    async fn context_budget_uses_selective_not_prefix_trim() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::retention::{RetentionPolicy, META_RETENTION_KEY};
        use crate::types::{MessageRole, OrchestratorMessage};

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
            retention_policy: Some(RetentionPolicy { keep_recent: 1 }),
            ..Default::default()
        });

        // System(0) · 陈旧(1..5) · 决策(5) · 陈旧(6..10) · user(10)
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: MessageRole::User,
                content: format!("陈旧前置 {i}：{}", "y".repeat(1_200)),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        msgs.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "已决定：采用方案 B".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: Some(
                [(META_RETENTION_KEY.to_string(), serde_json::json!("decision"))]
                    .into_iter()
                    .collect(),
            ),
        });
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: MessageRole::User,
                content: format!("陈旧后置 {i}：{}", "z".repeat(1_200)),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        msgs.push(OrchestratorMessage {
            role: MessageRole::User,
            content: "继续推进".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        let total = msgs.len();
        assert_eq!(total, 11);
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;
        let kept = agent.get_messages().await;

        assert!(
            kept.iter().any(|m| m.content.contains("方案 B")),
            "打标为「决策」的旧消息不得被裁——前缀裁剪做不到（它在陈旧内容中间）"
        );
        assert!(kept.iter().any(|m| m.content.contains("继续推进")), "最新 user 应存活");
        assert_eq!(kept[0].role, MessageRole::System);
        assert!(
            kept.len() < total,
            "陈旧内容应被删掉，实际保留 {} 条",
            kept.len()
        );
        // 决策消息之前与之后的陈旧内容都被删了 —— 这正是「选择性」而非「前缀」的证据
        assert!(
            !kept.iter().any(|m| m.content.contains("陈旧前置")),
            "决策之前的陈旧内容应被删"
        );
    }

    // ─── A1 §6.2：锚点回填（折叠 / 回填）────────────────────────

    /// 注入外置器后，超线裁剪走**折叠**而非删除：
    /// 被选中的组替换为「锚点对 + 压缩文本」（已回填态），原文先外置。
    #[tokio::test]
    async fn context_budget_folds_instead_of_dropping_when_sink_injected() {
        use crate::anchor::{fold_meta_of, is_folded, FoldState};
        use crate::context_budget::ContextBudgetPolicy;
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let captured: Arc<std::sync::Mutex<Vec<String>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured2 = Arc::clone(&captured);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            captured2.lock().unwrap().push(text.to_string());
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus)
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                ..Default::default()
            })
            .with_raw_context_sink(sink);

        // System(0) · 陈旧 4 条（各 ≈500 token）· 最新 user(5) · 回复(6)
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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
        msgs.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "好的".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;
        let kept = agent.get_messages().await;

        let folded: Vec<&OrchestratorMessage> = kept.iter().filter(|m| is_folded(m)).collect();
        assert!(
            !folded.is_empty(),
            "注入外置器后应发生折叠，实际保留 {} 条、无折叠形",
            kept.len()
        );
        // 折叠形是「已回填」态（enforce 内背靠背执行 backfill）
        for f in &folded {
            let meta = fold_meta_of(f).expect("折叠形应带 meta");
            assert_eq!(meta.state, FoldState::Filled, "折叠形应为已回填态");
            assert_eq!(meta.raw.len(), 16, "外置坐标应为 16 位");
            assert!(
                f.content.contains("⟨锚点A:") && f.content.contains("⟨锚点B:"),
                "折叠形须含一对前后锚点: {}",
                f.content
            );
            assert!(
                f.content.contains("已外置"),
                "压缩文本须附原文坐标: {}",
                f.content
            );
        }
        // 与 sink 调用次数一致（每折叠一组外置一次）
        assert_eq!(
            calls.load(Ordering::SeqCst),
            folded.len(),
            "外置次数应与折叠组数一致"
        );
        // 被折叠消息（陈旧 0/1/2——select_drops 至 trigger 即停，陈旧 3 仍在）的
        // 原文不应完整停留在上下文里（压缩文本至多含头尾片段）
        for i in 0..3 {
            let full = format!("陈旧 {i}：{}", "x".repeat(2_000));
            assert!(
                kept.iter().all(|m| !m.content.contains(&full)),
                "被折叠消息 {i} 的原文不应完整驻留"
            );
        }
        // ★ 但外置材料必须含**完整原文**（折叠的保真承诺落在外置层）
        let materials = captured.lock().unwrap();
        assert_eq!(materials.len(), 3, "应有三次外置");
        let full0 = format!("陈旧 0：{}", "x".repeat(2_000));
        assert!(
            materials.iter().any(|t| t.contains(&full0)),
            "外置材料须含完整原文（2000 字符全量）"
        );
        // 受保护内容仍在
        assert!(kept.iter().any(|m| m.content.contains("最新指令")));
        // 折叠的收益是**体量**而非条数：非工具消息 1 条 → 1 条折叠形（远小于原文）
        assert!(
            folded
                .iter()
                .all(|m| m.content.chars().count() < 1_000),
            "折叠形应远小于原文（2000+ 字符），实际: {:?}",
            folded.iter().map(|m| m.content.chars().count()).collect::<Vec<_>>()
        );
    }

    /// 外置被拒（闸门 / 未就绪）→ 该组**保留原样**（宁超线勿丢）
    #[tokio::test]
    async fn fold_keeps_original_intact_when_sink_denies() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::raw_context::RawContextSink;
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let sink: RawContextSink = Arc::new(|_| None); // 一律拒绝
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus)
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                ..Default::default()
            })
            .with_raw_context_sink(sink);

        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: MessageRole::User,
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        let total = msgs.len();
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;
        let kept = agent.get_messages().await;

        assert_eq!(kept.len(), total, "外置被拒时不得删除任何消息（宁超线勿丢）");
        assert!(
            kept.iter().any(|m| m.content.contains(&"x".repeat(2_000))),
            "原文须完整保留"
        );
    }

    /// 折叠的配对安全：工具交换组整体折叠为一条，不产生新的悬空 tool_call_id
    #[tokio::test]
    async fn fold_never_breaks_tool_pairing() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::retention::{dangling_tool_calls, RetentionPolicy};
        use crate::types::{MessageRole, OrchestratorMessage, ToolCall};

        let n = Arc::new(AtomicUsize::new(0));
        let n2 = Arc::clone(&n);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = n2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus)
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 1 }),
                ..Default::default()
            })
            .with_raw_context_sink(sink);

        // System(0) · user(1) · [asst(c1) 大 + res(c1) 大](2-3) · user(4) 最新
        let msgs = vec![
            OrchestratorMessage {
                role: MessageRole::System,
                content: "系统提示词".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::User,
                content: "开始".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::Assistant,
                content: format!("调用工具：{}", "a".repeat(3_000)),
                tool_calls: vec![ToolCall {
                    id: "call_1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({"text": "x".repeat(500)}),
                }],
                tool_call_id: None,
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::ToolResult,
                content: format!("工具结果：{}", "b".repeat(3_000)),
                tool_calls: Vec::new(),
                tool_call_id: Some("call_1".into()),
                meta: None,
            },
            OrchestratorMessage {
                role: MessageRole::User,
                content: "最新指令".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            },
        ];
        agent.append_messages(msgs).await;

        agent.enforce_context_budget().await;
        let kept = agent.get_messages().await;

        assert!(
            !kept.is_empty() && kept.len() < 5,
            "应发生折叠（保留 {} 条）",
            kept.len()
        );
        assert!(
            dangling_tool_calls(&kept).is_empty(),
            "折叠不得产生悬空 tool_call_id: {:?}",
            dangling_tool_calls(&kept)
        );
    }

    /// 两段式接口：单独调 `fold_context` 先落**空容器位**；无对应压缩文本时
    /// `backfill_folds` 保持占位（优雅降级——坐标仍在、可回源）
    #[tokio::test]
    async fn fold_lands_placeholder_and_backfill_degrades_gracefully() {
        use crate::anchor::{fold_meta_of, is_folded, FoldState};
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::types::{MessageRole, OrchestratorMessage};

        let sink: RawContextSink = Arc::new(|text: &str| {
            Some(RawRef {
                content_hash: "0123456789abcdef".into(),
                byte_len: text.len(),
            })
        });
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus).with_raw_context_sink(sink);

        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "第一条".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: "第二条".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        // 折叠组 [0,1]（两消息各自成组时为 [0] 与 [1]；此处按一个工具组语义构造——
        // 直接给一个任意分组：把两条非工具消息视为一组）
        let outcome = agent.fold_context(&[vec![0, 1]]).await.unwrap();
        assert_eq!(outcome.folded_groups, 1);
        assert_eq!(outcome.folded_messages, 2);

        let kept = agent.get_messages().await;
        assert_eq!(kept.len(), 1, "两条应折叠为一条");
        assert!(is_folded(&kept[0]));
        let meta = fold_meta_of(&kept[0]).unwrap();
        assert_eq!(meta.state, FoldState::Placeholder, "回填前应为空容器位");
        assert!(kept[0].content.contains("空容器位"), "{}", kept[0].content);

        // 压缩文本缺失 → 保持占位（降级），返回 0
        let filled = agent
            .backfill_folds(&[("deadbeefdeadbeef".into(), "错的".into())])
            .await
            .unwrap();
        assert_eq!(filled, 0);
        let kept = agent.get_messages().await;
        assert_eq!(
            fold_meta_of(&kept[0]).unwrap().state,
            FoldState::Placeholder,
            "无对应压缩文本应保持占位"
        );

        // 正确坐标 → 填回（filled）
        let filled = agent
            .backfill_folds(&[(
                "0123456789abcdef".into(),
                "压缩后的正文".into(),
            )])
            .await
            .unwrap();
        assert_eq!(filled, 1);
        let kept = agent.get_messages().await;
        assert_eq!(fold_meta_of(&kept[0]).unwrap().state, FoldState::Filled);
        assert!(kept[0].content.contains("压缩后的正文"));
    }

    /// R6 第二部分：merge_last_assistant_meta 把事件序追加进最后 assistant 消息 meta.action_events，
    /// 多次调用累计（追加语义），无 assistant 消息时忽略。
    #[tokio::test]
    async fn merge_last_assistant_meta_appends_action_events() {
        use crate::types::{MessageRole, OrchestratorMessage};
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "问题".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: "回复".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        // 首次注入
        agent
            .merge_last_assistant_meta(
                "action_events",
                vec![serde_json::json!({ "seq": 0, "action": "phase" })],
            )
            .await;
        // 追加注入（同一消息 meta 累计）
        agent
            .merge_last_assistant_meta(
                "action_events",
                vec![serde_json::json!({ "seq": 1, "action": "subagent" })],
            )
            .await;

        let messages = agent.get_messages().await;
        let last = messages.last().unwrap();
        let events = last.meta.as_ref().unwrap()["action_events"].as_array().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["action"], "phase");
        assert_eq!(events[1]["action"], "subagent");

        // 空值 no-op
        agent.merge_last_assistant_meta("action_events", vec![]).await;
        let messages = agent.get_messages().await;
        assert_eq!(messages.last().unwrap().meta.as_ref().unwrap()["action_events"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn run_dispatches_hooks_in_order_and_keeps_behavior() {
        // 验证织入点协议（matrix §8 里程碑 5）：
        // 1. 注册的钩子按 RunPhase 位点顺序被调度
        // 2. 钩子存在不影响 AgentLoop::run 的对外行为（结果不变）
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only(
            "你好，我是助手",
        )]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let order = Arc::new(std::sync::Mutex::new(Vec::new()));
        struct RecordingHook {
            order: Arc<std::sync::Mutex<Vec<&'static str>>>,
        }
        #[async_trait]
        impl AgentLoopHook for RecordingHook {
            async fn on_before_react(&self, _ctx: &HookContext<'_>) {
                self.order.lock().unwrap().push("before_react");
            }
            async fn on_after_user_message(&self, _ctx: &HookContext<'_>) {
                self.order.lock().unwrap().push("after_user_message");
            }
            async fn on_after_react(&self, _ctx: &HookContext<'_>) {
                self.order.lock().unwrap().push("after_react");
            }
            async fn on_after_run(&self, _ctx: &HookContext<'_>) {
                self.order.lock().unwrap().push("after_run");
            }
        }

        let agent = AgentLoop::new(backend, tool_bus).with_hook(Arc::new(RecordingHook {
            order: order.clone(),
        }));
        let result = agent.run("你好".into()).await.expect("应执行成功");
        assert_eq!(result, "你好，我是助手", "钩子存在不应改变 run 行为");

        let order = order.lock().unwrap();
        assert_eq!(
            order.as_slice(),
            &["before_react", "after_user_message", "after_react", "after_run"],
            "钩子应按 RunPhase 位点顺序调度"
        );
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
                reasoning: None,
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
    async fn run_returns_error_when_total_steps_exceeded() {
        // 每轮都返回工具调用，永远不结束 → 总步骤预算耗尽错误
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
                reasoning: None,
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            total_steps: 3,
            ..Default::default()
        });

        let result = agent.run("无限循环".into()).await;
        assert!(result.is_err());
        match result {
            Err(AgentError::TotalStepsReached(3)) => {}
            _ => panic!("应返回 TotalStepsReached(3)"),
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
                reasoning: None,
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

    impl Listener for TerminalEventListener {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            let label = match event {
                OrchestratorEvent::Agent(AgentEvent::Error { message, .. }) => {
                    format!("error:{message}")
                }
                OrchestratorEvent::Agent(AgentEvent::AgentEnd) => "agent_end".into(),
                OrchestratorEvent::Agent(AgentEvent::StreamEnd { .. }) => "stream_end".into(),
                _ => return ListenerOutcome::Continue,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
            ListenerOutcome::Continue
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
                reasoning: None,
        };
        let backend = Arc::new(MockBackend::new(vec![infinite_tool_call; 100]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            total_steps: 3, // 步骤预算 3 → 无限工具调用轮次撞预算
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
                reasoning: None,
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

    impl Listener for LoopEngEventListener {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
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
                _ => return ListenerOutcome::Continue,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
            ListenerOutcome::Continue
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
                reasoning: None,
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
                total_steps: 100, // 不触发预算熔断，验证是速率限制停止而非预算熔断
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
        // 以真实默认 LoopControlConfig（max_turns=None 已退役 / 200 tools / 100k tokens / 6h，
        // 轮数预算由 AgentLoopConfig.total_steps=200 承担）
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
                reasoning: None,
        };
        // 3 轮工具调用 + 1 轮最终文本 = 正常收敛，远低于默认 total_steps 200 预算
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
            total_steps: 100, // 不触发预算熔断，验证是正常收敛而非被循环控制停止
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
                reasoning: None,
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

    /// Mock 记忆访问器 — 记录调用与收到的 options 并返回预设检索结果
    struct MockMemory {
        recall_calls: std::sync::Mutex<Vec<String>>,
        inject_calls: std::sync::Mutex<usize>,
        record_turn_calls: std::sync::Mutex<usize>,
        archive_calls: std::sync::Mutex<usize>,
        /// 最近一次 recall 收到的 options（A1 丁1 档位断言用）
        last_recall_opts: std::sync::Mutex<Option<crate::memory::MemoryRecallOptions>>,
        /// 最近一次 inject 收到的 options（A1 丁1 档位断言用）
        last_inject_opts: std::sync::Mutex<Option<crate::memory::MemoryInjectOptions>>,
    }

    impl MockMemory {
        fn new() -> Self {
            Self {
                recall_calls: std::sync::Mutex::new(Vec::new()),
                inject_calls: std::sync::Mutex::new(0),
                record_turn_calls: std::sync::Mutex::new(0),
                archive_calls: std::sync::Mutex::new(0),
                last_recall_opts: std::sync::Mutex::new(None),
                last_inject_opts: std::sync::Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl crate::memory::MemoryAccessor for MockMemory {
        async fn recall(
            &self,
            query: String,
            options: Option<crate::memory::MemoryRecallOptions>,
        ) -> std::result::Result<Vec<crate::memory::MemoryRecallResult>, crate::memory::MemoryError>
        {
            self.recall_calls.lock().unwrap().push(query);
            *self.last_recall_opts.lock().unwrap() = options;
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
            options: Option<crate::memory::MemoryInjectOptions>,
        ) -> std::result::Result<String, crate::memory::MemoryError> {
            *self.inject_calls.lock().unwrap() += 1;
            *self.last_inject_opts.lock().unwrap() = options;
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
                system_prompt: Some("你是世界构建Agent".into()),
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
            sys.contains("你是世界构建Agent"),
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

    /// A1 丁1：记忆档位生效——recall 的 top_k 与 inject 的 max_tokens 按档位传递
    #[tokio::test]
    async fn run_recall_memory_passes_tier_params() {
        use crate::scenario::ScenarioMemoryPolicy;

        for (policy, expect_top_k, expect_max_tokens) in [
            (ScenarioMemoryPolicy::Light, 2u32, 800u32),
            (ScenarioMemoryPolicy::EntityRich, 8, 3_000),
        ] {
            let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("ok")]));
            let memory = Arc::new(MockMemory::new());
            let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()))
                .with_config(AgentLoopConfig {
                    memory_tier: Some(policy.params()),
                    ..Default::default()
                })
                .with_memory(Some(memory.clone()));
            agent.run("查点什么".into()).await.expect("应成功");

            let ro = memory
                .last_recall_opts
                .lock()
                .unwrap()
                .clone()
                .expect("recall 应收到显式 options");
            let io = memory
                .last_inject_opts
                .lock()
                .unwrap()
                .clone()
                .expect("inject 应收到显式 options");
            assert_eq!(ro.top_k, expect_top_k, "{policy:?} 档召回条数");
            assert_eq!(io.max_tokens, expect_max_tokens, "{policy:?} 档注入预算");
        }
    }

    /// A1 丁1：未配置档位 → Standard 档（= 既有 options 默认，零行为变化）
    #[tokio::test]
    async fn run_recall_memory_defaults_to_existing_options() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("ok")]));
        let memory = Arc::new(MockMemory::new());
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()))
            .with_memory(Some(memory.clone()));
        agent.run("测试".into()).await.expect("应成功");

        let ro = memory.last_recall_opts.lock().unwrap().clone().unwrap();
        let io = memory.last_inject_opts.lock().unwrap().clone().unwrap();
        // 与既有 options 默认一致（Standard 档锚点，防默认值改动造成的隐性行为漂移）
        assert_eq!(ro.top_k, crate::memory::MemoryRecallOptions::default().top_k);
        assert_eq!(
            io.max_tokens,
            crate::memory::MemoryInjectOptions::default().max_tokens
        );
    }

    // ─── A3 四管线路由：AgentLoop 发送链路接入 ────────────────────────

    /// 测试用：收集 RouterDecisionMade 事件的监听器
    struct RouterListener {
        decisions: std::sync::Mutex<Vec<(String, String)>>, // (target_id, target_name)
    }

    impl Listener for RouterListener {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            if let OrchestratorEvent::RouterDecisionMade {
                target_id,
                target_name,
                ..
            } = event
            {
                if let Ok(mut v) = self.decisions.lock() {
                    v.push((target_id.clone(), target_name.clone()));
                }
            }
            ListenerOutcome::Continue
        }
    }

    /// Mock 路由决策器 — 固定返回预置决策（不依赖 patterns::router，便于 kernel 独立测试）
    struct MockRouterDecider {
        target_id: String,
        target_name: String,
        reason: Option<String>,
    }
    #[async_trait]
    impl RouterDecider for MockRouterDecider {
        async fn decide(
            &self,
            _input: &str,
            _backend: &dyn NodeBackendAccessor,
        ) -> Result<RouterDecision, String> {
            Ok(RouterDecision {
                target_id: self.target_id.clone(),
                target_name: self.target_name.clone(),
                reason: self.reason.clone(),
            })
        }
        fn id(&self) -> String {
            "router".into()
        }
    }

    #[tokio::test]
    async fn run_with_router_broadcasts_decision_and_injects_directive() {
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("完成")]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        // 发送链路路由决策器：mock 固定决策到 research（不再依赖 patterns::router）
        let router = MockRouterDecider {
            target_id: "research".into(),
            target_name: "研究专家".into(),
            reason: None,
        };

        let agent = AgentLoop::new(backend.clone(), tool_bus)
            .with_router(Some(Arc::new(router)))
            .with_config(AgentLoopConfig {
                system_prompt: Some("基础系统提示".into()),
                ..Default::default()
            });

        let listener = Arc::new(RouterListener {
            decisions: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("/调研 论文".into()).await;
        assert!(result.is_ok(), "应执行成功，实际: {result:?}");

        // 1. RouterDecisionMade 事件已广播（force_pipeline → research）
        let decisions = listener.decisions.lock().unwrap().clone();
        assert_eq!(decisions.len(), 1, "应广播 1 次路由决策，实际: {decisions:?}");
        assert_eq!(decisions[0].0, "research", "应路由到 research");

        // 2. 管线指引已注入 system prompt（研究管线）
        let last_options = backend.last_options.lock().await.clone().unwrap();
        let sys = last_options.system_prompt_override.unwrap_or_default();
        assert!(
            sys.contains("研究"),
            "system prompt 应含研究管线指引，实际: {sys}"
        );
    }

    #[tokio::test]
    async fn run_without_router_skips_decision_and_directive() {
        // FIX-4（2026-08-27）：废弃会话级路由开关——未配置 Router 时静默跳过判型并清空管线指引。
        // 开关命令已删除，本测试验证"无 Router → 不广播 RouterDecisionMade、system prompt 无管线指引"。
        let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("完成")]));
        let tool_bus = Arc::new(SimpleToolBus::new());

        let agent = AgentLoop::new(backend.clone(), tool_bus).with_config(AgentLoopConfig {
            system_prompt: Some("基础系统提示".into()),
            ..Default::default()
        });

        let listener = Arc::new(RouterListener {
            decisions: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("/调研 论文".into()).await;
        assert!(result.is_ok(), "应执行成功，实际: {result:?}");

        // 1. 无 Router 不广播 RouterDecisionMade
        let decisions = listener.decisions.lock().unwrap().clone();
        assert_eq!(decisions.len(), 0, "无 Router 不应广播决策，实际: {decisions:?}");

        // 2. system prompt 不含管线指引（仅基础系统提示）
        let last_options = backend.last_options.lock().await.clone().unwrap();
        let sys = last_options.system_prompt_override.unwrap_or_default();
        assert!(
            !sys.contains("研究"),
            "无 Router 时 system prompt 不应含研究管线指引，实际: {sys}"
        );
        assert!(sys.contains("基础系统提示"), "应保留基础系统提示，实际: {sys}");
    }

    // ── B2 场景工具门控（可见性 + 执行） ──

    /// 测试用具名回显工具（验证白名单按名门控）
    struct NamedEchoTool(&'static str);
    #[async_trait]
    impl crate::tool::Tool for NamedEchoTool {
        fn name(&self) -> &str {
            self.0
        }
        fn description(&self) -> &str {
            "具名回显工具（测试用）"
        }
        fn parameters(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object", "properties": {} })
        }
        async fn execute(
            &self,
            args: serde_json::Value,
        ) -> Result<serde_json::Value, crate::tool::ToolError> {
            Ok(args)
        }
    }

    #[tokio::test]
    async fn scenario_filters_visible_and_executable_tools_b2() {
        use crate::scenario::WorldbuildingScenario;
        use crate::tool::{ToolBus, ToolError};

        // 工具总线：白名单内 entity_get + 系统基础工具 bash + 白名单外 secret_tool
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(NamedEchoTool("entity_get"))).await;
        tool_bus.register(Arc::new(NamedEchoTool("bash"))).await;
        tool_bus.register(Arc::new(NamedEchoTool("secret_tool"))).await;

        let backend = Arc::new(MockBackend::new(vec![]));
        let scenario: Arc<dyn crate::scenario::Scenario> = Arc::new(WorldbuildingScenario::new());
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            scenario: Some(scenario),
            ..Default::default()
        });

        let config = agent.config_snapshot();
        let eff = agent.effective_tool_bus(&config);

        // 可见性：白名单外不可见，白名单内可见（含系统基础工具 bash——execute_command 已退役）
        let names: Vec<String> = eff
            .list_all()
            .await
            .into_iter()
            .map(|d| d.name)
            .collect();
        assert!(
            !names.contains(&"secret_tool".to_string()),
            "非白名单工具不应可见: {names:?}"
        );
        assert!(
            names.contains(&"entity_get".to_string()),
            "场景 tool_ids 内工具应可见: {names:?}"
        );
        assert!(
            names.contains(&"bash".to_string()),
            "系统基础工具应可见: {names:?}"
        );

        // 执行：白名单外被拦截（NotFound），白名单内可执行
        assert!(
            matches!(
                eff.call_tool("secret_tool", serde_json::json!({})).await,
                Err(ToolError::NotFound(_))
            ),
            "非白名单工具执行应返回 NotFound"
        );
        assert!(
            eff.call_tool("entity_get", serde_json::json!({})).await.is_ok(),
            "白名单工具应可执行"
        );
    }

    // ── A4 Plan-Exec：plan 工具结果写入 state + 广播事件 ──

    /// 捕获 plan 事件（PlanCreated / PlanStepUpdate）的测试监听器
    struct PlanListener(std::sync::Mutex<Vec<String>>);
    impl Listener for PlanListener {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            let mut guard = self.0.lock().unwrap();
            match event {
                OrchestratorEvent::PlanCreated { items } => {
                    guard.push(format!("created:{}", items.len()));
                }
                OrchestratorEvent::PlanStepUpdate { step_id, status, .. } => {
                    guard.push(format!("update:{step_id}:{status:?}"));
                }
                OrchestratorEvent::PlanReplanned { items } => {
                    guard.push(format!("replanned:{}", items.len()));
                }
                _ => {}
            }
            ListenerOutcome::Continue
        }
    }

    #[tokio::test]
    async fn apply_plan_result_writes_state_and_broadcasts() {
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        let listener = Arc::new(PlanListener(std::sync::Mutex::new(Vec::new())));
        agent.subscribe(listener.clone()).await;

        // plan_create：写入 state.plan + 广播 PlanCreated
        agent
            .apply_plan_result(
                "plan_create",
                &serde_json::json!({
                    "items": [
                        { "id": "p-0", "title": "A", "description": "调研", "status": "pending", "order": 0 },
                        { "id": "p-1", "title": "B", "status": "in_progress", "order": 1 }
                    ]
                }),
            )
            .await;
        let plan = agent.get_plan().await.unwrap();
        assert_eq!(plan.len(), 2, "plan_create 应写入 2 项");
        assert_eq!(plan[0].title, "A");
        assert_eq!(plan[1].status, crate::types::PlanItemStatus::InProgress);

        // plan_update：更新对应项状态 + 广播 PlanStepUpdate
        agent
            .apply_plan_result(
                "plan_update",
                &serde_json::json!({ "item_id": "p-0", "status": "completed" }),
            )
            .await;
        let plan = agent.get_plan().await.unwrap();
        assert_eq!(plan[0].status, crate::types::PlanItemStatus::Completed);

        {
            let events = listener.0.lock().unwrap();
            assert_eq!(events.len(), 2, "应广播 PlanCreated + PlanStepUpdate 各一次");
            assert_eq!(events[0], "created:2");
            assert!(events[1].starts_with("update:p-0:Completed"), "实际: {}", events[1]);
        }
    }

    #[tokio::test]
    async fn apply_plan_result_ignores_unknown_or_invalid() {
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        // 非 plan 工具名 → 无副作用
        agent.apply_plan_result("echo", &serde_json::json!({ "items": [] })).await;
        assert!(agent.get_plan().await.is_none(), "非 plan 工具不应写入 plan");

        // plan_create 空 items → 不写入
        agent.apply_plan_result("plan_create", &serde_json::json!({ "items": [] })).await;
        assert!(agent.get_plan().await.is_none(), "空 items 不应写入 plan");

        // plan_update 非法 status → 不写入不广播，plan 保持 None
        agent.apply_plan_result("plan_update", &serde_json::json!({ "item_id": "x", "status": "bogus" })).await;
        assert!(agent.get_plan().await.is_none(), "非法 status 不应写入 plan");
    }

    #[tokio::test]
    async fn apply_plan_result_replans_keeps_failed_prefix_and_replaces_rest() {
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        let listener = Arc::new(PlanListener(std::sync::Mutex::new(Vec::new())));
        agent.subscribe(listener.clone()).await;

        // 建 3 步计划
        agent
            .apply_plan_result(
                "plan_create",
                &serde_json::json!({
                    "items": [
                        { "id": "p-0", "title": "A", "status": "pending", "order": 0 },
                        { "id": "p-1", "title": "B", "status": "pending", "order": 1 },
                        { "id": "p-2", "title": "C", "status": "pending", "order": 2 }
                    ]
                }),
            )
            .await;
        // 第 1 步完成、第 2 步失败
        agent
            .apply_plan_result("plan_update", &serde_json::json!({ "item_id": "p-0", "status": "completed" }))
            .await;
        agent
            .apply_plan_result("plan_update", &serde_json::json!({ "item_id": "p-1", "status": "failed" }))
            .await;

        // 重规划：保留已完成 p-0 与失败 p-1，替换其后为 D/E
        agent
            .apply_plan_result(
                "plan_replan",
                &serde_json::json!({
                    "failed_item_id": "p-1",
                    "new_steps": [
                        { "title": "D", "description": "重规划一" },
                        { "title": "E" }
                    ]
                }),
            )
            .await;

        let plan = agent.get_plan().await.unwrap();
        // 保留 p-0(completed)/p-1(failed)，替换掉 p-2，追加 D/E
        assert_eq!(plan.len(), 4, "应保留 2 项 + 新增 2 项");
        assert_eq!(plan[0].id, "p-0");
        assert_eq!(plan[0].status, crate::types::PlanItemStatus::Completed);
        assert_eq!(plan[1].id, "p-1");
        assert_eq!(plan[1].status, crate::types::PlanItemStatus::Failed);
        assert_eq!(plan[2].title, "D");
        assert_eq!(plan[2].description.as_deref(), Some("重规划一"));
        assert_eq!(plan[2].order, 2, "重排 order 从失败项之后续接");
        assert_eq!(plan[3].title, "E");
        assert_eq!(plan[3].order, 3);
        assert!(plan.iter().all(|i| i.id != "p-2"), "原后续 p-2 应被替换");

        // 事件：PlanCreated + 2×PlanStepUpdate + PlanReplanned
        let events = listener.0.lock().unwrap();
        assert!(events.iter().any(|e| e.starts_with("created:3")));
        assert_eq!(events.iter().filter(|e| e.starts_with("update:")).count(), 2);
        assert!(events.iter().any(|e| e.starts_with("replanned:4")), "实际: {events:?}");
    }

    #[tokio::test]
    async fn apply_plan_result_replan_ignores_missing_failed_item() {
        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        agent
            .apply_plan_result(
                "plan_create",
                &serde_json::json!({
                    "items": [
                        { "id": "p-0", "title": "A", "status": "pending", "order": 0 },
                        { "id": "p-1", "title": "B", "status": "pending", "order": 1 }
                    ]
                }),
            )
            .await;
        // failed_item_id 不存在 → 不替换、不广播，plan 保持原样
        agent
            .apply_plan_result(
                "plan_replan",
                &serde_json::json!({ "failed_item_id": "nope", "new_steps": [{ "title": "X" }] }),
            )
            .await;
        let plan = agent.get_plan().await.unwrap();
        assert_eq!(plan.len(), 2, "未命中 failed_item_id 不应改动计划");
        assert_eq!(plan[0].id, "p-0");
    }

    // ─── A6 工具生命周期钩子集成测试 ─────────────────────────────

    /// 修改式 hook：echo 工具的 message 参数改为 "hooked"，并统计 post 调用
    struct ModifyingHook {
        post_calls: Arc<AtomicUsize>,
    }
    impl ToolLifecycleHook for ModifyingHook {
        fn on_pre_use(&self, tool: &str, args: &serde_json::Value) -> ToolHookAction {
            if tool == "echo" {
                let mut a = args.clone();
                a["message"] = serde_json::json!("hooked");
                ToolHookAction::Allow(a)
            } else {
                ToolHookAction::Allow(args.clone())
            }
        }
        fn on_post_use(&self, _t: &str, _a: &serde_json::Value, _r: &serde_json::Value) {
            self.post_calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn tool_hook_modifies_args_before_execution() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "调 echo".into(),
                tool_calls: vec![ToolCall {
                    id: "call_hook".into(),
                    name: "echo".into(),
                    args: serde_json::json!({ "message": "hello" }),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;
        let post_calls = Arc::new(AtomicUsize::new(0));

        let agent = AgentLoop::new(backend, tool_bus)
            .with_tool_hook(Arc::new(ModifyingHook { post_calls: post_calls.clone() }));
        let result = agent.run("调用 echo".into()).await.expect("应执行成功");
        assert_eq!(result, "完成");
        assert!(post_calls.load(Ordering::SeqCst) > 0, "post hook 应被触发");

        // 验证工具实际收到的是修改后的参数（hooked 而非 hello）
        let msgs = agent.get_messages().await;
        let tr = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult)
            .expect("应有 toolResult");
        assert!(tr.content.contains("hooked"), "工具应收到修改后的参数");
        assert!(!tr.content.contains("hello"), "不应收到原始参数");
    }

    /// 拒绝式 hook：无条件拒绝工具执行
    struct DenyHook;
    impl ToolLifecycleHook for DenyHook {
        fn on_pre_use(&self, _t: &str, _a: &serde_json::Value) -> ToolHookAction {
            ToolHookAction::Deny("被 A6 钩子拒绝".into())
        }
    }

    #[tokio::test]
    async fn tool_hook_denies_tool_execution() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "调 echo".into(),
                tool_calls: vec![ToolCall {
                    id: "call_deny".into(),
                    name: "echo".into(),
                    args: serde_json::json!({ "message": "hello" }),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("收到拒绝"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_tool_hook(Arc::new(DenyHook));
        let result = agent.run("调用 echo".into()).await.expect("应执行成功");
        assert_eq!(result, "收到拒绝");

        // 工具被拒绝 → toolResult 内容为拒绝原因（工具未真正执行）
        let msgs = agent.get_messages().await;
        let tr = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult)
            .expect("应有 toolResult");
        assert!(tr.content.contains("被 A6 钩子拒绝"));
    }

    // ─── T4：并行路径补超时/重试（串并行统一执行包装） ─────────

    /// T4 契约：并行路径同样受 `tool_timeout` 约束——此前直调 `call_tool_with_ctx`，
    /// 慢工具会挂住整个 turn（本测试外层 3s 守护超时即失败）。
    #[tokio::test]
    async fn parallel_tool_timeout_is_enforced() {
        /// 5s 不返回的慢工具
        struct SlowTool;
        #[async_trait]
        impl crate::tool::Tool for SlowTool {
            fn name(&self) -> &str {
                "slow"
            }
            fn description(&self) -> &str {
                "慢工具（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                _args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                Ok(serde_json::json!({ "ok": true }))
            }
        }

        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "并行".into(),
                tool_calls: vec![
                    ToolCall {
                        id: "tc_slow".into(),
                        name: "slow".into(),
                        args: serde_json::json!({}),
                    },
                    ToolCall {
                        id: "tc_echo".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "message": "hi" }),
                    },
                ],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(SlowTool)).await;
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            parallel_tool_calls: true,
            tool_timeout: Some(std::time::Duration::from_millis(100)),
            tool_max_retries: 0,
            ..Default::default()
        });

        // 外层守护：若并行路径无超时（旧行为），run 会被慢工具挂住 → 守护超时判失败
        let result = tokio::time::timeout(std::time::Duration::from_secs(3), agent.run("跑".into()))
            .await
            .expect("并行工具应受超时约束，不得挂住 turn")
            .expect("运行应成功");
        assert_eq!(result, "完成");

        // 慢工具以「工具超时」失败落 toolResult；快工具不受影响
        let msgs = agent.get_messages().await;
        let trs: Vec<_> = msgs
            .iter()
            .filter(|m| m.role == MessageRole::ToolResult)
            .collect();
        assert_eq!(trs.len(), 2, "两个并行工具都应有结果");
        let slow_tr = trs
            .iter()
            .find(|m| m.tool_call_id.as_deref() == Some("tc_slow"))
            .expect("应有慢工具结果");
        assert!(
            slow_tr.content.contains("工具超时"),
            "慢工具应超时失败: {}",
            slow_tr.content
        );
        let echo_tr = trs
            .iter()
            .find(|m| m.tool_call_id.as_deref() == Some("tc_echo"))
            .expect("应有 echo 结果");
        assert!(echo_tr.content.contains("hi"), "快工具应正常返回");
    }

    /// T4 契约：并行路径同样按 `tool_max_retries` 重试（失败两次后成功 → 调用 3 次），
    /// 且重试事件与串行同规（`LoopEngRetrying` 可达监听器）。
    #[tokio::test]
    async fn parallel_tool_retry_and_events_apply() {
        /// 前两次失败、第三次成功的工具
        struct FlakyTool {
            calls: Arc<AtomicUsize>,
        }
        #[async_trait]
        impl crate::tool::Tool for FlakyTool {
            fn name(&self) -> &str {
                "flaky"
            }
            fn description(&self) -> &str {
                "抖动工具（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                _args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                let n = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
                if n < 3 {
                    Err(crate::tool::ToolError::Execution(format!("第 {n} 次失败")))
                } else {
                    Ok(serde_json::json!({ "ok": n }))
                }
            }
        }

        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "并行".into(),
                tool_calls: vec![
                    ToolCall {
                        id: "tc_flaky".into(),
                        name: "flaky".into(),
                        args: serde_json::json!({}),
                    },
                    ToolCall {
                        id: "tc_echo".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "message": "hi" }),
                    },
                ],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let calls = Arc::new(AtomicUsize::new(0));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus
            .register(Arc::new(FlakyTool {
                calls: calls.clone(),
            }))
            .await;
        tool_bus.register(Arc::new(EchoTool)).await;

        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            parallel_tool_calls: true,
            tool_max_retries: 2,
            tool_retry_base_delay: std::time::Duration::from_millis(1),
            ..Default::default()
        });
        let recorder = Arc::new(LoopEngEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("跑".into()).await.expect("运行应成功");
        assert_eq!(result, "完成");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            3,
            "并行工具应重试至成功（失败 2 次 + 成功 1 次）"
        );

        // 重试事件同规：两次 LoopEngRetrying（attempt 1 / 2）
        let events = recorder.events.lock().unwrap().clone();
        let retrying_count = events
            .iter()
            .filter(|e| e.starts_with("retrying:"))
            .count();
        assert_eq!(
            retrying_count, 2,
            "并行路径应广播两次重试事件: {events:?}"
        );
    }

    /// T4 契约：并行路径同样经过 A6 钩子（pre 改参生效——此前并行直调总线绕过钩子）。
    #[tokio::test]
    async fn parallel_tool_hook_applies() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "并行".into(),
                tool_calls: vec![
                    ToolCall {
                        id: "tc_a".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "message": "a" }),
                    },
                    ToolCall {
                        id: "tc_b".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "message": "b" }),
                    },
                ],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;
        let post_calls = Arc::new(AtomicUsize::new(0));

        let agent = AgentLoop::new(backend, tool_bus)
            .with_tool_hook(Arc::new(ModifyingHook {
                post_calls: post_calls.clone(),
            }))
            .with_config(AgentLoopConfig {
                parallel_tool_calls: true,
                ..Default::default()
            });

        let result = agent.run("跑".into()).await.expect("运行应成功");
        assert_eq!(result, "完成");
        assert_eq!(
            post_calls.load(Ordering::SeqCst),
            2,
            "并行两个工具都应触发 post 钩子"
        );

        let msgs = agent.get_messages().await;
        let trs: Vec<_> = msgs
            .iter()
            .filter(|m| m.role == MessageRole::ToolResult)
            .collect();
        assert_eq!(trs.len(), 2);
        let hooked = trs
            .iter()
            .filter(|m| m.content.contains("hooked"))
            .count();
        assert_eq!(hooked, 2, "并行路径工具应收到钩子改写后的参数");
    }

    // ─── T1：工具失败结果判别契约（isError + errorCode） ─────────

    /// T1 契约：失败结果显式携带 `isError` + `errorCode`（未知工具 → UNKNOWN_TOOL），
    /// 且保留既有 `error` / `tool` 字段（加性改动）。
    #[tokio::test]
    async fn tool_failure_result_carries_discriminant_fields() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "调不存在的工具".into(),
                tool_calls: vec![ToolCall {
                    id: "tc_missing".into(),
                    name: "missing_tool".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        // 空总线：调用即 NotFound（UNKNOWN_TOOL）
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus);

        let result = agent.run("跑".into()).await.expect("运行应成功");
        assert_eq!(result, "完成");

        let msgs = agent.get_messages().await;
        let tr = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult && m.tool_call_id.as_deref() == Some("tc_missing"))
            .expect("应有失败 toolResult");
        let v: serde_json::Value =
            serde_json::from_str(&tr.content).expect("toolResult 应为 JSON");
        assert_eq!(v["isError"], true, "失败结果应显式 isError");
        assert_eq!(v["errorCode"], "UNKNOWN_TOOL");
        assert_eq!(v["tool"], "missing_tool");
        assert!(
            v["error"].as_str().unwrap_or("").contains("工具不存在"),
            "既有 error 字符串应保留: {v}"
        );
    }

    /// T1 契约：策略拒绝（敏感目录硬 Deny）同样携带判别字段（POLICY_DENIED），
    /// 且工具不被执行（守卫在确认预检段拦截；成功结果不携带 isError）。
    #[tokio::test]
    async fn policy_denied_result_carries_discriminant_fields() {
        /// 计数回显工具（具名 read_file 以命中 FS 守卫）
        struct CountingEcho(Arc<AtomicUsize>);
        #[async_trait]
        impl crate::tool::Tool for CountingEcho {
            fn name(&self) -> &str {
                "read_file"
            }
            fn description(&self) -> &str {
                "计数回显（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(args)
            }
        }

        let calls = Arc::new(AtomicUsize::new(0));
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "读密钥文件".into(),
                tool_calls: vec![ToolCall {
                    id: "tc_deny".into(),
                    name: "read_file".into(),
                    args: serde_json::json!({ "path": "~/.ssh/id_rsa" }),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus
            .register(Arc::new(CountingEcho(calls.clone())))
            .await;
        let agent = AgentLoop::new(backend, tool_bus);

        let result = agent.run("跑".into()).await.expect("运行应成功");
        assert_eq!(result, "完成");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "敏感目录工具不应被执行");

        let msgs = agent.get_messages().await;
        let tr = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult && m.tool_call_id.as_deref() == Some("tc_deny"))
            .expect("应有拒绝 toolResult");
        let v: serde_json::Value =
            serde_json::from_str(&tr.content).expect("toolResult 应为 JSON");
        assert_eq!(v["isError"], true);
        assert_eq!(v["errorCode"], "POLICY_DENIED");
        assert!(
            v["error"].as_str().unwrap_or("").contains("敏感目录"),
            "拒绝原因应保留: {v}"
        );
    }

    /// S4-c：项目规则 deny 经配置注入生效——工具不被执行且结果为 POLICY_DENIED
    /// （覆盖「config.project_rules → ctx.project → permission_machine 位次 4」整条接线）
    #[tokio::test]
    async fn project_rules_deny_blocks_tool_via_config() {
        struct CountingEcho(Arc<AtomicUsize>);
        #[async_trait]
        impl crate::tool::Tool for CountingEcho {
            fn name(&self) -> &str {
                "read_file"
            }
            fn description(&self) -> &str {
                "计数回显（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(args)
            }
        }

        let calls = Arc::new(AtomicUsize::new(0));
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "读文件".into(),
                tool_calls: vec![ToolCall {
                    id: "tc_proj".into(),
                    name: "read_file".into(),
                    args: serde_json::json!({ "path": "note.txt" }),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(CountingEcho(calls.clone()))).await;
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            workdir: Some(std::path::PathBuf::from("/ws")),
            project_rules: Some(Arc::new(crate::permission_machine::ProjectPermissionRules {
                deny: vec!["read_file".into()],
                ask: Vec::new(),
                allow: Vec::new(),
            })),
            ..Default::default()
        });

        let result = agent.run("跑".into()).await.expect("运行应成功");
        assert_eq!(result, "完成");
        assert_eq!(calls.load(Ordering::SeqCst), 0, "项目规则 deny 的工具不应被执行");
        let msgs = agent.get_messages().await;
        let tr = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult && m.tool_call_id.as_deref() == Some("tc_proj"))
            .expect("应有拒绝 toolResult");
        let v: serde_json::Value = serde_json::from_str(&tr.content).expect("toolResult 应为 JSON");
        assert_eq!(v["isError"], true);
        assert_eq!(v["errorCode"], "POLICY_DENIED");
        assert!(
            v["error"].as_str().unwrap_or("").contains("项目规则"),
            "拒绝原因应标明项目规则: {v}"
        );
    }

    /// S4-d / B7 四值回归：确认结果 → 工具结果判别码端到端
    /// （Approved 放行执行 / Denied→CONFIRM_DENIED / Skipped→CONFIRM_SKIPPED / Timeout→CONFIRM_TIMEOUT）
    #[tokio::test]
    async fn confirmation_four_values_map_to_payload_codes() {
        use crate::confirmation::{ConfirmationBroker, ConfirmationOutcome, ConfirmationPolicy};
        use std::time::Duration;

        /// 捕获确认请求 id（模拟前端：监听 `agent:confirm` 通道后回传）
        struct ConfirmCapture(std::sync::Mutex<Option<String>>);
        impl Listener for ConfirmCapture {
            fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
                if let OrchestratorEvent::ConfirmationRequested { confirm_id, .. } = event {
                    *self.0.lock().unwrap() = Some(confirm_id.clone());
                }
                ListenerOutcome::Continue
            }
        }

        struct CountingEcho(Arc<AtomicUsize>);
        #[async_trait]
        impl crate::tool::Tool for CountingEcho {
            fn name(&self) -> &str {
                "delegate_to_sub_agent" // Dangerous 级 → alwaysAsk（位次 5）
            }
            fn description(&self) -> &str {
                "计数回显（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                _args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(serde_json::json!({ "ok": true }))
            }
        }

        async fn run_case(
            resolve: Option<ConfirmationOutcome>,
            timeout_ms: Option<u64>,
        ) -> (usize, Option<serde_json::Value>) {
            let calls = Arc::new(AtomicUsize::new(0));
            let backend = Arc::new(MockBackend::new(vec![
                PromptResponse {
                    text: "委派".into(),
                    tool_calls: vec![ToolCall {
                        id: "tc_confirm".into(),
                        name: "delegate_to_sub_agent".into(),
                        args: serde_json::json!({}),
                    }],
                    input_tokens: None,
                    output_tokens: None,
                    stop_reason: Some("tool_calls".into()),
                    reasoning: None,
                },
                PromptResponse::text_only("完成"),
            ]));
            let tool_bus = Arc::new(SimpleToolBus::new());
            tool_bus.register(Arc::new(CountingEcho(calls.clone()))).await;
            let broker = Arc::new(match timeout_ms {
                Some(ms) => ConfirmationBroker::with_timeout(Duration::from_millis(ms)),
                None => ConfirmationBroker::new(),
            });
            let agent = Arc::new(
                AgentLoop::new(backend, tool_bus)
                    .with_config(AgentLoopConfig {
                        confirmation_policy: Some(ConfirmationPolicy::dangerous_only()),
                        ..Default::default()
                    })
                    .with_confirmation(Some(broker.clone())),
            );
            let capture = Arc::new(ConfirmCapture(std::sync::Mutex::new(None)));
            agent.subscribe(capture.clone()).await;

            let runner = agent.clone();
            let handle = tokio::spawn(async move { runner.run("跑".into()).await });
            if let Some(outcome) = resolve {
                for _ in 0..200 {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    let id = capture.0.lock().unwrap().clone();
                    if let Some(id) = id {
                        broker.resolve(&id, outcome).await;
                        break;
                    }
                }
            }
            handle.await.unwrap().expect("运行应成功");

            let msgs = agent.get_messages().await;
            let tr = msgs.iter().find(|m| {
                m.role == MessageRole::ToolResult && m.tool_call_id.as_deref() == Some("tc_confirm")
            });
            let value = tr.map(|m| serde_json::from_str(&m.content).expect("toolResult 应为 JSON"));
            (calls.load(Ordering::SeqCst), value)
        }

        // 放行：工具执行、结果不携带判别码
        let (calls, v) = run_case(Some(ConfirmationOutcome::Approved), None).await;
        assert_eq!(calls, 1, "Approved 应执行工具");
        let v = v.expect("应有 toolResult");
        assert!(v.get("isError").is_none(), "放行结果不应携带 isError: {v}");

        // 拒绝 / 跳过：不执行、判别码区分
        let (calls, v) = run_case(Some(ConfirmationOutcome::Denied), None).await;
        assert_eq!(calls, 0, "Denied 不应执行");
        assert_eq!(v.expect("应有拒绝结果")["errorCode"], "CONFIRM_DENIED");
        let (calls, v) = run_case(Some(ConfirmationOutcome::Skipped), None).await;
        assert_eq!(calls, 0, "Skipped 不应执行");
        assert_eq!(v.expect("应有跳过结果")["errorCode"], "CONFIRM_SKIPPED");

        // 超时（broker 30ms）：不执行、码为 CONFIRM_TIMEOUT
        let (calls, v) = run_case(None, Some(30)).await;
        assert_eq!(calls, 0, "Timeout 不应执行");
        assert_eq!(v.expect("应有超时结果")["errorCode"], "CONFIRM_TIMEOUT");
    }

    /// T1 契约：并行路径失败结果同样带判别字段（与串行同规）；成功结果不携带 `isError`。
    #[tokio::test]
    async fn parallel_failure_and_success_discriminants() {
        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: "并行".into(),
                tool_calls: vec![
                    ToolCall {
                        id: "tc_missing".into(),
                        name: "missing_tool".into(),
                        args: serde_json::json!({}),
                    },
                    ToolCall {
                        id: "tc_echo".into(),
                        name: "echo".into(),
                        args: serde_json::json!({ "message": "hi" }),
                    },
                ],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            parallel_tool_calls: true,
            ..Default::default()
        });

        agent.run("跑".into()).await.expect("运行应成功");

        let msgs = agent.get_messages().await;
        let failed: serde_json::Value = serde_json::from_str(
            &msgs
                .iter()
                .find(|m| m.tool_call_id.as_deref() == Some("tc_missing"))
                .expect("应有失败结果")
                .content,
        )
        .expect("失败结果应为 JSON");
        assert_eq!(failed["isError"], true);
        assert_eq!(failed["errorCode"], "UNKNOWN_TOOL");

        let ok: serde_json::Value = serde_json::from_str(
            &msgs
                .iter()
                .find(|m| m.tool_call_id.as_deref() == Some("tc_echo"))
                .expect("应有成功结果")
                .content,
        )
        .expect("成功结果应为 JSON");
        assert!(
            ok.get("isError").is_none(),
            "成功结果不应携带 isError（缺省即成功）: {ok}"
        );
    }

    // ─── 丁1 加急：上下文窗口面板 / 手动压缩 ─────────────────

    /// context_usage：窗口/阈值/触发点/层级/构成分项与自动裁剪同源可见
    #[tokio::test]
    async fn context_usage_reports_window_threshold_and_tier() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let backend = Arc::new(MockBackend::new(vec![]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)), // 阈值 1000 / 触发点 950
            ..Default::default()
        });

        let text = "中".repeat(1_000); // CJK 1 token/字 → 约 1001 token/条
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::System,
                    content: "系统提示词".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: text.clone(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: text,
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        let u = agent.context_usage().await;
        assert_eq!(u.context_window, 4_000);
        assert_eq!(u.archive_threshold, 1_000);
        assert_eq!(u.trim_trigger, 950);
        assert_eq!(u.message_count, 3);
        // 两条大消息各 ≈1000 token，必然越过触发点 → 最高层
        assert!(u.total_tokens > u.trim_trigger, "占用应越过触发点");
        assert_eq!(u.tier, 4);
        assert_eq!(
            u.history_tokens + u.system_tokens,
            u.total_tokens,
            "构成分项应加总一致"
        );
        assert!(u.system_tokens > 0, "系统侧（提示词）应计入占用");
    }

    /// 手动压缩「一次到底」：忽略触发点（占用远低于自动阈值也执行），
    /// 可裁内容全部折叠、受保护内容不动、释放可见且前后计量同源
    #[tokio::test]
    async fn compact_now_folds_all_droppable_and_keeps_protected() {
        use crate::anchor::is_folded;
        use crate::context_budget::ContextBudgetPolicy;
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        // 窗口 100K / 阈值 40K——当前占用远低于触发点（自动路径不会动手），
        // 手动压缩仍应立即执行（证明「忽略触发点」）
        let agent =
            AgentLoop::new(Arc::new(MockBackend::new(vec![])), Arc::new(SimpleToolBus::new()))
                .with_config(AgentLoopConfig {
                    context_budget: Some(ContextBudgetPolicy::new(100_000, 0.40)),
                    retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                    ..Default::default()
                })
                .with_raw_context_sink(sink);

        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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
        msgs.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "好的".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        agent.append_messages(msgs).await;

        let before = agent.context_usage().await;
        assert!(
            before.total_tokens < before.archive_threshold,
            "前置条件：占用未达归档阈值（自动路径不会触发）"
        );

        let outcome = agent.compact_now().await.expect("手动压缩应成功");
        assert_eq!(outcome.mode, "folded");
        assert_eq!(outcome.before_tokens, before.total_tokens, "before 应与查询同源");
        assert!(outcome.folded_groups >= 1, "陈旧组应被折叠");
        assert!(outcome.folded_messages >= 1);
        assert!(outcome.after_tokens < outcome.before_tokens, "压缩后占用应下降");
        assert!(outcome.saved_tokens > 0, "应有可见释放");
        assert_eq!(
            outcome.saved_tokens,
            outcome.before_tokens - outcome.after_tokens
        );
        assert_eq!(calls.load(Ordering::SeqCst), outcome.folded_groups, "外置次数应等于折叠组数");

        let kept = agent.get_messages().await;
        // 受保护内容仍在：系统提示 + 最新 user 输入
        assert!(kept.iter().any(|m| m.role == MessageRole::System), "系统消息应保留");
        assert!(kept.iter().any(|m| m.content.contains("最新指令")), "最新 user 输入应保留");
        // 折叠形存在（注入外置器 → 折叠路径）
        assert!(kept.iter().any(is_folded), "应存在折叠形");
    }

    /// 未注入外置器 → 删除路径（与自动路径同源的降级行为）
    #[tokio::test]
    async fn compact_now_drops_without_sink() {
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let agent =
            AgentLoop::new(Arc::new(MockBackend::new(vec![])), Arc::new(SimpleToolBus::new()))
                .with_config(AgentLoopConfig {
                    retention_policy: Some(RetentionPolicy { keep_recent: 1 }),
                    ..Default::default()
                });

        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..3 {
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

        let outcome = agent.compact_now().await.expect("应成功");
        assert_eq!(outcome.mode, "dropped");
        assert!(outcome.dropped_messages >= 1, "陈旧消息应被删除");

        let kept = agent.get_messages().await;
        assert!(kept.len() < before_len, "删除后条数应减少");
        assert!(kept.iter().any(|m| m.content.contains("最新指令")));
        assert!(kept.iter().any(|m| m.role == MessageRole::System));
    }

    /// 无可压内容（全在受保护范围内）→ mode="none"、零释放
    #[tokio::test]
    async fn compact_now_none_when_nothing_droppable() {
        use crate::types::{MessageRole, OrchestratorMessage};

        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::System,
                    content: "系统提示词".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "短问题".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: "短回答".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        let outcome = agent.compact_now().await.expect("应成功");
        assert_eq!(outcome.mode, "none");
        assert_eq!(outcome.saved_tokens, 0);
        assert_eq!(outcome.before_tokens, outcome.after_tokens);
    }

    /// 流式进行中拒绝手动压缩（循环正在写 state，避免竞态）
    #[tokio::test]
    async fn compact_now_rejected_while_streaming() {
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        agent.is_streaming.store(true, Ordering::SeqCst);
        let err = agent.compact_now().await.expect_err("流式中应拒绝");
        assert!(err.to_string().contains("流式"), "错误信息应说明流式原因: {err}");
    }

    // ── 阶段 3 · 压缩事件化（A2 补齐②③契约测试）──

    /// 压缩事件记录器 — 按括号三事件记标签（顺序敏感）
    struct CompactEventRecorder {
        labels: std::sync::Mutex<Vec<String>>,
        /// 可选共享时间线（与 MockBackend 的请求派发共写，验证相对顺序）
        timeline: Option<Arc<std::sync::Mutex<Vec<String>>>>,
    }

    impl CompactEventRecorder {
        fn new() -> Self {
            Self {
                labels: std::sync::Mutex::new(Vec::new()),
                timeline: None,
            }
        }

        /// 与共享时间线联动（压缩时机契约测试）
        fn with_timeline(timeline: Arc<std::sync::Mutex<Vec<String>>>) -> Self {
            Self {
                labels: std::sync::Mutex::new(Vec::new()),
                timeline: Some(timeline),
            }
        }

        fn labels(&self) -> Vec<String> {
            self.labels.lock().unwrap().clone()
        }
    }

    impl Listener for CompactEventRecorder {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            let label = match event {
                OrchestratorEvent::ContextCompactStarted {
                    trigger,
                    before_tokens,
                    tier,
                } => format!("started:{trigger}:{before_tokens}:{tier}"),
                OrchestratorEvent::ContextCompactFinished {
                    trigger,
                    mode,
                    folded_groups,
                    dropped_messages,
                    backfilled,
                    ..
                } => format!(
                    "finished:{trigger}:{mode}:{folded_groups}:{dropped_messages}:{backfilled}"
                ),
                OrchestratorEvent::ContextCompactFailed {
                    trigger, stage, ..
                } => format!("failed:{trigger}:{stage}"),
                _ => return ListenerOutcome::Continue,
            };
            if let Some(timeline) = &self.timeline {
                if let Ok(mut tl) = timeline.lock() {
                    tl.push(label.clone());
                }
            }
            self.labels.lock().unwrap().push(label);
            ListenerOutcome::Continue
        }
    }

    /// 构造「超线可折叠」场景（System + 4 条陈旧 + 最新 user + 回复）
    ///
    /// `timeline`：可选共享时间线（压缩事件与请求派发共写，验证相对顺序）
    async fn agent_with_stale_context(
        sink: Option<crate::raw_context::RawContextSink>,
        timeline: Option<Arc<std::sync::Mutex<Vec<String>>>>,
    ) -> AgentLoop {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let mut backend = MockBackend::new(vec![PromptResponse::text_only("好的")]);
        if let Some(timeline) = timeline {
            backend = backend.with_timeline(timeline);
        }
        let mut agent = AgentLoop::new(Arc::new(backend), Arc::new(SimpleToolBus::new()))
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                ..Default::default()
            });
        if let Some(sink) = sink {
            agent = agent.with_raw_context_sink(sink);
        }

        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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
        msgs.push(OrchestratorMessage {
            role: MessageRole::Assistant,
            content: "好的".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        });
        agent.append_messages(msgs).await;
        agent
    }

    /// 超线自动裁剪 → Started → Finished 括号成对；Finished 字段与实际折叠一致
    #[tokio::test]
    async fn context_budget_broadcasts_compact_bracket_events() {
        use crate::raw_context::{RawContextSink, RawRef};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        let agent = agent_with_stale_context(Some(sink), None).await;

        let recorder = Arc::new(CompactEventRecorder::new());
        agent.subscribe(recorder.clone()).await;
        agent.enforce_context_budget().await;

        let labels = recorder.labels();
        assert_eq!(
            labels.len(),
            2,
            "自动压缩应成对广播（Started → Finished）: {labels:?}"
        );
        assert!(
            labels[0].starts_with("started:auto:"),
            "左端应为 auto 触发: {labels:?}"
        );
        let parts: Vec<&str> = labels[1].split(':').collect();
        assert_eq!(parts[0], "finished");
        assert_eq!(parts[1], "auto");
        assert_eq!(parts[2], "folded", "注入外置器应走折叠: {labels:?}");
        let folded_groups: usize = parts[3].parse().unwrap();
        assert_eq!(
            folded_groups,
            calls.load(Ordering::SeqCst),
            "Finished 组数应与外置次数一致: {labels:?}"
        );
        assert_eq!(parts[5], folded_groups.to_string(), "回填数应等于折叠组数: {labels:?}");
    }

    /// 手动 /compact → 同一括号（trigger=manual；低于自动触发线也执行）
    #[tokio::test]
    async fn compact_now_broadcasts_compact_bracket_events() {
        use crate::raw_context::{RawContextSink, RawRef};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        let agent = agent_with_stale_context(Some(sink), None).await;

        let recorder = Arc::new(CompactEventRecorder::new());
        agent.subscribe(recorder.clone()).await;
        let outcome = agent.compact_now().await.expect("手动压缩应成功");
        assert!(outcome.saved_tokens > 0);

        let labels = recorder.labels();
        assert_eq!(labels.len(), 2, "手动压缩应成对广播: {labels:?}");
        assert!(
            labels[0].starts_with("started:manual:"),
            "左端应为 manual 触发: {labels:?}"
        );
        assert!(
            labels[1].starts_with("finished:manual:folded:"),
            "右端应为 manual 折叠: {labels:?}"
        );
    }

    /// 无可压内容 → 不构成事务（无括号事件）
    #[tokio::test]
    async fn compact_none_broadcasts_no_bracket_events() {
        use crate::types::{MessageRole, OrchestratorMessage};

        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::System,
                    content: "系统提示词".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "短问题".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        let recorder = Arc::new(CompactEventRecorder::new());
        agent.subscribe(recorder.clone()).await;
        let outcome = agent.compact_now().await.expect("应成功");
        assert_eq!(outcome.mode, "none");
        assert!(
            recorder.labels().is_empty(),
            "无可压内容不应产生括号事件: {:?}",
            recorder.labels()
        );
    }

    /// 折叠失败（backend.set_messages 拒绝）→ Failed 右端先广播、错误再上抛
    #[tokio::test]
    async fn compact_failure_broadcasts_failed_bracket() {
        use crate::raw_context::{RawContextSink, RawRef};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        // 后端拒绝 set_messages → fold_context 在视图覆盖阶段失败
        use crate::context_budget::ContextBudgetPolicy;
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};
        let agent = AgentLoop::new(
            Arc::new(MockBackend::failing_set_messages(vec![])),
            Arc::new(SimpleToolBus::new()),
        )
        .with_config(AgentLoopConfig {
            context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
            retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
            ..Default::default()
        })
        .with_raw_context_sink(sink);
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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

        let recorder = Arc::new(CompactEventRecorder::new());
        agent.subscribe(recorder.clone()).await;
        let err = agent.compact_now().await.expect_err("折叠失败应上抛");
        assert!(
            err.to_string().contains("注入的 set_messages 失败"),
            "错误应来自注入的失败: {err}"
        );

        let labels = recorder.labels();
        assert_eq!(labels.len(), 2, "失败路径应有左端 + 失败右端: {labels:?}");
        assert!(labels[0].starts_with("started:manual:"), "{labels:?}");
        assert_eq!(labels[1], "failed:manual:fold", "右端应为失败（fold 阶段）: {labels:?}");
    }

    // ─ 阶段 3 · A2 补齐①：请求派生前压缩（时机 + 短路）──

    /// 压缩发生在**请求派发之前**（修正前在 AfterRun——收益滞后一整轮）
    #[tokio::test]
    async fn compact_runs_before_request_dispatch() {
        use crate::anchor::is_folded;
        use crate::raw_context::{RawContextSink, RawRef};

        let timeline: Arc<std::sync::Mutex<Vec<String>>> =
            Arc::new(std::sync::Mutex::new(Vec::new()));
        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        let agent =
            agent_with_stale_context(Some(sink), Some(Arc::clone(&timeline))).await;

        let recorder = Arc::new(CompactEventRecorder::with_timeline(Arc::clone(&timeline)));
        agent.subscribe(recorder.clone()).await;
        let result = agent.run("继续推进".into()).await;
        assert!(result.is_ok(), "运行应成功: {result:?}");

        let tl = timeline.lock().unwrap().clone();
        let first_prompt = tl
            .iter()
            .position(|x| x == "prompt")
            .unwrap_or_else(|| panic!("应至少派发一次请求: {tl:?}"));
        let started = tl
            .iter()
            .position(|x| x.starts_with("started:auto:"))
            .unwrap_or_else(|| panic!("超线历史应在请求前触发压缩: {tl:?}"));
        let finished = tl
            .iter()
            .position(|x| x.starts_with("finished:auto:"))
            .unwrap_or_else(|| panic!("压缩应在请求前完成: {tl:?}"));
        assert!(
            started < first_prompt && finished < first_prompt,
            "括号必须闭合于首个请求派发之前（修正前滞后一整轮）: {tl:?}"
        );
        // 压缩确实改写了本轮的上下文视图（折叠形已就位）
        assert!(agent.get_messages().await.iter().any(is_folded));
    }

    /// 远离触发线时，轻量短路跳过逐条 token 估算（内容未变 → 不重计量）
    #[tokio::test]
    async fn pre_step_check_short_circuits_without_content_change() {
        use crate::context_budget::{ContextBudgetPolicy, TokenEstimator};
        use crate::types::{MessageRole, OrchestratorMessage};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let estimator: TokenEstimator = Arc::new(move |text: &str| {
            calls2.fetch_add(1, Ordering::SeqCst);
            crate::context_budget::estimate_tokens_heuristic(text)
        });

        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        )
        .with_config(AgentLoopConfig {
            // 100K 窗口 → 触发线远高于当前占用（短路应生效）
            context_budget: Some(ContextBudgetPolicy::new(100_000, 0.40)),
            ..Default::default()
        })
        .with_token_estimator(estimator);
        agent
            .append_messages(vec![
                OrchestratorMessage {
                    role: MessageRole::System,
                    content: "系统提示词".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
                OrchestratorMessage {
                    role: MessageRole::User,
                    content: "你好".into(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                },
            ])
            .await;

        // 首次：无基线 → 完整计量（逐条估算）并记录基线
        agent.enforce_context_budget().await;
        let after_first = calls.load(Ordering::SeqCst);
        assert!(after_first >= 2, "首次应逐条计量: {after_first}");

        // 二次：内容与系统侧均未变 → 轻量短路，不再调用估算器
        agent.enforce_context_budget().await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            after_first,
            "内容未变时应短路（不逐条估算 token）"
        );

        // 新增内容足以越线（字节下界 ≥ 触发线 38K token → 至少 152K 字节）→ 恢复完整计量
        agent
            .append_messages(vec![OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "x".repeat(200_000),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            }])
            .await;
        agent.enforce_context_budget().await;
        assert!(
            calls.load(Ordering::SeqCst) > after_first,
            "新增体量可能越线时应恢复完整计量"
        );
    }

    // ─ 阶段 3 · D4：压缩摘要（LLM 摘要替代规则浓缩）──

    /// 构造「可折叠 + 可注入后端」的压缩场景（摘要契约测试共用）
    async fn agent_with_stale_context_and_backend(
        backend: Arc<MockBackend>,
        sink: crate::raw_context::RawContextSink,
    ) -> AgentLoop {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()))
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(4_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                ..Default::default()
            })
            .with_raw_context_sink(sink);
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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
        agent
    }

    /// 摘要可用时：折叠回填文本 = 检查点前言 + LLM 摘要（模板/暖前缀/用量契约）
    #[tokio::test]
    async fn compaction_uses_llm_summary_when_available() {
        use crate::anchor::is_folded;
        use crate::raw_context::{RawContextSink, RawRef};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        let summary = "## Current Work\n正在推进阶段 3 压缩链路";
        let backend = Arc::new(MockBackend::new(vec![]).with_side_call_summary(summary));
        let agent = agent_with_stale_context_and_backend(Arc::clone(&backend), sink).await;

        let outcome = agent.compact_now().await.expect("手动压缩应成功");
        assert_eq!(outcome.mode, "folded");
        assert!(backend.side_calls.load(Ordering::SeqCst) >= 1, "应发起摘要旁路调用");

        // 折叠形回填文本应含检查点前言 + 摘要（而非规则浓缩切片）
        let kept = agent.get_messages().await;
        let folded: Vec<_> = kept.iter().filter(|m| is_folded(m)).collect();
        assert!(!folded.is_empty(), "应有折叠形");
        assert!(
            folded.iter().any(|m| m.content.contains("正在推进阶段 3 压缩链路")),
            "折叠形应含 LLM 摘要: {:?}",
            folded.iter().map(|m| m.content.chars().count()).collect::<Vec<_>>()
        );
        assert!(
            folded.iter().any(|m| m.content.contains("自动压缩检查点")),
            "摘要回填应带检查点前言"
        );

        // 指令含 8 章节模板（模板契约）；暖前缀 = 主对话历史快照（非空）
        let instruction = backend
            .last_side_instruction
            .lock()
            .await
            .clone()
            .expect("应记录指令");
        assert!(instruction.contains("## Primary Request and Intent"));
        assert!(instruction.contains("## Critical Context"));
        assert!(
            *backend.last_side_history_len.lock().await > 0,
            "暖前缀应携带主对话历史"
        );
        // 摘要调用用量计入会话累计
        let usage = agent.usage.lock().await;
        assert!(usage.input_tokens > 0 && usage.output_tokens > 0, "摘要用量应计入: {usage:?}");
    }

    /// 摘要不达标（shrink 校验失败）→ 逐组回退规则浓缩（压缩不回退、不中断）
    #[tokio::test]
    async fn compaction_falls_back_when_summary_not_shrunk() {
        use crate::anchor::is_folded;
        use crate::raw_context::{RawContextSink, RawRef};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        // 摘要与材料等量级（远大于 50%）→ 拒绝
        let oversized = "超长摘要片段".repeat(1_000);
        let backend = Arc::new(MockBackend::new(vec![]).with_side_call_summary(&oversized));
        let agent = agent_with_stale_context_and_backend(Arc::clone(&backend), sink).await;

        let outcome = agent.compact_now().await.expect("压缩应成功（摘要失败即回退）");
        assert_eq!(outcome.mode, "folded");
        assert!(backend.side_calls.load(Ordering::SeqCst) >= 1, "应尝试过摘要调用");

        let kept = agent.get_messages().await;
        let folded: Vec<_> = kept.iter().filter(|m| is_folded(m)).collect();
        assert!(!folded.is_empty(), "应有折叠形");
        assert!(
            folded.iter().all(|m| !m.content.contains("超长摘要片段")),
            "未达 shrink 校验的摘要不应进入回填文本"
        );
    }

    /// 单次压缩最多发起的摘要调用数有上限；超出组沿用规则浓缩
    #[tokio::test]
    async fn compaction_summary_calls_are_bounded_per_pass() {
        use crate::agent::compaction_summary::MAX_SUMMARY_CALLS_PER_COMPACTION;

        let backend = Arc::new(MockBackend::new(vec![]).with_side_call_summary("短摘要"));
        let agent = AgentLoop::new(backend.clone(), Arc::new(SimpleToolBus::new()));

        let mut folded = crate::anchor::FoldOutcome::default();
        for i in 0..5 {
            let hash = format!("{i:016x}");
            folded.fills.push((hash.clone(), format!("规则浓缩 {i}")));
            folded.materials.push((hash, "材料".repeat(100)));
        }
        let (fills, summarized) = agent.fold_fills_with_summaries(&folded).await;

        assert_eq!(fills.len(), 5, "回填材料数与折叠组等长");
        assert_eq!(
            summarized,
            MAX_SUMMARY_CALLS_PER_COMPACTION.min(5),
            "摘要组数应为预算上限与组数的较小值"
        );
        assert_eq!(
            backend.side_calls.load(Ordering::SeqCst),
            MAX_SUMMARY_CALLS_PER_COMPACTION,
            "旁路调用次数应被预算上限截断"
        );
        assert_eq!(fills[3].1, "规则浓缩 3", "超预算组应回退规则浓缩");
        assert_eq!(fills[4].1, "规则浓缩 4", "超预算组应回退规则浓缩");
    }

    // ─ 阶段 3 · ④：请求快照（可重建采集）──

    /// 请求快照记录器（阶段 3 · ④ 契约测试）
    struct SnapshotRecorder {
        snapshots: std::sync::Mutex<Vec<crate::agent::request_snapshot::RequestSnapshot>>,
    }

    impl SnapshotRecorder {
        fn new() -> Self {
            Self {
                snapshots: std::sync::Mutex::new(Vec::new()),
            }
        }

        fn snapshots(&self) -> Vec<crate::agent::request_snapshot::RequestSnapshot> {
            self.snapshots.lock().unwrap().clone()
        }

        /// 按用途过滤（`main` 主链路 / `compaction` 旁路）
        fn by_purpose(&self, purpose: &str) -> Vec<crate::agent::request_snapshot::RequestSnapshot> {
            self.snapshots()
                .into_iter()
                .filter(|s| s.purpose == purpose)
                .collect()
        }
    }

    impl Listener for SnapshotRecorder {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            if let OrchestratorEvent::RequestSnapshotCaptured { snapshot } = event {
                if let Ok(mut v) = self.snapshots.lock() {
                    v.push(snapshot.clone());
                }
            }
            ListenerOutcome::Continue
        }
    }

    /// 首条主链路快照 = 全量视图 + header 字段（系统提示 / 参数 / 工具随请求实际值）
    #[tokio::test]
    async fn request_snapshot_captures_header_and_full_view() {
        use crate::agent::request_snapshot::ViewUpdate;
        use crate::types::MessageRole;

        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![PromptResponse::text_only("好的")])),
            tool_bus,
        )
        .with_config(AgentLoopConfig {
            temperature: Some(0.3),
            max_tokens: Some(1234),
            system_prompt: Some("我是系统提示".into()),
            ..Default::default()
        });
        let recorder = Arc::new(SnapshotRecorder::new());
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("你好".into()).await;
        assert!(result.is_ok(), "运行应成功: {result:?}");

        let mains = recorder.by_purpose("main");
        assert_eq!(mains.len(), 1, "单轮应有一条主链路快照");
        let snap = &mains[0];
        assert_eq!(snap.system_prompt.as_deref(), Some("我是系统提示"));
        assert_eq!(snap.temperature, Some(0.3));
        assert_eq!(snap.max_tokens, Some(1234));
        assert_eq!(snap.tools_names, vec!["echo".to_string()]);
        assert!(snap.tools_json.is_some(), "有工具时应带全量 schema");
        assert!(snap.captured_at_ms > 0);
        assert!(snap.material_ref.is_none());
        match &snap.view_update {
            ViewUpdate::Full { messages } => {
                // run() 首条推入 System（config.system_prompt）+ 带时间戳前缀的 user 消息
                assert_eq!(messages.len(), 2, "首条快照应为全量视图: {messages:?}");
                assert_eq!(messages[0].role, MessageRole::System);
                assert_eq!(messages[0].content, "我是系统提示");
                assert_eq!(messages[1].role, MessageRole::User);
                assert!(
                    messages[1].content.ends_with("你好"),
                    "user 消息应带时间戳前缀: {}",
                    messages[1].content
                );
            }
            other => panic!("首条快照应为全量视图: {other:?}"),
        }
    }

    /// 第二条快照仅记增量（上条视图为前缀）；全量 + 增量可重建该请求视图
    #[tokio::test]
    async fn request_snapshot_appends_delta_between_requests() {
        use crate::agent::request_snapshot::ViewUpdate;
        use crate::types::{MessageRole, ToolCall};

        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(EchoTool)).await;
        let responses = vec![
            PromptResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    id: "tc1".into(),
                    name: "echo".into(),
                    args: serde_json::json!({ "text": "hello" }),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: None,
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ];
        let agent = AgentLoop::new(Arc::new(MockBackend::new(responses)), tool_bus);
        let recorder = Arc::new(SnapshotRecorder::new());
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("开始".into()).await;
        assert!(result.is_ok(), "{result:?}");

        let mains = recorder.by_purpose("main");
        assert_eq!(mains.len(), 2, "两轮应各有一条主链路快照");
        let full = match &mains[0].view_update {
            ViewUpdate::Full { messages } => messages.clone(),
            other => panic!("首条应为全量: {other:?}"),
        };
        let appended = match &mains[1].view_update {
            ViewUpdate::Appended { messages } => messages.clone(),
            other => panic!("第二条应为增量: {other:?}"),
        };
        // 增量 = 助手（工具调用）+ 工具结果
        assert_eq!(appended.len(), 2, "增量应为助手消息 + 工具结果: {appended:?}");
        assert!(!appended[0].tool_calls.is_empty(), "助手消息应带工具调用");
        assert_eq!(appended[1].role, MessageRole::ToolResult);

        // 重建：全量 + 增量 = 第二条请求派发时的视图（实际视图的前缀）
        let mut rebuilt = full;
        rebuilt.extend(appended);
        let actual = agent.get_messages().await;
        assert_eq!(
            rebuilt,
            actual[..rebuilt.len()],
            "重建视图应与实际视图前缀逐字段一致"
        );
    }

    /// 结构性改写（折叠）后 → 下一条快照回到全量；旁路（压缩摘要）快照同样入账
    #[tokio::test]
    async fn request_snapshot_falls_back_to_full_after_view_rewrite() {
        use crate::agent::request_snapshot::ViewUpdate;
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::types::{MessageRole, OrchestratorMessage};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });
        let agent = agent_with_stale_context(Some(sink), None).await;
        let recorder = Arc::new(SnapshotRecorder::new());
        agent.subscribe(recorder.clone()).await;
        let options = agent.build_prompt_options(&agent.config_snapshot()).await;

        agent.capture_request_snapshot("main", &options, None).await;
        // 追加一条 → 应为增量
        agent
            .append_messages(vec![OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "追加一条".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            }])
            .await;
        agent.capture_request_snapshot("main", &options, None).await;
        // 折叠改写中段 → 应为全量
        let _ = agent.compact_now().await.expect("压缩应成功");
        agent.capture_request_snapshot("main", &options, None).await;

        let mains = recorder.by_purpose("main");
        assert_eq!(mains.len(), 3, "三次采集应各留一条主链路快照");
        assert!(
            matches!(mains[0].view_update, ViewUpdate::Full { .. }),
            "首条应为全量"
        );
        match &mains[1].view_update {
            ViewUpdate::Appended { messages } => assert_eq!(messages.len(), 1, "仅记新增一条"),
            other => panic!("第二条应为增量: {other:?}"),
        }
        assert!(
            matches!(mains[2].view_update, ViewUpdate::Full { .. }),
            "折叠改写后应回退全量: {:?}",
            mains[2].view_update
        );

        // 旁路（压缩摘要）快照同样入账，且带材料坐标（指令 = 模板 + 该材料）
        let compactions = recorder.by_purpose("compaction");
        assert!(!compactions.is_empty(), "压缩摘要旁路调用应入账");
        assert!(
            compactions.iter().all(|s| s.material_ref.is_some()),
            "旁路快照应带材料坐标: {compactions:?}"
        );
    }

    /// 旁路行（pattern 直调，purpose 非本环）入链后：下一条主链路快照回退全量，
    /// 保证「重建基底 == 采集基点」不变式（否则重建会静默错位）
    #[tokio::test]
    async fn request_snapshot_falls_back_to_full_after_bypass_row() {
        use crate::agent::request_snapshot::{build_bypass_snapshot, ViewUpdate};
        use crate::types::MessageRole;

        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        let recorder = Arc::new(SnapshotRecorder::new());
        agent.subscribe(recorder.clone()).await;
        let options = agent.build_prompt_options(&agent.config_snapshot()).await;

        agent.capture_request_snapshot("main", &options, None).await;
        agent
            .append_messages(vec![OrchestratorMessage {
                role: MessageRole::Assistant,
                content: "追加一条".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            }])
            .await;

        // 模拟 pattern 旁路行经 BackendEventBridge 到达本环（直接在环内巴士投递）
        let bypass = build_bypass_snapshot(
            "router",
            "deepseek",
            "deepseek-v4-flash",
            &PromptCallOptions::default(),
            &[OrchestratorMessage {
                role: MessageRole::User,
                content: "路由判型请求".into(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            }],
        );
        agent.broadcaster_ref().read().await.broadcast(
            &OrchestratorEvent::RequestSnapshotCaptured {
                snapshot: bypass,
            },
        );

        // 若无锚点重置，本条本应为增量（上条视图是前缀）
        agent.capture_request_snapshot("main", &options, None).await;

        let mains = recorder.by_purpose("main");
        assert_eq!(mains.len(), 2, "应有两条主链路快照");
        match &mains[1].view_update {
            ViewUpdate::Full { messages } => {
                assert_eq!(
                    messages,
                    &agent.get_messages().await,
                    "锚点重置后本条应为全量，且与当前视图一致"
                );
            }
            other => panic!("旁路行入链后应回退全量: {other:?}"),
        }
    }

    // ── A5 错误分类路由（按码分流：重试 / 压缩触发 / 用户提示） ──

    /// 不可重试码（未配置凭证）→ 即时失败：不消耗退避重试，错误消息附用户引导
    #[tokio::test]
    async fn non_retryable_error_fails_fast_with_user_hint() {
        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![])
                .with_prompt_errors(vec![BackendError::MissingCredential(
                    "provider=deepseek".into(),
                )])
                .with_timeline(Arc::clone(&timeline)),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new())).with_config(
            AgentLoopConfig {
                llm_max_retries: 2,
                llm_retry_base_delay: std::time::Duration::from_millis(1),
                ..Default::default()
            },
        );
        let listener = Arc::new(TerminalEventListener {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(listener.clone()).await;

        let result = agent.run("测试".into()).await;
        assert!(
            matches!(result, Err(AgentError::Backend(_))),
            "不可重试码应即时失败: {result:?}"
        );

        let prompts = timeline
            .lock()
            .unwrap()
            .iter()
            .filter(|e| *e == "prompt")
            .count();
        assert_eq!(prompts, 1, "不可重试码不应重发（不浪费退避窗口）");

        let events = listener.events.lock().unwrap().clone();
        let err = events
            .iter()
            .find(|e| e.starts_with("error:"))
            .expect("应广播 Error 终态事件");
        assert!(err.contains("未配置 API Key"), "错误消息应含原因: {err}");
        assert!(
            err.contains("请在模型设置中填写"),
            "用户可行动码应附引导语: {err}"
        );
    }

    /// provider 溢出（CONTEXT_WINDOW_EXCEEDED）→ 强制压缩 + 视图重同步 + 重发；
    /// 压缩以 `overflow` 触发源入括号事件
    #[tokio::test]
    async fn provider_overflow_triggers_compaction_and_redispatches() {
        use crate::context_budget::ContextBudgetPolicy;
        use crate::raw_context::{RawContextSink, RawRef};
        use crate::retention::RetentionPolicy;
        use crate::types::{MessageRole, OrchestratorMessage};

        let calls = Arc::new(AtomicUsize::new(0));
        let calls2 = Arc::clone(&calls);
        let sink: RawContextSink = Arc::new(move |text: &str| {
            let i = calls2.fetch_add(1, Ordering::SeqCst);
            Some(RawRef {
                content_hash: format!("{i:016x}"),
                byte_len: text.len(),
            })
        });

        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![PromptResponse::text_only("压缩后完成")])
                .with_prompt_errors(vec![BackendError::ContextWindowExceeded(
                    "This model's maximum context length is 65536 tokens".into(),
                )])
                .with_timeline(Arc::clone(&timeline)),
        );
        // 预算放宽：派发前的常规压缩不触发（溢出由 provider 判定 = 计量的地面真值）
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()))
            .with_config(AgentLoopConfig {
                context_budget: Some(ContextBudgetPolicy::new(200_000, 0.25)),
                retention_policy: Some(RetentionPolicy { keep_recent: 2 }),
                ..Default::default()
            })
            .with_raw_context_sink(sink);
        // 陈旧历史（可折叠内容）
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::System,
            content: "系统提示词".into(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        for i in 0..4 {
            msgs.push(OrchestratorMessage {
                role: if i % 2 == 0 {
                    MessageRole::User
                } else {
                    MessageRole::Assistant
                },
                content: format!("陈旧 {i}：{}", "x".repeat(2_000)),
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

        let recorder = Arc::new(CompactEventRecorder::new());
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("继续推进".into()).await;
        assert_eq!(result.expect("压缩后重发应成功"), "压缩后完成");

        let prompts = timeline
            .lock()
            .unwrap()
            .iter()
            .filter(|e| *e == "prompt")
            .count();
        assert_eq!(prompts, 2, "首次失败 + 压缩后重发 = 两次派发");

        let labels = recorder.labels();
        assert!(
            labels.iter().any(|l| l.starts_with("started:overflow:")),
            "压缩应以 overflow 触发源广播: {labels:?}"
        );
        assert!(
            labels
                .iter()
                .any(|l| l.starts_with("finished:overflow:folded:")),
            "overflow 压缩应完成折叠: {labels:?}"
        );
        assert!(calls.load(Ordering::SeqCst) > 0, "应有外置（折叠）发生");
    }

    /// 空响应（无文本且无工具调用）→ 重发一次；第二次有内容则正常返回
    #[tokio::test]
    async fn empty_response_is_retried_once() {
        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![
                PromptResponse::text_only(""),
                PromptResponse::text_only("正常回复"),
            ])
            .with_timeline(Arc::clone(&timeline)),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));

        let result = agent.run("你好".into()).await.expect("重发后应成功");
        assert_eq!(result, "正常回复");

        let prompts = timeline
            .lock()
            .unwrap()
            .iter()
            .filter(|e| *e == "prompt")
            .count();
        assert_eq!(prompts, 2, "空响应应触发一次重发");
    }

    /// 连续空响应 → 仅重发一次，之后维持既有语义（返回空响应，不报错、不循环）
    #[tokio::test]
    async fn empty_response_returns_after_single_retry() {
        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![
                PromptResponse::text_only(""),
                PromptResponse::text_only(""),
            ])
            .with_timeline(Arc::clone(&timeline)),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));

        let result = agent.run("你好".into()).await.expect("不应报错");
        assert_eq!(result, "", "维持既有语义（空响应作为终稿返回）");

        let prompts = timeline
            .lock()
            .unwrap()
            .iter()
            .filter(|e| *e == "prompt")
            .count();
        assert_eq!(prompts, 2, "仅重发一次（防循环）");
    }

    // ── A3 输入模型（三通道 / pre-step 准入 / 取消收口） ─

    /// 时间线上的 prompt 次数（A3/A5 契约断言复用）
    fn prompts_in(timeline: &Arc<std::sync::Mutex<Vec<String>>>) -> usize {
        timeline
            .lock()
            .unwrap()
            .iter()
            .filter(|e| *e == "prompt")
            .count()
    }

    /// `Inject` 不唤醒；下一次运行时经准入注入，且排在**本条 user 消息之前**（提交序 = 上下文序）
    #[tokio::test]
    async fn inject_is_queued_without_waking_and_lands_before_next_user_message() {
        use crate::agent::input::{InputKind, SubmitOutcome};

        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![PromptResponse::text_only("完成")])
                .with_timeline(Arc::clone(&timeline)),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));

        let outcome = agent
            .submit_input(InputKind::Inject, "背景资料：X".to_string())
            .await
            .expect("注入提交应成功");
        assert_eq!(outcome, SubmitOutcome::Queued, "注入不唤醒");
        assert_eq!(prompts_in(&timeline), 0, "注入不得触发运行");

        let reply = agent.run("问题".to_string()).await.expect("运行应成功");
        assert_eq!(reply, "完成");
        assert_eq!(prompts_in(&timeline), 1);

        let msgs = agent.get_messages().await;
        let idx_inject = msgs
            .iter()
            .position(|m| m.content == "背景资料：X")
            .expect("注入应进入消息视图");
        let idx_user = msgs
            .iter()
            .position(|m| m.content.contains("问题"))
            .expect("应有本轮 user 消息");
        assert!(
            idx_inject < idx_user,
            "空闲期注入应排在本轮 user 消息之前: {msgs:?}"
        );
        assert_eq!(
            msgs[idx_inject].meta.as_ref().unwrap()["input_kind"],
            serde_json::json!("inject")
        );
    }

    /// `Steer` 空闲时唤醒（对齐 dsh）：同步跑完一轮并返回 `Started`
    #[tokio::test]
    async fn steer_wakes_when_idle() {
        use crate::agent::input::{InputKind, SubmitOutcome};

        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![PromptResponse::text_only("好的")])
                .with_timeline(Arc::clone(&timeline)),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));

        let outcome = agent
            .submit_input(InputKind::Steer, "换个方向".to_string())
            .await
            .expect("steer 应成功");
        assert_eq!(outcome, SubmitOutcome::Started, "空闲 steer 应唤醒");
        assert_eq!(prompts_in(&timeline), 1, "唤醒应实际派发一轮请求");

        let msgs = agent.get_messages().await;
        assert!(
            msgs.iter().any(|m| m.content.contains("换个方向")),
            "唤醒输入应进入消息视图: {msgs:?}"
        );
    }

    /// 工具：轮内提交 steer（模拟"运行中插话"）——steer 应在**下一轮请求前**被准入注入
    struct SteerInTurnTool {
        agent: std::sync::Weak<AgentLoop>,
    }

    #[async_trait]
    impl crate::tool::Tool for SteerInTurnTool {
        fn name(&self) -> &str {
            "steer_in_turn"
        }
        fn description(&self) -> &str {
            "轮内提交 steer（测试用）"
        }
        fn parameters(&self) -> serde_json::Value {
            serde_json::json!({ "type": "object", "properties": {} })
        }
        async fn execute(
            &self,
            _args: serde_json::Value,
        ) -> Result<serde_json::Value, crate::tool::ToolError> {
            if let Some(agent) = self.agent.upgrade() {
                let outcome = agent
                    .submit_input(
                        crate::agent::input::InputKind::Steer,
                        "插话：先看 A".to_string(),
                    )
                    .await;
                assert_eq!(
                    outcome.expect("运行中 steer 应成功"),
                    crate::agent::input::SubmitOutcome::Queued,
                    "运行中 steer 应入队（不重入运行）"
                );
            }
            Ok(serde_json::json!({ "ok": true }))
        }
    }

    /// `Steer` 运行中入队（不打断当前轮），由下一轮请求前的准入注入（排在工具结果之后）
    #[tokio::test]
    async fn steer_while_streaming_is_queued_and_admitted_at_next_step() {
        use crate::types::{MessageRole, ToolCall};

        let timeline = Arc::new(std::sync::Mutex::new(Vec::new()));
        let backend = Arc::new(
            MockBackend::new(vec![
                PromptResponse {
                    text: "先执行一步".into(),
                    tool_calls: vec![ToolCall {
                        id: "tc_steer".into(),
                        name: "steer_in_turn".into(),
                        args: serde_json::json!({}),
                    }],
                    input_tokens: None,
                    output_tokens: None,
                    stop_reason: Some("tool_calls".into()),
                    reasoning: None,
                },
                PromptResponse::text_only("完成"),
            ])
            .with_timeline(Arc::clone(&timeline)),
        );
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = Arc::new(AgentLoop::new(backend, tool_bus.clone()));
        tool_bus
            .register(Arc::new(SteerInTurnTool {
                agent: Arc::downgrade(&agent),
            }))
            .await;

        let reply = agent.run("开始任务".to_string()).await.expect("运行应成功");
        assert_eq!(reply, "完成");
        assert_eq!(prompts_in(&timeline), 2, "两轮请求（插话不额外派发）");

        let msgs = agent.get_messages().await;
        let idx_user = msgs
            .iter()
            .position(|m| m.content.contains("开始任务"))
            .expect("应有本轮 user 消息");
        let idx_tool_result = msgs
            .iter()
            .position(|m| m.role == MessageRole::ToolResult)
            .expect("应有工具结果");
        let idx_steer = msgs
            .iter()
            .position(|m| m.content == "插话：先看 A")
            .expect("插话应被准入注入");
        assert!(
            idx_steer > idx_tool_result && idx_steer > idx_user,
            "运行中插话应注入在工具结果之后（下一轮请求前）: {msgs:?}"
        );
        assert_eq!(
            msgs[idx_steer].meta.as_ref().unwrap()["input_kind"],
            serde_json::json!("steer")
        );
    }

    /// 准入 waterfall 监听器：改写 / 丢弃 / 否决（否决则输入回退队列，留待下一轮）
    #[tokio::test]
    async fn admission_waterfall_allows_rewrite_drop_and_veto() {
        use crate::agent::input::InputKind;
        use crate::event_bus::{Next, Outcome};

        /// mode: 1=改写 / 2=丢弃 / 3=否决（不调 next）
        struct AdmissionListener {
            mode: u8,
        }
        impl Listener for AdmissionListener {
            fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                ListenerOutcome::Continue
            }
            fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
                if let OrchestratorEvent::InputAdmission { items, .. } = event {
                    match self.mode {
                        1 => {
                            for item in items.iter_mut() {
                                item.text = "改写后".to_string();
                            }
                        }
                        2 => items.clear(),
                        3 => return Outcome::Vetoed,
                        _ => {}
                    }
                }
                next.run(event)
            }
        }

        // 1) 改写：监听器改文本 → 注入改写值
        {
            let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("ok")]));
            let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));
            agent
                .subscribe(Arc::new(AdmissionListener { mode: 1 }))
                .await;
            agent
                .submit_input(InputKind::Inject, "原始文本".to_string())
                .await
                .unwrap();
            agent.run("问题".to_string()).await.unwrap();
            let msgs = agent.get_messages().await;
            assert!(msgs.iter().any(|m| m.content == "改写后"), "应按改写值注入");
            assert!(!msgs.iter().any(|m| m.content == "原始文本"), "原值不应注入");
        }

        // 2) 丢弃：items 置空 → 不注入
        {
            let backend = Arc::new(MockBackend::new(vec![PromptResponse::text_only("ok")]));
            let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));
            agent
                .subscribe(Arc::new(AdmissionListener { mode: 2 }))
                .await;
            agent
                .submit_input(InputKind::Inject, "应当被丢弃".to_string())
                .await
                .unwrap();
            agent.run("问题".to_string()).await.unwrap();
            let msgs = agent.get_messages().await;
            assert!(
                !msgs.iter().any(|m| m.content == "应当被丢弃"),
                "丢弃的输入不应注入"
            );
        }

        // 3) 否决：不调 next → 本轮不消费，输入回退队列（下一轮再准入）
        {
            let backend = Arc::new(MockBackend::new(vec![
                PromptResponse::text_only("第一轮"),
                PromptResponse::text_only("第二轮"),
            ]));
            let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new()));
            agent
                .subscribe(Arc::new(AdmissionListener { mode: 3 }))
                .await;
            agent
                .submit_input(InputKind::Inject, "被否决的注入".to_string())
                .await
                .unwrap();
            agent.run("第一问".to_string()).await.unwrap();
            let msgs = agent.get_messages().await;
            assert!(
                !msgs.iter().any(|m| m.content == "被否决的注入"),
                "否决轮不应注入"
            );
            // 取消监听（新实例不可注销 → 用永不否决的监听器不足以覆盖；改为直接跑第二轮验证仍然否决）
            let agent2 = &agent;
            agent2.run("第二问".to_string()).await.unwrap();
            let msgs = agent.get_messages().await;
            assert!(
                !msgs.iter().any(|m| m.content == "被否决的注入"),
                "持续否决下输入应一直留在队列"
            );
        }
    }

    /// 取消收口：已交付文本落为终稿（含中断锚点）+ `StreamEnd` / `AgentInterrupted` 收口广播
    #[tokio::test]
    async fn abort_finalizes_delivered_text_with_interrupt_anchor() {
        use crate::types::{MessageRole, ToolCall};

        /// 工具：模拟"流式已交付半截文本"后触发用户中断
        struct AbortAfterStreamTool {
            agent: std::sync::Weak<AgentLoop>,
        }
        #[async_trait]
        impl crate::tool::Tool for AbortAfterStreamTool {
            fn name(&self) -> &str {
                "abort_after_stream"
            }
            fn description(&self) -> &str {
                "模拟流式后中断（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                _args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                if let Some(agent) = self.agent.upgrade() {
                    agent
                        .broadcaster_ref()
                        .write()
                        .await
                        .broadcast(&OrchestratorEvent::Agent(AgentEvent::StreamDelta {
                            delta: "半截输出".to_string(),
                        }));
                    agent.abort().await;
                }
                Ok(serde_json::json!({ "ok": true }))
            }
        }

        /// 终态事件记录器（StreamEnd / AgentInterrupted）
        struct CancelRecorder {
            events: std::sync::Mutex<Vec<String>>,
        }
        impl Listener for CancelRecorder {
            fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
                let label = match event {
                    OrchestratorEvent::Agent(AgentEvent::StreamEnd { full_text }) => {
                        Some(format!("stream_end:{full_text}"))
                    }
                    OrchestratorEvent::AgentInterrupted { reason, .. } => {
                        Some(format!("interrupted:{reason}"))
                    }
                    _ => None,
                };
                if let Some(label) = label {
                    if let Ok(mut v) = self.events.lock() {
                        v.push(label);
                    }
                }
                ListenerOutcome::Continue
            }
        }

        let backend = Arc::new(MockBackend::new(vec![PromptResponse {
            text: String::new(),
            tool_calls: vec![ToolCall {
                id: "tc_abort".into(),
                name: "abort_after_stream".into(),
                args: serde_json::json!({}),
            }],
            input_tokens: None,
            output_tokens: None,
            stop_reason: Some("tool_calls".into()),
            reasoning: None,
        }]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        let agent = Arc::new(AgentLoop::new(backend, tool_bus.clone()));
        tool_bus
            .register(Arc::new(AbortAfterStreamTool {
                agent: Arc::downgrade(&agent),
            }))
            .await;
        let recorder = Arc::new(CancelRecorder {
            events: std::sync::Mutex::new(Vec::new()),
        });
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("开始".to_string()).await;
        assert!(
            matches!(result, Err(AgentError::Aborted)),
            "中断应返回 Aborted: {result:?}"
        );

        // 已交付文本落为终稿 + 中断锚点
        let msgs = agent.get_messages().await;
        let last = msgs.last().expect("应有消息");
        assert_eq!(last.role, MessageRole::Assistant, "终稿应为 assistant: {last:?}");
        assert_eq!(last.content, "半截输出", "终稿内容应为已交付文本");
        let meta = last.meta.as_ref().expect("应有锚点元数据");
        assert_eq!(meta["interrupted"], serde_json::json!(true));
        assert_eq!(meta["interrupted_reason"], serde_json::json!("user_abort"));
        assert!(meta["interrupted_iteration"].is_number());

        // 收口事件：StreamEnd（气泡转终稿）+ AgentInterrupted（活动日志）
        let events = recorder.events.lock().unwrap().clone();
        assert!(
            events.iter().any(|e| e == "stream_end:半截输出"),
            "应广播 StreamEnd 收口: {events:?}"
        );
        assert!(
            events.iter().any(|e| e == "interrupted:user_abort"),
            "应广播 AgentInterrupted: {events:?}"
        );
    }

    /// 收口幂等：重复 `finalize_interrupted_turn` 不重复落消息
    /// （收口广播会被记录器回写 → 缓冲在广播之后统一清空）
    #[tokio::test]
    async fn interrupted_finalize_is_idempotent() {
        use crate::types::MessageRole;

        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        // 模拟"流式已交付"（StreamDelta 直达本环巴士）
        agent
            .broadcaster_ref()
            .write()
            .await
            .broadcast(&OrchestratorEvent::Agent(AgentEvent::StreamDelta {
                delta: "半截输出".to_string(),
            }));

        agent.finalize_interrupted_turn("user_abort", 2).await;
        agent.finalize_interrupted_turn("user_abort", 2).await;

        let msgs = agent.get_messages().await;
        let interrupted: Vec<_> = msgs
            .iter()
            .filter(|m| m.role == MessageRole::Assistant && m.content == "半截输出")
            .collect();
        assert_eq!(interrupted.len(), 1, "重复收口不应重复落消息: {msgs:?}");
        assert!(
            agent.delivered_text_snapshot().is_empty(),
            "收口后已交付缓冲应清空（广播回写被收口清空覆盖）"
        );
    }

    // ── A4 双端收口：结构化提示段 ───

    /// 结构化段展开：TS 段按各自 order 排序（config.system_prompt 单段不参与）
    #[tokio::test]
    async fn build_prompt_options_expands_structured_sections() {
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        )
        .with_config(AgentLoopConfig {
            system_prompt: Some("legacy 文本（应被结构化段覆盖）".into()),
            prompt_sections: vec![
                PromptSection::new("skill_index", 270, "技能索引"),
                PromptSection::new("worldsea", 200, "系统说明"),
                PromptSection::new("project_agents", 240, "项目规则"),
                PromptSection::new("mcp_note", 290, "[MCP 环境] 已连接 2 个服务器"),
            ],
            ..Default::default()
        });

        let opts = agent.build_prompt_options(&agent.config_snapshot()).await;
        assert_eq!(
            opts.system_prompt_override.as_deref(),
            Some("系统说明\n\n项目规则\n\n技能索引\n\n[MCP 环境] 已连接 2 个服务器"),
            "段应按 order 升序拼接、legacy 文本不参与"
        );
    }

    /// 空结构化段回退 legacy 单段（群聊 / 老会话路径行为不变）
    #[tokio::test]
    async fn build_prompt_options_falls_back_to_legacy_single_section() {
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        )
        .with_config(AgentLoopConfig {
            system_prompt: Some("legacy 文本".into()),
            ..Default::default()
        });

        let opts = agent.build_prompt_options(&agent.config_snapshot()).await;
        assert_eq!(opts.system_prompt_override.as_deref(), Some("legacy 文本"));
    }

    /// set_prompt_sections 同步刷新 system_prompt 缓存（= 段组装静态合集文本）
    #[tokio::test]
    async fn set_prompt_sections_syncs_static_cache() {
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );

        agent
            .set_prompt_sections(vec![
                PromptSection::new("worldsea", 200, "系统说明"),
                PromptSection::new("mcp_note", 290, "[MCP 环境] 注记"),
            ])
            .await;

        let snap = agent.config_snapshot();
        assert_eq!(snap.prompt_sections.len(), 2);
        assert_eq!(
            snap.system_prompt.as_deref(),
            Some("系统说明\n\n[MCP 环境] 注记"),
            "system_prompt 缓存应为段组装文本（供首条 System 消息推入）"
        );
    }

    // ── 阶段 1 第二段迁移：工具结果裁剪（广播前 waterfall 预处理）──

    /// 广播前预处理三态契约：零监听器=默认裁剪 / 监听器改写=取回改写值 / 否决=兜底裁剪
    #[tokio::test]
    async fn tool_result_prebroadcast_default_rewrite_and_veto() {
        use super::tools::TOOL_RESULT_STR_LIMIT;
        use crate::event::keys;
        use crate::event_bus::{Next, Outcome};

        let huge = |marker: &str| format!("{marker}{}TAIL", "x".repeat(TOOL_RESULT_STR_LIMIT * 2));

        // 1) 零监听器：链尾内建 = 现行裁剪 → 与迁移前一致（含截断标注、首尾保留）
        {
            let agent = AgentLoop::new(
                Arc::new(MockBackend::new(vec![])),
                Arc::new(SimpleToolBus::new()),
            );
            let mut value = serde_json::Value::String(huge("HEAD"));
            agent
                .preprocess_tool_result("call_1", "terminal", &mut value)
                .await;
            let out = value.as_str().unwrap();
            assert!(out.contains("已截断"), "默认裁剪应生效: {out:.80}");
            assert!(
                out.starts_with("HEAD") && out.ends_with("TAIL"),
                "首尾保留契约不变"
            );
        }

        // 2) 监听器改写：取回改写值，且身份字段（tool_call_id / tool_name）可见
        {
            struct RewriteListener {
                seen: std::sync::Mutex<Vec<(String, String)>>,
            }
            impl Listener for RewriteListener {
                fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                    ListenerOutcome::Continue
                }
                fn call_waterfall(&self, event: &mut OrchestratorEvent, next: Next<'_>) -> Outcome {
                    if let OrchestratorEvent::ToolResultPreBroadcast {
                        tool_call_id,
                        tool_name,
                        result,
                    } = event
                    {
                        self.seen
                            .lock()
                            .unwrap()
                            .push((tool_call_id.clone(), tool_name.clone()));
                        *result = serde_json::json!({ "redacted": true });
                    }
                    next.run(event)
                }
            }

            let agent = AgentLoop::new(
                Arc::new(MockBackend::new(vec![])),
                Arc::new(SimpleToolBus::new()),
            );
            let listener = Arc::new(RewriteListener {
                seen: std::sync::Mutex::new(Vec::new()),
            });
            agent
                .subscribe_key(keys::TOOL_RESULT_PRE_BROADCAST, listener.clone())
                .await;

            let mut value = serde_json::Value::String(huge("HEAD"));
            agent
                .preprocess_tool_result("call_2", "read_file", &mut value)
                .await;

            assert_eq!(
                value,
                serde_json::json!({ "redacted": true }),
                "应取回监听器改写后的负载"
            );
            assert_eq!(
                listener.seen.lock().unwrap().as_slice(),
                &[("call_2".to_string(), "read_file".to_string())],
                "监听器应收到身份字段"
            );
        }

        // 3) 否决（不调 next）：链尾裁剪被跳过 → 调用方兜底裁剪仍生效（防爆兜底不可绕过）
        {
            struct VetoListener;
            impl Listener for VetoListener {
                fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                    ListenerOutcome::Continue
                }
                fn call_waterfall(&self, _event: &mut OrchestratorEvent, _next: Next<'_>) -> Outcome {
                    Outcome::Vetoed
                }
            }

            let agent = AgentLoop::new(
                Arc::new(MockBackend::new(vec![])),
                Arc::new(SimpleToolBus::new()),
            );
            agent
                .subscribe_key(keys::TOOL_RESULT_PRE_BROADCAST, Arc::new(VetoListener))
                .await;

            let mut value = serde_json::Value::String(huge("HEAD"));
            agent
                .preprocess_tool_result("call_3", "terminal", &mut value)
                .await;
            let out = value.as_str().unwrap();
            assert!(out.contains("已截断"), "否决不可绕过防爆兜底: {out:.80}");
        }
    }

    /// 端到端红线（05-§2.4）：裁剪发生在广播前、广播与入历史单副本逐字节一致
    #[tokio::test]
    async fn tool_result_prebroadcast_before_broadcast_single_copy() {
        use super::tools::TOOL_RESULT_STR_LIMIT;
        use crate::event::keys;

        /// 返回超长字符串的工具（触发裁剪）
        struct HugeOutputTool;
        #[async_trait]
        impl crate::tool::Tool for HugeOutputTool {
            fn name(&self) -> &str {
                "huge_output"
            }
            fn description(&self) -> &str {
                "超长输出（测试用）"
            }
            fn parameters(&self) -> serde_json::Value {
                serde_json::json!({ "type": "object", "properties": {} })
            }
            async fn execute(
                &self,
                _args: serde_json::Value,
            ) -> Result<serde_json::Value, crate::tool::ToolError> {
                Ok(serde_json::Value::String(format!(
                    "HEAD{}TAIL",
                    "x".repeat(TOOL_RESULT_STR_LIMIT * 2)
                )))
            }
        }

        /// 捕获 ToolCallEnd 广播负载
        struct ToolEndRecorder {
            results: std::sync::Mutex<Vec<(String, serde_json::Value)>>,
        }
        impl Listener for ToolEndRecorder {
            fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
                if let OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                    tool_call_id,
                    result,
                    ..
                }) = event
                {
                    self.results
                        .lock()
                        .unwrap()
                        .push((tool_call_id.clone(), result.clone()));
                }
                ListenerOutcome::Continue
            }
        }

        let backend = Arc::new(MockBackend::new(vec![
            PromptResponse {
                text: String::new(),
                tool_calls: vec![ToolCall {
                    id: "tc_huge".into(),
                    name: "huge_output".into(),
                    args: serde_json::json!({}),
                }],
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some("tool_calls".into()),
                reasoning: None,
            },
            PromptResponse::text_only("完成"),
        ]));
        let tool_bus = Arc::new(SimpleToolBus::new());
        tool_bus.register(Arc::new(HugeOutputTool)).await;

        let agent = AgentLoop::new(backend, tool_bus);
        let recorder = Arc::new(ToolEndRecorder {
            results: std::sync::Mutex::new(Vec::new()),
        });
        agent
            .subscribe_key(keys::TOOL_CALL_END, recorder.clone())
            .await;

        agent.run("跑工具".to_string()).await.expect("运行应成功");

        // 广播侧：已裁剪
        let broadcast = recorder.results.lock().unwrap();
        assert_eq!(broadcast.len(), 1, "应捕获一次 ToolCallEnd: {broadcast:?}");
        let (call_id, b_result) = &broadcast[0];
        assert_eq!(call_id, "tc_huge");
        let b_text = b_result.as_str().unwrap();
        assert!(b_text.contains("已截断"), "广播侧应为裁剪后内容: {b_text:.80}");

        // 历史侧：与广播负载逐字节一致（裁剪在广播前 / 单副本）
        let msgs = agent.get_messages().await;
        let tool_msg = msgs
            .iter()
            .find(|m| m.role == MessageRole::ToolResult)
            .expect("应有工具结果消息");
        assert_eq!(
            &tool_msg.content,
            &serde_json::to_string(b_result).unwrap(),
            "入历史内容应与广播负载逐字节一致（广播前裁剪 / 单副本）"
        );
    }

    // ── 风险点处置（2026-09-17）：分发不持外包锁 ──

    /// 分发运行监听器链期间**不持广播器外包锁**：
    /// ① 链内注册可即时完成（另一任务取写锁不阻塞——若持锁则超时未完成）；
    /// ② 注册不作用于本轮（快照语义 C3），下一轮起生效
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn dispatch_does_not_hold_broadcaster_lock_and_registration_defers() {
        use crate::event::keys;

        /// 链尾监听器（新注册者）：计收到的条数
        struct TailCounter {
            count: Arc<AtomicUsize>,
        }
        impl Listener for TailCounter {
            fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                self.count.fetch_add(1, Ordering::SeqCst);
                ListenerOutcome::Continue
            }
        }

        /// 链内注册探针：首次进入时发起"注册新监听器"任务，并等待其完成
        struct RegisterProbe {
            agent: std::sync::Weak<AgentLoop>,
            new_listener_count: Arc<AtomicUsize>,
            /// 注册任务是否已完成（未完成 = 分发持锁，写锁被阻塞）
            registered: Arc<AtomicBool>,
            /// 只发起一次注册（第二轮回调不再重复）
            spawned: AtomicBool,
        }
        impl Listener for RegisterProbe {
            fn call(&self, _event: &OrchestratorEvent) -> ListenerOutcome {
                if self.spawned.swap(true, Ordering::SeqCst) {
                    return ListenerOutcome::Continue;
                }
                let Some(agent) = self.agent.upgrade() else {
                    return ListenerOutcome::Continue;
                };
                let count = Arc::clone(&self.new_listener_count);
                let done = Arc::clone(&self.registered);
                tokio::spawn(async move {
                    agent
                        .subscribe_key(keys::TOOL_CALL_END, Arc::new(TailCounter { count }))
                        .await;
                    done.store(true, Ordering::SeqCst);
                });
                // 等待注册完成：若分发仍持外包锁，写锁获取将一直等待 → 本轮超时未置位
                for _ in 0..80 {
                    if self.registered.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                ListenerOutcome::Continue
            }
        }

        let agent = Arc::new(AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        ));
        let new_listener_count = Arc::new(AtomicUsize::new(0));
        let registered = Arc::new(AtomicBool::new(false));
        agent
            .subscribe_key(
                keys::TOOL_CALL_END,
                Arc::new(RegisterProbe {
                    agent: Arc::downgrade(&agent),
                    new_listener_count: Arc::clone(&new_listener_count),
                    registered: Arc::clone(&registered),
                    spawned: AtomicBool::new(false),
                }),
            )
            .await;

        let event = |id: &str| {
            OrchestratorEvent::Agent(AgentEvent::ToolCallEnd {
                tool_call_id: id.to_string(),
                result: serde_json::json!({ "ok": true }),
                status: "success".to_string(),
                duration_ms: 1,
                error: None,
            })
        };

        // 第一轮：链内注册（若持锁则 registered 超时未置位）
        agent.broadcast(event("tc_lock_1")).await;
        assert!(
            registered.load(Ordering::SeqCst),
            "链内注册应即时完成——分发不得持有广播器外包锁"
        );
        assert_eq!(
            new_listener_count.load(Ordering::SeqCst),
            0,
            "分发中注册不作用于本轮（快照语义）"
        );

        // 第二轮：新监听器生效
        agent.broadcast(event("tc_lock_2")).await;
        assert_eq!(
            new_listener_count.load(Ordering::SeqCst),
            1,
            "新注册监听器应自下一轮起生效"
        );
    }

    // ── A5 后续（2026-09-17）：Retry-After 头支持 + 错误结果结构化字段 ──

    /// `Retry-After` 优先于指数退避（取大、超上限截断）；终态 `Error` 事件带
    /// 结构化字段（code / retryable / retry_after_ms）
    #[tokio::test]
    async fn retry_after_overrides_backoff_and_error_carries_structured_fields() {
        use std::time::Duration;

        // 1) 纯函数：取大 + 超上限截断
        {
            use super::llm::retry_delay;
            assert_eq!(retry_delay(Duration::from_secs(1), None), Duration::from_secs(1));
            assert_eq!(
                retry_delay(Duration::from_secs(1), Some(30_000)),
                Duration::from_secs(30),
                "服务端建议更久 → 以它为准"
            );
            assert_eq!(
                retry_delay(Duration::from_secs(5), Some(1_000)),
                Duration::from_secs(5),
                "退避更久 → 保持退避"
            );
            assert_eq!(
                retry_delay(Duration::from_secs(1), Some(120_000)),
                Duration::from_secs(60),
                "超上限截断为 60s"
            );
        }

        // 2) 集成：429 + Retry-After → 重试等待即该值；耗尽后终态事件带码
        struct RetryRecorder {
            waits: std::sync::Mutex<Vec<u64>>,
            last_error: std::sync::Mutex<Option<(String, Option<String>, Option<bool>, Option<u64>)>>,
        }
        impl Listener for RetryRecorder {
            fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
                match event {
                    OrchestratorEvent::LoopEngRetrying { backoff_ms, .. } => {
                        self.waits.lock().unwrap().push(*backoff_ms);
                    }
                    OrchestratorEvent::Agent(AgentEvent::Error {
                        message,
                        code,
                        retryable,
                        retry_after_ms,
                    }) => {
                        *self.last_error.lock().unwrap() =
                            Some((message.clone(), code.clone(), *retryable, *retry_after_ms));
                    }
                    _ => {}
                }
                ListenerOutcome::Continue
            }
        }

        let backend = Arc::new(
            MockBackend::new(vec![]).with_prompt_errors(vec![
                BackendError::RateLimit {
                    retry_after_ms: Some(50),
                },
                BackendError::RateLimit {
                    retry_after_ms: Some(50),
                },
            ]),
        );
        let agent = AgentLoop::new(backend, Arc::new(SimpleToolBus::new())).with_config(
            AgentLoopConfig {
                llm_max_retries: 1,
                // 退避 1ms ≪ Retry-After 50ms —— 断言等待以服务端建议为准
                llm_retry_base_delay: Duration::from_millis(1),
                ..Default::default()
            },
        );
        let recorder = Arc::new(RetryRecorder {
            waits: std::sync::Mutex::new(Vec::new()),
            last_error: std::sync::Mutex::new(None),
        });
        agent.subscribe(recorder.clone()).await;

        let result = agent.run("测试".into()).await;
        assert!(result.is_err(), "重试耗尽应失败: {result:?}");

        let waits = recorder.waits.lock().unwrap().clone();
        assert_eq!(
            waits,
            vec![50],
            "重试等待应为 Retry-After 值（50ms），实际: {waits:?}"
        );

        let (message, code, retryable, ra) = recorder
            .last_error
            .lock()
            .unwrap()
            .clone()
            .expect("应广播终态 Error 事件");
        assert_eq!(code.as_deref(), Some("RATE_LIMIT"), "终态事件应带稳定码");
        assert_eq!(retryable, Some(true), "限流可重试");
        assert_eq!(ra, Some(50), "终态事件应保留服务端建议等待");
        assert!(message.contains("速率限制"), "message 保留原因文本: {message}");
    }

    /// W2①（2026-09-18 工作区与环境对齐 dsh）：`project_id` 贯通——
    /// `with_config` / `set_config` 同步镜像字段（构造 ToolContext 用，此前恒 None）
    #[tokio::test]
    async fn project_id_mirrors_config_for_tool_context() {
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        )
        .with_config(AgentLoopConfig {
            project_id: Some("p-123".into()),
            ..Default::default()
        });
        assert_eq!(
            agent.project_id().as_deref(),
            Some("p-123"),
            "with_config 应同步 project_id 镜像字段"
        );
        // set_config 更新路径（恢复 / 切换项目同源）
        agent
            .set_config(AgentLoopConfig {
                project_id: Some("p-456".into()),
                ..Default::default()
            })
            .await;
        assert_eq!(agent.project_id().as_deref(), Some("p-456"));
    }

    /// S4-b：会话级授权存取（仅会话内存活；`once` 命中即消费；内容模式匹配）
    #[tokio::test]
    async fn session_grant_accessors_roundtrip_and_consume_once() {
        use crate::permission_machine::SessionGrant;
        let agent = AgentLoop::new(
            Arc::new(MockBackend::new(vec![])),
            Arc::new(SimpleToolBus::new()),
        );
        assert_eq!(agent.session_grant_count(), 0, "新会话无授权");

        let n = agent.grant_session_permission(vec![
            SessionGrant { tool_name: "execute_command".into(), content: Some("cargo".into()), once: true },
            SessionGrant { tool_name: "web_fetch".into(), content: None, once: false },
        ]);
        assert_eq!(n, 2, "写入后条目数");

        // 内容不匹配：不命中、不消费
        assert!(!agent.consume_session_grant("execute_command", Some("git status")));
        assert_eq!(agent.session_grant_count(), 2);
        // 一次性命中即消费
        assert!(agent.consume_session_grant("execute_command", Some("cargo test")));
        assert_eq!(agent.session_grant_count(), 1, "once 命中后移除");
        assert!(!agent.consume_session_grant("execute_command", Some("cargo test")), "已消费");
        // 全量条目（content=None）：无主体亦命中，且不消费
        assert!(agent.consume_session_grant("web_fetch", None));
        assert_eq!(agent.session_grant_count(), 1);
    }