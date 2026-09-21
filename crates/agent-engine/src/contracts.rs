//! 内核契约（S2 冻结 · 07 文档）——单一定义处。
//!
//! 本批（S3-a）落三类已稳固的类型：事件键与分发模式、输入三语义、审批四值。
//! 事件 key **全表**（59 项）与 ToolDescriptor 分别归 S3-b 与工具族批次，避免迁移期双份事实源漂移。

use serde::{Deserialize, Serialize};

/// 事件键：`domain/name` 形态的静态字符串（同类事件共享）。
pub type EventKey = &'static str;

/// 事件分发模式——五模式**声明面**保留；近景实装 Emit / Bail / Waterfall
/// （serial / parallel 无消费方时缓做，首个消费方出现即补，见 07 §一）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchMode {
    Emit,
    Bail,
    Serial,
    Parallel,
    Waterfall,
}

/// 输入三语义（对齐旧 `agent-kernel::agent::input::InputKind`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputKind {
    /// 跟进（唤醒）：新任务周期——推入 user 消息并启动循环
    FollowUp,
    /// 中途引导（唤醒，最近一轮消费）
    Steer,
    /// 上下文注入（不唤醒）：只入队，待下一次运行时经准入注入
    Inject,
}

/// 审批四值结果（对齐旧 `agent-kernel::confirmation::ConfirmationOutcome`）。
///
/// fail-closed 不变量：仅 [`ConfirmationOutcome::Approved`] 视为放行；
/// `Timeout` **仅内核侧产生**，不接受前端回传（07 §四）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationOutcome {
    /// 用户放行
    Approved,
    /// 用户拒绝
    Denied,
    /// 用户跳过（第三键）
    Skipped,
    /// 等待确认超时
    Timeout,
}

impl ConfirmationOutcome {
    /// fail-closed：仅 Approved 为真。
    pub fn is_approved(self) -> bool {
        matches!(self, Self::Approved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirmation_is_fail_closed() {
        assert!(ConfirmationOutcome::Approved.is_approved());
        for outcome in [
            ConfirmationOutcome::Denied,
            ConfirmationOutcome::Skipped,
            ConfirmationOutcome::Timeout,
        ] {
            assert!(!outcome.is_approved(), "{outcome:?} 不应视为放行");
        }
    }

    #[test]
    fn serde_snake_case_roundtrip() {
        // 与旧 kernel 的 serde 口径一致（snake_case），迁移期跨 crate 传递不破
        assert_eq!(serde_json::to_string(&ConfirmationOutcome::Skipped).unwrap(), "\"skipped\"");
        assert_eq!(serde_json::to_string(&InputKind::FollowUp).unwrap(), "\"follow_up\"");
        assert_eq!(serde_json::to_string(&DispatchMode::Waterfall).unwrap(), "\"waterfall\"");
        let back: ConfirmationOutcome = serde_json::from_str("\"timeout\"").unwrap();
        assert_eq!(back, ConfirmationOutcome::Timeout);
    }

    #[test]
    fn dispatch_mode_declares_five() {
        let declared = [
            DispatchMode::Emit,
            DispatchMode::Bail,
            DispatchMode::Serial,
            DispatchMode::Parallel,
            DispatchMode::Waterfall,
        ];
        assert_eq!(declared.len(), 5, "五模式声明面必须完整（实装面见 07 §一）");
    }

    #[test]
    fn input_kind_declares_three_semantics() {
        let declared = [InputKind::FollowUp, InputKind::Steer, InputKind::Inject];
        assert_eq!(declared.len(), 3, "三语义正交（跟进入队/引领/注入不唤醒）");
    }

    #[test]
    fn event_key_shape() {
        // 键形态约定：domain/name（如 "conversation/forked"）——S3-b 起全表登记
        let sample: EventKey = "conversation/forked";
        assert!(sample.contains('/'));
    }
}
