// ─── 测试 ────────────────────────────────────────────

    use super::*;
    use async_trait::async_trait;
    use crate::backend::PromptResponse;
    use crate::router_decider::{RouterDecider, RouterDecision};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use crate::tool::{EchoTool, SimpleToolBus};
    use crate::tool_hook::{ToolHookAction, ToolLifecycleHook};
    use crate::types::ToolCall;

    /// Mock 后端 — 返回预设响应
    struct MockBackend {
        responses: AsyncMutex<Vec<PromptResponse>>,
        last_options: AsyncMutex<Option<PromptCallOptions>>,
    }

    impl MockBackend {
        fn new(responses: Vec<PromptResponse>) -> Self {
            Self {
                responses: AsyncMutex::new(responses),
                last_options: AsyncMutex::new(None),
            }
        }
    }

    #[async_trait]
    impl NodeBackendAccessor for MockBackend {
        async fn prompt(
            &self,
            _prompt: String,
            options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            *self.last_options.lock().await = options;
            let mut responses = self.responses.lock().await;
            if responses.is_empty() {
                return Err(BackendError::Other("no more mock responses".into()));
            }
            Ok(responses.remove(0))
        }

        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
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

    impl EventListener for TerminalEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
            let label = match event {
                OrchestratorEvent::Agent(AgentEvent::Error { message }) => {
                    format!("error:{message}")
                }
                OrchestratorEvent::Agent(AgentEvent::AgentEnd) => "agent_end".into(),
                OrchestratorEvent::Agent(AgentEvent::StreamEnd { .. }) => "stream_end".into(),
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
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

    impl EventListener for LoopEngEventListener {
        fn on_event(&self, event: &OrchestratorEvent) {
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
                _ => return,
            };
            if let Ok(mut v) = self.events.lock() {
                v.push(label);
            }
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
            async fn steer(&self, _text: String) -> Result<(), BackendError> {
                Ok(())
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

    /// Mock 记忆访问器 — 记录调用并返回预设检索结果
    struct MockMemory {
        recall_calls: std::sync::Mutex<Vec<String>>,
        inject_calls: std::sync::Mutex<usize>,
        record_turn_calls: std::sync::Mutex<usize>,
        archive_calls: std::sync::Mutex<usize>,
    }

    impl MockMemory {
        fn new() -> Self {
            Self {
                recall_calls: std::sync::Mutex::new(Vec::new()),
                inject_calls: std::sync::Mutex::new(0),
                record_turn_calls: std::sync::Mutex::new(0),
                archive_calls: std::sync::Mutex::new(0),
            }
        }
    }

    #[async_trait]
    impl crate::memory::MemoryAccessor for MockMemory {
        async fn recall(
            &self,
            query: String,
            _options: Option<crate::memory::MemoryRecallOptions>,
        ) -> std::result::Result<Vec<crate::memory::MemoryRecallResult>, crate::memory::MemoryError>
        {
            self.recall_calls.lock().unwrap().push(query);
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
            _options: Option<crate::memory::MemoryInjectOptions>,
        ) -> std::result::Result<String, crate::memory::MemoryError> {
            *self.inject_calls.lock().unwrap() += 1;
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

    // ─── A3 四管线路由：AgentLoop 发送链路接入 ────────────────────────

    /// 测试用：收集 RouterDecisionMade 事件的监听器
    struct RouterListener {
        decisions: std::sync::Mutex<Vec<(String, String)>>, // (target_id, target_name)
    }

    impl EventListener for RouterListener {
        fn on_event(&self, event: &OrchestratorEvent) {
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
    impl EventListener for PlanListener {
        fn on_event(&self, event: &OrchestratorEvent) {
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