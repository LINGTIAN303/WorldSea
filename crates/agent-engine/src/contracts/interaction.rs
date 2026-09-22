//! 交互请求族契约（S5）——「交互请求三型（permission / userInput / hookReview）为外层统一模型」。
//!
//! 依据：[07-§四 审批契约](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/07-内核契约冻结.md) ·
//! [12-S5施工计划](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/12-S5施工计划-交互三型.md)。
//!
//! 判别口径 = `kind`：请求与结果各自携带 kind，**错配即拒**（统一注册表 `resolve` 不唤醒）。
//! - `Permission`：工具调用审批——结果 [`ConfirmationOutcome`] 四值不变（B7 回归底线）
//! - `UserInput`：模型主动提问——结果 [`AskOutcome`] 四态不变
//! - `HookReview`：钩子转人工复核（S5 新增；ZCode 钩子决策 `allow|deny|ask` 中 `ask` 的内化）——
//!   结果 [`HookReviewOutcome`]，超时/取消按拒绝 fail-closed
//!
//! 详细注释见 docs/details/注释/agent-runtime/confirmation.md。

use serde::{Deserialize, Serialize};

use super::ConfirmationOutcome;

/// 交互请求类型（三型；serde snake_case）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InteractionKind {
    /// 工具调用审批
    Permission,
    /// 模型主动提问
    UserInput,
    /// 钩子转人工复核
    HookReview,
}

impl InteractionKind {
    /// 线面标识（事件载荷 `kind` 字段；与 serde 口径一致）
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Permission => "permission",
            Self::UserInput => "user_input",
            Self::HookReview => "hook_review",
        }
    }
}

/// 交互请求载荷（`serde(tag = "kind")`——wire 口径 `{"kind": "...", <载荷字段>}`）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InteractionRequest {
    /// 审批：`args` 为待执行工具的参数原样
    Permission {
        /// 待确认的工具名
        tool_name: String,
        /// 待确认的工具参数
        args: serde_json::Value,
        /// 工具声明风险等级（`ToolDescriptor.safety.risk_level` 线面串；`None` = 旧载荷/未声明）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        risk_level: Option<String>,
        /// 工具声明副作用范围（同上）
        #[serde(default, skip_serializing_if = "Option::is_none")]
        side_effect_scope: Option<String>,
    },
    /// 提问：`questions` 为规范化后的批次载荷（camelCase：`[{id, question, header?, options?, multiSelect?}]`）
    UserInput {
        /// 问题批次
        questions: serde_json::Value,
    },
    /// 复核：`reason` 为钩子给出的转复核原因（前端展示）
    HookReview {
        /// 发起复核的钩子名（`ToolLifecycleHook::hook_name`）
        hook_name: String,
        /// 被钩子拦下的工具名
        tool_name: String,
        /// 工具参数（复核参考）
        args: serde_json::Value,
        /// 钩子给出的原因（人类可读）
        reason: String,
    },
}

impl InteractionRequest {
    /// 请求类型（判别）
    pub fn kind(&self) -> InteractionKind {
        match self {
            Self::Permission { .. } => InteractionKind::Permission,
            Self::UserInput { .. } => InteractionKind::UserInput,
            Self::HookReview { .. } => InteractionKind::HookReview,
        }
    }
}

// ─── 提问（userInput 型）载荷与结果（Q1，2026-09-20；S5 自 agent-kernel 迁入） ───

/// 提问单题答案（前端回传；协议对齐 dsh `ask_user_question`：稳定 id 原样回显）
///
/// 语义（对齐 dsh）：
/// - 单选：`custom` 覆盖 `selected`（有自定义回答时 `selected` 为空）
/// - 多选：`custom` 为补充（保留 `selected`）
/// - 跳过 / 未答：`selected` 为空且无 `custom`
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AskAnswer {
    /// 问题稳定 id（与请求 `questions[].id` 一一对应）
    pub id: String,
    /// 选中的选项 label 列表（跳过/未答 = 空数组）
    #[serde(default)]
    pub selected: Vec<String>,
    /// 自定义回答（可选；单选下为覆盖语义）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<String>,
}

/// 提问结果（三语义 + 超时四态，2026-09-20）
///
/// - `Answered`：用户作答（answers 与问题按稳定 id 一一对应）→ 工具成功结果
/// - `Denied`：用户拒绝作答（前端「取消」键）→ 工具失败码 `ASK_DENIED`
/// - `Cancelled`：等待被中断取消（abort / dispose 随轮取消；仅内核侧产生）→ 工具失败码 `ASK_CANCELLED`
/// - `TimedOut`：等待超时（600s 兜底；仅内核侧产生）→ 工具按「跳过」处理（逐题空答案 + `timedOut` 标记，非失败结果）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AskOutcome {
    /// 用户已作答
    Answered(Vec<AskAnswer>),
    /// 用户拒绝作答（前端取消）
    Denied,
    /// 等待被中断取消（随轮取消 / 会话销毁；仅内核侧产生）
    Cancelled,
    /// 等待超时（兜底；仅内核侧产生）——按「跳过」处理
    TimedOut,
}

