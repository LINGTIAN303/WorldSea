//! # 长任务管理 — Loop Engineering 核心组件
//!
//! 对应 TS 版 `longTaskStore.ts` + `useLongTask.ts`，迁移到 Rust 原生实现。
//!
//! ## 职责
//! 1. **状态机**：running → completed/failed/cancelled
//! 2. **心跳**：定时更新 `last_heartbeat_at`，检测失联（软提醒，不强制终止）
//! 3. **checkpoint**：事件驱动快照 AgentLoop 内部 messages，支持断点恢复
//! 4. **协作式取消**：设 `cancel_flag`，ReAct 循环在下一轮检查时优雅停止
//!
//! ## 设计原则（复用 workflow 引擎模式）
//! - 协作式取消 > 强制取消（Temporal/Airflow 经典模式）
//! - 心跳判活（`DispatchHandle.last_heartbeat_at_ms` 模式）
//! - checkpoint 持久化（`SqliteStore` 模式）
//! - 无硬超时（符合"无强制中断"需求）
//!
//! ## 与 TS 版的差异
//! - 持久化层从 IndexedDB 改为 SQLite（与 SessionRepository 同库）
//! - 心跳定时器从 `setInterval` 改为 `tokio::time::interval`
//! - 取消标志从模块级 `Map` 改为 `Arc<AtomicBool>`（每任务独立）
//! - checkpoint 数据提供者从回调改为 `Arc<dyn CheckpointProvider>` trait

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex as AsyncMutex, RwLock};
use tracing::{debug, info, warn};

use crate::types::OrchestratorMessage;

// ─── 常量 ────────────────────────────────────────────

/// 心跳间隔：每 5s 更新一次 `last_heartbeat_at` + flush 脏 checkpoint
///
/// 注意：保留 `std::time::Duration` 类型，因为 `tokio::time::interval` 需要此类型。
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_millis(5_000);

/// 心跳失联阈值：超过 30s 标记 stale（UI 提醒，不终止）
///
/// 使用 `chrono::Duration` 以便与 `DateTime<Utc>` 减法结果（`chrono::Duration`）直接比较。
pub const HEARTBEAT_STALE_THRESHOLD: ChronoDuration = ChronoDuration::seconds(30);

/// 心跳死亡阈值：超过 5min 标记 dead（疑似崩溃，建议恢复）
pub const HEARTBEAT_DEAD_THRESHOLD: ChronoDuration = ChronoDuration::minutes(5);

// ─── 数据结构 ────────────────────────────────────────────

/// 长任务类型
///
/// 对应 TS 版 `LongTaskType`，区分主 Agent 与子 Agent。
/// P1 范围仅 `main-agent` 接入；P4 子 Agent 接入时扩展为多任务 Map。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LongTaskType {
    /// 主 Agent 任务
    MainAgent,
    /// 子 Agent 任务（编排框架阶段接入）
    SubAgent,
}

/// 长任务状态机
///
/// 对应 TS 版 `LongTaskStatus`，状态转移：
/// ```text
/// running ──┬──→ completed
///           ├──→ failed
///           └──→ cancelled
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LongTaskStatus {
    /// 运行中
    Running,
    /// 已完成
    Completed,
    /// 已失败
    Failed,
    /// 已取消
    Cancelled,
}

/// 心跳状态（软监控，不强制终止）
///
/// 对应 TS 版 `heartbeatStatus`，根据 `last_heartbeat_at` 计算：
/// - `Alive`：最近心跳在 `HEARTBEAT_STALE_THRESHOLD` 内
/// - `Stale`：超过 `HEARTBEAT_STALE_THRESHOLD` 但未超过 `HEARTBEAT_DEAD_THRESHOLD`
/// - `Dead`：超过 `HEARTBEAT_DEAD_THRESHOLD`，疑似崩溃
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HeartbeatStatus {
    /// 活跃
    Alive,
    /// 失联（UI 提醒）
    Stale,
    /// 疑似崩溃（建议恢复）
    Dead,
}

