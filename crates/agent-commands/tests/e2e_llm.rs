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

use agent_commands::{AgentCommandService, SendMessageParams};
use agent_runtime::llm::config::ProviderConfig;

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