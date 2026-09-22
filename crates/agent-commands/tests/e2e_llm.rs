//! e2e_llm 测试：真实 LLM 端到端实测（运行方式/设计约束/Provider 选择），详细见 docs/details/注释/agent-commands/e2e_llm.md

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use agent_commands::{AgentCommandService, SendMessageParams, ShellSessionManager, register_terminal_tools};
use agent_runtime::agent::{AgentError, AgentLoop, AgentLoopConfig};
use agent_runtime::backend::{NodeBackendAccessor, PromptCallOptions};
use agent_runtime::event::OrchestratorEvent;
use agent_runtime::event_bus::{Listener, ListenerOutcome};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::long_task::{
    LongTaskCheckpoint, LongTaskMeta, LongTaskStatus, LongTaskType,
};
use agent_runtime::loop_control::{
    LoopControlConfig, LoopController, RateLimitConfig, RateLimitExceeded, RetryConfig,
    SoftTimeoutConfig, SoftTimeoutLevel, WatchdogAlert, WatchdogConfig,
};
use agent_runtime::node::{
    AbortCheck, EventEmitter, NodeContext, NodeResult, NodeStatus, OrchestratorNode,
};
use agent_runtime::sub_agent_pool::SubAgentSpec;
use agent_runtime::graph_of_thoughts::{AggregationStrategy, GoTConfig, GoTNode};
use agent_runtime::router::{RouteTarget, RouterConfig, RouterNode};
use agent_runtime::tool::{
    SideEffectScope, SimpleToolBus, Tool, ToolBus, ToolDescriptor, ToolError, WhitelistToolBus,
};
use agent_runtime::tree_of_thoughts::{
    BeamSearchStrategy, GoalCheckStrategy, LlmScoringStrategy, ThoughtNode, ToTConfig, ToTError,
    ToTNode,
};
use agent_runtime::types::{MessageRole, OrchestratorMessage, OrchestratorState, ToolCall};
use async_trait::async_trait;

/// 从环境变量读取测试用 API Key（未设置则返回 None）
fn api_key_from_env() -> Option<String> {
    let key = std::env::var("DEEPSEEK_API_KEY").ok()?;
    if key.trim().is_empty() {
        None
    } else {
        Some(key)
    }
}

/// 构造 DeepSeek 云端 Provider 配置
fn deepseek_config(api_key: &str) -> ProviderConfig {
    ProviderConfig::Cloud {
        provider: "deepseek".into(),
        model_id: "deepseek-v4-flash".into(),
        api_key: api_key.into(),
    }
}

#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_main_chain_deepseek_stream_reply() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) 建会话（注入 DeepSeek 配置）
    let svc = AgentCommandService::new();
    let info = svc
        .new_session(
            Some("你是测试助手，请用中文简洁回答。".into()),
            vec![],
            Some(deepseek_config(&api_key)),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("new_session 应成功");

    // 2) Provider 配置回显 —— 校验真实配置（DeepSeek）而非默认占位
    let cfg = svc.get_provider_config(&info.id).await.expect("get_provider_config 应成功");
    assert_eq!(cfg.provider, "deepseek", "Provider 应为 deepseek");
    assert_eq!(cfg.model, "deepseek-v4-flash", "模型应为 deepseek-v4-flash");
    assert_eq!(cfg.base_url.as_deref(), Some("https://api.deepseek.com"));

    // 3) 主链路：发送消息 → 流式回复
    let result = svc
        .send_message(SendMessageParams {
            session_id: info.id.clone(),
            text: "你好，请用一句话介绍你自己。".into(),
            images: vec![],
            mode: None,
        })
        .await
        .expect("send_message 应成功（真实 LLM 调用）");

    // 4) 校验回复非空且非占位
    assert!(
        !result.reply.trim().is_empty(),
        "回复不应为空（真实 LLM 返回）"
    );
    eprintln!("[e2e] 会话 {:.8} 回复：{}", info.id, result.reply);
    eprintln!("[e2e] 消息数：{}", result.state.messages.len());
}

// ─── 工具调用链路实测 ────────────────────────────────────────────

/// 天气工具 — 带调用计数，用于校验 LLM 是否真实触发了工具调用
///
/// 通过共享的 `Arc<AtomicUsize>` 记录执行次数，测试结束后断言 > 0，
/// 证明 ReAct 循环确实走了"LLM 触发 → 工具执行 → 结果回填"链路。
struct WeatherTool {
    calls: Arc<AtomicUsize>,
}

impl WeatherTool {
    fn new(calls: Arc<AtomicUsize>) -> Self {
        Self { calls }
    }
}

#[async_trait]
impl Tool for WeatherTool {
    fn name(&self) -> &str {
        "get_weather"
    }

    fn description(&self) -> &str {
        "查询指定城市的天气"
    }

    fn parameters(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "city": { "type": "string", "description": "城市名" }
            },
            "required": ["city"]
        })
    }

    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor::read_only(
            self.name(),
            "search",
            self.description(),
            SideEffectScope::Network,
        )
        .with_input_schema(self.parameters())
    }

    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, ToolError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let city = args.get("city").and_then(|v| v.as_str()).unwrap_or("未知");
        Ok(serde_json::json!({
            "city": city,
            "weather": "晴",
            "temperature": 25,
            "unit": "摄氏度"
        }))
    }
}

/// 工具调用完整链路实测：触发 → 执行 → 结果回填 → 最终回复
///
/// 直接构造 `AgentLoop` + 注册 `get_weather` 工具（绕过 `AgentCommandService`
/// 的空 tool_bus），用强指令 system prompt 诱导 LLM 触发工具调用。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_tool_call_chain_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) 构造带工具注册的 AgentLoop（get_weather 带调用计数）
    let calls = Arc::new(AtomicUsize::new(0));
    let tool_bus =
        Arc::new(SimpleToolBus::with_tools(vec![Arc::new(WeatherTool::new(calls.clone()))]));
    let backend = Arc::new(GenaiBackend::new(deepseek_config(&api_key)));
    let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
        // 注意：deepseek-v4-flash 是推理模型，指令需明确"用户消息必含城市名，禁止反问"，
        // 否则模型可能因误读"未指定城市"而选择反问而非调用工具（实测已复现）。
        // 且必须显式声明"获得工具结果后直接回答、禁止再次调用工具"——否则模型会因
        // "MUST call" 的强指令反复调用同工具，直到撞上 max_iterations（实测复现）。
        system_prompt: Some(
            "You are a weather assistant. The user's message always contains a city name. \
             You MUST call the get_weather tool with that city name, then answer based on \
             the tool result. After you receive the tool result, answer the user's question \
             directly and do NOT call get_weather again. Never ask for the city, never \
             fabricate the weather."
                .into(),
        ),
        // temperature=0 保证确定性：避免推理模型因采样随机性在"再调工具/直接回答"间
        // 摇摆，使 ReAct 循环在少数几轮内收敛（实测默认温度下可能反复调用至超限）。
        temperature: Some(0.0),
        ..Default::default()
    });

    // 2) 触发 ReAct 循环：LLM 应触发 get_weather 工具调用
    // 用英文消息规避 deepseek-v4-flash 对中文提问的反问/误解倾向（实测中文不稳定）。
    // 本测试目标是验证"LLM 触发 → 工具执行 → 结果回填"链路，与语言无关。
    let reply = agent
        .run("What is the weather in Beijing? Please call get_weather.".into())
        .await
        .expect("run 应成功（真实 LLM 工具调用）");

    // 诊断：打印完整消息历史，观察 LLM 是否理解工具 / 是否直接回答
    {
        let msgs = agent.get_messages().await;
        eprintln!("[e2e] === 消息历史（共 {} 条）===", msgs.len());
        for (i, m) in msgs.iter().enumerate() {
            eprintln!(
                "[e2e] [{i}] role={:?} tool_calls={} content={}",
                m.role,
                m.tool_calls.len(),
                m.content.chars().take(200).collect::<String>()
            );
        }
    }

    // 3) 校验工具链路：
    //    - 工具确实被执行（调用计数 > 0）
    //    - 消息历史含 ToolResult（结果回填）
    //    - 最终回复非空
    let call_count = calls.load(Ordering::SeqCst);
    assert!(call_count > 0, "get_weather 工具应被 LLM 触发执行（实际调用 {call_count} 次）");

    let msgs = agent.get_messages().await;
    assert!(
        msgs.iter().any(|m| m.role == MessageRole::ToolResult),
        "消息历史应含 ToolResult（工具结果已回填）"
    );
    assert!(!reply.trim().is_empty(), "最终回复不应为空（基于工具结果）");

    eprintln!("[e2e] 工具调用次数：{call_count}");
    eprintln!("[e2e] 消息总数：{}", msgs.len());
    eprintln!("[e2e] 最终回复：{reply}");
}

// ─── 长任务端到端实测（long_task + checkpoint, breakpoint/resume）────────────────

