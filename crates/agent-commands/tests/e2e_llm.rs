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
use agent_runtime::agent::{AgentLoop, AgentLoopConfig};
use agent_runtime::llm::config::ProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::tool::{SimpleToolBus, Tool, ToolError};
use agent_runtime::types::MessageRole;
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