/// 断点恢复快照
///
/// 对应 TS 版 `LongTaskCheckpoint`，存储 ReAct 循环的完整状态：
/// - `agent_messages`：AgentLoop 内部 messages（含 tool_call/result）
/// - `last_user_text`：触发任务的用户消息文本
/// - 其他元数据用于恢复时重建上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongTaskCheckpoint {
    /// AgentLoop 内部 messages（含完整 tool call/result，用于恢复续跑）
    pub agent_messages: Vec<OrchestratorMessage>,
    /// 触发任务的用户消息文本
    pub last_user_text: String,
    /// 技能名列表（若通过 skill 触发）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_names: Option<Vec<String>>,
    /// 会话聊天模式
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_mode: Option<String>,
    /// 锁定的聊天模式（首条消息时锁定）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_chat_mode: Option<String>,
}

/// 长任务元数据
///
/// 对应 TS 版 `LongTaskRecord.meta`，存储任务描述与编排上下文。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongTaskMeta {
    /// 子 Agent 类型（`type=SubAgent` 时填充）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    /// 任务描述/prompt
    pub prompt: String,
    /// 创作编排上下文（子 Agent 接入时用）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pipeline_context: Option<PipelineContext>,
}

/// 创作编排上下文
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineContext {
    pub pipeline_id: String,
    pub step_id: String,
}

/// 长任务记录（持久化到 SQLite）
///
/// 对应 TS 版 `LongTaskRecord`，迁移到 Rust：
/// - 时间戳从 `number`（ms）改为 `DateTime<Utc>`（RFC3339 字符串存储）
/// - `turn_count` 类型从 `number` 改为 `u32`
/// - `current_tool` / `current_phase` 保留 `Option<String>`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongTaskRecord {
    /// 任务唯一 ID（格式：`longtask-{type}-{timestamp}-{rand}`）
    pub task_id: String,
    /// 任务类型
    #[serde(rename = "type")]
    pub task_type: LongTaskType,
    /// 状态机
    pub status: LongTaskStatus,
    /// 创建时间（RFC3339）
    pub started_at: DateTime<Utc>,
    /// 最后心跳时间（RFC3339）
    pub last_heartbeat_at: DateTime<Utc>,
    /// 结束时间（RFC3339），终态时填充
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<DateTime<Utc>>,
    /// 进度：已完成轮次（`turn_end` 触发数）
    pub turn_count: u32,
    /// 进度：当前执行的 tool 名称
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_tool: Option<String>,
    /// 进度：当前阶段标签（深度模式）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_phase: Option<String>,
    /// 断点恢复快照
    pub checkpoint: LongTaskCheckpoint,
    /// 元数据
    pub meta: LongTaskMeta,
}

// ─── CheckpointProvider trait ────────────────────────────────────────────

/// checkpoint 数据提供者 trait
///
/// 对应 TS 版 `() => LongTaskCheckpoint` 回调，Rust 改为 trait 注入：
/// - `AgentLoop` 实现此 trait，提供 `get_checkpoint()` 返回当前 messages 快照
/// - `LongTaskManager` 通过 `Arc<dyn CheckpointProvider>` 调用，解耦具体实现
///
/// # 设计动机
/// Rust 没有 TS 的闭包捕获灵活性，用 trait + Arc 既能持有状态又线程安全。
///
/// # 异步设计
/// AgentLoop 的 `state` 用 `tokio::sync::Mutex`（AsyncMutex）保护，
/// 取 messages 必须 `.await`，因此 trait 方法为 `async`。
#[async_trait]
pub trait CheckpointProvider: Send + Sync {
    /// 获取当前 checkpoint 快照（含 AgentLoop 内部 messages）
    ///
    /// 实现应避免长时间持锁，建议克隆 messages 后立即释放锁。
    async fn get_checkpoint(&self) -> LongTaskCheckpoint;
}

// ─── LongTaskManager ────────────────────────────────────────────

/// 长任务管理器
///
/// 对应 TS 版 `useLongTask` composable，Rust 版改为可注入的 Manager。
/// 单例：每个 AgentLoop 持有一个 Manager（P1 范围仅主 Agent 接入）。
///
/// # 职责
/// 1. 持有当前活跃任务（`active_task`）
/// 2. 启动/停止心跳定时器
/// 3. 提供 checkpoint 更新接口（脏标记节流）
/// 4. 协作式取消标志管理
///
/// # 不负责
/// - 持久化：由 `LongTaskRepository`（Tauri 端）负责，Manager 仅持有内存状态
/// - 事件广播：由 `AgentLoop` 通过 `OrchestratorEvent` 转发
pub struct LongTaskManager {
    /// 当前活跃任务（None 表示无活跃任务）
    active_task: AsyncMutex<Option<LongTaskRecord>>,
    /// 心跳状态（UI 可读）
    heartbeat_status: RwLock<HeartbeatStatus>,
    /// 协作式取消标志（每任务独立，简化为单标志）
    cancel_flag: Arc<AtomicBool>,
    /// checkpoint 脏标记（true=有未持久化的 checkpoint 更新）
    checkpoint_dirty: AsyncMutex<bool>,
    /// 心跳定时器句柄（None=未启动）
    heartbeat_handle: AsyncMutex<Option<tokio::task::JoinHandle<()>>>,
}

