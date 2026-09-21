//! HITL 权限确认（A5）：工具调用前暂停征询用户确认，详细见 docs/details/注释/agent-runtime/agent.md
//!
//! 借鉴 OpenWorld `HITL 权限确认 / ask_user`，适配 WorldSea 桌面端 Rust AgentLoop。
//! 机制：AgentLoop 执行「需确认」工具前，经 `ConfirmationBroker::request` 广播
//! `ConfirmationRequested` 事件 → Tauri 端转发前端 `agent:confirm:{session_id}` →
//! 前端弹窗后经 `cmd_agent_confirm` 回传 → `ConfirmationBroker::resolve` 放行/拒绝。
//!
//! D8 四值对齐（2026-09-17）：审批结果由 bool 升级为 [`ConfirmationOutcome`]
//! （approved / denied / skipped / timeout）——「拒绝」「跳过」「超时」不再不可区分。
//!
//! 决策在 Rust 侧（`ConfirmationPolicy` 配置需确认工具集），MVP 仅覆盖危险操作。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex, RwLock};

use crate::event::{EventBroadcaster, OrchestratorEvent};
use crate::permission_rules::SecurityLevel;
use crate::tool_context::ToolContext;

/// 默认确认超时（60s），超时按不执行处理，避免 Agent 无限等待
const DEFAULT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(60);

/// 默认提问超时（10 分钟，2026-09-20 用户裁定：超时按「跳过」处理）
///
/// 提问不套用确认的 60s（人工作答需要时间），但也不能无限等待（无应答者场景）；
/// 超时 → [`AskOutcome::TimedOut`]：清理 pending + 广播 `AskResolved{timed_out}`
/// （前端关面板 + 弱提示），工具侧按「跳过」返回空答案 + `timedOut` 标记。
const DEFAULT_ASK_TIMEOUT: Duration = Duration::from_secs(600);

// ─── 审批结果四值（D8，2026-09-17） ──────────────────────────

/// 用户审批结果（D8 四值对齐；取代原 bool 归一——跳过/拒绝/超时相互不可区分）
///
/// - `Approved`：用户放行（含「添加白名单并放行」附加动作）
/// - `Denied`：用户拒绝执行
/// - `Skipped`：用户跳过本次操作（第三键「取消(跳过)」）
/// - `Timeout`：等待用户确认超时（`DEFAULT_CONFIRM_TIMEOUT`），按不执行处理
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConfirmationOutcome {
    /// 用户放行
    Approved,
    /// 用户拒绝
    Denied,
    /// 用户跳过（第三键）
    Skipped,
    /// 等待确认超时（仅 kernel 侧产生，不接受前端回传）
    Timeout,
}

impl ConfirmationOutcome {
    /// 是否放行工具执行（仅 `Approved` 为真）
    pub fn is_approved(self) -> bool {
        matches!(self, Self::Approved)
    }

    /// 从 snake_case 字符串解析（前端 `cmd_agent_confirm` 入参；`timeout` 由 kernel 超时产生）
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

// ─── 提问通道（Q1，2026-09-20） ─────────────────────────────

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

/// 提问结果（D3 三语义 + 超时四值，2026-09-20）
///
/// - `Answered`：用户作答（answers 与问题按稳定 id 一一对应）→ 工具成功结果
/// - `Denied`：用户拒绝作答（前端「取消」键）→ 工具失败码 `ASK_DENIED`
/// - `Cancelled`：等待被中断取消（abort / dispose 随轮取消；仅 kernel 侧产生）
///   → 工具失败码 `ASK_CANCELLED`
/// - `TimedOut`：等待超时（`DEFAULT_ASK_TIMEOUT` = 10 分钟；仅 kernel 侧产生）
///   → 工具按「跳过」处理（逐题空答案 + `timedOut` 标记，非失败结果）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AskOutcome {
    /// 用户已作答
    Answered(Vec<AskAnswer>),
    /// 用户拒绝作答（前端取消）
    Denied,
    /// 等待被中断取消（随轮取消 / 会话销毁；仅 kernel 侧产生）
    Cancelled,
    /// 等待超时（10 分钟兜底；仅 kernel 侧产生）——按「跳过」处理
    TimedOut,
}

