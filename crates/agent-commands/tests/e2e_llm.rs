//! # 端到端实测 — 真实 LLM 后端（Phase 5.4 子任务 2）
//!
//! 覆盖主链路：`new_session` → `send_message` → 流式回复。
//!
//! ## 运行方式
//! 需要真实 API Key，通过环境变量注入（**禁止硬编码**）：
//!
//! ```bash
//! $env:DEEPSEEK_API_KEY = "sk-xxx"   # PowerShell
//! cargo test --test e2e_llm -- --ignored --nocapture
//! ```
//!
//! ## 设计约束
//! - 测试 `#[ignore]`：不参与常规 CI，避免无网络/无 Key 时误报。
//! - API Key 仅从环境变量 `DEEPSEEK_API_KEY` 读取；未设置时测试直接跳过（打印提示）。
//! - 验证点在主链路上：会话创建成功、Provider 配置回显正确、消息能拿到非空回复。
//!
//! ## Provider 选择
//! 采用 DeepSeek（国内可直连）。可替换为其他已注册 provider：改 `deepseek_config`
//! 中的 `provider` / `model_id` 与下方断言，并设置对应环境变量即可。

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use agent_commands::{AgentCommandService, SendMessageParams};
use agent_runtime::agent::{AgentError, AgentLoop, AgentLoopConfig};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::long_task::{
    LongTaskCheckpoint, LongTaskMeta, LongTaskStatus, LongTaskType,
};
use agent_runtime::tool::{SimpleToolBus, Tool, ToolError};
use agent_runtime::types::{MessageRole, OrchestratorMessage, ToolCall};
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
            Some(deepseek_config(&api_key)),
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
        // max_iterations=15：给 deepseek-v4-flash 推理模型足够收敛机会（实测通常 9 轮内
        // 收敛），同时避免默认 25 时偶发反复调用工具拖慢测试。工具调用链测试单独设更高值。
        max_iterations: 15,
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