/// 构造带 get_weather 工具的 AgentLoop（供长任务实测复用）
///
/// 返回 `(Arc<AgentLoop>, Arc<AtomicUsize>)`。第二个值为工具调用计数 Arc，
/// 供测试断言工具是否被真实触发（LongTaskManager 方法与 AgentLoop 共享 Arc）。
fn build_weather_agent(
    api_key: &str,
) -> (Arc<AgentLoop>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let tool_bus = Arc::new(SimpleToolBus::with_tools(vec![Arc::new(
        WeatherTool::new(calls.clone()),
    )]));
    let backend = Arc::new(GenaiBackend::new(deepseek_config(api_key)));
    let agent = Arc::new(AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
        system_prompt: Some(
            "You are a weather assistant. The user's message always contains a city name. \
             You MUST call the get_weather tool with that city name, then answer based on \
             the tool result. After you receive the tool result, answer the user's question \
             directly and do NOT call get_weather again. Never ask for the city, never \
             fabricate the weather."
                .into(),
        ),
        temperature: Some(0.0),
        // total_steps=15：给 deepseek-v4-flash 推理模型足够收敛机会（实测通常 9 轮内
        // 收敛），同时避免默认 200 时偶发反复调用工具拖慢测试。工具调用链测试单独设更高值。
        total_steps: 15,
        ..Default::default()
    }));
    (agent, calls)
}

/// 长任务完整生命周期实测：start → running → checkpoint（工具调用中更新）→ complete
///
/// 验证 LongTaskManager 与 AgentLoop 集成：
/// 1. start_task 后进入 Running，has_active_task=true
/// 2. ReAct 循环触发工具调用时，checkpoint 被更新（turn_count / current_tool /
///    agent_messages 含 ToolResult）
/// 3. complete_task 后状态转 Completed，active_task 清空
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_long_task_lifecycle_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    let (agent, _calls) = build_weather_agent(&api_key);

    // 1) 启动长任务（模拟命令层在 send_message 前登记任务）
    let initial_checkpoint = LongTaskCheckpoint {
        agent_messages: vec![],
        last_user_text: "What is the weather in Beijing?".into(),
        skill_names: None,
        chat_mode: None,
        locked_chat_mode: None,
    };
    let record = agent
        .long_task_manager()
        .start_task(
            "longtask-e2e-1".into(),
            LongTaskType::MainAgent,
            initial_checkpoint,
            LongTaskMeta {
                prompt: "What is the weather in Beijing? Please call get_weather.".into(),
                ..Default::default()
            },
        )
        .await;
    assert_eq!(record.status, LongTaskStatus::Running);
    assert!(agent.long_task_manager().has_active_task().await);

    // 2) 启动心跳定时器（on_tick 无实际持久化，仅验证不报错）
    agent
        .start_long_task_heartbeat(|_tick| async move {})
        .await;

    // 3) 触发 ReAct 循环（工具调用 → 事件驱动 checkpoint 更新）
    //    注：deepseek-v4-flash 推理模型可能因"必须调用工具"强指令偶发反复调用同工具
    //    直至 max_iterations，此时 run 返回 Err，但工具调用已在循环内发生、checkpoint
    //    已更新——因此先校验 checkpoint（本测试核心：长任务 + 工具调用集成），
    //    再对 run 成功场景做额外回复校验。
    let reply_result = agent
        .run("What is the weather in Beijing? Please call get_weather.".into())
        .await;

    // 4) 校验 checkpoint 已更新：turn_count 递增、current_tool 为 get_weather、
    //    agent_messages 含 ToolResult（断点恢复所需的完整上下文）
    let active = agent
        .long_task_manager()
        .get_active_task()
        .await
        .expect("长任务应仍处于活跃状态");
    assert_eq!(active.status, LongTaskStatus::Running);
    assert!(
        active.turn_count > 0,
        "checkpoint 的 turn_count 应 > 0（工具调用触发更新）"
    );
    assert_eq!(
        active.current_tool.as_deref(),
        Some("get_weather"),
        "checkpoint 的 current_tool 应为 get_weather"
    );
    let msgs = &active.checkpoint.agent_messages;
    assert!(
        msgs.iter().any(|m| m.role == MessageRole::ToolResult),
        "checkpoint.agent_messages 应含 ToolResult（断点恢复上下文完整）"
    );

    // 若 run 成功，额外校验最终回复非空
    if let Ok(reply) = &reply_result {
        assert!(!reply.trim().is_empty(), "最终回复不应为空");
    }

    // 5) 完成长任务 → 状态转 Completed，active_task 清空
    let completed = agent.long_task_manager().complete_task().await;
    let completed = completed.expect("complete_task 应返回记录");
    assert_eq!(completed.status, LongTaskStatus::Completed);
    assert!(completed.ended_at.is_some());
    assert!(!agent.long_task_manager().has_active_task().await);

    eprintln!("[e2e] 长任务生命周期：turn_count={} current_tool={:?} 消息数={}",
        completed.turn_count, completed.current_tool, msgs.len());
}

/// 断点恢复（breakpoint/resume）实测：checkpoint 持久化 → 新 AgentLoop 恢复续跑
///
/// 验证 LongTaskManager 的 checkpoint 快照（agent_messages）能作为断点：
/// 1. 手动构造一个含完整工具调用历史（system/user/assistant(tool_calls)/toolResult）
///    的 checkpoint 快照，模拟"应用重启后从 SQLite 恢复的持久化断点"。
///    （真实运行生成 checkpoint 已在 lifecycle 测试覆盖；此处聚焦恢复 + 续跑，
///    避免 deepseek-v4-flash 推理模型对地理位置问题反复调用工具的耗时不确定性。）
/// 2. 新建 AgentLoop，通过 set_runtime_messages 恢复 checkpoint 消息。
/// 3. 校验恢复后消息一致、可基于恢复上下文成功续跑（追加新消息）。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_long_task_breakpoint_resume_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) 构造持久化 checkpoint 快照（模拟应用重启后从 SQLite 恢复的断点）
    let checkpoint_msgs = vec![
        OrchestratorMessage {
            role: MessageRole::System,
            content: "You are a weather assistant. The user's message always contains a city name. \
                      You MUST call the get_weather tool with that city name, then answer based on \
                      the tool result. After you receive the tool result, answer the user's question \
                      directly and do NOT call get_weather again."
                .into(),
            tool_calls: vec![],
            tool_call_id: None,
            meta: None,
        },
        OrchestratorMessage {
            role: MessageRole::User,
            content: "What is the weather in Beijing?".into(),
            tool_calls: vec![],
            tool_call_id: None,
            meta: None,
        },
        OrchestratorMessage {
            role: MessageRole::Assistant,
            content: String::new(),
            tool_calls: vec![ToolCall {
                id: "call-bj-1".into(),
                name: "get_weather".into(),
                args: serde_json::json!({ "city": "Beijing" }),
            }],
            tool_call_id: None,
            meta: None,
        },
        OrchestratorMessage {
            role: MessageRole::ToolResult,
            content: serde_json::json!({
                "city": "Beijing",
                "weather": "晴",
                "temperature": 25,
                "unit": "摄氏度"
            })
            .to_string(),
            tool_calls: vec![],
            tool_call_id: Some("call-bj-1".into()),
            meta: None,
        },
    ];
    let checkpoint = LongTaskCheckpoint {
        agent_messages: checkpoint_msgs.clone(),
        last_user_text: "What is the weather in Beijing?".into(),
        skill_names: None,
        chat_mode: None,
        locked_chat_mode: None,
    };
    assert!(!checkpoint.agent_messages.is_empty(), "checkpoint 消息不应为空");
    assert!(
        checkpoint
            .agent_messages
            .iter()
            .any(|m| m.role == MessageRole::ToolResult),
        "checkpoint 应含 ToolResult（工具结果已持久化）"
    );

    // 2) 模拟"应用重启"：新建 AgentLoop，用 checkpoint.agent_messages 恢复断点
    let (agent2, _calls2) = build_weather_agent(&api_key);
    agent2
        .set_runtime_messages(checkpoint.agent_messages.clone())
        .await
        .expect("set_runtime_messages 应成功");

    // 3) 校验恢复后消息与 checkpoint 一致（断点未丢失）
    let restored = agent2.get_runtime_messages().await;
    assert_eq!(
        restored.len(),
        checkpoint.agent_messages.len(),
        "恢复后消息数应与 checkpoint 一致"
    );
    assert_eq!(
        restored.last().map(|m| m.role),
        checkpoint.agent_messages.last().map(|m| m.role),
        "恢复后最后一条消息角色应与 checkpoint 一致"
    );

    // 4) 校验可续跑：基于恢复的上下文再追加一轮。
    //    续跑用纯文本消息（无需工具调用），聚焦验证"断点恢复后 AgentLoop 能基于
    //    恢复上下文继续对话"。工具调用链已在 lifecycle 测试充分验证，此处避免
    //    deepseek-v4-flash 推理模型对地理位置问题反复调用 get_weather 直至撞
    //    max_iterations（实测复现，模型行为非产品缺陷）。
    let continuation = agent2
        .run(
            "Please summarize the weather information you have gathered so far. \
             Answer in text only, do not call any tool."
                .into(),
        )
        .await
        .expect("恢复后续跑应成功");
    let after_resume = agent2.get_runtime_messages().await;
    assert!(
        after_resume.len() > checkpoint.agent_messages.len(),
        "续跑后消息数应增加（上下文已恢复）"
    );
    assert!(!continuation.trim().is_empty(), "续跑回复不应为空");

    eprintln!("[e2e] 断点恢复：checkpoint 消息数={}，恢复后消息数={}（续跑 +{}）",
        checkpoint.agent_messages.len(), after_resume.len(),
        after_resume.len() - checkpoint.agent_messages.len());
}