impl LongTaskManager {
    /// 创建新的 LongTaskManager（无活跃任务）
    pub fn new() -> Self {
        Self {
            active_task: AsyncMutex::new(None),
            heartbeat_status: RwLock::new(HeartbeatStatus::Alive),
            cancel_flag: Arc::new(AtomicBool::new(false)),
            checkpoint_dirty: AsyncMutex::new(false),
            heartbeat_handle: AsyncMutex::new(None),
        }
    }

    /// 启动长任务
    ///
    /// # 参数
    /// - `task_id`：调用方生成的任务 ID（格式建议：`longtask-{type}-{ts}-{rand}`）
    /// - `task_type`：任务类型
    /// - `initial_checkpoint`：初始 checkpoint（由 `CheckpointProvider` 获取）
    /// - `meta`：任务元数据（含 `prompt` 字段，作为任务描述）
    ///
    /// # 行为
    /// 1. 若已有活跃任务，警告并保留（不抢占，调用方应先 `complete_task` 或 `fail_task`）
    /// 2. 创建 `LongTaskRecord`，status=Running，started_at=now
    /// 3. 清除 cancel_flag，重置 heartbeat_status=Alive
    /// 4. 启动心跳定时器
    ///
    /// # 返回
    /// 创建的 `LongTaskRecord`（调用方负责持久化）
    pub async fn start_task(
        &self,
        task_id: String,
        task_type: LongTaskType,
        initial_checkpoint: LongTaskCheckpoint,
        meta: LongTaskMeta,
    ) -> LongTaskRecord {
        // 防御：若已有活跃任务，警告
        {
            let active = self.active_task.lock().await;
            if let Some(existing) = active.as_ref() {
                warn!(
                    "LongTaskManager.start_task: 已有活跃任务 {}，将被抢占",
                    existing.task_id
                );
            }
        }

        let now = Utc::now();
        let record = LongTaskRecord {
            task_id: task_id.clone(),
            task_type,
            status: LongTaskStatus::Running,
            started_at: now,
            last_heartbeat_at: now,
            ended_at: None,
            turn_count: 0,
            current_tool: None,
            current_phase: None,
            checkpoint: initial_checkpoint,
            meta,
        };

        // 写入内存
        {
            let mut active = self.active_task.lock().await;
            *active = Some(record.clone());
        }

        // 重置标志
        self.cancel_flag.store(false, Ordering::SeqCst);
        *self.checkpoint_dirty.lock().await = false;
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;

        info!(
            "LongTaskManager: 启动长任务 {}（类型: {:?}, prompt: {}...）",
            record.task_id,
            record.task_type,
            record.meta.prompt.chars().take(50).collect::<String>()
        );

        record
    }

    /// 更新 checkpoint（事件驱动，由 `turn_end` / `tool_execution_end` 触发）
    ///
    /// # 参数
    /// - `progress_turn_count`：可选的轮次更新
    /// - `progress_current_tool`：可选的当前工具名更新
    /// - `progress_current_phase`：可选的当前阶段标签更新
    /// - `new_checkpoint`：新的 checkpoint 快照（由 `CheckpointProvider` 获取）
    ///
    /// # 行为
    /// 1. 仅当活跃任务存在且 status=Running 时更新
    /// 2. 更新进度字段
    /// 3. 替换 checkpoint，标记 dirty=true
    /// 4. 持久化由心跳定时器节流（5s 一次），避免频繁写入
    pub async fn checkpoint(
        &self,
        progress_turn_count: Option<u32>,
        progress_current_tool: Option<String>,
        progress_current_phase: Option<String>,
        new_checkpoint: LongTaskCheckpoint,
    ) {
        let mut active = self.active_task.lock().await;
        let Some(record) = active.as_mut() else {
            return;
        };
        if record.status != LongTaskStatus::Running {
            return;
        }

        if let Some(tc) = progress_turn_count {
            record.turn_count = tc;
        }
        if let Some(tool) = progress_current_tool {
            record.current_tool = Some(tool);
        }
        if let Some(phase) = progress_current_phase {
            record.current_phase = Some(phase);
        }

        record.checkpoint = new_checkpoint;
        drop(active); // 释放锁再获取 dirty 锁，避免死锁

        *self.checkpoint_dirty.lock().await = true;
    }

