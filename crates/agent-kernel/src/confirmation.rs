//! HITL 权限确认（A5）与交互族类型出口：策略判定 + 路径守卫，详细见
//! docs/details/注释/agent-runtime/confirmation.md
//!
//! S5（交互三型）后的模块分工：
//! - **本模块** = 策略与守卫面（`ConfirmationPolicy` /
//!   `guard_fs_path` / `rule_content_subject`）+ 交互族类型的再导出；
//! - 协调器实现迁 [`crate::interaction_broker`]（三型统一注册表）；
//! - 类型定义迁 `agent-engine::contracts`（单一定义处）——本模块以 `pub use`
//!   保持 `agent_runtime::confirmation::*` 下行路径不变。
//!
//! 机制：AgentLoop 执行「需确认」工具前，经 `InteractionBroker::request_permission`
//! 广播族事件 `InteractionRequested`〔permission 型〕→ Tauri 端转发前端
//! `agent:interaction:{session_id}` → 前端弹窗后经统一回传命令
//! `cmd_agent_interaction_respond` 回传 → `InteractionBroker::resolve` 放行/拒绝。
//!
//! D8 四值对齐（2026-09-17）：审批结果由 bool 升级为 [`ConfirmationOutcome`]
//! （approved / denied / skipped / timeout）——「拒绝」「跳过」「超时」不再不可区分。
//!
//! 决策在 Rust 侧（`ConfirmationPolicy` 配置需确认工具集），MVP 仅覆盖危险操作。

use std::path::{Path, PathBuf};

use crate::permission_rules::SecurityLevel;
use crate::tool_context::ToolContext;

// ─── 审批结果四值（D8，2026-09-17；S5 单点化：定义处迁 agent-engine::contracts） ───

pub use agent_engine::contracts::ConfirmationOutcome;

// ─── 提问通道（Q1，2026-09-20；S5 单点化：定义处迁 agent-engine::contracts::interaction） ───

pub use agent_engine::contracts::interaction::{
    AskAnswer, AskOutcome, InteractionKind, InteractionOutcome, InteractionRequest,
    InteractionResponse,
};

// ─── A7 工具权限分级（C2 元数据族：**静态表已删**——等级读工具声明 ToolDescriptor.safety.risk_level） ───

pub use crate::tool::RiskLevel as ToolRiskLevel;

// ─── HITL 确认策略 ──────────────────────────────────────────

/// 确认策略：哪些工具调用需要用户确认
///
/// 判定在 Rust 侧（A7 升级为三分级），综合工具名/等级与命令参数：
/// - 工具风险等级由**工具声明**给出（C2：`ToolDescriptor.safety.risk_level`，调用方传入）
///   - `Dangerous`：无条件确认（且通常已在位次 5 被 alwaysAsk 拦下）
///   - `Safe`：直接放行
///   - `Moderate`：`confirm_moderate=true` 时确认；否则命令工具命中危险模式才确认
/// - `confirm_tools`：兼容 A5 遗留的「工具名白名单」，命中即无条件确认（可为空）
/// - `dangerous_command_patterns`：`execute_command`/`shell_session` 命令命中任一模版时确认
#[derive(Debug, Clone, Default)]
pub struct ConfirmationPolicy {
    /// 无条件需确认的工具名（A5 遗留，可为空；等级由工具声明承载）
    pub confirm_tools: Vec<String>,
    /// 危险命令子串（小写匹配，命中即确认）
    pub dangerous_command_patterns: Vec<String>,
    /// A7：是否需要确认 Moderate 级工具（默认 false = 仅确认 Dangerous）
    pub confirm_moderate: bool,
    /// 安全档位（v2 三档，2026-09-03）：Plan/Interact/Autopilot。
    /// Autopilot 恒不确认（规则引擎锁/白名单在更上层），Plan 恒确认（写/命令由
    /// `maybe_require_confirmation` 直接拒绝）。
    pub security_level: SecurityLevel,
}