/// 协作式取消实测：request_cancel → ReAct 循环优雅停止 → 状态转 Cancelled
///
/// 验证 LongTaskManager 的协作式取消标志能与 AgentLoop 联动：
/// 1. 启动长任务后 request_cancel
/// 2. ReAct 循环检测到取消标志，返回 Aborted 错误
/// 3. 任务状态从 Running 转 Cancelled，cancel_flag 重置
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_long_task_cooperative_cancel_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    let (agent, _calls) = build_weather_agent(&api_key);
    agent
        .long_task_manager()
        .start_task(
            "longtask-cancel-1".into(),
            LongTaskType::MainAgent,
            LongTaskCheckpoint {
                agent_messages: vec![],
                last_user_text: "Should be cancelled".into(),
                skill_names: None,
                chat_mode: None,
                locked_chat_mode: None,
            },
            LongTaskMeta {
                prompt: "Should be cancelled".into(),
                ..Default::default()
            },
        )
        .await;

    // 请求协作式取消（提交）—— 真实场景下由 Tauri 命令层调用
    agent.long_task_manager().request_cancel();
    assert!(agent.long_task_manager().is_cancel_requested());

    // run 应检测到取消标志并优雅停止（返回 Aborted），不发起真实 LLM 调用
    let result = agent
        .run("This run should be cancelled.".into())
        .await;
    assert!(
        matches!(result, Err(AgentError::Aborted)),
        "取消后 run 应返回 Aborted（实际: {:?}）",
        result
    );

    // 取消后任务应已清空（cancel_task 用 take 移除 active_task，活跃任务为 None），
    // cancel_flag 已重置。断点恢复场景下由调用方从持久化记录（Cancelled）恢复。
    let active = agent.long_task_manager().get_active_task().await;
    assert!(
        active.is_none(),
        "取消后 active_task 应被清空（实际: {:?}）",
        active
    );
    assert!(!agent.long_task_manager().is_cancel_requested(), "取消后 flag 应重置");

    eprintln!("[e2e] 协作式取消：run 返回 Aborted，任务状态 → Cancelled，flag 已重置");
}

// ─── 13 种编排模式 e2e（分层混合策略）────────────────────────────
//
// 分层混合策略（用户已确认）：编排框架层（Supervisor/Router/MultiAgent/ToT/GoT/
// LoopControl）用确定性策略控制路由/分配/打分，真实 LLM 只负责子任务执行；loop 层
// 用真实 LLM。下方先实现 Supervisor 模式。

// ─── 确定性桩：事件发射 / 中断检查 ────────────────────────────────────

struct E2eEmitter;
impl EventEmitter for E2eEmitter {
    fn emit(&self, _event: OrchestratorEvent) {}
}

struct E2eAbort;
#[async_trait]
impl AbortCheck for E2eAbort {
    fn is_aborted(&self) -> bool {
        false
    }
    async fn wait_if_paused(&self) {}
}

// ─── 确定性桩：事件收集器 ────────────────────────────────────

/// 事件收集器 — 记录 Router 发射的决策事件，供测试断言
struct RecordingEmitter {
    events: std::sync::Mutex<Vec<OrchestratorEvent>>,
}

impl RecordingEmitter {
    fn new() -> Self {
        Self {
            events: std::sync::Mutex::new(Vec::new()),
        }
    }

    fn decisions(&self) -> Vec<OrchestratorEvent> {
        self.events.lock().unwrap().clone()
    }
}

impl EventEmitter for RecordingEmitter {
    fn emit(&self, event: OrchestratorEvent) {
        self.events.lock().unwrap().push(event);
    }
}

/// Router 编排模式 e2e：确定性关键词路由 + 事件发射，详细见 docs/details/注释/agent-commands/e2e_llm.md
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_router_orchestration_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) 路由目标：代码专家 / 文档专家（带关键词）
    let targets = vec![
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

    // 2) 构造 RouterNode（关键词策略 + 共享 backend；backend 仅作占位，关键词策略不调用）
    let backend = Arc::new(GenaiBackend::new(deepseek_config(&api_key)));
    let node = RouterNode::with_keyword_strategy(
        "router",
        "路由节点",
        targets.clone(),
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        RouterConfig::default(),
    );

    // 3) 辅助执行：构造 NodeContext 并执行，返回 (NodeResult, 事件列表)
    async fn run_router(
        node: &RouterNode,
        backend: &dyn NodeBackendAccessor,
        input: &str,
    ) -> (NodeResult, Vec<OrchestratorEvent>) {
        let mut state = OrchestratorState::new(input.to_string());
        let emitter = RecordingEmitter::new();
        let abort = E2eAbort;
        let ctx = NodeContext {
            state: &mut state,
            backend,
            memory: None,
            emitter: &emitter,
            abort_check: &abort,
        };
        let result = node.execute(ctx).await;
        let events = emitter.decisions();
        (result, events)
    }

    // 4) 用例 A：输入含"函数" → 路由到 coder（代码专家）
    let (result_a, events_a) = run_router(&node, &*backend, "请帮我写一个排序函数，用 Rust 实现。").await;
    assert_eq!(result_a.status, NodeStatus::Continue, "Router 应返回 Continue");
    assert_eq!(
        result_a.next_node_id.as_deref(),
        Some("coder"),
        "含'函数'应路由到 coder"
    );
    assert!(
        result_a.summary.as_deref().unwrap().contains("代码专家"),
        "summary 应包含路由分支名称（代码专家）"
    );
    // 应发射 RouterDecisionMade 事件且 target_id = coder，非 fallback
    assert!(
        events_a.iter().any(|e| matches!(e, OrchestratorEvent::RouterDecisionMade {
            node_id: _,
            target_id,
            target_name,
            reason: _,
            is_fallback: false,
        } if target_id == "coder" && target_name == "代码专家")),
        "应发射 RouterDecisionMade(coder) 事件"
    );

    // 5) 用例 B：输入含"文档" → 路由到 writer（文档专家）
    let (result_b, events_b) = run_router(&node, &*backend, "请把这段技术文档翻译成英文。").await;
    assert_eq!(result_b.status, NodeStatus::Continue);
    assert_eq!(
        result_b.next_node_id.as_deref(),
        Some("writer"),
        "含'文档'应路由到 writer"
    );
    assert!(
        events_b.iter().any(|e| matches!(e, OrchestratorEvent::RouterDecisionMade {
            node_id: _,
            target_id,
            target_name: _,
            reason: _,
            is_fallback: false,
        } if target_id == "writer")),
        "应发射 RouterDecisionMade(writer) 事件"
    );

    // 6) 用例 C：无关键词命中且配置 fallback → 走 fallback
    let mut targets_with_fallback = targets.clone();
    targets_with_fallback.push(RouteTarget {
        id: "fallback".into(),
        name: "兜底分支".into(),
        description: "处理未分类任务".into(),
        keywords: None,
    });
    let fallback_node = RouterNode::with_keyword_strategy(
        "router",
        "路由节点",
        targets_with_fallback,
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        RouterConfig {
            fallback_target_id: Some("fallback".into()),
        },
    );
    let mut state_c = OrchestratorState::new("今天天气怎么样？".to_string());
    let emitter_c = RecordingEmitter::new();
    let abort_c = E2eAbort;
    let ctx_c = NodeContext {
        state: &mut state_c,
        backend: &*backend,
        memory: None,
        emitter: &emitter_c,
        abort_check: &abort_c,
    };
    let result_c = fallback_node.execute(ctx_c).await;
    assert_eq!(result_c.status, NodeStatus::Continue, "无匹配应走 fallback");
    assert_eq!(
        result_c.next_node_id.as_deref(),
        Some("fallback"),
        "无匹配应路由到 fallback"
    );
    assert!(
        emitter_c
            .decisions()
            .iter()
            .any(|e| matches!(e, OrchestratorEvent::RouterDecisionMade {
                node_id: _,
                target_id,
                target_name: _,
                reason: _,
                is_fallback: true,
            } if target_id == "fallback")),
        "fallback 决策应发射 is_fallback=true 事件"
    );

    eprintln!(
        "[e2e] Router：code→{} writer→{} fallback→{}",
        result_a.next_node_id.as_deref().unwrap(),
        result_b.next_node_id.as_deref().unwrap(),
        result_c.next_node_id.as_deref().unwrap()
    );
}