impl AskOutcome {
    /// 结果类别字符串（事件载荷 `AskResolved` / 前端清理用）
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Answered(_) => "answered",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
        }
    }
}

// ─── A7 工具权限分级 ──────────────────────────────────────────

/// 工具安全等级（A7 三分级，对齐 TS `PermissionGuard` 的 safe/moderate/dangerous）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolPermission {
    /// 安全：常规读/查询，不确认直接执行
    Safe,
    /// 中等：写操作/命令执行，默认不确认，可按策略开启确认
    Moderate,
    /// 危险：破坏性/不可逆操作，无条件确认
    Dangerous,
}

/// 已知工具静态等级映射（集中登记，未登记默认 `Moderate`，对齐 TS `PermissionGuard` 默认）
///
/// 分级口径：
/// - `Dangerous`：destructive / 委派子 Agent / 删除等不可逆操作，无条件确认
/// - `Moderate`：写操作、命令执行（命中 `dangerous_command_patterns` 再动态升级）
/// - `Safe`：只读查询
pub fn tool_permission(tool_name: &str) -> ToolPermission {
    match tool_name {
        // 危险：委派 / 删除 / 破坏性
        "delegate_to_sub_agent" | "entity_delete" | "memory_delete" | "clear_history"
        | "trash_empty" => ToolPermission::Dangerous,
        // 命令执行：Moderate 基底（命中危险命令模式由 needs_confirmation 动态升级）
        "execute_command" | "shell_session" | "shell_session_exec" | "shell_session_create"
        | "shell_session_write" => ToolPermission::Moderate,
        // 计划写入 / 搜索 / 实体读：Safe 级可放行
        "plan_create" | "plan_update" | "plan_replan" | "entity_list" | "entity_get"
        | "web_search" | "list_sub_agents" => ToolPermission::Safe,
        // 文件系统工具（Phase 5）：只读放行（Safe）；写入/编辑 → Moderate（默认不确认，可按策略开启）
        "read_file" | "list_directory" | "search_files" => ToolPermission::Safe,
        "write_file" | "edit_file" | "edit_diff" => ToolPermission::Moderate,
        // A1 记忆工具（2026-09-12）：
        // - 只读两件 → Safe（`memory_recall` 的副作用在记忆系统内部（访问计数），
        //   不触碰用户数据；`memory_read_raw` 是纯读且作用域收敛到外置目录）
        // - 写入/治理三件 → Moderate（可解释、可撤销；删除已在上方 Dangerous）
        "memory_recall" | "memory_read_raw" => ToolPermission::Safe,
        "memory_store" | "memory_update" | "memory_pin" => ToolPermission::Moderate,
        // 其余未登记工具按 Moderate 兜底（策略默认不确认，行为不变）
        _ => ToolPermission::Moderate,
    }
}

// ─── HITL 确认策略 ──────────────────────────────────────────

/// 确认策略：哪些工具调用需要用户确认
///
/// 判定在 Rust 侧（A7 升级为三分级），综合工具名/等级与命令参数：
/// - 工具权限等级取 `tool_permission(name)`（Safe/Moderate/Dangerous）
///   - `Dangerous`：无条件确认
///   - `Safe`：直接放行
///   - `Moderate`：`confirm_moderate=true` 时确认；否则命令工具命中危险模式才确认
/// - `confirm_tools`：兼容 A5 遗留的「工具名白名单」，命中即无条件确认（可为空）
/// - `dangerous_command_patterns`：`execute_command`/`shell_session` 命令命中任一模版时确认
#[derive(Debug, Clone, Default)]
pub struct ConfirmationPolicy {
    /// 无条件需确认的工具名（A5 遗留，可为空；等级由 `tool_permission` 承载）
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

