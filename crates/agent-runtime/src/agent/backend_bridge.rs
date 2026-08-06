use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::debug;

use crate::event::{EventBroadcaster, EventListener, OrchestratorEvent};

// ─── Backend 事件桥接 ────────────────────────────────────────────

/// Backend 事件桥接 listener，详细见 docs/details/注释/agent-runtime/agent.md
pub(super) struct BackendEventBridge {
    /// 目标广播器（AgentLoop 的 broadcaster）
    pub(super) target_broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl EventListener for BackendEventBridge {
    fn on_event(&self, event: &OrchestratorEvent) {
        // 同步转发：尝试读取 broadcaster，失败则丢弃（避免 panic）
        // 注意：使用 try_read 避免阻塞，因为 backend 可能在持有锁时调用
        if let Ok(broadcaster) = self.target_broadcaster.try_read() {
            broadcaster.broadcast(event);
        } else {
            // 锁竞争时丢弃事件（流式增量丢失一两个不影响整体）
            debug!("BackendEventBridge: broadcaster 锁竞争，丢弃事件");
        }
    }
}