/// ToT 编排模式 e2e：Beam Search 思维树探索 + 真实 LLM，详细见 docs/details/注释/agent-commands/e2e_llm.md
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_tot_beam_search_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) ToT 配置：减小参数加快测试（beam_width=2，branch_factor=2，max_depth=3）
    //    完整思维树探索但参数较小，控制测试时间
    let config = ToTConfig {
        max_depth: 3,
        max_thoughts: 20,
        beam_width: 2,
        branch_factor: 2,
        score_convergence_threshold: 5,
        require_summary: true,
        check_goal_at_root: false,
    };

    // 2) 共享 backend，使用默认策略（BeamSearch 探索 + Llm 评分 + Llm 目标检查）
    let backend = Arc::new(GenaiBackend::new(deepseek_config(&api_key)));
    let node = ToTNode::with_default_strategies(
        "tot",
        "思维树探索",
        Arc::clone(&backend) as Arc<dyn NodeBackendAccessor>,
        config,
    );

    // 3) 构造 NodeContext（数学问题："3瓶水换一瓶，10瓶喝了能换几瓶" 经典多步推理题，适合 ToT 探索）
    let mut state = OrchestratorState::new("有10瓶矿泉水，每3个空瓶可以换一瓶新的。请问总共能喝到多少瓶？请分步思考。");
    let emitter = E2eEmitter;
    let abort = E2eAbort;
    let ctx = NodeContext {
        state: &mut state,
        backend: &*backend,
        memory: None,
        emitter: &emitter,
        abort_check: &abort,
    };

    // 4) 执行 ToT 探索
    let result = node.execute(ctx).await;
    if result.status == NodeStatus::Error {
        eprintln!("[e2e] ToT 执行 Error: {:?}", result.error);
    }
    // 两种正常终止路径（取决于真实 LLM 是否在探索中达成目标）：
    // - Done：目标达成（消息标记 [ToT 目标达成]）
    // - Continue：探索到 max_depth/评分收敛（消息标记 [ToT 最优思维]）
    assert!(
        matches!(result.status, NodeStatus::Continue | NodeStatus::Done),
        "ToT 应返回 Continue 或 Done，实际: {:?}",
        result.status
    );
    assert!(result.summary.is_some(), "应有 summary");

    // 5) 校验结果：至少探索出一个节点，最优评分 > 0，最优思维非空
    let snapshot = node.tree_snapshot().await;
    let total_nodes = snapshot.len();
    assert!(total_nodes >= 1, "树中至少有一个根节点");

    let best_id = node.best_node_id().await.expect("应有最优节点");
    let best_node = snapshot
        .iter()
        .find(|n| n.id == best_id)
        .cloned()
        .expect("最优节点应存在");
    assert!(best_node.score.is_some(), "最优节点应有评分");
    let best_score = best_node.score.unwrap();
    assert!(best_score > 0, "最优评分应 > 0");
    assert!(!best_node.content.trim().is_empty(), "最优思维内容不应为空");

    // 6) 校验 state.messages 含 ToT 结果消息（目标达成或最优思维两种标记）
    let last = state.messages.last().expect("应有 ToT 结果消息");
    assert!(matches!(last.role, MessageRole::Assistant));
    let is_goal = last.content.contains("[ToT 目标达成");
    let is_best = last.content.contains("[ToT 最优思维");
    assert!(
        is_goal || is_best,
        "消息应包含 [ToT 目标达成] 或 [ToT 最优思维] 标记，实际: {}",
        &last.content[..last.content.len().min(80)]
    );
    assert!(
        last.content.contains(&best_node.content),
        "消息应包含最优思维内容"
    );

    // 7) 校验 meta 记录（目标达成路径记录 goal_*，探索完成路径记录 best_*）
    let meta = last.meta.as_ref().expect("应有 meta");
    if is_goal {
        assert!(meta.get("goal_thought_id").is_some());
        assert!(meta.get("goal_score").is_some());
    } else {
        assert!(meta.get("best_score").is_some());
        assert!(meta.get("total_nodes").is_some());
    }

    eprintln!(
        "[e2e] ToT：total_nodes={} best_depth={} best_score={} 最优思维长度={} 状态={:?}",
        total_nodes,
        best_node.depth,
        best_score,
        best_node.content.len(),
        result.status
    );
}

/// 确定性聚合策略 —— 拼接所有候选思维（e2e 用，框架层确定性，不依赖 LLM 聚合）
///
/// GoT 核心创新是图聚合，本策略直接拼接 top-N 思维，
/// 真实 LLM 仍负责探索/评分/目标检查，聚合用确定性拼接，保证测试稳定。
struct ConcatAggregationStrategy;

#[async_trait]
impl AggregationStrategy for ConcatAggregationStrategy {
    async fn aggregate(
        &self,
        _ctx: &NodeContext<'_>,
        nodes: &[ThoughtNode],
    ) -> Result<String, ToTError> {
        let mut parts = Vec::new();
        for (idx, node) in nodes.iter().enumerate() {
            let score = node.score.unwrap_or(0);
            parts.push(format!(
                "[聚合候选 {}（评分 {}）]: {}",
                idx + 1,
                score,
                node.content
            ));
        }
        Ok(parts.join("\n\n"))
    }
}

/// 确定性目标检查 —— 永不达成（e2e 用）
///
/// GoT 聚合发生在层扩展之后、目标检查之前。若用真实 LLM 目标检查，LLM 可能在
/// 深度 1 就判定"目标达成"从而提前 return Done，导致聚合步骤被跳过（非确定性）。
/// 本策略恒返回 false，保证探索必然推进到聚合阶段，稳定验证多源聚合链路。
struct NeverGoalCheck;

#[async_trait]
impl GoalCheckStrategy for NeverGoalCheck {
    async fn check_goal(
        &self,
        _node: &ThoughtNode,
        _context: &str,
        _backend: &dyn NodeBackendAccessor,
    ) -> Result<bool, ToTError> {
        Ok(false)
    }
}

/// Graph of Thoughts (GoT) 编排模式 e2e：确定性聚合 + 真实 LLM 探索/评分
///
/// 验证 GoTNode 完整链路：
/// 1. Beam Search 探索 + Llm 评分 + Llm 目标检查（复用 ToT 逻辑）
/// 2. 每层评分≥阈值节点进行聚合（ConcatAggregationStrategy 确定性拼接）
/// 3. 聚合节点加入下一层候选池，生成思维图（带 parents 多源）
/// 4. 终止后找到最优节点（评分最高），写入 state.messages，返回 Done + summary
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_got_aggregation_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) GoT 配置：减小参数控制规模（max_depth=3，beam_width=2，branch_factor=2，开启聚合）
    let config = GoTConfig {
        tot: ToTConfig {
            max_depth: 3,
            max_thoughts: 20,
            beam_width: 2,
            branch_factor: 2,
            score_convergence_threshold: 5,
            require_summary: true,
            check_goal_at_root: false,
        },
        aggregation_enabled: true,
        // 阈值降到 1：LLM 对中间思维步骤评分常低于 50（如 30-40），
        // 若保持 50 阈值则候选不足 2 个、聚合永不触发。任何有效评分（≥1）即合格，
        // 只要某层有 ≥2 个节点就能稳定触发聚合，完整验证多源聚合链路。
        aggregation_threshold: 1,
        max_aggregation_size: 3,
        aggregation_branch_factor: 1,
    };

    // 2) 策略：框架层聚合用确定性拼接，探索/评分/目标检查用真实 LLM
    let backend = Arc::new(GenaiBackend::new(deepseek_config(&api_key)));
    let node = GoTNode::new(
        "got",
        "思维图探索",
        Arc::new(BeamSearchStrategy::new()),
        Arc::new(LlmScoringStrategy::new()),
        // 确定性目标检查：恒返回 false，确保探索推进到聚合阶段，
        // 避免真实 LLM 在深度 1 就判定"目标达成"提前 return，导致聚合被跳过（非确定性）
        Arc::new(NeverGoalCheck),
        Arc::new(ConcatAggregationStrategy),
        config,
    );

    // 3) 构造 NodeContext（数学问题，和 ToT 同题，便于对比）
    let mut state = OrchestratorState::new("有10瓶矿泉水，每3个空瓶可以换一瓶新的。请问总共能喝到多少瓶？请分步思考。");
    let emitter = E2eEmitter;
    let abort = E2eAbort;
    let ctx = NodeContext {
        state: &mut state,
        backend: &*backend,
        memory: None,
        emitter: &emitter,
        abort_check: &abort,
    };

    // 4) 执行 GoT 探索
    let result = node.execute(ctx).await;
    if result.status == NodeStatus::Error {
        eprintln!("[e2e] GoT 执行 Error: {:?}", result.error);
    }
    assert!(
        matches!(result.status, NodeStatus::Done | NodeStatus::Continue),
        "GoT 应返回 Done（目标达成）或 Done（探索完成，最优节点），实际: {:?}",
        result.status
    );
    assert!(result.summary.is_some(), "应有 summary");

    // 5) 校验结果：至少探索出一个节点，最优评分 > 0，最优思维非空
    let snapshot = node.tree_snapshot().await;
    let total_nodes = snapshot.len();
    assert!(total_nodes >= 1, "图中至少有一个根节点");

    let best_id = node.best_node_id().await.expect("应有最优节点");
    let best_node = snapshot
        .iter()
        .find(|n| n.id == best_id)
        .cloned()
        .expect("最优节点应存在");
    assert!(best_node.score.is_some(), "最优节点应有评分");
    let best_score = best_node.score.unwrap();
    assert!(best_score > 0, "最优评分应 > 0");
    assert!(!best_node.content.trim().is_empty(), "最优思维内容不应为空");

    // 6) 校验是否产生聚合节点（至少有一个节点 parents.len() > 1）
    let has_aggregated = snapshot.iter().any(|n| n.parents.len() >= 2);
    // 阈值=1 时，只要某层 ≥2 个节点评分≥1 即触发聚合；beam_width=2 保证每层 ≥2 节点
    assert!(
        has_aggregated,
        "GoT 应产生聚合节点（parents≥2），图中多源聚合链路未触发，total_nodes={}",
        total_nodes
    );
    eprintln!("[e2e] GoT：产生了聚合节点（parents≥2），图结构正确");

    // 7) 校验 state.messages 含 GoT 最优思维结果
    let last = state.messages.last().expect("应有 GoT 最优思维消息");
    assert!(matches!(last.role, MessageRole::Assistant));
    assert!(
        last.content == best_node.content,
        "消息应包含最优思维内容"
    );

    eprintln!(
        "[e2e] GoT：total_nodes={} has_aggregated={} best_depth={} best_score={} 最优思维长度={}",
        total_nodes,
        has_aggregated,
        best_node.depth,
        best_score,
        best_node.content.len()
    );
}