    /// 标记任务完成
    ///
    /// # 行为
    /// 1. 设置 status=Completed, ended_at=now
    /// 2. 停止心跳定时器
    /// 3. 清空内存（record 已持久化由调用方负责）
    /// 4. 重置标志
    ///
    /// # 返回
    /// 完成后的 `LongTaskRecord`（含 ended_at），供调用方持久化；若无可恢复任务返回 None
    pub async fn complete_task(&self) -> Option<LongTaskRecord> {
        let mut active = self.active_task.lock().await;
        let Some(mut record) = active.take() else {
            return None;
        };
        record.status = LongTaskStatus::Completed;
        record.ended_at = Some(Utc::now());

        self.stop_heartbeat_internal().await;
        *self.checkpoint_dirty.lock().await = false;
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
        self.cancel_flag.store(false, Ordering::SeqCst);

        info!(
            "LongTaskManager: 任务完成 {}（轮次: {}, 耗时: {}s）",
            record.task_id,
            record.turn_count,
            record
                .ended_at
                .map(|t| (t - record.started_at).num_seconds())
                .unwrap_or(0)
        );

        Some(record)
    }

    /// 标记任务失败
    pub async fn fail_task(&self, error: &str) -> Option<LongTaskRecord> {
        let mut active = self.active_task.lock().await;
        let Some(mut record) = active.take() else {
            return None;
        };
        record.status = LongTaskStatus::Failed;
        record.ended_at = Some(Utc::now());

        self.stop_heartbeat_internal().await;
        *self.checkpoint_dirty.lock().await = false;
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
        self.cancel_flag.store(false, Ordering::SeqCst);

        warn!(
            "LongTaskManager: 任务失败 {}: {}",
            record.task_id, error
        );

        Some(record)
    }

    /// 标记任务已取消（协作式取消完成后调用）
    ///
    /// 区别于 `request_cancel`（设 flag）：此函数在 ReAct 循环实际停止后调用，
    /// 将状态从 Running 转为 Cancelled。
    pub async fn cancel_task(&self) -> Option<LongTaskRecord> {
        let mut active = self.active_task.lock().await;
        let Some(mut record) = active.take() else {
            return None;
        };
        record.status = LongTaskStatus::Cancelled;
        record.ended_at = Some(Utc::now());

        self.stop_heartbeat_internal().await;
        *self.checkpoint_dirty.lock().await = false;
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
        self.cancel_flag.store(false, Ordering::SeqCst);

        info!(
            "LongTaskManager: 任务已取消 {}（轮次: {}）",
            record.task_id, record.turn_count
        );

        Some(record)
    }

