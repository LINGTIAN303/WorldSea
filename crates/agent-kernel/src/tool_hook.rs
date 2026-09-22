//! A6 工具生命周期钩子（PreToolUse / PostToolUse / OnError 护栏）
//!
//! 借鉴 OpenWorld 的 PreToolUse/PostToolUse/OnError 三阶段工具拦截，
//! 适配 WorldSea Rust AgentLoop。机制：
//! - `on_pre_use`：工具执行前调用，可修改 args（返回 `Allow(new_args)`）或拒绝（`Deny`）。
//!   多个钩子按注册顺序依次执行，后一个覆盖前一个的 args。
//! - `on_post_use`：工具执行成功后调用，观察结果（不阻断）。
//! - `on_error`：工具执行失败后调用，记录错误（不阻断流程，供审计/告警）。
//!
//! 通过 `AgentLoop::with_tool_hook` 注册，在 `execute_tool_with_retry` 的
//! `call_tool` 前后触发。机制本身不强制 UI，由具体钩子实现承载策略。

use crate::tool::ToolError;

/// 工具钩子 pre 判定结果
///
/// - `Allow(new_args)`：放行并携带（可能被修改后的）参数
/// - `Deny(reason)`：拒绝执行，`reason` 作为工具错误返回给 LLM
/// - `Review { reason }`（S5）：钩子不裁决、**转人工复核**（hookReview 交互请求）——
///   放行则继续执行（沿原 args），拒绝 / 超时 / 随轮取消按 fail-closed 收口
///   （对齐 ZCode 钩子三值决策 `allow | deny | ask` 的 `ask` 位）
#[derive(Debug, Clone)]
pub enum ToolHookAction {
    /// 放行执行，`new_args` 为本次实际执行所用的参数（原样 = 不修改）
    Allow(serde_json::Value),
    /// 拒绝执行，`reason` 作为 `ToolError::Execution` 返回给 LLM
    Deny(String),
    /// 转人工复核（S5）：`reason` 为展示给用户的原因；未获放行者按拒绝处理
    Review { reason: String },
}

/// 工具生命周期钩子（A6）
pub trait ToolLifecycleHook: Send + Sync {
    /// 钩子标识（日志 / 调试 / 审计用），默认取类型名
    fn hook_name(&self) -> &str {
        std::any::type_name::<Self>()
    }

    /// 工具执行前：修改 args（返回 `Allow(new_args)`）或拒绝（返回 `Deny`）
    fn on_pre_use(&self, tool_name: &str, args: &serde_json::Value) -> ToolHookAction {
        let _ = tool_name;
        ToolHookAction::Allow(args.clone())
    }

    /// 工具执行成功后调用（观测结果，不阻断）
    fn on_post_use(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        result: &serde_json::Value,
    ) {
        let _ = (tool_name, args, result);
    }

    /// 工具执行失败后调用（记录错误，不阻断流程）
    fn on_error(&self, tool_name: &str, args: &serde_json::Value, error: &ToolError) {
        let _ = (tool_name, args, error);
    }
}

// ─── 内置钩子示例 ──────────────────────────────────────────

/// 审计日志钩子：把每次工具调用（成功/失败/拒绝）写入 tracing 日志
///
/// 作为 A6 机制的默认示例与通用护栏，无阻断作用；
/// 后续可把记录结果转发到 A1 trace 通道或持久化审计表。
pub struct AuditLifecycleHook;

impl ToolLifecycleHook for AuditLifecycleHook {
    fn hook_name(&self) -> &str {
        "audit"
    }

    fn on_pre_use(&self, tool_name: &str, args: &serde_json::Value) -> ToolHookAction {
        tracing::info!(
            "[hook:audit] pre  tool={} args={}",
            tool_name,
            args.to_string().chars().take(120).collect::<String>()
        );
        ToolHookAction::Allow(args.clone())
    }

    fn on_post_use(&self, tool_name: &str, args: &serde_json::Value, result: &serde_json::Value) {
        tracing::info!(
            "[hook:audit] post tool={} args={} result={}",
            tool_name,
            args.to_string().chars().take(80).collect::<String>(),
            result.to_string().chars().take(80).collect::<String>()
        );
    }

    fn on_error(&self, tool_name: &str, args: &serde_json::Value, error: &ToolError) {
        tracing::info!(
            "[hook:audit] err  tool={} args={} error={}",
            tool_name,
            args.to_string().chars().take(80).collect::<String>(),
            error
        );
    }
}

// ─── 测试 ──────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_hook_allows_passthrough() {
        let h = AuditLifecycleHook;
        let args = serde_json::json!({ "a": 1 });
        // 内置 audit 钩子默认放行且不改 args
        assert!(matches!(
            h.on_pre_use("echo", &args),
            ToolHookAction::Allow(ref v) if v == &args
        ));
        assert!(h.hook_name() == "audit");
    }

    #[test]
    fn deny_action_carries_reason() {
        let action = ToolHookAction::Deny("危险命令已被拦截".to_string());
        match action {
            ToolHookAction::Deny(reason) => assert!(reason.contains("危险")),
            _ => panic!("应为 Deny"),
        }
    }
}