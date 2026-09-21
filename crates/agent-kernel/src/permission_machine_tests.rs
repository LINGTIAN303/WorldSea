//! 权限模式机逐位用例（S4-a）：判定顺序表**一行一例**（错位即红）+ 两条不变量反证

use super::*;
use serde_json::json;

/// 基线 ctx：确认通道可用 + 全部名单/命中为空（策略按用例传入）
fn base_ctx<'a>(
    tool: &'a str,
    args: &'a serde_json::Value,
    policy: Option<&'a ConfirmationPolicy>,
) -> PermissionCtx<'a> {
    PermissionCtx {
        tool_name: tool,
        args,
        policy,
        confirmation_available: true,
        builtin_lock: None,
        user_lock: None,
        user_allow: false,
        project: ProjectVerdict::None,
        always_ask: false,
        session_grant: false,
        plan_forbidden_write_or_command: false,
        agent_tmp: false,
        path_outside_workdir: false,
    }
}

fn interact() -> ConfirmationPolicy {
    ConfirmationPolicy::dangerous_only()
}

/// 位次 1：内置锁 / 数据区命中 → Deny
#[test]
fn pos1_builtin_lock_denies() {
    let policy = interact();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&policy));
    c.builtin_lock = Some("数据区写保护：entities/");
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Deny, RuleId::BuiltinLock));
}

/// 位次 2：用户锁命中 → Deny
#[test]
fn pos2_user_lock_denies() {
    let policy = interact();
    let args = json!({ "command": "ls" });
    let mut c = base_ctx("execute_command", &args, Some(&policy));
    c.user_lock = Some("上锁名单拦截命令执行");
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Deny, RuleId::UserLock));
}

/// 位次 3：用户 Allow 名单 → Allow（**先于档位与项目规则**——ZD2-5 名单优先于档位）
#[test]
fn pos3_user_allow_releases_before_mode() {
    let plan = ConfirmationPolicy::plan();
    let args = json!({ "command": "cargo test" });
    let mut c = base_ctx("execute_command", &args, Some(&plan));
    c.user_allow = true;
    c.project = ProjectVerdict::Deny; // 名单亦先于项目规则（05-§五.4 层级）
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::UserAllow));
}

/// 位次 4：项目规则 deny → Deny（**先于 alwaysAsk**——Q4-B 本项目强化）
#[test]
fn pos4_project_deny_precedes_always_ask() {
    let policy = interact();
    let args = json!({ "command": "ls" });
    let mut c = base_ctx("execute_command", &args, Some(&policy));
    c.project = ProjectVerdict::Deny;
    c.always_ask = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Deny, RuleId::ProjectDeny));
}

/// 位次 5：alwaysAsk → Ask——**反证①：Autopilot 亦不可绕过**
#[test]
fn pos5_always_ask_survives_autopilot() {
    let autopilot = ConfirmationPolicy::autopilot();
    let args = json!({ "id": "x" });
    let mut c = base_ctx("entity_delete", &args, Some(&autopilot));
    c.always_ask = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Ask, RuleId::AlwaysAsk));
    // 名单源（S4-a 批次）：Dangerous 级工具即 alwaysAsk
    assert!(is_always_ask("entity_delete"), "Dangerous 级应入 alwaysAsk");
    assert!(is_always_ask("clear_history"));
    assert!(!is_always_ask("write_file"), "Moderate 不在本批名单");
}

/// 位次 6：会话级授权 → Allow——**仅 alwaysAsk gate 消费**（普通工具不认）
#[test]
fn pos6_session_grant_serves_always_ask_gate_only() {
    let policy = interact();
    let args = json!({ "id": "x" });
    let mut c = base_ctx("entity_delete", &args, Some(&policy));
    c.always_ask = true;
    c.session_grant = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::SessionGrant));

    // 非 alwaysAsk 工具：会话授权不得成为通用放行（落常规判定——Safe 读经兜底放行）
    let args2 = json!({ "id": "x" });
    let mut c2 = base_ctx("entity_get", &args2, Some(&policy));
    c2.session_grant = true;
    let d2 = decide(&c2);
    assert_ne!(d2.rule_id, RuleId::SessionGrant, "会话授权只服务 alwaysAsk gate");
    assert_eq!(d2.behavior, Behavior::Allow);
}

/// 位次 7：项目规则 ask → Ask（在 Plan 守卫与 agent-tmp 之前）
#[test]
fn pos7_project_ask_asks() {
    let policy = interact();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&policy));
    c.project = ProjectVerdict::Ask;
    c.agent_tmp = true; // 项目 ask 先于 agent-tmp 免确认
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Ask, RuleId::ProjectAsk));
}

/// 位次 8：Plan 档守卫（写 / 命令）→ Deny
#[test]
fn pos8_plan_guard_denies_write_and_command() {
    let plan = ConfirmationPolicy::plan();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&plan));
    c.plan_forbidden_write_or_command = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Deny, RuleId::PlanGuard));
}

/// 位次 9：agent-tmp 免确认 → Allow
#[test]
fn pos9_agent_tmp_releases() {
    let policy = interact();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&policy));
    c.agent_tmp = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::AgentTmp));
}