    /// 请求协作式取消（设 flag，不强制终止）
    ///
    /// ReAct 循环在每轮迭代开始检查 `is_cancel_requested()`，
    /// 等当前 tool call 完成后优雅停止。
    pub fn request_cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
        debug!("LongTaskManager: 已请求协作式取消");
    }

    /// 检查是否已请求取消
    ///
    /// ReAct 循环每轮迭代开始调用此方法，若返回 true 则优雅停止。
    pub fn is_cancel_requested(&self) -> bool {
        self.cancel_flag.load(Ordering::SeqCst)
    }

    /// 标记任务可重试失败（Loop Engineering 阶段 2.6 新增）
    ///
    /// 与 `fail_task` 的区别：
    /// - `fail_task`：永久失败，设 `ended_at`，状态转 Failed
    /// - `retry_task`：可重试失败，**不设 `ended_at`**，状态保持 Running，
    ///   保留 checkpoint 供 AgentLoop 决定是否重试
    ///
    /// # 行为
    /// 1. 仅当活跃任务存在且 status=Running 时更新
    /// 2. 将错误信息记录到 `current_phase`（前缀 "retry:"）
    /// 3. 标记 checkpoint dirty 以便持久化最新状态
    ///
    /// # 返回
    /// 当前 `LongTaskRecord` 的克隆（含最新 checkpoint），供调用方决定是否重试。
    /// 若无可重试任务返回 None。
    ///
    /// # 使用场景
    /// AgentLoop 在 LLM/tool 调用失败时调用此方法，然后查询 `LoopController::retry_policy`
    /// 决定是否重试。若重试，调用 `clear_retry_marker` 清除标记后继续循环；
    /// 若不重试，调用 `fail_task` 转为永久失败。
    pub async fn retry_task(&self, error: &str) -> Option<LongTaskRecord> {
        {
            let mut active = self.active_task.lock().await;
            let Some(record) = active.as_mut() else {
                return None;
            };
            if record.status != LongTaskStatus::Running {
                return None;
            }
            // 不改变 status，仅记录错误到 current_phase
            // 截断过长的错误信息避免 current_phase 字段膨胀
            let error_preview: String = error.chars().take(100).collect();
            record.current_phase = Some(format!("retry: {}", error_preview));
        }
        // 标记 dirty 以便持久化
        *self.checkpoint_dirty.lock().await = true;

        let record_clone = self.active_task.lock().await.clone();
        debug!(
            "LongTaskManager: 任务标记可重试失败 {}: {}",
            record_clone.as_ref()?.task_id,
            error
        );
        record_clone
    }

    /// 清除重试标记（Loop Engineering 阶段 2.6 新增）
    ///
    /// 在 AgentLoop 决定重试并准备继续循环时调用，
    /// 清除 `retry_task` 设置的 `current_phase` 标记。
    pub async fn clear_retry_marker(&self) {
        let mut active = self.active_task.lock().await;
        let Some(record) = active.as_mut() else {
            return;
        };
        if record.status != LongTaskStatus::Running {
            return;
        }
        // 仅清除 retry: 前缀的 phase，保留其他 phase
        if let Some(phase) = &record.current_phase {
            if phase.starts_with("retry:") {
                record.current_phase = None;
            }
        }
    }

    /// 记录速率限制状态（Loop Engineering 阶段 2.6 新增）
    ///
    /// 由 AgentLoop 在每轮检查 `LoopController::rate_limiter` 后调用，
    /// 将 rate_limit 状态记录到 `current_phase` 字段，便于持久化与 UI 展示。
    ///
    /// # 参数
    /// - `status`：rate_limit 状态描述（如 "turns: 50/100" / "tokens: 45000/100000"）
    ///
    /// # 行为
    /// 1. 仅当活跃任务存在且 status=Running 时更新
    /// 2. 更新 `current_phase` 字段（前缀 "rate_limit:"）
    /// 3. 不标记 dirty（避免频繁持久化，由心跳定时器节流）
    pub async fn record_rate_limit_status(&self, status: &str) {
        let mut active = self.active_task.lock().await;
        let Some(record) = active.as_mut() else {
            return;
        };
        if record.status != LongTaskStatus::Running {
            return;
        }
        record.current_phase = Some(format!("rate_limit: {}", status));
    }

    /// 接管已持久化的长任务（断点恢复用）
    ///
    /// 应用重载后，从 SQLite 恢复 Running 任务到内存：
    /// - 设置 active_task（内存状态）
    /// - 重置 cancel_flag、heartbeat_status
    /// - 重启心跳定时器
    ///
    /// 复用持久化的 task_id，不创建新任务。
    pub async fn resume_task(&self, record: LongTaskRecord) {
        // 若已有活跃任务，警告（不抢占）
        {
            let active = self.active_task.lock().await;
            if let Some(existing) = active.as_ref() {
                warn!(
                    "LongTaskManager.resume_task: 已有活跃任务 {}，将被覆盖",
                    existing.task_id
                );
            }
        }

        let mut record = record;
        record.last_heartbeat_at = Utc::now();

        info!(
            "LongTaskManager: 恢复长任务 {}（轮次: {}, 已运行: {}s）",
            record.task_id,
            record.turn_count,
            (Utc::now() - record.started_at).num_seconds()
        );

        {
            let mut active = self.active_task.lock().await;
            *active = Some(record);
        }
        self.cancel_flag.store(false, Ordering::SeqCst);
        *self.checkpoint_dirty.lock().await = false;
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
    }

    /// 获取当前活跃任务的快照（只读克隆）
    pub async fn get_active_task(&self) -> Option<LongTaskRecord> {
        self.active_task.lock().await.clone()
    }

    /// 获取当前活跃任务 ID
    pub async fn get_active_task_id(&self) -> Option<String> {
        self.active_task
            .lock()
            .await
            .as_ref()
            .filter(|r| r.status == LongTaskStatus::Running)
            .map(|r| r.task_id.clone())
    }

    /// 获取心跳状态
    pub async fn get_heartbeat_status(&self) -> HeartbeatStatus {
        *self.heartbeat_status.read().await
    }

    /// 是否有活跃任务
    pub async fn has_active_task(&self) -> bool {
        self.active_task
            .lock()
            .await
            .as_ref()
            .map(|r| r.status == LongTaskStatus::Running)
            .unwrap_or(false)
    }

    /// 是否有脏 checkpoint 待持久化
    pub async fn is_checkpoint_dirty(&self) -> bool {
        *self.checkpoint_dirty.lock().await
    }

    /// 清除 checkpoint 脏标记（持久化完成后调用）
    pub async fn clear_checkpoint_dirty(&self) {
        *self.checkpoint_dirty.lock().await = false;
    }

    /// 更新心跳时间（心跳定时器调用）
    ///
    /// # 行为
    /// 1. 仅当活跃任务存在且 status=Running 时更新
    /// 2. 更新 `last_heartbeat_at`
    /// 3. 重算 heartbeat_status
    pub async fn update_heartbeat(&self) {
        let mut active = self.active_task.lock().await;
        let Some(record) = active.as_mut() else {
            *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
            return;
        };
        if record.status != LongTaskStatus::Running {
            *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
            return;
        }
        record.last_heartbeat_at = Utc::now();
        // Alive（刚更新心跳）
        *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
    }

    /// 重算心跳状态（不更新 last_heartbeat_at）
    ///
    /// 用于 UI 查询时根据 `last_heartbeat_at` 计算当前状态。
    pub async fn refresh_heartbeat_status(&self) {
        let active = self.active_task.lock().await;
        let Some(record) = active.as_ref() else {
            *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
            return;
        };
        if record.status != LongTaskStatus::Running {
            *self.heartbeat_status.write().await = HeartbeatStatus::Alive;
            return;
        }
        let elapsed = Utc::now() - record.last_heartbeat_at;
        let new_status = if elapsed > HEARTBEAT_DEAD_THRESHOLD {
            HeartbeatStatus::Dead
        } else if elapsed > HEARTBEAT_STALE_THRESHOLD {
            HeartbeatStatus::Stale
        } else {
            HeartbeatStatus::Alive
        };
        *self.heartbeat_status.write().await = new_status;
    }

    /// 启动心跳定时器
    ///
    /// # 参数
    /// - `manager_arc`：`LongTaskManager` 的 Arc 句柄（让 spawn 闭包能持有 Manager 引用，
    ///   从而在每次 tick 时读取内存状态决定 tick 类型）
    /// - `on_tick`：心跳 tick 回调（用于持久化脏 checkpoint / 更新 SQLite 心跳时间）
    ///
    /// # 行为
    /// - 每 `HEARTBEAT_INTERVAL` 触发一次：
    ///   1. 调用 `update_heartbeat()` 更新内存心跳时间
    ///   2. 若 `is_checkpoint_dirty()`：构造 `CheckpointFlush` tick（含完整 record）调用 `on_tick`，
    ///      然后清除 dirty 标记
    ///   3. 否则：构造 `HeartbeatOnly` tick（仅 task_id + last_heartbeat_at）调用 `on_tick`
    /// - 任务完成/失败/取消时通过 `stop_heartbeat_internal` 停止
    ///
    /// # 设计说明
    /// - **为何需要 `manager_arc` 参数**：spawn 出来的定时器 task 需要异步访问 Manager 的
    ///   `is_checkpoint_dirty` / `get_active_task` / `clear_checkpoint_dirty` 等方法，
    ///   这些方法都是 `&self`，需要持有 Arc 引用才能在 spawn 闭包中调用。
    ///   调用方（通常是 `AgentLoop::start_long_task_heartbeat`）通过
    ///   `Arc::clone(&manager)` 传入。
    /// - **不直接持有 `Arc<dyn LongTaskRepository>`**：避免 agent-runtime crate 依赖
    ///   rusqlite，保持 crate 解耦。持久化逻辑由 `on_tick` 回调注入。
    pub async fn start_heartbeat<F, Fut>(&self, manager_arc: Arc<Self>, on_tick: F)
    where
        F: Fn(HeartbeatTick) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = ()> + Send,
    {
        // 停止已有定时器
        self.stop_heartbeat_internal().await;

        let task_id_opt = self.get_active_task_id().await;
        let Some(task_id) = task_id_opt else {
            warn!("LongTaskManager.start_heartbeat: 无活跃任务，不启动定时器");
            return;
        };

        // clone 一份给 spawn 闭包，原 task_id 留给日志使用
        // （避免 async move 闭包捕获 task_id 后，spawn 之后的日志行无法再借用）
        let task_id_for_spawn = task_id.clone();
        let handle = tokio::spawn(async move {
            let mut interval = tokio::time::interval(HEARTBEAT_INTERVAL);
            // 跳过第一次立即触发（避免刚 start_task 就写心跳）
            interval.tick().await;

            loop {
                interval.tick().await;

                // 1. 更新内存心跳时间（重算 heartbeat_status）
                manager_arc.update_heartbeat().await;

                // 2. 根据 dirty 状态决定 tick 类型
                if manager_arc.is_checkpoint_dirty().await {
                    // 脏 checkpoint：拉取完整 record 构造 CheckpointFlush
                    if let Some(record) = manager_arc.get_active_task().await {
                        let tick = HeartbeatTick::CheckpointFlush {
                            task_id: task_id_for_spawn.clone(),
                            record,
                        };
                        on_tick(tick).await;
                        // 持久化完成后清除 dirty 标记
                        manager_arc.clear_checkpoint_dirty().await;
                    }
                } else {
                    // 无脏 checkpoint：仅更新心跳时间
                    let tick = HeartbeatTick::HeartbeatOnly {
                        task_id: task_id_for_spawn.clone(),
                        last_heartbeat_at: Utc::now(),
                    };
                    on_tick(tick).await;
                }
            }
        });

        *self.heartbeat_handle.lock().await = Some(handle);
        debug!("LongTaskManager: 心跳定时器已启动（task_id={}）", task_id);
    }

    /// 停止心跳定时器（内部方法）
    async fn stop_heartbeat_internal(&self) {
        let mut handle_guard = self.heartbeat_handle.lock().await;
        if let Some(handle) = handle_guard.take() {
            handle.abort();
            debug!("LongTaskManager: 心跳定时器已停止");
        }
    }

    /// 外部停止心跳定时器（用于 dispose）
    pub async fn stop_heartbeat(&self) {
        self.stop_heartbeat_internal().await;
    }
}