    /// 判断某工具调用是否需要确认（A7 三分级裁决，档位短路优先）
    pub fn needs_confirmation(&self, tool_name: &str, args: &serde_json::Value) -> bool {
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

        match tool_permission(tool_name) {
            ToolPermission::Dangerous => true,
            ToolPermission::Safe => false,
            ToolPermission::Moderate => {
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

// ─── ConfirmationBroker ────────────────────────────────────

/// HITL 确认协调器：发起确认请求 → 等待前端回传 → 放行/拒绝
///
/// 每个 AgentLoop 会话持有一个 broker；`request` 广播事件并 `await` oneshot，
/// 前端经 `cmd_agent_confirm` 调用 `resolve` 唤醒等待方。
pub struct ConfirmationBroker {
    pending: Mutex<HashMap<String, oneshot::Sender<ConfirmationOutcome>>>,
    /// Q1（2026-09-20）：待回答提问（10 分钟兜底超时——`ask_timeout`；随轮取消见 `AgentLoop::abort/dispose`）
    pending_asks: Mutex<HashMap<String, oneshot::Sender<AskOutcome>>>,
    timeout: Duration,
    /// 提问兜底超时（默认 10 分钟；测试可经 `with_ask_timeout` 缩短）
    ask_timeout: Duration,
}

impl ConfirmationBroker {
    /// 创建确认协调器（默认确认超时 60s；提问兜底超时 10 分钟）
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            pending_asks: Mutex::new(HashMap::new()),
            timeout: DEFAULT_CONFIRM_TIMEOUT,
            ask_timeout: DEFAULT_ASK_TIMEOUT,
        }
    }

    /// 创建并自定义确认超时（提问超时维持默认）
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            pending_asks: Mutex::new(HashMap::new()),
            timeout,
            ask_timeout: DEFAULT_ASK_TIMEOUT,
        }
    }

