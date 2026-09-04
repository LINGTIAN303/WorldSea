//! HITL 权限确认（A5）：工具调用前暂停征询用户确认，详细见 docs/details/注释/agent-runtime/agent.md
//!
//! 借鉴 OpenWorld `HITL 权限确认 / ask_user`，适配 WorldSmith 桌面端 Rust AgentLoop。
//! 机制：AgentLoop 执行「需确认」工具前，经 `ConfirmationBroker::request` 广播
//! `ConfirmationRequested` 事件 → Tauri 端转发前端 `agent:confirm:{session_id}` →
//! 前端弹窗后经 `cmd_agent_confirm` 回传 → `ConfirmationBroker::resolve` 放行/拒绝。
//!
//! 决策在 Rust 侧（`ConfirmationPolicy` 配置需确认工具集），MVP 仅覆盖危险操作。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{oneshot, Mutex, RwLock};

use crate::event::{EventBroadcaster, OrchestratorEvent};
use crate::permission_rules::SecurityLevel;
use crate::tool_context::ToolContext;

/// 默认确认超时（60s），超时按拒绝处理，避免 Agent 无限等待
const DEFAULT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(60);

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
///   独立执行，不受本函数影响（agent-tmp 与 entities/.worldsmith 是一级目录互斥）。
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
    pending: Mutex<HashMap<String, oneshot::Sender<bool>>>,
    timeout: Duration,
}

impl ConfirmationBroker {
    /// 创建确认协调器（默认超时 60s）
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            timeout: DEFAULT_CONFIRM_TIMEOUT,
        }
    }

    /// 创建并自定义确认超时
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            timeout,
        }
    }

    /// 发起确认请求：广播事件并等待前端响应
    ///
    /// # 返回
    /// - `Some(true)`：用户放行
    /// - `Some(false)`：用户拒绝
    /// - `None`：超时或中断（调用方按拒绝处理）
    pub async fn request(
        &self,
        broadcaster: &Arc<RwLock<EventBroadcaster>>,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Option<bool> {
        let confirm_id = Self::gen_id();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(confirm_id.clone(), tx);
        // 广播确认请求（同步 broadcast，锁先 read）
        broadcaster.read().await.broadcast(&OrchestratorEvent::ConfirmationRequested {
            confirm_id: confirm_id.clone(),
            tool_name: tool_name.to_string(),
            args,
        });
        // 等待前端回传，超时则清理并返回 None
        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(approved)) => Some(approved),
            _ => {
                self.pending.lock().await.remove(&confirm_id);
                None
            }
        }
    }

    /// 解析确认（前端经 `cmd_agent_confirm` 回传）
    ///
    /// 返回是否成功找到并唤醒对应等待方（confirm_id 不存在 = 已超时/已处理）。
    pub async fn resolve(&self, confirm_id: &str, approved: bool) -> bool {
        if let Some(tx) = self.pending.lock().await.remove(confirm_id) {
            let _ = tx.send(approved);
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
        assert!(broker2.resolve(&id, true).await);
        assert_eq!(handle.await.unwrap(), Some(true));
    }

    // ─── Phase 5 动态路径守卫测试 ─────────────────────────────

    fn ctx_for(wd: &str) -> ToolContext {
        ToolContext {
            workdir: Some(PathBuf::from(wd)),
            project_id: None,
            workspace_id: None,
            tool_stream: None,
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