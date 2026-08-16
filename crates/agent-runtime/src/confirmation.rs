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

// ─── HITL 确认策略 ──────────────────────────────────────────

/// 确认策略：哪些工具调用需要用户确认
///
/// 判定在 Rust 侧（A5 MVP 决策点），工具名与参数均参与：
/// - `confirm_tools`：无条件需确认的工具名（无论参数）
/// - `dangerous_command_patterns`：`execute_command`/`shell_session` 且命令命中任一模版时确认
#[derive(Debug, Clone, Default)]
pub struct ConfirmationPolicy {
    /// 无条件需确认的工具名
    pub confirm_tools: Vec<String>,
    /// 危险命令子串（小写匹配，命中即确认）
    pub dangerous_command_patterns: Vec<String>,
}

impl ConfirmationPolicy {
    /// 推荐的默认策略：仅危险操作确认（A5 首批范围）
    ///
    /// - `delegate_to_sub_agent`：委派子 Agent 是无条件确认
    /// - `execute_command`/`shell_session`：命令命中危险模式时确认
    pub fn dangerous_only() -> Self {
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
        }
    }

    /// 判断某工具调用是否需要确认
    pub fn needs_confirmation(&self, tool_name: &str, args: &serde_json::Value) -> bool {
        if self.confirm_tools.iter().any(|t| t == tool_name) {
            return true;
        }
        if matches!(tool_name, "execute_command" | "shell_session") {
            let cmd = args
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_lowercase();
            self.dangerous_command_patterns
                .iter()
                .any(|p| cmd.contains(p))
        } else {
            false
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
        assert!(p.needs_confirmation("delegate_to_sub_agent", &serde_json::json!({})));
        assert!(p.needs_confirmation("execute_command", &serde_json::json!({ "command": "rm -rf /" })));
        assert!(!p.needs_confirmation("execute_command", &serde_json::json!({ "command": "ls -la" })));
        assert!(!p.needs_confirmation("entity_get", &serde_json::json!({ "id": "x" })));
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