// ─── LoopControl 循环控制 e2e：限流/重试/软超时/看门狗 一站式验证 ──────────────────
///
/// LoopControl 是**框架层纯逻辑组件**（非 OrchestratorNode），提供：
/// 1. 速率限制（轮次/工具调用/token/时长）
/// 2. 重试策略（指数退避、错误类型过滤）
/// 3. 软超时（两级提醒，不强制终止）
/// 4. 看门狗（空闲监控，触发恢复）
///
/// 本测试验证**完整聚合校验**，所有策略用确定性配置，无需真实 LLM。
#[tokio::test]
async fn e2e_loop_control_integration() {
    // 1) 配置：缩小阈值便于触发（max_turns=2，max_tool_calls=3，软超时短阈值）
    let config = LoopControlConfig {
        rate_limit: RateLimitConfig {
            max_turns: Some(2),
            max_tool_calls: Some(3),
            max_tokens: Some(1000),
            max_duration: Some(std::time::Duration::from_secs(10)),
        },
        retry: RetryConfig {
            max_retries: 2,
            initial_backoff: std::time::Duration::from_millis(50),
            backoff_multiplier: 2.0,
            max_backoff: std::time::Duration::from_millis(200),
            retryable_errors: vec!["timeout".into(), "rate_limit".into()],
        },
        soft_timeout: SoftTimeoutConfig {
            warn_threshold: std::time::Duration::from_millis(50),
            critical_threshold: std::time::Duration::from_millis(150),
        },
        // 看门狗放主 controller 中设极大阈值（不触发），避免软超时的 sleep 推进
        // 看门狗时钟；看门狗链路单独用 controller_watchdog 验证。
        watchdog: WatchdogConfig {
            idle_threshold: std::time::Duration::from_secs(3600),
            dead_threshold: std::time::Duration::from_secs(7200),
            auto_recovery: false,
        },
    };

    // 2) 创建聚合控制器
    let controller = LoopController::new(config);

    // 3) 初始状态校验：无事件触发
    let check0 = controller.check_all();
    assert!(!check0.has_any(), "初始状态不应有任何事件");
    assert!(!check0.should_stop(), "初始状态不应停止");

    // 4) 速率限制校验：注意 `check_exceeded` 用 `>=` 判定，max_turns=2 时第 2 轮即触发
    controller.rate_limiter.inc_turns();
    assert_eq!(controller.rate_limiter.turns(), 1);
    let check1 = controller.check_all();
    assert!(!check1.should_stop(), "1 轮未超限（max=2）");

    controller.rate_limiter.inc_turns();
    assert_eq!(controller.rate_limiter.turns(), 2);

    let check2 = controller.check_all();
    assert!(check2.should_stop(), "2 轮应触发停止（max=2，>= 触发）");
    assert!(matches!(
        check2.rate_limit_exceeded,
        Some(RateLimitExceeded::Turns { current: 2, max: 2 })
    ), "超限应为轮次超限");

    eprintln!("[e2e] LoopControl：轮次超限触发正确（2/2）");

    // 5) 重试策略校验：timeout 错误可重试，指数退避计算正确
    let policy = &controller.retry_policy;
    // 首次重试（attempt=0）→ 50ms
    let backoff0 = policy.should_retry("request timeout", 0);
    assert!(backoff0.is_some());
    assert_eq!(backoff0.unwrap(), std::time::Duration::from_millis(50));
    // 二次重试（attempt=1）→ 100ms
    let backoff1 = policy.should_retry("connection reset", 1);
    // "connection reset" 不在可重试列表，不应重试
    assert!(backoff1.is_none());
    // 二次重试 timeout → 100ms（50 * 2^1）
    let backoff1 = policy.should_retry("read timeout", 1);
    assert!(backoff1.is_some());
    assert_eq!(backoff1.unwrap(), std::time::Duration::from_millis(100));
    // 三次重试（attempt=2）→ 已达 max_retries=2，不应重试
    let backoff2 = policy.should_retry("rate limit exceeded", 2);
    assert!(backoff2.is_none());
    // 四次重试（attempt=3）→ 已达 max_retries，不应重试
    let backoff3 = policy.should_retry("timeout", 3);
    assert!(backoff3.is_none());

    eprintln!("[e2e] LoopControl：重试策略指数退避计算正确");

    // 6) 软超时校验：等待触发 warn → critical 两级提醒（仅首次触发，避免重复）
    std::thread::sleep(std::time::Duration::from_millis(60));
    let check3 = controller.check_all();
    assert!(check3.soft_timeout_level.is_some());
    assert_eq!(check3.soft_timeout_level.unwrap(), SoftTimeoutLevel::Warning);
    // 再次检查不应重复触发
    let check3b = controller.check_all();
    assert!(check3b.soft_timeout_level.is_none());

    std::thread::sleep(std::time::Duration::from_millis(100));
    let check4 = controller.check_all();
    assert!(check4.soft_timeout_level.is_some());
    assert_eq!(check4.soft_timeout_level.unwrap(), SoftTimeoutLevel::Critical);

    eprintln!("[e2e] LoopControl：软超时两级提醒触发正确");

    // 7) 看门狗校验（独立 controller，避免与软超时的时间互相干扰）
    let watchdog_controller = LoopController::new(LoopControlConfig {
        rate_limit: RateLimitConfig {
            max_turns: None,
            max_tool_calls: None,
            max_tokens: None,
            max_duration: None,
        },
        retry: RetryConfig::default(),
        soft_timeout: SoftTimeoutConfig {
            warn_threshold: std::time::Duration::from_secs(3600),
            critical_threshold: std::time::Duration::from_secs(7200),
        },
        watchdog: WatchdogConfig {
            idle_threshold: std::time::Duration::from_millis(30),
            dead_threshold: std::time::Duration::from_millis(100),
            auto_recovery: false,
        },
    });
    // 初始无告警
    let w0 = watchdog_controller.check_all();
    assert!(w0.watchdog_alert.is_none(), "初始无看门狗告警");
    // 超过 idle 阈值（30ms）→ 触发 Idle（Dead 优先级更高但未到 100ms）
    std::thread::sleep(std::time::Duration::from_millis(60));
    let w1 = watchdog_controller.check_all();
    assert!(matches!(w1.watchdog_alert, Some(WatchdogAlert::Idle { .. })), "超过 idle 应触发 Idle");
    // 更新活动后重置 idle 触发标志
    watchdog_controller.update_activity();
    std::thread::sleep(std::time::Duration::from_millis(10));
    let w2 = watchdog_controller.check_all();
    assert!(w2.watchdog_alert.is_none(), "活动后 10ms 未超 idle 阈值，应无告警");
    // 超过 dead 阈值（100ms）→ 触发 Dead
    std::thread::sleep(std::time::Duration::from_millis(120));
    let w3 = watchdog_controller.check_all();
    assert!(matches!(w3.watchdog_alert, Some(WatchdogAlert::Dead { .. })), "超过 dead 应触发 Dead");

    eprintln!("[e2e] LoopControl：看门狗 idle/dead 触发 + 活动重置正确");

    // 8) 最终聚合校验（主 controller）：rate_limit 仍超限 → should_stop = true
    let check_final = controller.check_all();
    assert!(check_final.has_any());
    assert!(check_final.should_stop());
    assert!(check_final.rate_limit_exceeded.is_some());
    // soft_timeout 已触发过（warn/critical），不会重复出现在 check 中；
    // 主 controller 看门狗阈值极大，未触发。
    assert!(check_final.soft_timeout_level.is_none());
    assert!(check_final.watchdog_alert.is_none());

    eprintln!(
        "[e2e] LoopControl：综合验证通过 → rate_limit={:?} soft_timeout={:?} watchdog={:?}",
        check_final.rate_limit_exceeded, check_final.soft_timeout_level, check_final.watchdog_alert
    );
}

