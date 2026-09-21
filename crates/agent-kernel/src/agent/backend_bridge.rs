use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::debug;

use crate::event::{EventBroadcaster, OrchestratorEvent};
use crate::event_bus::{Listener, ListenerOutcome};

// ─── Backend 事件桥接 ────────────────────────────────────────────

/// Backend 事件桥接 listener，详细见 docs/details/注释/agent-runtime/agent.md
pub(super) struct BackendEventBridge {
    /// 目标广播器（AgentLoop 的 broadcaster）
    pub(super) target_broadcaster: Arc<RwLock<EventBroadcaster>>,
}

impl Listener for BackendEventBridge {
    fn call(&self, event: &OrchestratorEvent) -> ListenerOutcome {
        // 同步转发：短 `try_read` 仅取总线句柄，随即于**壳锁外**分发（2026-09-17 风险点处置：
        // 目标总线长链运行期间不再持锁 → 写者不排队、本转发不再因锁竞争丢事件）
        match self.target_broadcaster.try_read() {
            Ok(broadcaster) => {
                let bus = broadcaster.handle();
                drop(broadcaster); // 释放壳锁后再分发
                bus.emit(event);
            }
            Err(_) => {
                // 仅在"取句柄"的瞬时竞争下丢弃（流式增量丢失一两个不影响整体）
                debug!("BackendEventBridge: broadcaster 锁竞争，丢弃事件");
            }
        }
        ListenerOutcome::Continue
    }
}