    /// 创建并自定义提问兜底超时（测试用；生产维持 `DEFAULT_ASK_TIMEOUT`）
    pub fn with_ask_timeout(ask_timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            pending_asks: Mutex::new(HashMap::new()),
            timeout: DEFAULT_CONFIRM_TIMEOUT,
            ask_timeout,
        }
    }

    /// 发起确认请求：广播事件并等待前端响应
    ///
    /// # 返回（D8 四值）
    /// - `Approved`：用户放行
    /// - `Denied` / `Skipped`：用户拒绝 / 跳过（均不执行，文案区分）
    /// - `Timeout`：超时或中断（调用方按不执行处理）
    pub async fn request(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        tool_name: &str,
        args: serde_json::Value,
    ) -> ConfirmationOutcome {
        let confirm_id = Self::gen_id();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(confirm_id.clone(), tx);
        // 广播确认请求（取总线句柄后于**壳锁外**分发——2026-09-17 风险点处置）
        let bus = broadcaster.read().await.handle();
        bus.emit(&OrchestratorEvent::ConfirmationRequested {
            confirm_id: confirm_id.clone(),
            tool_name: tool_name.to_string(),
            args,
        });
        // 等待前端回传，超时则清理并返回 Timeout
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(outcome)) => outcome,
            _ => {
                self.pending.lock().await.remove(&confirm_id);
                ConfirmationOutcome::Timeout
            }
        }
    }

    /// 解析确认（前端经 `cmd_agent_confirm` 回传）
    ///
    /// 返回是否成功找到并唤醒对应等待方（confirm_id 不存在 = 已超时/已处理）。
    pub async fn resolve(&self, confirm_id: &str, outcome: ConfirmationOutcome) -> bool {
        if let Some(tx) = self.pending.lock().await.remove(confirm_id) {
            let _ = tx.send(outcome);
            true
        } else {
            false
        }
    }

    /// 生成确认请求唯一 ID（纳秒时间戳 + 原子计数，避免依赖额外 uuid crate）
    fn gen_id() -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("confirm-{nanos}-{n}")
    }

    // ─── Q1 提问通道（2026-09-20） ─────────────────────────────

    /// 发起提问请求：广播 `AskRequested` 事件并等待前端作答
    ///
    /// **超时口径（2026-09-20 用户裁定）**：兜底 10 分钟（`DEFAULT_ASK_TIMEOUT`）——
    /// 提问不套用确认的 60s（人工作答需要时间），但也不能无限等待（无应答者场景）；
    /// 超时 → [`AskOutcome::TimedOut`]（清理 pending + 广播 `AskResolved{timed_out}`，
    /// 前端关面板 + 弱提示），工具侧按「跳过」处理。取消/中断另由
    /// [`AgentLoop::abort`](crate::agent::AgentLoop::abort) /
    /// [`AgentLoop::dispose`](crate::agent::AgentLoop::dispose) 经 [`Self::cancel_pending_asks`] 收口。
    ///
    /// `questions` 为工具规范化后的批次载荷（camelCase：
    /// `[{ id, question, header?, options?, multiSelect? }]`）。
    pub async fn ask(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        questions: serde_json::Value,
    ) -> AskOutcome {
        let ask_id = Self::gen_ask_id();
        let (tx, rx) = oneshot::channel();
        self.pending_asks.lock().await.insert(ask_id.clone(), tx);
        // 广播提问请求（取总线句柄后于**壳锁外**分发——同 `request` 的锁纪律）
        let bus = broadcaster.read().await.handle();
        bus.emit(&OrchestratorEvent::AskRequested {
            ask_id: ask_id.clone(),
            questions,
        });
        // 等待人工作答：用户作答/拒绝（`resolve_ask`）、随轮取消（`cancel_pending_asks`）
        // 或兜底超时三者之一唤醒
        match tokio::time::timeout(self.ask_timeout, rx).await {
            Ok(Ok(outcome)) => outcome,
            // 发送端被丢弃（不应发生）→ 按取消兜底，保证工具侧不致永久挂起
            Ok(Err(_)) => AskOutcome::Cancelled,
            Err(_) => {
                // 超时：清理 pending 并广播 resolved（前端据此关面板 + 弱提示）
                self.pending_asks.lock().await.remove(&ask_id);
                let bus = broadcaster.read().await.handle();
                bus.emit(&OrchestratorEvent::AskResolved {
                    ask_id,
                    outcome: AskOutcome::TimedOut,
                });
                AskOutcome::TimedOut
            }
        }
    }

    /// 解析提问（前端经 `cmd_agent_ask_answer` 回传）
    ///
    /// 返回是否成功找到并唤醒对应等待方（ask_id 不存在 = 已处理/已取消）。
    pub async fn resolve_ask(&self, ask_id: &str, outcome: AskOutcome) -> bool {
        if let Some(tx) = self.pending_asks.lock().await.remove(ask_id) {
            let _ = tx.send(outcome);
            true
        } else {
            false
        }
    }

    /// 取消全部待回答提问（Q1 随轮取消），返回被取消的 ask_id 列表
    ///
    /// 调用方（`AgentLoop::cancel_pending_asks`）据此广播 `AskResolved{cancelled}`
    /// 供前端清理面板。
    pub async fn cancel_pending_asks(&self) -> Vec<String> {
        let mut guard = self.pending_asks.lock().await;
        let ids: Vec<String> = guard.keys().cloned().collect();
        for (_, tx) in guard.drain() {
            let _ = tx.send(AskOutcome::Cancelled);
        }
        ids
    }

    /// 生成提问请求唯一 ID（`ask-{nanos}-{n}`，与 confirm 同构、靠前缀区分）
    fn gen_ask_id() -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("ask-{nanos}-{n}")
    }
}

impl Default for ConfirmationBroker {
    fn default() -> Self {
        Self::new()
    }
}