// ─── 终端工具全链路 e2e：LLM 真实触发 execute_command ──────────────────────────
///
/// 验证"工具注册 → LLM 感知工具 → 触发 execute_command → 命令真实执行 → 结果回填"
/// 完整链路。注意：此测试走 `AgentLoop + register_terminal_tools`（temperature=0 可控
/// 性更好），与 `AgentCommandService::new_agent` 内部注册入口等同（同一工具注册函数）。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_terminal_tools_full_chain_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 1) 构造带终端工具注册的 AgentLoop（复用 AgentCommandService::new_agent 的注册入口）
    let tool_bus = Arc::new(SimpleToolBus::new());
    register_terminal_tools(&*tool_bus, ShellSessionManager::new()).await;
    // 诊断：确认工具已注册到总线（list_all 应返回全部终端工具）
    {
        let defs = tool_bus.list_all().await;
        eprintln!("[e2e] 已注册工具数={}，名称={:?}", defs.len(), defs.iter().map(|d| d.name.clone()).collect::<Vec<_>>());
        for d in &defs {
            eprintln!("[e2e]   工具 {}({}) schema={}", d.name, d.description.chars().take(40).collect::<String>(), d.parameters);
        }
    }
    let backend = Arc::new(GenaiBackend::new(deepseek_config(&api_key)));
    let agent = AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
        // 参考 e2e_tool_call_chain 经验：deepseek-v4-flash 推理模型需明确指令、
        // 禁止反问、禁止反复调用工具；temperature=0 保证确定性收敛。
        system_prompt: Some(
            "You are a terminal assistant. You MUST call the execute_command tool with \
             command \"echo terminal-e2e-ok\" to verify the terminal works. After you \
             receive the tool result, answer the user directly and do NOT call \
             execute_command again. Never ask for clarification, never fabricate output."
                .into(),
        ),
        temperature: Some(0.0),
        ..Default::default()
    });

    // 2) 触发 ReAct 循环：LLM 应调用 execute_command 执行 echo
    let reply = match agent.run("Please run the terminal check now.".into()).await {
        Ok(r) => r,
        Err(e) => {
            // 诊断：run 失败（可能 MaxIterations）时仍打印历史，便于观察收敛行为
            let msgs = agent.get_messages().await;
            eprintln!("[e2e] run 返回错误：{e:?}");
            eprintln!("[e2e] === 失败前消息历史（共 {} 条）===", msgs.len());
            for (i, m) in msgs.iter().enumerate() {
                eprintln!(
                    "[e2e] [{i}] role={:?} tool_calls={} content={}",
                    m.role,
                    m.tool_calls.len(),
                    m.content.chars().take(200).collect::<String>()
                );
                for tc in &m.tool_calls {
                    eprintln!("[e2e]     tool_call name={} args={}", tc.name, tc.args);
                }
            }
            // 失败即 fail：避免假通过掩盖真实问题（此前 return 会跳过下方全部断言）
            panic!("run 返回错误，终端工具全链路未通过: {e:?}");
        }
    };

    // 3) 诊断：打印消息历史，观察 LLM 是否真实调用 execute_command
    {
        let msgs = agent.get_messages().await;
        eprintln!("[e2e] === 终端工具消息历史（共 {} 条）===", msgs.len());
        for (i, m) in msgs.iter().enumerate().take(12) {
            eprintln!(
                "[e2e] [{i}] role={:?} tool_calls={} content={}",
                m.role,
                m.tool_calls.len(),
                m.content.chars().take(200).collect::<String>()
            );
            for tc in &m.tool_calls {
                eprintln!("[e2e]     tool_call name={} args={}", tc.name, tc.args);
            }
        }
    }

    // 4) 校验链路：
    //    - 存在调用 execute_command 的工具调用
    //    - 消息历史含 ToolResult（触发工具结果回填）
    //    - ToolResult 内容含命令输出 "terminal-e2e-ok"（命令真实执行）
    let msgs = agent.get_messages().await;
    let called_command = msgs.iter().any(|m| {
        m.tool_calls.iter().any(|tc| tc.name == "execute_command")
    });
    assert!(
        called_command,
        "LLM 应触发 execute_command 工具调用（终端工具感知失败）"
    );

    let tool_result = msgs.iter().find(|m| m.role == MessageRole::ToolResult);
    assert!(
        tool_result.is_some(),
        "消息历史应含 ToolResult（终端工具结果未回填）"
    );
    assert!(
        tool_result.unwrap().content.contains("terminal-e2e-ok"),
        "ToolResult 内容应包含命令输出 terminal-e2e-ok（命令未真实执行）"
    );
    assert!(!reply.trim().is_empty(), "最终回复不应为空");

    eprintln!("[e2e] 终端工具全链路：execute_command 被真实调用并回填结果");
    eprintln!("[e2e] 最终回复：{reply}");
}