impl Default for LongTaskManager {
    fn default() -> Self {
        Self::new()
    }
}

// ─── HeartbeatTick ────────────────────────────────────────────

/// 心跳 tick 事件（传递给持久化回调）
///
/// 通过枚举区分两种 tick：
/// - `HeartbeatOnly`：仅更新 `last_heartbeat_at`（轻量写入）
/// - `CheckpointFlush`：完整保存 record（含最新 checkpoint，重量级写入）
///
/// 调用方（Tauri 端 `LongTaskRepository`）根据类型选择不同 SQL。
#[derive(Debug, Clone)]
pub enum HeartbeatTick {
    /// 仅心跳更新（轻量）
    HeartbeatOnly {
        /// 任务 ID
        task_id: String,
        /// 新的心跳时间
        last_heartbeat_at: DateTime<Utc>,
    },
    /// Checkpoint flush（重量级，含完整 record）
    CheckpointFlush {
        /// 任务 ID
        task_id: String,
        /// 完整 record（含最新 checkpoint）
        record: LongTaskRecord,
    },
}

impl HeartbeatTick {
    // 注意：不再需要 `from_task` 占位方法。
    // 心跳定时器在 `LongTaskManager::start_heartbeat` 的 spawn 闭包内，
    // 通过 `manager_arc.is_checkpoint_dirty()` 直接决定构造 `HeartbeatOnly`
    // 还是 `CheckpointFlush`，无需占位 tick。
}