impl ConfirmationPolicy {
    /// 推荐的宽松默认策略：仅危险操作确认（Interact 档，A7 分级的 Dangerous 档）
    ///
    /// - `Dangerous` 级工具（委派子 Agent、删除等）无条件确认
    /// - `execute_command`/`shell_session` 命中危险命令模式时确认
    pub fn dangerous_only() -> Self {
        Self::new(false)
    }

    /// 严格策略：确认 Dangerous + Moderate 级工具（写操作 / 命令执行一律确认）
    pub fn moderate_and_dangerous() -> Self {
        Self::new(true)
    }

    /// 只读档：Plan（写/命令由 maybe_require_confirmation 直接拒绝）
    pub fn plan() -> Self {
        let mut p = Self::new(false);
        p.security_level = SecurityLevel::Plan;
        p
    }

    /// 免逐条确认档：Autopilot（白名单/锁由规则引擎裁决，本策略恒不确认）
    pub fn autopilot() -> Self {
        let mut p = Self::new(false);
        p.security_level = SecurityLevel::Autopilot;
        p
    }

    /// 统一构造：`confirm_moderate` 决定 Moderate 级是否确认，危险命令模式固化
    fn new(confirm_moderate: bool) -> Self {
        Self {
            confirm_tools: vec!["delegate_to_sub_agent".to_string()],
            dangerous_command_patterns: vec![
                "rm -rf".into(),
                "rm -fr".into(),
                "format ".into(),
                "shutdown".into(),
                "reboot".into(),
                "mkfs".into(),
                "dd if=".into(),
                "taskkill".into(),
                "reg delete".into(),
                "net user".into(),
                "pip uninstall".into(),
                "npm uninstall -g".into(),
            ],
            confirm_moderate,
            // 默认档：Interact（交互确认）
            security_level: SecurityLevel::Interact,
        }
    }

    /// 判断某工具调用是否需要确认（档位短路优先；**等级来自工具声明**——C2）
    ///
    /// `risk`：工具声明的风险等级（`ToolDescriptor.safety.risk_level`；未声明工具传 Moderate，
    /// 对齐既有「未登记默认 Moderate」语义）。
    pub fn needs_confirmation(
        &self,
        tool_name: &str,
        args: &serde_json::Value,
        risk: crate::tool::RiskLevel,
    ) -> bool {
        // Q1（2026-09-20）：提问工具不做执行前确认——提问面板本身就是人工交互，
        // 再叠一层「工具执行确认」是双重弹窗；且 Plan 档「恒确认」会把它一并拦下
        // （提问不改写任何状态，无需执行闸门；子代理/不可用由工具内 ASK_UNAVAILABLE 收口）
        if tool_name == "ask_user_question" {
            return false;
        }
        // 档位短路（v2，2026-09-03）：Autopilot 恒不确认；Plan 恒确认
        match self.security_level {
            SecurityLevel::Autopilot => return false,
            SecurityLevel::Plan => return true,
            SecurityLevel::Interact => {}
        }
        // 兼容 A5：显式工具名白名单命中即确认（最高优先级）
        if self.confirm_tools.iter().any(|t| t == tool_name) {
            return true;
        }

        match risk {
            crate::tool::RiskLevel::Dangerous => true,
            crate::tool::RiskLevel::Safe => false,
            crate::tool::RiskLevel::Moderate => {
                if self.confirm_moderate {
                    return true;
                }
                // 命令工具命中危险命令模式 → 动态升级为确认
                if matches!(tool_name, "execute_command" | "shell_session") {
                    let cmd = args
                        .get("command")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_lowercase();
                    return self
                        .dangerous_command_patterns
                        .iter()
                        .any(|p| cmd.contains(p));
                }
                false
            }
        }
    }
}

// ─── Phase 5 动态路径守卫（越界确认 / 敏感目录拒绝） ──────────────────────