impl AskOutcome {
    /// 结果类别字符串（事件载荷 / 前端清理用）
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Answered(_) => "answered",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }
}

// ─── 复核（hookReview 型，S5 新增） ───────────────────────────

/// 复核结果（hookReview 型）
///
/// 前端只回传 `approved` / `denied`；`TimedOut`（300s 兜底）与 `Cancelled`（随轮取消）
/// **仅内核侧产生**，且与 `Denied` 同路 fail-closed（工具不执行）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HookReviewOutcome {
    /// 用户放行（工具继续执行）
    Approved,
    /// 用户拒绝（工具不执行）
    Denied,
    /// 等待超时（仅内核侧产生；按拒绝处理）
    TimedOut,
    /// 随轮取消（仅内核侧产生；按拒绝处理）
    Cancelled,
}

impl HookReviewOutcome {
    /// fail-closed：仅 `Approved` 视为放行
    pub fn is_approved(self) -> bool {
        matches!(self, Self::Approved)
    }

    /// 从 snake_case 字符串解析（前端回传；`timed_out` / `cancelled` 由内核产生）
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "approved" => Ok(Self::Approved),
            "denied" => Ok(Self::Denied),
            "timed_out" | "cancelled" => Err(format!(
                "{raw} 由内核产生，不接受前端回传"
            )),
            other => Err(format!("未知复核结果: {other}（期望 approved/denied）")),
        }
    }

    /// 结果类别字符串（事件载荷 / 前端清理用）
    pub fn kind(self) -> &'static str {
        match self {
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::TimedOut => "timed_out",
            Self::Cancelled => "cancelled",
        }
    }
}

// ─── 统一结果 ───────────────────────────────────────────────

/// 交互结果（判别即 kind；错配即拒——统一注册表按 kind 校验后唤醒等待方）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InteractionOutcome {
    /// 审批结果（四值不变）
    Permission(ConfirmationOutcome),
    /// 提问结果（四态不变）
    UserInput(AskOutcome),
    /// 复核结果（S5 新增）
    HookReview(HookReviewOutcome),
}

impl InteractionOutcome {
    /// 结果类型（判别）
    pub fn kind(&self) -> InteractionKind {
        match self {
            Self::Permission(_) => InteractionKind::Permission,
            Self::UserInput(_) => InteractionKind::UserInput,
            Self::HookReview(_) => InteractionKind::HookReview,
        }
    }

    /// 线面结果串（事件载荷 `outcome` 字段；前端按串清理面板）
    pub fn wire_outcome(&self) -> &'static str {
        match self {
            Self::Permission(o) => match o {
                ConfirmationOutcome::Approved => "approved",
                ConfirmationOutcome::Denied => "denied",
                ConfirmationOutcome::Skipped => "skipped",
                ConfirmationOutcome::Timeout => "timeout",
            },
            Self::UserInput(o) => o.kind(),
            Self::HookReview(o) => o.kind(),
        }
    }
}

// ─── 统一回传（前端 → 内核） ─────────────────────────────────

/// 交互回传（`serde(tag = "kind")`——与请求同判别口径；`kind` 错配由注册表 resolve 拒绝）
///
/// 内核侧值（`timeout` / `timed_out` / `cancelled`）**不接受前端回传**，由
/// [`Self::into_outcome`] 统一校验（fail-closed 收口）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InteractionResponse {
    /// 审批回传：`outcome` 取 `approved` / `denied` / `skipped`
    Permission {
        /// 用户审批结果（snake_case 串；经 [`ConfirmationOutcome::parse`] 校验）
        outcome: String,
    },
    /// 提问回传：`answers` 缺省 = 用户拒绝作答（前端「取消」键 → `ASK_DENIED`）
    UserInput {
        /// 逐题答案（按稳定 id 与请求一一对应；作答时给出）
        answers: Option<Vec<AskAnswer>>,
    },
    /// 复核回传：`outcome` 取 `approved` / `denied`
    HookReview {
        /// 用户复核结果（snake_case 串；经 [`HookReviewOutcome::parse`] 校验）
        outcome: String,
    },
}

