use std::sync::Arc;

use async_trait::async_trait;

use crate::long_task::{CheckpointProvider, HeartbeatTick, LongTaskCheckpoint, LongTaskManager};

use super::AgentLoop;

// ─── Loop Engineering 集成（阶段 2.2 新增） ─────────────

impl AgentLoop {
    /// 获取长任务管理器引用，详细见 docs/details/注释/agent-runtime/agent.md
    pub fn long_task_manager(&self) -> &LongTaskManager {
        &self.long_task_manager
    }

    /// 获取长任务管理器的 Arc 句柄
    ///
    /// 用于需要独立持有 `Arc<LongTaskManager>` 的场景（如心跳定时器回调闭包）。
    pub fn long_task_manager_arc(&self) -> Arc<LongTaskManager> {
        Arc::clone(&self.long_task_manager)
    }

    /// 启动长任务心跳定时器（helper 方法，批次3.4），详细见 docs/details/注释/agent-runtime/agent.md
    pub async fn start_long_task_heartbeat<F, Fut>(&self, on_tick: F)
    where
        F: Fn(HeartbeatTick) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        let manager_arc = self.long_task_manager_arc();
        self.long_task_manager
            .start_heartbeat(manager_arc, on_tick)
            .await;
    }

    /// 停止长任务心跳定时器（helper 方法，批次3.4）
    ///
    /// 封装 [`LongTaskManager::stop_heartbeat`]，用于 dispose / 显式停止场景。
    pub async fn stop_long_task_heartbeat(&self) {
        self.long_task_manager.stop_heartbeat().await;
    }
}

// ─── CheckpointProvider 实现 ────────────────────────────────────────────

/// 为 `AgentLoop` 实现 `CheckpointProvider`，供 `LongTaskManager` 拉取 checkpoint。
///
/// # 实现
/// - `agent_messages`：从 `state.messages` 克隆（持 AsyncMutex，需 await）
/// - `last_user_text`：从 `last_user_text` 字段读取（同步 RwLock）
/// - `skill_names` / `chat_mode` / `locked_chat_mode`：当前 AgentLoop 不持有，
///   留 `None`。调用方需要更细粒度的 checkpoint 时，直接构造 `LongTaskCheckpoint`
///   并调 `LongTaskManager::checkpoint()` 而不通过本 trait。
#[async_trait]
impl CheckpointProvider for AgentLoop {
    async fn get_checkpoint(&self) -> LongTaskCheckpoint {
        let messages = self.get_messages().await;
        let last_user_text = self
            .last_user_text
            .read()
            .map(|g| g.clone())
            .unwrap_or_default();
        LongTaskCheckpoint {
            agent_messages: messages,
            last_user_text,
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        }
    }
}
