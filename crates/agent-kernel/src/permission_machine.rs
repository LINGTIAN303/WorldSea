//! 权限模式机（S4-a）：判定顺序**单点化**
//!
//! 设计依据：`docs/plans/2026-09-21-ZCode能力内化方向探究/05-权限模式机草案.md`（ZD2×5 已拍板）
//! + [11-S4施工计划](../../../docs/plans/2026-09-21-ZCode能力内化方向探究/11-S4施工计划-权限模式机.md) §三
//! （**判定顺序表 = 本模块与逐位用例的同一事实源**）。
//!
//! 把原先散落六段的判定（`guard_fs_path` → `rule_engine_verdict` → Plan 守卫 → agent-tmp
//! → `needs_confirmation` → 路径守卫）收为**纯函数** [`decide`]：无 I/O、无全局单例——
//! 规则 / 名单 / 档位 / 命中原因经 [`PermissionCtx`] 传入；调用点退化为
//! 「构造 ctx → decide → 执行（Deny→拒绝 / Ask→确认 / Allow→放行）」。
//!
//! **不变量**（反证覆盖，见 `permission_machine_tests`）：
//! - **模式放行分支不得绕过 alwaysAsk**（档位闸门在 alwaysAsk 之后）；
//! - **内置锁 / 用户锁不得被 Allow 名单或档位翻案**（单调：锁位次最前）。
//!
//! 批次边界（S4 计划）：本批落位次 1-13 与全部字段；**alwaysAsk 名单源**为现状语义
//! （Dangerous 级），S4-b 扩为四类结构化名单并接入会话授权来源；项目规则来源 S4-c 接入
//! （本批 `ProjectVerdict::None`）。位次表不随批次改动，只换来源。

use crate::confirmation::{ConfirmationPolicy, ToolPermission};
use crate::permission_rules::SecurityLevel;

/// 判定行为（终值）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Behavior {
    /// 放行（直接执行）
    Allow,
    /// 需人工确认（经确认通道）；确认通道不可用时按现行语义降级为放行
    Ask,
    /// 拒绝（不执行，返回 POLICY_DENIED）
    Deny,
}

/// 规则位次标识（判定来源——可观测、可逐位反证）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleId {
    /// 1 内置锁 / 数据区（E1）
    BuiltinLock,
    /// 2 用户 Lock 命中
    UserLock,
    /// 3 用户 Allow 名单命中（名单优先于档位——ZD2-5）
    UserAllow,
    /// 4 项目规则 deny（Q4-B：先于 alwaysAsk 与档位）
    ProjectDeny,
    /// 5 alwaysAsk 命中（模式不可绕过）
    AlwaysAsk,
    /// 6 会话级授权命中（**仅 alwaysAsk gate 消费**——对齐 ZCode sessionRules）
    SessionGrant,
    /// 7 项目规则 ask
    ProjectAsk,
    /// 8 Plan 档守卫（写 / 命令）
    PlanGuard,
    /// 9 agent-tmp 免确认（隐式白名单）
    AgentTmp,
    /// 10 项目规则 allow
    ProjectAllow,
    /// 11 档位闸门：Autopilot 免逐条
    ModeAutopilot,
    /// 11 档位闸门：Plan 只读档
    ModePlan,
    /// 12 工具等级 / 策略位（含危险命令动态升级）
    ToolLevel,
    /// 13 动态路径守卫：越界升级为确认
    PathGuard,
    /// 兜底（无确认通道 / 无策略）
    Fallback,
}

/// 判定结果
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub behavior: Behavior,
    pub rule_id: RuleId,
    /// 可读原因（拒绝时进入工具错误消息；确认时供留档）
    pub reason: String,
}

impl Decision {
    fn allow(rule_id: RuleId, reason: impl Into<String>) -> Self {
        Self { behavior: Behavior::Allow, rule_id, reason: reason.into() }
    }
    fn ask(rule_id: RuleId, reason: impl Into<String>) -> Self {
        Self { behavior: Behavior::Ask, rule_id, reason: reason.into() }
    }
    fn deny(rule_id: RuleId, reason: impl Into<String>) -> Self {
        Self { behavior: Behavior::Deny, rule_id, reason: reason.into() }
    }
}

/// 项目规则裁决（S4-c 接入来源；本批恒 `None`）
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ProjectVerdict {
    /// 未声明 / 未命中
    #[default]
    None,
    /// 拒绝（项目硬约束）
    Deny,
    /// 需确认
    Ask,
    /// 放行
    Allow,
}