// ─── 测试 ────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_dangerous_only_matches() {
        let p = ConfirmationPolicy::dangerous_only();
        // Dangerous（委派 / 删除）无条件确认
        assert!(p.needs_confirmation("delegate_to_sub_agent", &serde_json::json!({})));
        assert!(p.needs_confirmation("entity_delete", &serde_json::json!({ "id": "x" })));
        // Moderate 命令：仅命中危险模式确认
        assert!(p.needs_confirmation("execute_command", &serde_json::json!({ "command": "rm -rf /" })));
        assert!(!p.needs_confirmation("execute_command", &serde_json::json!({ "command": "ls -la" })));
        // Safe 只读放行
        assert!(!p.needs_confirmation("entity_get", &serde_json::json!({ "id": "x" })));
        assert!(!p.needs_confirmation("plan_create", &serde_json::json!({ "plan": [] })));
    }

    #[test]
    fn policy_moderate_and_dangerous_confirm_all_write() {
        let p = ConfirmationPolicy::moderate_and_dangerous();
        // Moderate 写/命令一律确认（不再依赖命令模式）
        assert!(p.needs_confirmation("execute_command", &serde_json::json!({ "command": "ls -la" })));
        assert!(p.needs_confirmation("shell_session", &serde_json::json!({ "command": "echo hi" })));
        // Dangerous 仍确认
        assert!(p.needs_confirmation("entity_delete", &serde_json::json!({ "id": "x" })));
        // Safe 仍放行
        assert!(!p.needs_confirmation("entity_get", &serde_json::json!({ "id": "x" })));
    }

    #[test]
    fn tool_permission_classification() {
        assert_eq!(tool_permission("delegate_to_sub_agent"), ToolPermission::Dangerous);
        assert_eq!(tool_permission("entity_delete"), ToolPermission::Dangerous);
        assert_eq!(tool_permission("execute_command"), ToolPermission::Moderate);
        assert_eq!(tool_permission("entity_get"), ToolPermission::Safe);
        assert_eq!(tool_permission("plan_create"), ToolPermission::Safe);
        // 未登记工具默认 Moderate（对齐 TS PermissionGuard）
        assert_eq!(tool_permission("unknown_tool"), ToolPermission::Moderate);
    }

    #[tokio::test]
    async fn broker_resolve_wakes_request() {
        let broker = ConfirmationBroker::new();
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        // 先开一个后台任务发起请求，主任务稍后 resolve
        let broker2 = Arc::new(broker);
        let b2 = broker2.clone();
        let bc = broadcaster.clone();
        let handle = tokio::spawn(async move {
            b2.request(&bc, "execute_command", serde_json::json!({ "command": "shutdown now" })).await
        });
        // 等待请求进入 pending（轮询），然后 resolve
        tokio::time::sleep(Duration::from_millis(50)).await;
        // 找到 pending 的 confirm_id
        let id = {
            let guard = broker2.pending.lock().await;
            guard.keys().next().cloned().unwrap()
        };
        assert!(broker2.resolve(&id, ConfirmationOutcome::Denied).await);
        assert_eq!(handle.await.unwrap(), ConfirmationOutcome::Denied);
        // 已解析的 confirm_id 再次 resolve → false（已处理）
        assert!(!broker2.resolve(&id, ConfirmationOutcome::Approved).await);
    }

    #[tokio::test]
    async fn broker_timeout_returns_timeout_outcome() {
        // D8：超时不再与「拒绝」混同——应产出独立的 Timeout 四值
        let broker = ConfirmationBroker::with_timeout(Duration::from_millis(30));
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let outcome = broker
            .request(&broadcaster, "execute_command", serde_json::json!({}))
            .await;
        assert_eq!(outcome, ConfirmationOutcome::Timeout);
        assert!(!outcome.is_approved());
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
        assert!(!plan.needs_confirmation("ask_user_question", &serde_json::json!({"questions": []})));
        assert!(plan.needs_confirmation("read_file", &serde_json::json!({"path": "a.md"})));
        let moderate = ConfirmationPolicy::moderate_and_dangerous();
        assert!(!moderate.needs_confirmation("ask_user_question", &serde_json::json!({})));
    }

    #[tokio::test]
    async fn broker_ask_resolve_wakes_request_with_answers() {
        // 提问等待无超时：由 resolve_ask 唤醒并原样带回答案
        let broker = Arc::new(ConfirmationBroker::new());
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let b2 = broker.clone();
        let bc = broadcaster.clone();
        let handle = tokio::spawn(async move {
            b2.ask(&bc, serde_json::json!([{ "id": "q1", "question": "继续吗？" }]))
                .await
        });
        // 轮询等待请求进入 pending_asks
        let mut ask_id = None;
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(10)).await;
            let guard = broker.pending_asks.lock().await;
            if let Some(k) = guard.keys().next().cloned() {
                ask_id = Some(k);
                break;
            }
        }
        let ask_id = ask_id.expect("ask 应进入 pending_asks");
        assert!(ask_id.starts_with("ask-"), "ask_id 前缀应可区分: {ask_id}");
        let answers = vec![AskAnswer {
            id: "q1".into(),
            selected: vec!["Approve".into()],
            custom: None,
        }];
        assert!(broker
            .resolve_ask(&ask_id, AskOutcome::Answered(answers.clone()))
            .await);
        assert_eq!(handle.await.unwrap(), AskOutcome::Answered(answers));
        // 已解析的 ask_id 再次 resolve → false（已处理）
        assert!(!broker.resolve_ask(&ask_id, AskOutcome::Denied).await);
    }

    #[tokio::test]
    async fn broker_cancel_pending_asks_wakes_all_with_cancelled() {
        // 随轮取消（Q1）：abort / dispose 时全部等待方应收到 Cancelled，不得残留
        let broker = Arc::new(ConfirmationBroker::new());
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let b = broker.clone();
            let bc = broadcaster.clone();
            handles.push(tokio::spawn(async move {
                b.ask(&bc, serde_json::json!([])).await
            }));
        }
        // 轮询等待两条请求都进入 pending_asks
        for _ in 0..50 {
            tokio::time::sleep(Duration::from_millis(10)).await;
            if broker.pending_asks.lock().await.len() == 2 {
                break;
            }
        }
        let ids = broker.cancel_pending_asks().await;
        assert_eq!(ids.len(), 2, "应返回两条被取消的 ask_id");
        for h in handles {
            assert_eq!(h.await.unwrap(), AskOutcome::Cancelled);
        }
        // 清空后再取消 → 空列表（幂等）
        assert!(broker.cancel_pending_asks().await.is_empty());
    }

    #[tokio::test]
    async fn broker_ask_timeout_returns_timed_out_and_clears_pending() {
        // 10 分钟兜底超时（此处缩短验证）：超时 → TimedOut，pending 清理、后续 resolve 无效
        let broker = ConfirmationBroker::with_ask_timeout(Duration::from_millis(30));
        let broadcaster = Arc::new(RwLock::new(EventBroadcaster::new()));
        let outcome = broker
            .ask(&broadcaster, serde_json::json!([{ "id": "q1", "question": "继续？" }]))
            .await;
        assert_eq!(outcome, AskOutcome::TimedOut);
        assert_eq!(outcome.kind(), "timed_out");
        // pending 已随超时清理（幂等返回空）
        assert!(broker.cancel_pending_asks().await.is_empty());
        assert!(!broker.resolve_ask("ask-any", AskOutcome::Denied).await);
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
    fn tool_permission_fs_tools() {
        // FS 工具等级登记：只读 Safe，写入 Moderate
        assert_eq!(tool_permission("read_file"), ToolPermission::Safe);
        assert_eq!(tool_permission("list_directory"), ToolPermission::Safe);
        assert_eq!(tool_permission("search_files"), ToolPermission::Safe);
        assert_eq!(tool_permission("write_file"), ToolPermission::Moderate);
        assert_eq!(tool_permission("edit_file"), ToolPermission::Moderate);
        assert_eq!(tool_permission("edit_diff"), ToolPermission::Moderate);
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