// ─── 子 Agent 编排全链路 e2e：主 Agent 委派给子 Agent ────────────────────────
///
/// 验证"规格注册 → 主 Agent 感知 list_sub_agents → 调用 delegate_to_sub_agent →
/// 子 Agent 独立执行 → 结果回填主 Agent"完整链路。走 `AgentCommandService`，
/// 与真实 Tauri 后端同一入口。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_subagent_orchestration_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    let svc = AgentCommandService::new();
    // 1) 注册一个子 Agent 规格（代码助手）
    svc.register_subagent_spec(SubAgentSpec {
        id: "coder".into(),
        name: "代码助手".into(),
        description: "精通 Rust 代码编写，处理算法、函数实现任务".into(),
        system_prompt: "你是一个严谨的 Rust 代码工程师。请直接给出简洁、正确的代码实现，不做多余解释。".into(),
        tools_whitelist: None,
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;
    assert_eq!(svc.list_subagent_specs().await.len(), 1);

    // 2) 创建会话（真实 LLM 后端）
    let info = svc
        .new_session(
            Some(
                "You are an orchestrator. Use the delegate_to_sub_agent tool to delegate \
                 coding tasks to a specialist sub-agent. First call list_sub_agents to \
                 discover available sub-agents, then delegate the task to the 'coder' \
                 sub-agent. After receiving the sub-agent result, summarize it to the \
                 user. Never fabricate the result, never ask for clarification."
                    .into(),
            ),
            vec![],
            Some(deepseek_config(&api_key)),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("会话创建失败");

    // 3) 触发 ReAct：主 Agent 应委派给 coder 子 Agent
    let reply = match svc
        .send_message(SendMessageParams {
            session_id: info.id.clone(),
            text: "请写一个 Rust 函数 max，返回两个整数的较大值。".into(),
            images: vec![],
            mode: None,
        })
        .await
    {
        Ok(r) => r,
        Err(e) => {
            // 诊断：打印消息历史观察收敛行为
            if let Ok(msgs) = svc.get_messages(&info.id).await {
                eprintln!("[e2e] === 消息历史（共 {} 条）===", msgs.len());
                for (i, m) in msgs.iter().enumerate() {
                    eprintln!(
                        "[e2e] [{i}] role={:?} tool_calls={} content={}",
                        m.role,
                        m.tool_calls.len(),
                        m.content.chars().take(150).collect::<String>()
                    );
                    for tc in &m.tool_calls {
                        eprintln!("[e2e]     tool_call name={} args={}", tc.name, tc.args);
                    }
                }
            }
            panic!("send_message 返回错误，子 Agent 编排未通过: {e:?}");
        }
    };

    // 4) 校验：主 Agent 应调用过 delegate_to_sub_agent
    let msgs = svc.get_messages(&info.id).await.unwrap();
    let delegated = msgs.iter().any(|m| {
        m.tool_calls
            .iter()
            .any(|tc| tc.name == "delegate_to_sub_agent")
    });
    assert!(
        delegated,
        "主 Agent 应调用 delegate_to_sub_agent（子 Agent 感知/委派失败）"
    );

    // 校验：存在 ToolResult（子 Agent 结果回填）
    let tool_result = msgs.iter().find(|m| m.role == MessageRole::ToolResult);
    assert!(
        tool_result.is_some(),
        "消息历史应含 ToolResult（子 Agent 结果未回填）"
    );
    assert!(
        tool_result.unwrap().content.contains("sub_agent_id"),
        "ToolResult 应包含子 Agent 结果元数据 (sub_agent_id)"
    );
    assert!(!reply.reply.trim().is_empty(), "最终回复不应为空");

    eprintln!("[e2e] 子 Agent 编排全链路：主 Agent 成功委派给子 Agent 并回填结果");
    eprintln!("[e2e] 最终回复：{}", reply.reply);
}

// ─── 终端能力进子 Agent 白名单 e2e：验证 WhitelistToolBus 工具隔离在真实 LLM 下生效 ──
///
/// 验证"子 Agent 工具白名单"在真实 LLM 链路下真正生效：
/// 1) 前置确定性校验（不依赖 LLM）：WhitelistToolBus 只暴露白名单内工具，白名单外不可见。
/// 2) 真实链路：主 Agent 委派给带白名单（仅 execute_command）的 sandbox 子 Agent，
///    子 Agent 经 WhitelistToolBus 调用白名单内的 execute_command 真实执行命令并回填。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_subagent_terminal_whitelist_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // ── 0) 前置确定性校验：WhitelistToolBus 隔离本身正确（不依赖 LLM）──
    {
        let inner = Arc::new(SimpleToolBus::new());
        register_terminal_tools(&*inner, ShellSessionManager::new()).await;
        let wl = WhitelistToolBus::new(inner, vec!["execute_command".into()]);
        let defs = wl.list_all().await;
        assert_eq!(
            defs.len(),
            1,
            "白名单只含 execute_command，list_all 应仅返回该工具（实际：{:?}）",
            defs.iter().map(|d| d.name.as_str()).collect::<Vec<_>>()
        );
        assert_eq!(defs[0].name, "execute_command");
        // 白名单外工具应不可见/不可取
        assert!(
            wl.get_by_name("delegate_to_sub_agent").await.is_none(),
            "白名单外工具 delegate_to_sub_agent 应不可见"
        );
        assert!(
            wl.get_by_name("shell_session_create").await.is_none(),
            "白名单外工具 shell_session_create 应不可见"
        );
    }

    let svc = AgentCommandService::new();
    // 1) 注册子 Agent：白名单仅含终端工具 execute_command
    svc.register_subagent_spec(SubAgentSpec {
        id: "sandbox".into(),
        name: "沙箱终端".into(),
        description: "只能执行 shell 命令的受限子 Agent，通过 execute_command 终端工具运行命令".into(),
        system_prompt: "你是一个受沙箱约束的终端操作员。你只能使用 execute_command 工具执行用户要求的 shell 命令，并返回命令的真实输出。不要调用其他工具，不要编造输出。".into(),
        tools_whitelist: Some(vec!["execute_command".into()]),
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;
    assert_eq!(svc.list_subagent_specs().await.len(), 1);

    // 2) 创建主会话（真实 LLM 后端）
    let info = svc
        .new_session(
            Some(
                "You are an orchestrator. Use delegate_to_sub_agent to delegate terminal \
                 tasks to the 'sandbox' sub-agent (call list_sub_agents first to discover). \
                 After receiving the sub-agent result, tell the user the exact command output."
                    .into(),
            ),
            vec![],
            Some(deepseek_config(&api_key)),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("会话创建失败");

    // 3) 触发 ReAct：主 Agent 应委派给 sandbox，sandbox 经白名单调用 execute_command
    let reply = match svc
        .send_message(SendMessageParams {
            session_id: info.id.clone(),
            text: "请委派给 sandbox 子 Agent，让它用终端工具执行命令：echo whitelist-e2e-ok，然后把输出告诉我。".into(),
            images: vec![],
            mode: None,
        })
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if let Ok(msgs) = svc.get_messages(&info.id).await {
                eprintln!("[e2e] === 消息历史（共 {} 条）===", msgs.len());
                for (i, m) in msgs.iter().enumerate() {
                    eprintln!(
                        "[e2e] [{i}] role={:?} tool_calls={} content={}",
                        m.role,
                        m.tool_calls.len(),
                        m.content.chars().take(120).collect::<String>()
                    );
                    for tc in &m.tool_calls {
                        eprintln!("[e2e]     name={} args={}", tc.name, tc.args);
                    }
                }
            }
            panic!("send_message 返回错误，终端白名单子 Agent 未通过: {e:?}");
        }
    };

    // 4) 校验：主 Agent 委派成功
    let msgs = svc.get_messages(&info.id).await.unwrap();
    let delegated = msgs
        .iter()
        .any(|m| m.tool_calls.iter().any(|tc| tc.name == "delegate_to_sub_agent"));
    assert!(delegated, "主 Agent 应调用 delegate_to_sub_agent");

    // 5) 校验：子 Agent 结果回填（delegate_to_sub_agent 的 ToolResult 含 sub_agent_id 元数据）
    let tool_result = msgs
        .iter()
        .find(|m| m.role == MessageRole::ToolResult && m.content.contains("sub_agent_id"));
    assert!(
        tool_result.is_some(),
        "消息历史应含子 Agent 结果回填 (sub_agent_id)"
    );

    // 6) 校验：子 Agent 经白名单内的 execute_command 真实执行了命令（输出含 echo 内容）
    let all_content = msgs
        .iter()
        .map(|m| m.content.clone())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(
        all_content.contains("whitelist-e2e-ok"),
        "子 Agent 应通过 execute_command 执行 echo whitelist-e2e-ok 并回填输出（实际消息头部：{}）",
        all_content.chars().take(400).collect::<String>()
    );
    assert!(!reply.reply.trim().is_empty(), "最终回复不应为空");

    eprintln!("[e2e] 终端白名单子 Agent 全链路：主 Agent 委派 → 子 Agent 经 WhitelistToolBus 调用 execute_command 成功");
    eprintln!("[e2e] 最终回复：{}", reply.reply);
}

// ─── 多子 Agent 编排 e2e：验证主 Agent 能在多个专长子 Agent 间正确择路 ──
///
/// 与 `e2e_subagent_orchestration_deepseek`（单子 Agent）不同，本测试注册
/// 两个专长子 Agent（code 代码助手 / write 写作助手），验证主 Agent 在多个
/// 子 Agent 中能依据任务类型正确选择目标：给定一个明确的"写代码"任务，
/// 主 Agent 应调用 `delegate_to_sub_agent` 且 `sub_agent_id == "code"`。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_subagent_multi_dispatch_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    let svc = AgentCommandService::new();
    // 1) 注册两个专长子 Agent（code / write）
    svc.register_subagent_spec(SubAgentSpec {
        id: "code".into(),
        name: "代码助手".into(),
        description: "精通 Rust 编程，负责编写与实现代码".into(),
        system_prompt: "你是一个严谨的 Rust 代码工程师。直接给出简洁正确的代码实现，不做多余解释。".into(),
        tools_whitelist: None,
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;
    svc.register_subagent_spec(SubAgentSpec {
        id: "write".into(),
        name: "写作助手".into(),
        description: "精通中文写作，负责撰写文案、故事、说明".into(),
        system_prompt: "你是一个中文写作专家。产出通顺、有文采的文字。".into(),
        tools_whitelist: None,
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;
    assert_eq!(svc.list_subagent_specs().await.len(), 2);

    // 2) 创建会话（真实 LLM 后端），系统提示明确两个子 Agent 的择路映射
    let info = svc
        .new_session(
            Some(
                "You are an orchestrator with two specialists. Use list_sub_agents to \
                 discover them, then delegate_to_sub_agent with the matching sub_agent_id: \
                 use sub_agent_id='code' for coding tasks, sub_agent_id='write' for writing \
                 tasks. After receiving the sub-agent result, summarize it to the user. \
                 Never fabricate the result."
                    .into(),
            ),
            vec![],
            Some(deepseek_config(&api_key)),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("会话创建失败");

    // 3) 触发 ReAct：给定一个明确的"写代码"任务，主 Agent 应择路委派给 code
    let reply = match svc
        .send_message(SendMessageParams {
            session_id: info.id.clone(),
            text: "请委派给合适的子 Agent：写一个 Rust 函数 add，返回两个整数之和。".into(),
            images: vec![],
            mode: None,
        })
        .await
    {
        Ok(r) => r,
        Err(e) => {
            if let Ok(msgs) = svc.get_messages(&info.id).await {
                eprintln!("[e2e] === 消息历史（共 {} 条）===", msgs.len());
                for (i, m) in msgs.iter().enumerate() {
                    eprintln!(
                        "[e2e] [{i}] role={:?} tool_calls={} content={}",
                        m.role,
                        m.tool_calls.len(),
                        m.content.chars().take(150).collect::<String>()
                    );
                    for tc in &m.tool_calls {
                        eprintln!("[e2e]     tool_call name={} args={}", tc.name, tc.args);
                    }
                }
            }
            panic!("send_message 返回错误，多子 Agent 编排未通过: {e:?}");
        }
    };

    // 4) 校验：主 Agent 应调用过 delegate_to_sub_agent，且委派给 code（择路正确）
    let msgs = svc.get_messages(&info.id).await.unwrap();
    let mut delegated_to: Option<String> = None;
    for m in &msgs {
        for tc in &m.tool_calls {
            if tc.name == "delegate_to_sub_agent" {
                if let Some(id) = tc.args.get("sub_agent_id").and_then(|x| x.as_str()) {
                    delegated_to = Some(id.to_string());
                }
            }
        }
    }
    assert!(
        delegated_to.is_some(),
        "主 Agent 应调用 delegate_to_sub_agent（多子 Agent 择路委派失败）"
    );
    assert_eq!(
        delegated_to.as_deref(),
        Some("code"),
        "写代码任务应择路委派给 code 子 Agent（实际委派给：{:?}）",
        delegated_to
    );

    // 5) 校验：子 Agent 结果回填 + 最终回复非空
    let tool_result = msgs.iter().find(|m| m.role == MessageRole::ToolResult);
    assert!(
        tool_result.is_some(),
        "消息历史应含 ToolResult（子 Agent 结果未回填）"
    );
    assert!(
        tool_result.unwrap().content.contains("sub_agent_id"),
        "ToolResult 应包含子 Agent 结果元数据 (sub_agent_id)"
    );
    assert!(!reply.reply.trim().is_empty(), "最终回复不应为空");

    eprintln!("[e2e] 多子 Agent 编排：主 Agent 在 code/write 中正确择路委派给 code");
    eprintln!("[e2e] 最终回复：{}", reply.reply);
}

// ─── 规格热更新真实链路 e2e：验证运行期 register_subagent_spec 覆盖后子 Agent 重建 ──
///
/// 与单元测试 `get_or_create_agent_reuses_or_rebuilds_by_spec` 不同，本测试走真实 LLM
/// 链路：先注册 code 子 Agent（system_prompt 要求回复以 `[V1]` 开头），委派一次校验
/// ToolResult 含 `[V1]`；随后运行期覆盖 code 规格（system_prompt 要求以 `[V2]` 开头），
/// 再次委派，校验新产生的 ToolResult 含 `[V2]`，证明子 Agent 已按新规格重建实例。
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_subagent_spec_hot_update_deepseek() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[e2e] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    let svc = AgentCommandService::new();

    // 1) 注册 v1 规格：子 Agent 回复必须以 [V1] 开头
    svc.register_subagent_spec(SubAgentSpec {
        id: "code".into(),
        name: "代码助手".into(),
        description: "精通 Rust 编程，负责编写与实现代码".into(),
        system_prompt:
            "你是一个严谨的 Rust 代码工程师。你的每一条回复都必须以 [V1] 开头，然后给出代码实现。"
                .into(),
        tools_whitelist: None,
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;

    // 2) 创建会话，主 Agent 明确每次代码任务都须委派给 code，不要直接回答
    let info = svc
        .new_session(
            Some(
                "You are an orchestrator with one specialist. Every time you receive a coding \
                 task, you MUST call delegate_to_sub_agent with sub_agent_id='code'. Never answer \
                 the coding task directly. After receiving the sub-agent result, tell the user 'done'."
                    .into(),
            ),
            vec![],
            Some(deepseek_config(&api_key)),
            None,
            None,
            None,
            None,
        )
        .await
        .expect("会话创建失败");

    // 3) 第一次委派（v1 规格），记录消息条数作为分界点
    let partition = {
        match svc
            .send_message(SendMessageParams {
                session_id: info.id.clone(),
                text: "委派给 code：写一个 Rust 函数 add，返回两个整数之和。".into(),
                images: vec![],
                mode: None,
            })
            .await
        {
            Ok(_) => {}
            Err(e) => {
                eprintln!("[e2e] 第一次委派失败: {e:?}");
                return;
            }
        }
        svc.get_messages(&info.id).await.unwrap().len()
    };

    // 4) 校验第一次委派产生了含 [V1] 的 ToolResult
    let msgs1 = svc.get_messages(&info.id).await.unwrap();
    let v1_result = msgs1
        .iter()
        .filter(|m| m.role == MessageRole::ToolResult)
        .any(|m| m.content.contains("[V1]"));
    assert!(
        v1_result,
        "v1 规格委派后 ToolResult 应含 [V1] 标记（子 Agent 使用 v1 system_prompt）"
    );

    // 5) 运行期热更新 code 规格为 v2（system_prompt 改为要求以 [V2] 开头）
    svc.register_subagent_spec(SubAgentSpec {
        id: "code".into(),
        name: "代码助手".into(),
        description: "精通 Rust 编程，负责编写与实现代码".into(),
        system_prompt:
            "你是一个严谨的 Rust 代码工程师。你的每一条回复都必须以 [V2] 开头，然后给出代码实现。"
                .into(),
        tools_whitelist: None,
        max_iterations: Some(5),
    temp_dir: None,
    })
    .await;

    // 6) 第二次委派（应使用按新规格重建的子 Agent）
    match svc
        .send_message(SendMessageParams {
            session_id: info.id.clone(),
            text: "再委派给 code：写一个 Rust 函数 multiply，返回两个整数之积。".into(),
            images: vec![],
            mode: None,
        })
        .await
    {
        Ok(_) => {}
        Err(e) => {
            eprintln!("[e2e] 第二次委派失败: {e:?}");
            return;
        }
    }

    // 7) 校验分界点之后新产生的 ToolResult 含 [V2]，证明使用了新规格实例
    let msgs2 = svc.get_messages(&info.id).await.unwrap();
    let v2_result = msgs2
        .iter()
        .enumerate()
        .filter(|(i, m)| *i >= partition && m.role == MessageRole::ToolResult)
        .any(|(_, m)| m.content.contains("[V2]"));
    assert!(
        v2_result,
        "热更新后二次委派应使用新规格实例（分界点后 ToolResult 应含 [V2] 标记）"
    );

    eprintln!("[e2e] 规格热更新：v1 委派含 [V1]，热更新 v2 后二次委派重建实例含 [V2]");
    eprintln!("[e2e] 消息数：第一次后 {partition} 条，第二次后 {} 条", msgs2.len());
}

// ─── 临时诊断：绕过 AgentLoop，直接调 backend.prompt 带工具，确认 genai 层 tools 是否注入 ──
#[tokio::test]
#[ignore = "需要真实 API Key 与网络，按需显式运行"]
async fn e2e_diag_prompt_with_tools_direct() {
    let Some(api_key) = api_key_from_env() else {
        eprintln!("[diag] 未设置 DEEPSEEK_API_KEY，跳过真实 LLM 调用");
        return;
    };

    // 构造仅含 execute_command 的工具总线
    let tool_bus = Arc::new(SimpleToolBus::new());
    register_terminal_tools(&*tool_bus, ShellSessionManager::new()).await;
    let defs = tool_bus.list_all().await;
    let exec = defs
        .iter()
        .find(|d| d.name == "execute_command")
        .expect("应存在 execute_command 工具")
        .clone();
    eprintln!("[diag] execute_command schema={}", exec.parameters);

    let backend = GenaiBackend::new(deepseek_config(&api_key));

    // 订阅事件，打印 ToolCallStart 的累积过程（诊断 genai 碎片累积）
    struct ToolCallDiag;
    impl Listener for ToolCallDiag {
        fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
            if let OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallStart {
                tool_call_id,
                name,
                args,
            }) = event
            {
                eprintln!("[diag:event] ToolCallStart id={} name={:?} args={:?}", tool_call_id, name, args);
            }
            ListenerOutcome::Continue
        }
    }
    backend.subscribe_events(Arc::new(ToolCallDiag)).await;

    let opts = PromptCallOptions {
        system_prompt_override: Some(
            "You are a terminal assistant. You MUST call the execute_command tool with \
             command \"echo diag-ok\". Do NOT reply with text, only call the tool first."
                .into(),
        ),
        tools: vec![exec],
        ..Default::default()
    };
    let resp = backend
        .prompt("Run the terminal check now.".into(), Some(opts))
        .await
        .expect("prompt 应成功");
    eprintln!("[diag] text={:?}", resp.text);
    eprintln!("[diag] tool_calls.len={}", resp.tool_calls.len());
    for tc in &resp.tool_calls {
        eprintln!("[diag]   tool_call name={} args={}", tc.name, tc.args);
    }
    eprintln!("[diag] stop_reason={:?}", resp.stop_reason);
}