/// 判定输入（聚合；调用点负责从各来源填充——纯函数无 I/O）
pub struct PermissionCtx<'a> {
    pub tool_name: &'a str,
    pub args: &'a serde_json::Value,
    /// 确认策略（None = 未启用确认：档位闸门 / 工具等级 / 路径升级均不参与）
    pub policy: Option<&'a ConfirmationPolicy>,
    /// 确认通道可用（broker 就绪）；false 时 `Ask` 按现行语义降级为放行
    pub confirmation_available: bool,
    /// 位次 1：内置锁 / 数据区命中原因
    pub builtin_lock: Option<&'a str>,
    /// 位次 2：用户 Lock 命中原因
    pub user_lock: Option<&'a str>,
    /// 位次 3：用户 Allow 名单命中（命令 / 路径）
    pub user_allow: bool,
    /// 位次 4/7/10：项目规则裁决
    pub project: ProjectVerdict,
    /// 位次 5：alwaysAsk 命中（源见 [`is_always_ask`]）
    pub always_ask: bool,
    /// 位次 6：会话级授权命中（来源 S4-b 接入）
    pub session_grant: bool,
    /// 位次 8：Plan 档下写 / 命令工具
    pub plan_forbidden_write_or_command: bool,
    /// 位次 9：agent-tmp 子树免确认
    pub agent_tmp: bool,
    /// 位次 13：写 / 搜索类工具解析后越出工作区
    pub path_outside_workdir: bool,
}

/// alwaysAsk 判定（**S4-a 批次源**：Dangerous 级工具——现状语义；S4-b 扩四类结构化名单）
///
/// 注意：alwaysAsk 位于档位闸门之前——**Autopilot 亦不可绕过**（05-§八.1 不变量）。
pub fn is_always_ask(tool_name: &str) -> bool {
    crate::confirmation::tool_permission(tool_name) == ToolPermission::Dangerous
}

/// 判定顺序**单点**（位次表见模块文档与 11-§三；命中即返回，不回溯）
///
/// 归一化：确认通道不可用时，**任何来源的 `Ask` 降级为放行**（现行语义——无 broker /
/// 无策略则无确认可执行；锁与 Plan 守卫的 `Deny` 不受影响，仍前置于此）。
pub fn decide(ctx: &PermissionCtx) -> Decision {
    let decision = decide_linear(ctx);
    if decision.behavior == Behavior::Ask && !ctx.confirmation_available {
        return Decision::allow(RuleId::Fallback, "无确认通道：Ask 按现行语义降级放行");
    }
    decision
}

/// 线性位次判定（1-13 + 兜底；单点事实源）
fn decide_linear(ctx: &PermissionCtx) -> Decision {
    // 位次 1-2：锁（单调——任何名单 / 档位不得翻案）
    if let Some(reason) = ctx.builtin_lock {
        return Decision::deny(RuleId::BuiltinLock, reason);
    }
    if let Some(reason) = ctx.user_lock {
        return Decision::deny(RuleId::UserLock, reason);
    }
    // 位次 3：用户 Allow 名单（ZD2-5：名单优先于档位与项目规则）
    if ctx.user_allow {
        return Decision::allow(RuleId::UserAllow, "用户白名单命中");
    }
    // 位次 4：项目规则 deny（Q4-B：项目硬约束先于 alwaysAsk）
    if ctx.project == ProjectVerdict::Deny {
        return Decision::deny(RuleId::ProjectDeny, "项目规则拒绝（permissions.deny）");
    }
    // 位次 5-6：alwaysAsk（模式不可绕过）；会话授权仅在此 gate 内消费
    if ctx.always_ask {
        if ctx.session_grant {
            return Decision::allow(RuleId::SessionGrant, "会话级授权命中（alwaysAsk gate）");
        }
        return Decision::ask(RuleId::AlwaysAsk, "alwaysAsk 工具：必过确认（模式不可绕过）");
    }
    // 位次 7：项目规则 ask
    if ctx.project == ProjectVerdict::Ask {
        return Decision::ask(RuleId::ProjectAsk, "项目规则要求确认（permissions.ask）");
    }
    // 位次 8：Plan 档守卫（写 / 命令）
    if ctx.plan_forbidden_write_or_command {
        return Decision::deny(RuleId::PlanGuard, "Plan 只读档：写/命令操作已禁用");
    }
    // 位次 9：agent-tmp 免确认（隐式白名单）
    if ctx.agent_tmp {
        return Decision::allow(RuleId::AgentTmp, "agent-tmp 子树：免确认（2026-09-03 拍板）");
    }
    // 位次 10：项目规则 allow
    if ctx.project == ProjectVerdict::Allow {
        return Decision::allow(RuleId::ProjectAllow, "项目规则放行（permissions.allow）");
    }
    // 位次 11-12：档位闸门 + 工具等级（策略谓词复用——含危险命令动态升级）
    if let Some(policy) = ctx.policy {
        match policy.security_level {
            SecurityLevel::Autopilot => {
                return Decision::allow(RuleId::ModeAutopilot, "Autopilot：免逐条（锁/守卫已前置）")
            }
            SecurityLevel::Plan => {
                return Decision::ask(RuleId::ModePlan, "Plan 只读档：需确认");
            }
            SecurityLevel::Interact => {}
        }
        if policy.needs_confirmation(ctx.tool_name, ctx.args) {
            return Decision::ask(RuleId::ToolLevel, "工具等级 / 策略命中：需确认");
        }
    }
    // 位次 13：动态路径守卫——把放行升级为确认（不降级、不翻案拒绝）
    if ctx.path_outside_workdir {
        return Decision::ask(RuleId::PathGuard, "路径越出工作区：需确认");
    }
    Decision::allow(RuleId::Fallback, "未命中任何规则：放行")
}

#[cfg(test)]
#[path = "permission_machine_tests.rs"]
mod tests;
