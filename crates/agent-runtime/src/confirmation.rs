//! HITL 权限确认（A5）：工具调用前暂停征询用户确认，详细见 docs/details/注释/agent-runtime/agent.md
//!
//! 借鉴 OpenWorld `HITL 权限确认 / ask_user`，适配 WorldSmith 桌面端 Rust AgentLoop。
//! 机制：AgentLoop 执行「需确认」工具前，经 `ConfirmationBroker::request` 广播
//! `ConfirmationRequested` 事件 → Tauri 端转发前端 `agent:confirm:{session_id}` →
//! 前端弹窗后经 `cmd_agent_confirm` 回传 → `ConfirmationBroker::resolve` 放行/拒绝。
//!
//! 决策在 Rust 侧（`ConfirmationPolicy` 配置需确认工具集），MVP 仅覆盖危险操作。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{oneshot, Mutex, RwLock};

use crate::event::{EventBroadcaster, OrchestratorEvent};

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
}

impl ConfirmationPolicy {
    /// 推荐的宽松默认策略：仅危险操作确认（A7 分级的 Dangerous 档）
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
        }
    }

    /// 判断某工具调用是否需要确认（A7 三分级裁决）
    pub fn needs_confirmation(&self, tool_name: &str, args: &serde_json::Value) -> bool {
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
}