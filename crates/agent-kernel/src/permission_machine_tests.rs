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

// ─── S4-b：alwaysAsk 四类名单 + 会话级授权 ────────────────────

/// 四类名单覆盖（ZD2-2 全选）：进程执行 / 未预批外发 / 破坏性 + 数据区写删（路径型）
#[test]
fn s4b_always_ask_classes_cover_four_categories() {
    // ① 进程执行（is_command_tool 同源集合）
    for t in [
        "execute_command",
        "bash",
        "powershell",
        "shell_session",
        "shell_session_exec",
        "shell_session_create",
        "shell_session_write",
    ] {
        assert_eq!(always_ask_class(t), Some(AlwaysAskClass::ProcessExec), "{t}");
    }
    // ② 未预批外发：MCP 全量前缀 + web_fetch
    assert_eq!(always_ask_class("mcp__fs__read_file"), Some(AlwaysAskClass::UntrustedEgress));
    assert_eq!(always_ask_class("mcp__any__tool"), Some(AlwaysAskClass::UntrustedEgress));
    assert_eq!(always_ask_class("web_fetch"), Some(AlwaysAskClass::UntrustedEgress));
    // ③ 破坏性工具（Dangerous 级）
    for t in ["delegate_to_sub_agent", "entity_delete", "memory_delete", "clear_history", "trash_empty"] {
        assert_eq!(always_ask_class(t), Some(AlwaysAskClass::Destructive), "{t}");
    }
    // ④ 数据区写删为**路径型**——由内置锁 / 数据区位次（1）承担，不进本名单
    assert_eq!(always_ask_class("write_file"), None);
    assert_eq!(always_ask_class("edit_file"), None);
    // 未登记工具不误伤（Moderate 兜底）
    assert_eq!(always_ask_class("unknown_tool"), None);
    assert_eq!(always_ask_class("entity_get"), None);
}

/// 会话授权消费规则：内容匹配 / 一次性消费 / 全量条目 / 空值忽略
#[test]
fn s4b_session_grant_consumption_rules() {
    let mut g = SessionPermissionGrants::default();
    assert!(g.is_empty());
    g.grant("execute_command", Some("cargo".into()), true);
    g.grant("bash", None, false);
    g.grant("", None, false); // 空工具名忽略
    g.grant("web_fetch", Some(String::new()), false); // 空内容 → 归一为全量
    assert_eq!(g.len(), 3, "空工具名被忽略");

    assert!(!g.consume("execute_command", Some("git status")), "内容不匹配");
    assert!(g.consume("execute_command", Some("cargo test")), "内容包含命中");
    assert_eq!(g.len(), 2, "once 命中即消费");
    assert!(!g.consume("execute_command", Some("cargo test")), "已消费不重复");
    assert!(g.consume("bash", Some("任意")), "全量条目不限内容");
    assert!(g.consume("web_fetch", None), "空内容归一为全量：无主体亦命中");
    assert_eq!(g.len(), 2, "全量条目不被消费");
}

// ─── S4-c：项目规则层 ────────────────────────────────

/// 项目规则裁决：deny > ask > allow > None；工具精确/通配 + 内容包含/通配
#[test]
fn s4c_project_rules_verdict_priority_and_matching() {
    let rules = ProjectPermissionRules {
        deny: vec!["execute_command".into(), "mcp__*".into(), "read_file:*secret*".into()],
        ask: vec!["web_fetch".into(), "write_file".into()],
        allow: vec!["read_file:*entities/*".into(), "write_file".into()],
    };
    // 工具精确（无内容模式 = 全量）
    assert_eq!(rules.verdict("execute_command", Some("ls")), ProjectVerdict::Deny);
    assert_eq!(rules.verdict("execute_command", None), ProjectVerdict::Deny);
    // 工具通配（mcp__*）
    assert_eq!(rules.verdict("mcp__fs__read_file", None), ProjectVerdict::Deny);
    // 内容通配（*secret*）
    assert_eq!(rules.verdict("read_file", Some("/ws/.env-secret")), ProjectVerdict::Deny);
    assert_eq!(rules.verdict("read_file", Some("/ws/note.txt")), ProjectVerdict::None, "不匹配 deny/allow");
    // ask 优先于 allow（write_file 同时在两者中 → Ask）
    assert_eq!(rules.verdict("write_file", None), ProjectVerdict::Ask);
    assert_eq!(rules.verdict("web_fetch", None), ProjectVerdict::Ask);
    // allow（内容前缀通配）
    assert_eq!(rules.verdict("read_file", Some("/ws/entities/a.json")), ProjectVerdict::Allow);
    // 未声明工具
    assert_eq!(rules.verdict("entity_get", None), ProjectVerdict::None);
}

/// 内容匹配口径：无 `*` → 包含；含 `*` → 通配（与既有名单子串口径兼容）
#[test]
fn s4c_content_matches_semantics() {
    assert!(content_matches("cargo", "cargo test"), "无星号=包含");
    assert!(!content_matches("cargo", "git status"));
    assert!(content_matches("cargo *", "cargo test"), "含星号=通配（前缀锚定）");
    assert!(!content_matches("cargo *", "sudo cargo test"), "首段锚定开头");
    assert!(content_matches("*secret*", "/a/b/secret.txt"));
    assert!(content_matches("*.env", "/a/b/.env"), "末段锚定结尾");
    assert!(tool_matches("mcp__*", "mcp__fs__read"), "工具通配");
    assert!(!tool_matches("read", "read_file"), "工具无星号=精确相等");
}

/// 项目规则文件加载：合法 / 缺文件 / 坏 JSON / 空规则
#[test]
fn s4c_project_rules_load_from_disk() {
    let base = std::env::temp_dir().join(format!(
        "ws-proj-rules-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let rules_dir = base.join(".worldsea");
    std::fs::create_dir_all(&rules_dir).unwrap();

    // ① 合法文件
    std::fs::write(
        rules_dir.join("permissions.json"),
        r#"{"deny":["execute_command"],"allow":["read_file:*entities/*"]}"#,
    )
    .unwrap();
    let loaded = ProjectPermissionRules::load(&base).expect("合法文件应加载");
    assert_eq!(loaded.verdict("execute_command", None), ProjectVerdict::Deny);
    assert_eq!(loaded.verdict("read_file", Some("/x/entities/a")), ProjectVerdict::Allow);

    // ② 坏 JSON → 未声明（不阻断装配，不猜测）
    std::fs::write(rules_dir.join("permissions.json"), "{ not json").unwrap();
    assert!(ProjectPermissionRules::load(&base).is_none());

    // ③ 空规则（{}）→ 未声明
    std::fs::write(rules_dir.join("permissions.json"), "{}").unwrap();
    assert!(ProjectPermissionRules::load(&base).is_none());

    // ④ 缺文件 → 未声明
    std::fs::remove_file(rules_dir.join("permissions.json")).unwrap();
    assert!(ProjectPermissionRules::load(&base).is_none());

    let _ = std::fs::remove_dir_all(&base);
}

/// 兜底：无策略（未启用确认）→ 放行
#[test]
fn fallback_allows_without_policy() {
    let args = json!({});
    let c = base_ctx("write_file", &args, None);
    let d = decide(&c);
    assert_eq!((d.behavior, d.rule_id), (Behavior::Allow, RuleId::Fallback));
}