/// 位次 10：项目规则 allow → Allow（晚于 Plan 守卫——项目放行不得翻案只读档）
#[test]
fn pos10_project_allow_allows_but_not_over_plan_guard() {
    let policy = interact();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&policy));
    c.project = ProjectVerdict::Allow;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::ProjectAllow));

    // Plan 守卫在位次 8：项目 allow 无法翻案
    let plan = ConfirmationPolicy::plan();
    let args2 = json!({});
    let mut c2 = base_ctx("write_file", &args2, Some(&plan));
    c2.project = ProjectVerdict::Allow;
    c2.plan_forbidden_write_or_command = true;
    assert_eq!(decide(&c2).behavior, Behavior::Deny);
}

/// 位次 11：档位闸门——Autopilot 免逐条 / Plan 只读档需确认
#[test]
fn pos11_mode_gate() {
    let autopilot = ConfirmationPolicy::autopilot();
    let args = json!({});
    let c = base_ctx("write_file", &args, Some(&autopilot));
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::ModeAutopilot));

    let plan = ConfirmationPolicy::plan();
    let args2 = json!({ "path": "a.txt" });
    let c2 = base_ctx("read_file", &args2, Some(&plan));
    let d2 = decide(&c2);
    assert_eq!((d2.behavior, d2.rule_id), (Behavior::Ask, RuleId::ModePlan));
}

/// 位次 12：工具等级 / 策略位（含危险命令动态升级）
#[test]
fn pos12_tool_level_and_dangerous_command() {
    let policy = interact();
    // Dangerous 级（等级位兜底；经 alwaysAsk 名单时在位次 5 拦下）：Ask
    let args = json!({ "id": "x" });
    let c = base_ctx("entity_delete", &args, Some(&policy));
    assert_eq!(decide(&c).behavior, Behavior::Ask);
    // Safe 级：放行
    let args2 = json!({ "id": "x" });
    let c2 = base_ctx("entity_get", &args2, Some(&policy));
    assert_eq!(decide(&c2).behavior, Behavior::Allow);
    // Moderate（命令）+ 危险命令模式：动态升级 Ask
    let args3 = json!({ "command": "rm -rf /" });
    let c3 = base_ctx("execute_command", &args3, Some(&policy));
    assert_eq!(decide(&c3).behavior, Behavior::Ask);
    // Moderate 普通命令：放行（Interact 默认不确认 Moderate）
    let args4 = json!({ "command": "ls -la" });
    let c4 = base_ctx("execute_command", &args4, Some(&policy));
    assert_eq!(decide(&c4).behavior, Behavior::Allow);
    // confirm_moderate 开启：Moderate 一律确认
    let strict = ConfirmationPolicy::moderate_and_dangerous();
    let args5 = json!({});
    let c5 = base_ctx("write_file", &args5, Some(&strict));
    assert_eq!(decide(&c5).behavior, Behavior::Ask);
}

/// 位次 13：路径越界把**放行**升级为确认；不降级、不翻案拒绝
#[test]
fn pos13_path_escalation_upgrades_only_allow() {
    let policy = interact();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&policy));
    c.path_outside_workdir = true;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Ask, RuleId::PathGuard));

    // 拒绝不受影响（锁先于路径位）
    let args2 = json!({});
    let mut c2 = base_ctx("write_file", &args2, Some(&policy));
    c2.builtin_lock = Some("数据区写保护");
    c2.path_outside_workdir = true;
    assert_eq!(decide(&c2).behavior, Behavior::Deny);

    // 显式白名单（位次 3）不受路径升级影响——名单即授权
    let args3 = json!({});
    let mut c3 = base_ctx("write_file", &args3, Some(&policy));
    c3.user_allow = true;
    c3.path_outside_workdir = true;
    assert_eq!(decide(&c3).rule_id, RuleId::UserAllow);
}

/// **反证②：锁单调**——内置锁 / 用户锁不得被 Allow 名单或档位翻案
#[test]
fn locks_are_monotonic() {
    let autopilot = ConfirmationPolicy::autopilot();
    let args = json!({});
    let mut c = base_ctx("write_file", &args, Some(&autopilot));
    c.builtin_lock = Some("数据区写保护");
    c.user_allow = true;
    c.project = ProjectVerdict::Allow;
    c.agent_tmp = true;
    assert_eq!(decide(&c).behavior, Behavior::Deny, "内置锁不得被任何放行翻案");

    let args2 = json!({ "command": "ls" });
    let mut c2 = base_ctx("execute_command", &args2, Some(&autopilot));
    c2.user_lock = Some("命令锁");
    c2.user_allow = true;
    assert_eq!(decide(&c2).behavior, Behavior::Deny, "用户锁同理");
}

/// 归一化：确认通道不可用 → 任何来源的 Ask 降级放行（现行语义）；Deny 不受影响
#[test]
fn ask_degrades_without_confirmation_channel() {
    let policy = interact();
    let args = json!({ "id": "x" });
    let mut c = base_ctx("entity_delete", &args, Some(&policy));
    c.always_ask = true;
    c.confirmation_available = false;
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::Fallback));

    let args2 = json!({});
    let mut c2 = base_ctx("write_file", &args2, Some(&policy));
    c2.builtin_lock = Some("数据区写保护");
    c2.confirmation_available = false;
    assert_eq!(decide(&c2).behavior, Behavior::Deny, "Deny 不降级");
}

/// 兜底：无策略（未启用确认）→ 放行
#[test]
fn fallback_allows_without_policy() {
    let args = json!({});
    let c = base_ctx("write_file", &args, None);
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::Fallback));
}