// ─── 测试 ────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MessageRole;

    fn make_test_checkpoint() -> LongTaskCheckpoint {
        LongTaskCheckpoint {
            agent_messages: vec![OrchestratorMessage {
                role: MessageRole::User,
                content: "test".into(),
                tool_calls: vec![],
                tool_call_id: None,
                meta: None,
            }],
            last_user_text: "test prompt".into(),
            skill_names: None,
            chat_mode: None,
            locked_chat_mode: None,
        }
    }

    #[tokio::test]
    async fn test_start_task_creates_running_record() {
        let manager = LongTaskManager::new();
        let record = manager
            .start_task(
                "test-1".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta {
                    prompt: "test prompt".into(),
                    ..Default::default()
                },
            )
            .await;

        assert_eq!(record.task_id, "test-1");
        assert_eq!(record.task_type, LongTaskType::MainAgent);
        assert_eq!(record.status, LongTaskStatus::Running);
        assert!(record.ended_at.is_none());
        assert!(manager.has_active_task().await);
    }

    #[tokio::test]
    async fn test_complete_task_sets_ended_at() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-2".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let completed = manager.complete_task().await;
        assert!(completed.is_some());
        let completed = completed.unwrap();
        assert_eq!(completed.status, LongTaskStatus::Completed);
        assert!(completed.ended_at.is_some());
        assert!(!manager.has_active_task().await);
    }

    #[tokio::test]
    async fn test_cancel_flag_cooperative() {
        let manager = LongTaskManager::new();
        assert!(!manager.is_cancel_requested());

        manager.request_cancel();
        assert!(manager.is_cancel_requested());

        // complete_task 后 flag 应被重置
        manager
            .start_task(
                "test-3".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;
        manager.request_cancel();
        assert!(manager.is_cancel_requested());

        manager.cancel_task().await;
        assert!(!manager.is_cancel_requested());
    }

    #[tokio::test]
    async fn test_checkpoint_updates_progress() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-4".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        let new_checkpoint = LongTaskCheckpoint {
            agent_messages: vec![],
            last_user_text: "updated".into(),
            skill_names: Some(vec!["skill1".into()]),
            chat_mode: Some("advanced".into()),
            locked_chat_mode: None,
        };

        manager
            .checkpoint(
                Some(5),
                Some("echo".into()),
                Some("executing".into()),
                new_checkpoint,
            )
            .await;

        let active = manager.get_active_task().await.unwrap();
        assert_eq!(active.turn_count, 5);
        assert_eq!(active.current_tool.as_deref(), Some("echo"));
        assert_eq!(active.current_phase.as_deref(), Some("executing"));
        assert!(manager.is_checkpoint_dirty().await);
    }

    #[tokio::test]
    async fn test_resume_task_keeps_task_id() {
        let manager = LongTaskManager::new();
        let original_record = LongTaskRecord {
            task_id: "resumed-1".into(),
            task_type: LongTaskType::MainAgent,
            status: LongTaskStatus::Running,
            started_at: Utc::now() - chrono::Duration::seconds(60),
            last_heartbeat_at: Utc::now() - chrono::Duration::seconds(30),
            ended_at: None,
            turn_count: 10,
            current_tool: Some("echo".into()),
            current_phase: None,
            checkpoint: make_test_checkpoint(),
            meta: LongTaskMeta::default(),
        };

        manager.resume_task(original_record.clone()).await;

        let active = manager.get_active_task().await.unwrap();
        assert_eq!(active.task_id, "resumed-1");
        assert_eq!(active.turn_count, 10);
        // last_heartbeat_at 应被更新为 now
        assert!(active.last_heartbeat_at > original_record.last_heartbeat_at);
    }

    #[tokio::test]
    async fn test_heartbeat_status_transitions() {
        let manager = LongTaskManager::new();
        manager
            .start_task(
                "test-5".into(),
                LongTaskType::MainAgent,
                make_test_checkpoint(),
                LongTaskMeta::default(),
            )
            .await;

        // 刚启动应为 Alive
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Alive);

        // 模拟长时间未心跳
        {
            let mut active = manager.active_task.lock().await;
            if let Some(record) = active.as_mut() {
                record.last_heartbeat_at = Utc::now() - chrono::Duration::seconds(60);
            }
        }
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Stale);

        // 模拟崩溃（超过 5min）
        {
            let mut active = manager.active_task.lock().await;
            if let Some(record) = active.as_mut() {
                record.last_heartbeat_at = Utc::now() - chrono::Duration::seconds(400);
            }
        }
        manager.refresh_heartbeat_status().await;
        assert_eq!(manager.get_heartbeat_status().await, HeartbeatStatus::Dead);
    }
}
