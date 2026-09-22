//! 内核契约（S2 冻结 · 07 文档）——单一定义处。
//!
//! 落有四类已稳固的契约：事件键表与分发模式（S3-b 自 agent-kernel 迁入）、
//! 输入三语义、审批四值。`ToolDescriptor` 归工具族批次。
//! 另落检查点引用契约（S3-e 合并裁定 · 方案 A，见 [`checkpoints`]）
//! 与交互请求族契约（S5 三型统一模型 + 提问载荷/结果，见 [`interaction`]）。

use serde::{Deserialize, Serialize};

pub mod checkpoints;
pub mod interaction;
pub mod keys;

/// 事件键：静态字符串（命名沿既有口径：snake_case 单词式，如 `"agent_start"`）。
pub type EventKey = &'static str;

/// 事件分发模式——五模式**声明面**保留；近景实装 Emit / Bail / Waterfall
/// （serial / parallel 无消费方时缓做，首个消费方出现即补，见 07 §一）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DispatchMode {
    /// 同步扇出、忽略返回值（既有 broadcast 语义）
    Emit,
    /// 同步串行、首个否决值短路（dsh: bail）
    Bail,
    /// 顺序 await、首个否决短路（dsh: serial）
    Serial,
    /// 并行 await（dsh: parallel）
    Parallel,
    /// 环绕中间件、末参 next、不调即否决（dsh: waterfall）
    Waterfall,
}

/// 事件模式声明（单一声明点，06 草案 §3.1 / U1 表驱动；S3-b 自 agent-kernel 迁入）
///
/// 默认 [`DispatchMode::Emit`]；少数事件显式登记其他模式
/// （`INPUT_ADMISSION` 与 `TOOL_RESULT_PRE_BROADCAST` = waterfall）。
pub fn mode_of(key: EventKey) -> DispatchMode {
    match key {
        // A3 输入准入：waterfall（监听器链可改写 / 否决待准入输入）
        keys::INPUT_ADMISSION => DispatchMode::Waterfall,
        // A1 第二段（工具结果裁剪）：waterfall（监听器链可改写 result；链尾内建 = 裁剪）
        keys::TOOL_RESULT_PRE_BROADCAST => DispatchMode::Waterfall,
        // S3-c/S3-d 会话分支：同步扇出、无拦截语义（显式登记，同族事件统一入表）
        keys::CONVERSATION_FORKED | keys::CONVERSATION_REWOUND | keys::CHECKPOINT_CREATED => {
            DispatchMode::Emit
        }
        // S5 交互族：请求/结果同步扇出（审批/提问/复核三型共用）
        keys::INTERACTION_REQUESTED | keys::INTERACTION_RESOLVED => DispatchMode::Emit,
        _ => DispatchMode::Emit,
    }
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

    /// 从 snake_case 字符串解析（前端回传入参；`timeout` 仅内核侧产生、不接受回传）
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "approved" => Ok(Self::Approved),
            "denied" => Ok(Self::Denied),
            "skipped" => Ok(Self::Skipped),
            "timeout" => Err("timeout 由 kernel 超时产生，不接受前端回传".to_string()),
            other => Err(format!("未知审批结果: {other}（期望 approved/denied/skipped）")),
        }
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
    fn confirmation_parse_rejects_kernel_only_timeout() {
        assert_eq!(ConfirmationOutcome::parse("approved").unwrap(), ConfirmationOutcome::Approved);
        assert_eq!(ConfirmationOutcome::parse("denied").unwrap(), ConfirmationOutcome::Denied);
        assert_eq!(ConfirmationOutcome::parse("skipped").unwrap(), ConfirmationOutcome::Skipped);
        // timeout 仅内核侧产生（07 §四）——前端回传即报错
        assert!(ConfirmationOutcome::parse("timeout").is_err());
        assert!(ConfirmationOutcome::parse("unknown").is_err());
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
    fn keys_table_moved_intact() {
        // S3-b 迁移对照：Key 值与旧 agent-kernel::event::keys 逐字一致（首尾抽样）
        assert_eq!(keys::AGENT_START, "agent_start");
        assert_eq!(keys::CHECKPOINT_CREATED, "checkpoint_created");
    }

    #[test]
    fn interaction_key_registered_with_mode() {
        // S5 交互族：key + mode 双查（键值口径 snake_case 单词式）
        assert_eq!(keys::INTERACTION_REQUESTED, "interaction_requested");
        assert_eq!(keys::INTERACTION_RESOLVED, "interaction_resolved");
        for key in [keys::INTERACTION_REQUESTED, keys::INTERACTION_RESOLVED] {
            assert_eq!(mode_of(key), DispatchMode::Emit, "{key} 应为同步扇出");
        }
    }

    #[test]
    fn mode_of_registers_waterfall_keys() {
        // 两个 waterfall 登记必须随表迁移（06 草案 U1 表驱动）
        assert_eq!(mode_of(keys::INPUT_ADMISSION), DispatchMode::Waterfall);
        assert_eq!(mode_of(keys::TOOL_RESULT_PRE_BROADCAST), DispatchMode::Waterfall);
        assert_eq!(mode_of(keys::AGENT_START), DispatchMode::Emit);
    }

    #[test]
    fn session_branch_key_registered_with_mode() {
        // S3-c/S3-d：会话分支三事件登记（key + mode 双查——键值口径 snake_case 单词式）
        assert_eq!(keys::CONVERSATION_FORKED, "conversation_forked");
        assert_eq!(keys::CONVERSATION_REWOUND, "conversation_rewound");
        assert_eq!(keys::CHECKPOINT_CREATED, "checkpoint_created");
        for key in [
            keys::CONVERSATION_FORKED,
            keys::CONVERSATION_REWOUND,
            keys::CHECKPOINT_CREATED,
        ] {
            assert_eq!(mode_of(key), DispatchMode::Emit, "{key} 应为同步扇出");
        }
    }
}
