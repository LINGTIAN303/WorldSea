//! AgentLoop 织入点 Hook 协议（轻量协议化，matrix §8 里程碑 5）
//!
//! 把 AgentLoop::run 生命周期内的横切织入位（记忆闭环 / 四管线路由 / DeepPhase 阶段判定）
//! 显性化为统一位点契约，并提供外部扩展通道：
//! - `RunPhase`：位点枚举（每位点职责见枚举文档）
//! - `AgentLoopHook`：钩子 trait，每位点一个方法（默认空实现，实现方按需覆写）
//! - `AgentLoopHooks`：钩子注册表 + 位点调度
//! - `HookContext`：调度时注入的只读上下文（对 AgentLoop 的引用 + 当轮输入/工具名/成败）
//!
//! 设计约束（matrix §2.3 / §8 里程碑 5）：
//! - 内置织入（记忆/路由/DeepPhase）保持为底座内聚能力，仅重构成内部方法组织化；
//!   本协议提供统一调度入口与外部观察/扩展通道，**不改变** with_memory/with_router 等
//!   既有启用语义与对外行为。
//! - hook 失败不得阻断主流程（协议约定：实现方在 hook 内自行容错，调度方不捕获异常）。

use std::sync::{Arc, RwLock};

use async_trait::async_trait;

use super::AgentLoop;

/// 织入位点枚举 — AgentLoop::run 生命周期内可挂载横切逻辑的位置
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunPhase {
    /// run 开头：用户输入就绪、ReAct 循环启动前。
    /// 内置织入：记忆召回（recall→inject→memory_context）、
    /// 四管线路由决策（decide→pipeline_context + RouterDecisionMade 事件）。
    BeforeReact,
    /// user 消息入队并广播后（ReAct 循环前）。
    /// 内置织入：无；供外部观察本轮输入侧上下文。
    AfterUserMessage,
    /// run_react_loop 每轮工具调用完成后。
    /// 内置织入：long_task checkpoint 更新（三模式移除后无 DeepPhase 阶段判定）。
    OnToolCall,
    /// ReAct 循环结束、终态事件（AgentEnd/Error）广播后，run 收尾前。
    /// 内置织入：无；供外部观察本轮成败（`HookContext::succeeded`）。
    AfterReact,
    /// run 收尾阶段。
    /// 内置织入：记忆归档（record_turn + archive）。
    AfterRun,
}

/// AgentLoop 织入钩子 trait — 实现并注册后，在对应位点被调用
///
/// 全部方法默认空实现；实现方仅覆写关心的位点。
/// 每轮信息经 `HookContext` 传入（当前 AgentLoop 引用 / 本轮输入 / 工具名 / 成败）。
#[async_trait]
pub trait AgentLoopHook: Send + Sync {
    /// `RunPhase::BeforeReact`：ReAct 循环启动前（内置记忆召回/路由决策之后）
    async fn on_before_react(&self, _ctx: &HookContext<'_>) {}
    /// `RunPhase::AfterUserMessage`：user 消息入队并广播后
    async fn on_after_user_message(&self, _ctx: &HookContext<'_>) {}
    /// `RunPhase::OnToolCall`：每轮工具调用完成后（`ctx.tool_name` 为当前工具名）
    async fn on_tool_call(&self, _ctx: &HookContext<'_>) {}
    /// `RunPhase::AfterReact`：ReAct 循环结束、终态事件广播后（`ctx.succeeded` 为本轮成败）
    async fn on_after_react(&self, _ctx: &HookContext<'_>) {}
    /// `RunPhase::AfterRun`：run 收尾阶段（内置记忆归档之后，`ctx.succeeded` 为本轮成败）
    async fn on_after_run(&self, _ctx: &HookContext<'_>) {}
}

/// 调度时注入的只读上下文
///
/// `agent` 为当前 AgentLoop 的只读引用（内部状态均为 Arc 原子字段），
/// hook 可经公开方法读取 backend/emitter/state 快照等；协议约定只读、不写入。
/// `tool_name` 仅在 `OnToolCall` 位点填充；`succeeded` 在 `AfterReact`/`AfterRun` 位点填充。
pub struct HookContext<'a> {
    /// 当前 AgentLoop（只读）
    pub agent: &'a AgentLoop,
    /// 本轮用户输入
    pub run_user_input: &'a str,
    /// 当前工具名（仅 `OnToolCall` 位点有意义）
    pub tool_name: Option<&'a str>,
    /// 本轮是否成功（仅 `AfterReact`/`AfterRun` 位点有意义）
    pub succeeded: bool,
}

impl<'a> HookContext<'a> {
    pub(crate) fn new(agent: &'a AgentLoop, run_user_input: &'a str) -> Self {
        Self {
            agent,
            run_user_input,
            tool_name: None,
            succeeded: false,
        }
    }
}

/// 钩子注册表 + 位点调度
///
/// 内部 `RwLock<Vec<Arc<dyn AgentLoopHook>>>`：运行期可 `register` 追加，
/// `dispatch` 时快照执行（顺序调用，协议约定 hook 内部容错）。
#[derive(Default)]
pub struct AgentLoopHooks {
    hooks: RwLock<Vec<Arc<dyn AgentLoopHook>>>,
}

impl AgentLoopHooks {
    /// 注册一个钩子（运行期追加）
    pub fn register(&self, hook: Arc<dyn AgentLoopHook>) {
        if let Ok(mut guard) = self.hooks.write() {
            guard.push(hook);
        }
    }

    /// 是否有已注册钩子（无钩子时调度零开销短路）
    pub fn is_empty(&self) -> bool {
        self.hooks.read().map(|g| g.is_empty()).unwrap_or(true)
    }

    /// 按位点分发到所有已注册钩子（顺序执行；协议约定 hook 内部容错，失败不阻断主流程）
    pub async fn dispatch(&self, phase: RunPhase, ctx: &HookContext<'_>) {
        let snapshot = self.hooks.read().map(|g| g.clone()).unwrap_or_default();
        if snapshot.is_empty() {
            return;
        }
        for hook in &snapshot {
            match phase {
                RunPhase::BeforeReact => hook.on_before_react(ctx).await,
                RunPhase::AfterUserMessage => hook.on_after_user_message(ctx).await,
                RunPhase::OnToolCall => hook.on_tool_call(ctx).await,
                RunPhase::AfterReact => hook.on_after_react(ctx).await,
                RunPhase::AfterRun => hook.on_after_run(ctx).await,
            }
        }
    }
}