/// 路径守卫裁决结果（Phase 5：动态路径权限分层）
///
/// 供 `maybe_require_confirmation`（`agent/tools.rs`）在确认层做额外裁决：
/// - [`Allow`](PathGuard::Allow)：放行（路径在 workdir 内，或工具不带路径参数）
/// - [`Confirm`](PathGuard::Confirm)：需确认（写/搜索类工具解析后路径越出 workdir）
/// - [`Deny`](PathGuard::Deny)：拒绝（命中敏感目录，返回拒绝原因）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathGuard {
    /// 放行（路径在 workdir 内，或工具不带路径参数）
    Allow,
    /// 需确认（写/搜索类工具解析后路径越出 workdir）
    Confirm,
    /// 拒绝（命中敏感目录，返回拒绝原因）
    Deny(String),
}

/// 是否为文件系统工具（决定是否做路径守卫）
fn is_fs_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "read_file" | "write_file" | "edit_file" | "edit_diff" | "list_directory" | "search_files"
    )
}

/// 是否为写/搜索类工具（越出 workdir 需确认；读类越界放行，对齐「绝对路径读允许」）
fn is_write_or_search_tool(tool_name: &str) -> bool {
    matches!(tool_name, "write_file" | "edit_file" | "edit_diff" | "search_files")
}

/// 提取 FS 工具的目标路径参数（read/write/edit 用 `path`；list/search 缺省 `.`）
///
/// 返回 `None` 表示该工具无路径参数（如参数缺失），守卫按放行处理。
fn fs_path_arg(tool_name: &str, args: &serde_json::Value) -> Option<String> {
    match tool_name {
        "read_file" | "write_file" | "edit_file" | "edit_diff" => args
            .get("path")
            .and_then(|v| v.as_str())
            .map(String::from),
        "list_directory" | "search_files" => Some(
            args.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or(".")
                .to_string(),
        ),
        _ => None,
    }
}

/// 用户主目录（兼容 Unix `HOME` / Windows `USERPROFILE`）
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// 展开路径开头的 `~` 为用户主目录（`~` / `~/xxx` / `~\xxx`）
fn expand_home(raw: &str) -> String {
    if raw == "~" {
        if let Some(home) = home_dir() {
            return home.to_string_lossy().to_string();
        }
        return raw.to_string();
    }
    if let Some(rest) = raw
        .strip_prefix("~/")
        .or_else(|| raw.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir() {
            return home.join(rest).to_string_lossy().to_string();
        }
    }
    raw.to_string()
}

/// 判断解析后路径是否命中敏感目录（返回命中项描述，供拒绝原因展示）
///
/// 敏感目录清单（对齐 Claude Code 的受保护目录）：
/// - 用户主目录下的密钥/配置目录：`~/.ssh`、`~/.gnupg`
/// - 系统目录：`/etc`、`/usr`、`/bin`、`/sbin`
///
/// 采用 `Path::starts_with` 做组件级前缀匹配（避免 `/etcetera` 误命中 `/etc`）。
fn is_sensitive_path(p: &Path) -> Option<String> {
    // 用户主目录下的密钥/配置目录
    if let Some(home) = home_dir() {
        for (name, label) in [(".ssh", "~/.ssh"), (".gnupg", "~/.gnupg")] {
            let sensitive = home.join(name);
            if p == sensitive || p.starts_with(&sensitive) {
                return Some(format!("敏感目录 {label}"));
            }
        }
    }
    // 系统目录（绝对路径前缀，Unix 风格）
    for sys in ["/etc", "/usr", "/bin", "/sbin"] {
        let sp = Path::new(sys);
        if p == sp || p.starts_with(sp) {
            return Some(format!("系统目录 {sys}"));
        }
    }
    None
}