impl InteractionResponse {
    /// 解析为统一结果（唯一回传解析入口：内核侧值 / 未知值一律报错 → 不唤醒等待方）
    pub fn into_outcome(self) -> Result<InteractionOutcome, String> {
        match self {
            Self::Permission { outcome } => {
                ConfirmationOutcome::parse(&outcome).map(InteractionOutcome::Permission)
            }
            Self::UserInput { answers } => Ok(InteractionOutcome::UserInput(match answers {
                Some(list) => AskOutcome::Answered(list),
                None => AskOutcome::Denied,
            })),
            Self::HookReview { outcome } => {
                HookReviewOutcome::parse(&outcome).map(InteractionOutcome::HookReview)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kind_declares_three_types() {
        let declared = [
            InteractionKind::Permission,
            InteractionKind::UserInput,
            InteractionKind::HookReview,
        ];
        assert_eq!(declared.len(), 3, "三型正交（审批 / 提问 / 复核）");
        for k in declared {
            assert_eq!(serde_json::to_string(&k).unwrap(), format!("\"{}\"", k.as_str()));
        }
    }

    #[test]
    fn request_wire_carries_kind_tag() {
        let req = InteractionRequest::HookReview {
            hook_name: "audit".into(),
            tool_name: "entity_delete".into(),
            args: serde_json::json!({ "id": "x" }),
            reason: "删除不可逆".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert_eq!(v["kind"], "hook_review");
        assert_eq!(v["reason"], "删除不可逆");
        assert_eq!(req.kind(), InteractionKind::HookReview);
        // 反序列化回环（前端/命令层同口径）
        let back: InteractionRequest = serde_json::from_value(v).unwrap();
        assert_eq!(back, req);
    }

    #[test]
    fn permission_wire_carries_declared_metadata() {
        // UX-b：审批载荷带工具声明元数据（风险等级 / 副作用范围），前端弹窗展示
        let req = InteractionRequest::Permission {
            tool_name: "execute_command".into(),
            args: serde_json::json!({ "command": "ls" }),
            risk_level: Some("dangerous".into()),
            side_effect_scope: Some("system".into()),
        };
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert_eq!(v["kind"], "permission");
        assert_eq!(v["tool_name"], "execute_command");
        assert_eq!(v["risk_level"], "dangerous");
        assert_eq!(v["side_effect_scope"], "system");
        let back: InteractionRequest = serde_json::from_value(v).unwrap();
        assert_eq!(back, req);

        // 旧载荷（无元数据字段）可解析——serde default 兼容；序列化时字段省略
        let legacy: InteractionRequest = serde_json::from_value(serde_json::json!({
            "kind": "permission",
            "tool_name": "read_file",
            "args": {},
        }))
        .unwrap();
        let legacy_v = serde_json::to_value(&legacy).unwrap();
        assert!(legacy_v.get("risk_level").is_none(), "None 字段应省略（载荷最小化）");
        assert!(
            matches!(
                legacy,
                InteractionRequest::Permission { risk_level: None, side_effect_scope: None, .. }
            ),
            "旧载荷缺字段 → None（不猜测）"
        );
    }

    #[test]
    fn outcome_kind_matches_and_wire_strings() {
        let o = InteractionOutcome::Permission(ConfirmationOutcome::Skipped);
        assert_eq!(o.kind(), InteractionKind::Permission);
        assert_eq!(o.wire_outcome(), "skipped");
        assert_eq!(
            InteractionOutcome::UserInput(AskOutcome::TimedOut).wire_outcome(),
            "timed_out"
        );
        assert_eq!(
            InteractionOutcome::HookReview(HookReviewOutcome::Denied).wire_outcome(),
            "denied"
        );
    }

    #[test]
    fn hook_review_outcome_is_fail_closed() {
        assert!(HookReviewOutcome::Approved.is_approved());
        for o in [
            HookReviewOutcome::Denied,
            HookReviewOutcome::TimedOut,
            HookReviewOutcome::Cancelled,
        ] {
            assert!(!o.is_approved(), "{o:?} 不应视为放行");
        }
        assert!(HookReviewOutcome::parse("approved").is_ok());
        assert!(HookReviewOutcome::parse("timed_out").is_err(), "内核值不接受前端回传");
    }

    #[test]
    fn response_parses_to_unified_outcome_and_rejects_kernel_values() {
        // 三型回传 → 统一结果（判别即 kind）
        let o = serde_json::from_str::<InteractionResponse>(r#"{"kind":"permission","outcome":"skipped"}"#)
            .unwrap()
            .into_outcome()
            .unwrap();
        assert_eq!(o, InteractionOutcome::Permission(ConfirmationOutcome::Skipped));
        let o = serde_json::from_str::<InteractionResponse>(r#"{"kind":"hook_review","outcome":"approved"}"#)
            .unwrap()
            .into_outcome()
            .unwrap();
        assert_eq!(o, InteractionOutcome::HookReview(HookReviewOutcome::Approved));
        // 提问：缺 answers = 拒绝作答
        let o = serde_json::from_str::<InteractionResponse>(r#"{"kind":"user_input"}"#)
            .unwrap()
            .into_outcome()
            .unwrap();
        assert_eq!(o, InteractionOutcome::UserInput(AskOutcome::Denied));
        // 内核侧值 / 未知值：拒绝回传（fail-closed——不唤醒等待方）
        for raw in [
            r#"{"kind":"permission","outcome":"timeout"}"#,
            r#"{"kind":"hook_review","outcome":"timed_out"}"#,
            r#"{"kind":"hook_review","outcome":"cancelled"}"#,
            r#"{"kind":"permission","outcome":"yes"}"#,
        ] {
            let resp: InteractionResponse = serde_json::from_str(raw).unwrap();
            assert!(resp.into_outcome().is_err(), "{raw} 应被拒绝");
        }
    }
}
