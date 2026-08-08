//! WorldSmith CLI 主入口（Rust 版，Phase F 迁移）
//!
//! 用法：
//!   worldsmith chat [options]    交互式对话（AgentLoop + genai）
//!   worldsmith --help
//!   worldsmith --version
//!
//! 背景：TS 端 Agent（createWorldSmithAgent / createCliAgent）已在批次3 移除
//! pi-ai 依赖后废弃，Agent 循环迁移至 Rust（crates/agent-runtime::AgentLoop）。
//! 本二进制直接复用 Rust AgentLoop + GenaiBackend，实现真实 chat。

mod tools;

use std::io::{self, BufRead, Write};
use std::sync::Arc;

use agent_runtime::agent::{AgentLoop, AgentLoopConfig};
use agent_runtime::backend::ThinkingLevel;
use agent_runtime::llm::config::{CustomApiType, ProviderConfig};
use agent_runtime::llm::genai_backend::GenaiBackend;
use agent_runtime::tool::{SimpleToolBus, ToolBus};

use tools::build_cli_tools;

const SYSTEM_PROMPT: &str = "你是 WorldSmith 的世界观构建助手。你可以读写本地文件、列出目录、执行命令来协助用户构建世界观内容。回答使用中文，简洁直接。";

#[derive(Debug, Clone)]
struct CliArgs {
    provider: String,
    model: String,
    api_key: Option<String>,
    base_url: Option<String>,
    data_dir: Option<String>,
}

fn print_help() {
    println!(
        "WorldSmith CLI — AI-powered worldbuilding assistant\n\
         \n\
         用法：\n\
         \x20 worldsmith chat [options]    交互式对话\n\
         \x20 worldsmith --help            显示帮助\n\
         \x20 worldsmith --version         显示版本\n\
         \n\
         chat 选项：\n\
         \x20 -p, --provider <name>   LLM provider（默认 deepseek）\n\
         \x20 -m, --model <name>      Model ID（默认 deepseek-chat）\n\
         \x20     --api-key <key>     API key（或 WORLDSMITH_API_KEY 环境变量）\n\
         \x20     --base-url <url>    自定义 API base URL（OpenAI 兼容协议）\n\
         \x20 -d, --data <path>       数据目录（保留参数，暂未启用实体存储）"
    );
}

fn parse_args() -> CliArgs {
    let mut args = CliArgs {
        provider: "deepseek".to_string(),
        model: "deepseek-chat".to_string(),
        api_key: None,
        base_url: None,
        data_dir: None,
    };
    let mut it = std::env::args().skip(1).peekable();
    let mut command: Option<String> = None;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "-p" | "--provider" => {
                if let Some(v) = it.next() {
                    args.provider = v;
                }
            }
            "-m" | "--model" => {
                if let Some(v) = it.next() {
                    args.model = v;
                }
            }
            "--api-key" => {
                if let Some(v) = it.next() {
                    args.api_key = Some(v);
                }
            }
            "--base-url" => {
                if let Some(v) = it.next() {
                    args.base_url = Some(v);
                }
            }
            "-d" | "--data" => {
                if let Some(v) = it.next() {
                    args.data_dir = Some(v);
                }
            }
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            "-V" | "--version" => {
                println!("worldsmith {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            other if other.starts_with('-') => {
                eprintln!("未知选项：{other}（用 --help 查看用法）");
                std::process::exit(1);
            }
            other => {
                if command.is_none() {
                    command = Some(other.to_string());
                }
            }
        }
    }
    let command = command.unwrap_or_else(|| "chat".to_string());
    if command != "chat" {
        eprintln!("未知命令：{command}（当前仅支持 chat；用 --help 查看用法）");
        std::process::exit(1);
    }
    args
}

fn resolve_api_key(args: &CliArgs) -> Option<String> {
    if let Some(key) = &args.api_key {
        return Some(key.clone());
    }
    std::env::var("WORLDSMITH_API_KEY").ok().filter(|k| !k.is_empty())
}

fn build_provider_config(args: &CliArgs, api_key: String) -> ProviderConfig {
    if let Some(base_url) = &args.base_url {
        ProviderConfig::Custom {
            base_url: base_url.clone(),
            api_key,
            api_type: CustomApiType::OpenaiCompatible,
            model_id: args.model.clone(),
            context_window: 1048576,
            max_tokens: 65536,
        }
    } else {
        ProviderConfig::Cloud {
            provider: args.provider.clone(),
            model_id: args.model.clone(),
            api_key,
        }
    }
}

async fn run_chat(args: &CliArgs) -> anyhow::Result<()> {
    let api_key = match resolve_api_key(args) {
        Some(k) => k,
        None => {
            eprintln!(
                "错误：未配置 API key。请用 --api-key 参数或设置 WORLDSMITH_API_KEY 环境变量。"
            );
            std::process::exit(1);
        }
    };

    let provider_config = build_provider_config(args, api_key);

    // 事件订阅：打印流式增量（AgentStart/StreamDelta 等可读事件），保持终端简洁
    let agent = {
        let backend = Arc::new(GenaiBackend::new(provider_config));
        let tool_bus: Arc<dyn ToolBus> =
            Arc::new(SimpleToolBus::with_tools(build_cli_tools()));
        AgentLoop::new(backend, tool_bus).with_config(AgentLoopConfig {
            system_prompt: Some(SYSTEM_PROMPT.to_string()),
            temperature: None,
            max_tokens: None,
            thinking_level: Some(ThinkingLevel::Low),
            ..Default::default()
        })
    };

    println!(
        "WorldSmith CLI — 对话模式（{}/{}）",
        args.provider, args.model
    );
    println!("输入 /quit 退出，/clear 清屏。");

    let stdin = io::stdin();
    let mut lines = stdin.lock().lines();
    loop {
        print!("worldsmith> ");
        io::stdout().flush().ok();

        let Some(Ok(line)) = lines.next() else { break };
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        match line {
            "/quit" | "/exit" | "/q" => break,
            "/clear" => {
                print!("\x1b[2J\x1b[H");
                continue;
            }
            _ if line.starts_with('/') => {
                println!("未知命令：{line}（可用 /quit /clear）");
                continue;
            }
            _ => {}
        }

        match agent.run(line.to_string()).await {
            Ok(reply) => println!("\n{reply}\n"),
            Err(e) => eprintln!("\n[错误] {e}\n"),
        }
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    // 初始化 tracing（默认 info 级，仅错误/警告输出）
    let _ = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::WARN)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();

    let args = parse_args();
    if let Err(e) = run_chat(&args).await {
        eprintln!("[错误] {e:#}");
        std::process::exit(1);
    }
}