/// 动态路径守卫（Phase 5：权限规则分层）
///
/// 对 FS 工具做越界/敏感目录裁决：
/// - 命中敏感目录（`~/.ssh`、`~/.gnupg`、`/etc`、`/usr`、`/bin`、`/sbin`）：
///   默认 → [`PathGuard::Deny`]；`allow_sensitive_with_confirm=true` → [`PathGuard::Confirm`]
///   （允许经确认放行，安全底线由确认弹窗兜底）
/// - 写/搜索类工具（`write_file`/`edit_file`/`search_files`）解析后越出 workdir
///   （workdir 非 `None`）→ [`PathGuard::Confirm`]（强制确认，对齐「工作区之外需授权」）
/// - 其余 → [`PathGuard::Allow`]（读类越界放行，对齐「绝对路径读允许」）
///
/// `allow_sensitive_with_confirm`：是否允许「确认放行」敏感目录（Phase 1 权限策略，默认 false）。
pub fn guard_fs_path(
    tool_name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
    allow_sensitive_with_confirm: bool,
) -> PathGuard {
    if !is_fs_tool(tool_name) {
        return PathGuard::Allow;
    }
    let Some(raw) = fs_path_arg(tool_name, args) else {
        return PathGuard::Allow;
    };
    // 展开 ~ 再 resolve，保证 ~/.ssh 等能正确命中敏感目录
    let expanded = expand_home(&raw);
    let resolved = ctx.resolve_path(&expanded);
    // 1) 敏感目录：默认拒绝；开启确认开关 → 改为 Confirm（允许经确认放行）
    if let Some(reason) = is_sensitive_path(&resolved) {
        if allow_sensitive_with_confirm {
            return PathGuard::Confirm; // 开启确认开关：允许经确认放行
        }
        return PathGuard::Deny(reason);
    }
    // 2) 写/搜索类越出 workdir → 确认
    if is_write_or_search_tool(tool_name)
        && ctx.workdir.is_some()
        && !ctx.is_within_workdir(resolved.to_string_lossy().as_ref())
    {
        return PathGuard::Confirm;
    }
    PathGuard::Allow
}

/// agent-tmp 全权免确认：写/搜索工具解析（归一化）后落 workdir/agent-tmp 子树 → 放行
///
/// 与 [`guard_fs_path`] 同源路径解析（`fs_path_arg` → `expand_home` → `ctx.resolve_path`），
/// 额外做词法归一化以拦截 `agent-tmp/../entities/...` 逃逸（与 `is_within_workdir` 同源）。
///
/// # 语义
/// - `agent-tmp` 全权免确认（2026-09-03 用户拍板，跳过 HITL 审批）；
/// - E1 写保护（`agent_commands::fs_tools::ensure_not_protected`）在真实写入链路
///   独立执行，不受本函数影响（agent-tmp 与 entities/.worldsea 是一级目录互斥）。
pub fn should_bypass_confirmation(
    tool_name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> bool {
    if !is_write_or_search_tool(tool_name) {
        return false;
    }
    let Some(workdir) = &ctx.workdir else {
        return false;
    };
    let Some(raw) = fs_path_arg(tool_name, args) else {
        return false;
    };
    let expanded = expand_home(&raw);
    let resolved = ctx.resolve_path(&expanded);
    let normalized = crate::tool_context::normalize_path(&resolved);
    crate::workspace_partition::is_within_agent_tmp(workdir, &normalized)
}

// ─── v2 规则引擎裁决（用户锁 > 白名单 > 档位，2026-09-03 P0） ─────────────

/// 命令类工具（Plan 档禁写/命令 / 命令锁判定用）
pub fn is_command_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "bash" | "powershell" | "execute_command" | "shell_session" | "shell_session_exec"
            | "shell_session_create" | "shell_session_write"
    )
}

/// 写类 FS 工具（Plan 档禁写用）
pub fn is_write_tool(tool_name: &str) -> bool {
    matches!(tool_name, "write_file" | "edit_file" | "edit_diff")
}

/// 内容主体（S4-b：会话授权 / 项目规则等内容匹配的判定主体）
///
/// - 命令类工具：`command` 原文（**小写**，与 `dangerous_command_patterns` 同口径）
/// - FS 类工具：解析（`fs_path_arg` → `expand_home` → `ctx.resolve_path`）后的**归一化路径**
/// - 其余工具：`None`（无内容主体——会话授权仅全量条目可命中）
pub fn rule_content_subject(
    tool_name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Option<String> {
    if is_command_tool(tool_name) {
        return args
            .get("command")
            .and_then(|v| v.as_str())
            .map(|s| s.to_lowercase());
    }
    if is_fs_tool(tool_name) {
        let raw = fs_path_arg(tool_name, args)?;
        let expanded = expand_home(&raw);
        let resolved = ctx.resolve_path(&expanded);
        return Some(crate::tool_context::normalize_path(&resolved).to_string_lossy().to_string());
    }
    None
}

/// 规则引擎统一裁决（锁 > 白名单）：
/// - `Err`：命中用户锁（按 read/command/write 维度）——调用方按拒绝处理
/// - `Ok(true)`：命中白名单（命令/路径）——调用方直接放行，跳过档位确认
/// - `Ok(false)`：未覆盖——交给档位默认策略
pub fn rule_engine_verdict(
    tool_name: &str,
    args: &serde_json::Value,
    ctx: &ToolContext,
) -> Result<bool, String> {
    let rules = crate::permission_rules::rules();
    // 命令工具：以会话 workdir（命令执行 cwd）判定 command 锁；命令白名单命中即放行
    if is_command_tool(tool_name) {
        if let Some(wd) = &ctx.workdir {
            let norm = crate::tool_context::normalize_path(wd);
            if rules.command_locked(&norm) {
                return Err(format!(
                    "上锁名单拦截命令执行（工作区 {} 已锁 command，command_ok=false）",
                    norm.display()
                ));
            }
        }
        let cmd = args
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !cmd.is_empty() && rules.is_command_allowed(cmd) {
            return Ok(true);
        }
        return Ok(false);
    }
    // FS 工具：解析目标路径做 read/write 锁与路径白名单判定
    if is_fs_tool(tool_name) {
        let Some(raw) = fs_path_arg(tool_name, args) else {
            return Ok(false);
        };
        let expanded = expand_home(&raw);
        let resolved = ctx.resolve_path(&expanded);
        let norm = crate::tool_context::normalize_path(&resolved);
        return crate::permission_rules::verdict_for_path(
            &rules,
            &norm,
            false,
            is_write_or_search_tool(tool_name),
            tool_name == "read_file",
        );
    }
    Ok(false)
}

// ─── 交互协调器（S5 单点化：实现迁 interaction_broker 模块，三型统一注册表） ───

pub use crate::interaction_broker::InteractionBroker;

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_dangerous_only_matches() {
        let p = ConfirmationPolicy::dangerous_only();
        // Dangerous（委派 / 删除）无条件确认
        assert!(p.needs_confirmation("delegate_to_sub_agent", &serde_json::json!({}), crate::tool::RiskLevel::Dangerous));
        assert!(p.needs_confirmation("entity_delete", &serde_json::json!({ "id": "x" }), crate::tool::RiskLevel::Dangerous));
        // Moderate 命令：仅命中危险模式确认
        assert!(p.needs_confirmation("execute_command", &serde_json::json!({ "command": "rm -rf /" }), crate::tool::RiskLevel::Moderate));
        assert!(!p.needs_confirmation("execute_command", &serde_json::json!({ "command": "ls -la" }), crate::tool::RiskLevel::Moderate));
        // Safe 只读放行
        assert!(!p.needs_confirmation("entity_get", &serde_json::json!({ "id": "x" }), crate::tool::RiskLevel::Safe));
        assert!(!p.needs_confirmation("plan_create", &serde_json::json!({ "plan": [] }), crate::tool::RiskLevel::Safe));
    }

    #[test]
    fn policy_moderate_and_dangerous_confirm_all_write() {
        let p = ConfirmationPolicy::moderate_and_dangerous();
        // Moderate 写/命令一律确认（不再依赖命令模式）
        assert!(p.needs_confirmation("execute_command", &serde_json::json!({ "command": "ls -la" }), crate::tool::RiskLevel::Moderate));
        assert!(p.needs_confirmation("shell_session", &serde_json::json!({ "command": "echo hi" }), crate::tool::RiskLevel::Moderate));
        // Dangerous 仍确认
        assert!(p.needs_confirmation("entity_delete", &serde_json::json!({ "id": "x" }), crate::tool::RiskLevel::Dangerous));
        // Safe 仍放行
        assert!(!p.needs_confirmation("entity_get", &serde_json::json!({ "id": "x" }), crate::tool::RiskLevel::Safe));
    }

    #[test]
    fn outcome_four_values_and_parse() {
        // D8 四值：仅 approved 放行；前端只可回传三值（timeout 由 kernel 产生）
        assert!(ConfirmationOutcome::Approved.is_approved());
        assert!(!ConfirmationOutcome::Denied.is_approved());
        assert!(!ConfirmationOutcome::Skipped.is_approved());
        assert!(!ConfirmationOutcome::Timeout.is_approved());
        assert_eq!(ConfirmationOutcome::parse("approved").unwrap(), ConfirmationOutcome::Approved);
        assert_eq!(ConfirmationOutcome::parse("denied").unwrap(), ConfirmationOutcome::Denied);
        assert_eq!(ConfirmationOutcome::parse("skipped").unwrap(), ConfirmationOutcome::Skipped);
        assert!(ConfirmationOutcome::parse("timeout").is_err());
        assert!(ConfirmationOutcome::parse("yes").is_err());
        // serde 口径：snake_case（与前端 TS 联合类型一致）
        let json = serde_json::to_value(ConfirmationOutcome::Skipped).unwrap();
        assert_eq!(json, serde_json::json!("skipped"));
    }

    // ─── Q1 提问通道测试（2026-09-20） ─────────────────────────

    #[test]
    fn policy_needs_confirmation_exempts_ask_question() {
        // Q1：提问工具豁免执行前确认（面板即人工交互；Plan 档恒确认同样豁免）
        let plan = ConfirmationPolicy::plan();
        assert!(!plan.needs_confirmation("ask_user_question", &serde_json::json!({"questions": []}), crate::tool::RiskLevel::Safe));
        assert!(plan.needs_confirmation("read_file", &serde_json::json!({"path": "a.md"}), crate::tool::RiskLevel::Safe));
        let moderate = ConfirmationPolicy::moderate_and_dangerous();
        assert!(!moderate.needs_confirmation("ask_user_question", &serde_json::json!({}), crate::tool::RiskLevel::Safe));
    }

    #[test]
    fn ask_outcome_kinds_and_answer_serde() {
        // 结果类别（事件载荷 / 前端清理判据）
        assert_eq!(AskOutcome::Answered(vec![]).kind(), "answered");
        assert_eq!(AskOutcome::Denied.kind(), "denied");
        assert_eq!(AskOutcome::Cancelled.kind(), "cancelled");
        assert_eq!(AskOutcome::TimedOut.kind(), "timed_out");
        // 答案序列化：custom 缺省不携带（对齐 dsh 输出 schema）
        let a = AskAnswer {
            id: "q1".into(),
            selected: vec!["A".into()],
            custom: None,
        };
        let v = serde_json::to_value(&a).unwrap();
        assert_eq!(v, serde_json::json!({ "id": "q1", "selected": ["A"] }));
        // 反序列化：selected / custom 可缺省（跳过 = 空 selected 无 custom）
        let parsed: AskAnswer = serde_json::from_value(serde_json::json!({ "id": "q1" })).unwrap();
        assert_eq!(parsed.selected, Vec::<String>::new());
        assert_eq!(parsed.custom, None);
    }

    // ─── Phase 5 动态路径守卫测试 ─────────────────────────────

    fn ctx_for(wd: &str) -> ToolContext {
        ToolContext {
            workdir: Some(PathBuf::from(wd)),
            project_id: None,
            workspace_id: None,
            sandbox: None,
            tool_stream: None,
            is_sub_agent: false,
        }
    }

    #[test]
    fn guard_write_outside_workdir_confirms() {
        // write_file 越出 workdir → 需确认
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path(
            "write_file",
            &serde_json::json!({ "path": "/tmp/out.txt", "content": "x" }),
            &ctx,
            false,
        );
        assert_eq!(guard, PathGuard::Confirm);
    }

    #[test]
    fn guard_write_inside_workdir_allows() {
        // write_file 在 workdir 内 → 放行（Moderate 默认不确认由策略裁决）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path(
            "write_file",
            &serde_json::json!({ "path": "src/a.txt", "content": "x" }),
            &ctx,
            false,
        );
        assert_eq!(guard, PathGuard::Allow);
    }

    #[test]
    fn guard_read_outside_workdir_allows() {
        // read_file 越出 workdir → 放行（读类越界允许，对齐「绝对路径读允许」）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path("read_file", &serde_json::json!({ "path": "/tmp/x.txt" }), &ctx, false);
        assert_eq!(guard, PathGuard::Allow);
    }

    #[test]
    fn guard_search_outside_workdir_confirms() {
        // search_files 越出 workdir → 需确认（用非敏感目录的越界路径，避免先命中敏感目录 Deny）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path("search_files", &serde_json::json!({ "pattern": "*.rs", "path": "/tmp/out" }), &ctx, false);
        assert_eq!(guard, PathGuard::Confirm);
    }

    #[test]
    fn guard_denies_system_dir() {
        // 系统目录（/etc）命中 → 拒绝（无论读写）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path("read_file", &serde_json::json!({ "path": "/etc/passwd" }), &ctx, false);
        assert!(matches!(guard, PathGuard::Deny(_)));
    }

    #[test]
    fn guard_sensitive_dir_deny_by_default() {
        // Phase 1：allow_sensitive_with_confirm=false（默认）→ 敏感目录仍 Deny
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path(
            "read_file",
            &serde_json::json!({ "path": "/etc/passwd" }),
            &ctx,
            false,
        );
        assert!(matches!(guard, PathGuard::Deny(_)), "默认应拒绝敏感目录: {guard:?}");
    }

    #[test]
    fn guard_sensitive_dir_confirm_when_allowed() {
        // Phase 1：allow_sensitive_with_confirm=true → 敏感目录由 Deny 改为 Confirm（允许经确认放行）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path(
            "read_file",
            &serde_json::json!({ "path": "/etc/passwd" }),
            &ctx,
            true,
        );
        assert_eq!(guard, PathGuard::Confirm, "开启确认开关后敏感目录应转为 Confirm");
    }

    #[test]
    fn guard_denies_home_ssh() {
        // ~/.ssh 命中 → 拒绝（依赖真实 home 环境变量）
        let ctx = ctx_for("/workspace");
        if let Some(home) = home_dir() {
            let ssh = home.join(".ssh").join("id_rsa");
            let guard = guard_fs_path("read_file", &serde_json::json!({ "path": ssh.to_string_lossy() }), &ctx, false);
            assert!(matches!(guard, PathGuard::Deny(_)), "~/.ssh 应被拒绝: {guard:?}");
        }
    }

    #[test]
    fn guard_non_fs_tool_allows() {
        // 非 FS 工具不做路径守卫
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path("execute_command", &serde_json::json!({ "command": "ls" }), &ctx, false);
        assert_eq!(guard, PathGuard::Allow);
    }

    #[test]
    fn guard_no_workdir_no_constraint() {
        // workdir 为 None → 无约束，写类任意路径放行
        let ctx = ToolContext::default();
        let guard = guard_fs_path("write_file", &serde_json::json!({ "path": "/any/path" }), &ctx, false);
        assert_eq!(guard, PathGuard::Allow);
    }

    #[test]
    fn is_write_tool_covers_edit_diff() {
        // edit_diff（2026-09-02 系统工具）须纳入写工具判定（Plan 档禁写 / 路径守卫）
        assert!(is_write_tool("edit_diff"));
        assert!(is_write_tool("write_file"));
        assert!(is_write_tool("edit_file"));
        assert!(!is_write_tool("read_file"));
        assert!(!is_write_tool("execute_command"));
    }

    #[test]
    fn guard_edit_diff_outside_workdir_confirms() {
        // edit_diff 越出 workdir → 需确认（与 write_file 同守卫）
        let ctx = ctx_for("/workspace");
        let guard = guard_fs_path(
            "edit_diff",
            &serde_json::json!({ "path": "/tmp/out.rs", "edits": [{ "old_string": "a", "new_string": "b" }] }),
            &ctx,
            false,
        );
        assert_eq!(guard, PathGuard::Confirm);
    }

    #[test]
    fn rule_engine_locks_edit_diff_write() {
        // edit_diff 写入命中锁（write_ok=false）→ 规则引擎应拦 Err
        // 临时在全局规则加锁（单测进程 RULES_PATH 未初始化，仅内存不落盘），用后移除
        crate::permission_rules::update_rules(|r| {
            r.locks.retain(|l| l.path != "/workspace/secret");
            r.locks.push(crate::permission_rules::LockRule {
                path: "/workspace/secret".into(),
                read_ok: true,
                command_ok: false,
                write_ok: false,
            });
        })
        .unwrap();
        let ctx = ctx_for("/workspace");
        let res = crate::confirmation::rule_engine_verdict(
            "edit_diff",
            &serde_json::json!({ "path": "secret/x.rs", "edits": [] }),
            &ctx,
        );
        assert!(res.is_err(), "edit_diff 写命中锁应被拦: {res:?}");
        crate::permission_rules::update_rules(|r| {
            r.locks.retain(|l| l.path != "/workspace/secret");
        })
        .unwrap();
    }

    // ─── 工作区分区免确认测试（M1，2026-09-03）──────────────────────

    #[test]
    fn bypass_true_for_agent_tmp_write() {
        // write_file 落 workdir/agent-tmp 子树 → 免确认
        let ctx = ctx_for("/workspace");
        assert!(should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "agent-tmp/draft.md", "content": "x" }),
            &ctx,
        ));
        // 绝对路径同命中；大小写不敏感
        assert!(should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "/workspace/AGENT-TMP/sub-coder/out.md" }),
            &ctx,
        ));
    }

    #[test]
    fn bypass_false_for_parent_dir_escape() {
        // agent-tmp/../entities/... 归一化后不命中 agent-tmp → 不豁免（走原确认逻辑）
        let ctx = ctx_for("/workspace");
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "agent-tmp/../entities/x.json" }),
            &ctx,
        ));
        // 越出 workdir 的 agent-tmp 字面路径 → 不豁免
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "/other/agent-tmp/x.md" }),
            &ctx,
        ));
    }

    #[test]
    fn bypass_false_for_non_agent_tmp_paths() {
        // 普通项目路径 / agent-out / entities → 不豁免（沿用现有权限）
        let ctx = ctx_for("/workspace");
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "src/main.rs" }),
            &ctx,
        ));
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "agent-out/report.md" }),
            &ctx,
        ));
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "entities/cast.json" }),
            &ctx,
        ));
    }

    #[test]
    fn bypass_false_for_non_write_tools() {
        // read_file（非写/搜索）不豁免——行为不变
        let ctx = ctx_for("/workspace");
        assert!(!should_bypass_confirmation(
            "read_file",
            &serde_json::json!({ "path": "agent-tmp/draft.md" }),
            &ctx,
        ));
    }

    #[test]
    fn bypass_false_without_workdir() {
        // workdir 为 None → 无分区锚点，不豁免
        let ctx = ToolContext::default();
        assert!(!should_bypass_confirmation(
            "write_file",
            &serde_json::json!({ "path": "agent-tmp/draft.md" }),
            &ctx,
        ));
    }
}