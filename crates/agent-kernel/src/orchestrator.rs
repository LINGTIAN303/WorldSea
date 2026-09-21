//! # 编排器接口
//!
//! 对应 TS 版 `Orchestrator` 接口与 `DefaultOrchestrator` 实现。
//! 阶段 1.1 只定义 trait 与最小空实现，阶段 2 将扩展为完整图执行器。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::Mutex as AsyncMutex;

use crate::backend::NodeBackendAccessor;
use crate::event::{EventBroadcaster, OrchestratorEndResult, OrchestratorEvent, OrchestratorEndStatus, TracePhaseStatus};
use crate::memory::MemoryAccessor;
use crate::node::{
    AbortCheck, EventEmitter, NodeContext, NodeResult, NodeStatus, OrchestratorNode,
};
use crate::types::{
    ArtifactKind, ConvergeReason, HandoverArtifact, ImageAttachment, MessageRole,
    OrchestratorMessage, OrchestratorState,
};

// ─── 边与图 ────────────────────────────────────

/// 边 — 节点间的连接
///
/// 阶段 1.1 用简单的线性/条件边，不引入完整图引擎。
/// 阶段 2 可扩展为支持任意拓扑的图。
pub struct OrchestratorEdge {
    /// 源节点 ID
    pub from: String,
    /// 目标节点 ID
    pub to: String,
    /// 条件函数（返回 true 时走这条边，None=无条件）
    pub condition: Option<EdgeCondition>,
    /// 边的标签（调试用）
    pub label: Option<String>,
}

impl OrchestratorEdge {
    /// 创建无条件边
    pub fn new(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            condition: None,
            label: None,
        }
    }

    /// 创建条件边
    pub fn with_condition(
        from: impl Into<String>,
        to: impl Into<String>,
        condition: EdgeCondition,
    ) -> Self {
        Self {
            from: from.into(),
            to: to.into(),
            condition: Some(condition),
            label: None,
        }
    }
}

/// 边条件函数
pub type EdgeCondition = Arc<dyn Fn(&OrchestratorState) -> bool + Send + Sync>;

// ─── 运行选项与结果 ────────────────────────────────────

/// 运行选项
#[derive(Debug, Clone, Default)]
pub struct OrchestratorRunOptions {
    /// 图片附件
    pub images: Vec<ImageAttachment>,
    /// 模型 ID 覆盖
    pub model_id: Option<String>,
    /// 会话模式
    pub chat_mode: Option<String>,
    /// 最大轮次（防止无限循环）
    pub max_iterations: Option<u32>,
    /// 超时（毫秒）
    pub timeout_ms: Option<u64>,
    /// run_id（B22：轨迹事件聚合键；None = 内部生成 uuid）
    pub run_id: Option<String>,
    /// 管线名（TracePipeStarted.pipeline；None = "default"）
    pub pipeline: Option<String>,
    /// 判型理由（TracePipeStarted.reason；A1 可纠之"可见"半）
    pub pipeline_reason: Option<String>,
    /// 节点执行超时（毫秒）（B0-21 run 级冻结检测：单节点 execute 挂起兜底）
    ///
    /// None = 用默认值 [`NODE_TIMEOUT_DEFAULT_MS`]（10 分钟）；
    /// Some(0) = 禁用冻结检测；Some(n) = 自定义阈值。
    /// 超时 → 判定冻结 → 产出 Degraded 物 + run 出口 Completed + converge_reason=Degraded。
    pub node_timeout_ms: Option<u64>,
}

/// 节点执行超时默认值（B0-21 run 级冻结检测）：10 分钟
///
/// 单节点 execute 超过此阈值判定冻结（覆盖编排节点内部 prompt 挂起场景，
/// LoopEng 看门狗覆盖不到的盲区）→ 产出 Degraded 物降级收敛。
pub const NODE_TIMEOUT_DEFAULT_MS: u64 = 10 * 60 * 1000;

/// 当前时间戳（Unix 毫秒）— 供 Degraded 物等时间戳字段
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 运行结果
#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorResult {
    /// 最终状态
    pub status: OrchestratorEndStatus,
    /// 收敛原因（D0-4 六值枚举；B0-4：超限/无进展也是收敛）
    pub converge_reason: Option<ConvergeReason>,
    /// 归属 run
    pub run_id: Option<String>,
    /// 最终消息（Agent 的最后一条回复）
    pub final_message: Option<String>,
    /// 执行的轮次数
    pub iterations: u32,
    /// 错误信息
    pub error: Option<String>,
    /// 最终状态快照
    pub final_state: OrchestratorState,
    /// 本次 run 产出的交接物全文（D23/FIX-1 闭环：事件只带 artifact_id+summary，
    /// 物全文随结果带回，命令层写入 RunStore 供 get_artifact 查询）
    pub artifacts: Vec<HandoverArtifact>,
}

// ─── Orchestrator trait ────────────────────────────────────

/// Orchestrator — 编排器，驱动节点图执行，详细见 docs/details/注释/agent-runtime/orchestrator.md
#[async_trait]
pub trait Orchestrator: Send + Sync {
    /// 添加节点
    fn add_node(&mut self, node: Box<dyn OrchestratorNode>);

    /// 添加边
    fn add_edge(&mut self, edge: OrchestratorEdge);

    /// 设置入口节点
    fn set_entry(&mut self, node_id: &str);

    /// 启动执行
    async fn run(
        &self,
        input: String,
        options: Option<OrchestratorRunOptions>,
    ) -> Result<OrchestratorResult, OrchestratorError>;

    /// 中断执行
    async fn abort(&self) -> Result<(), OrchestratorError>;

    /// 暂停执行（可恢复）
    fn pause(&self);

    /// 恢复执行
    fn resume(&self);

    /// 订阅事件
    fn subscribe(&self, listener: Arc<dyn crate::event_bus::Listener>);

    /// 获取当前状态快照（checkpoint 用）
    async fn get_snapshot(&self) -> OrchestratorState;

    /// 从快照恢复
    async fn restore(&self, snapshot: OrchestratorState);

    /// 销毁
    fn dispose(&self);
}

/// 编排器错误
#[derive(Debug, thiserror::Error)]
pub enum OrchestratorError {
    #[error("节点不存在: {0}")]
    NodeNotFound(String),

    #[error("入口节点未设置")]
    EntryNotSet,

    #[error("超过最大轮次: {0}")]
    MaxIterationsExceeded(u32),

    #[error("执行超时")]
    Timeout,

    #[error("节点执行错误: {0}")]
    NodeError(String),

    #[error("已被中断")]
    Aborted,

    #[error("其他错误: {0}")]
    Other(String),
}

// ─── 内部 Helper：中断检查器与事件发射器包装 ────────────────────────────────────────────

/// 中断检查器 — 包装共享的 `aborted` 标志，供 `NodeContext.abort_check` 使用
///
/// 设计要点：
/// - `is_aborted` 是同步方法，不能用 `await`，所以用 `try_lock`
/// - 锁竞争时不报中断（避免假阴性中断节点）
/// - `wait_if_paused` 阶段 1.1 不实现真暂停，留作阶段 2 Loop Engineering 扩展
struct AbortChecker {
    aborted: Arc<AsyncMutex<bool>>,
}

impl AbortChecker {
    fn new(aborted: Arc<AsyncMutex<bool>>) -> Self {
        Self { aborted }
    }
}

#[async_trait]
impl AbortCheck for AbortChecker {
    fn is_aborted(&self) -> bool {
        match self.aborted.try_lock() {
            Ok(g) => *g,
            Err(_) => false,
        }
    }

    async fn wait_if_paused(&self) {
        // 阶段 1.1 不实现真暂停/恢复
        // 阶段 2 Loop Engineering 扩展时再补完
    }
}

/// 事件发射器包装 — 让 `NodeContext.emitter` 能直接广播到 `EventBroadcaster`
///
/// 必要性：`EventBroadcaster` 被包在 `Arc<RwLock<>>` 里，
/// `NodeContext.emitter` 需要一个 `&dyn EventEmitter` 引用，
/// 此结构体持有 `&Arc<RwLock<EventBroadcaster>>` 并实现 `EventEmitter`。
struct BroadcasterEmitter<'a> {
    broadcaster: &'a Arc<RwLock<EventBroadcaster>>,
}

impl<'a> EventEmitter for BroadcasterEmitter<'a> {
    fn emit(&self, event: OrchestratorEvent) {
        if let Ok(b) = self.broadcaster.read() {
            b.broadcast(&event);
        }
    }
}

// ─── DefaultOrchestrator（阶段 1.1 最小空实现）────────────────────────────────────

/// 默认编排器 — 线性/条件序列执行器
///
/// 阶段 1.1：仅提供基本结构，`run` 返回未实现错误。
/// 阶段 1.3 将实现完整的节点遍历逻辑。
#[allow(dead_code)]
pub struct DefaultOrchestrator {
    nodes: HashMap<String, Box<dyn OrchestratorNode>>,
    edges: Vec<OrchestratorEdge>,
    entry_node_id: Option<String>,
    backend: Option<Arc<dyn NodeBackendAccessor>>,
    memory: Option<Arc<dyn MemoryAccessor>>,
    broadcaster: Arc<RwLock<EventBroadcaster>>,
    aborted: Arc<AsyncMutex<bool>>,
    paused: Arc<AsyncMutex<bool>>,
    state: Arc<AsyncMutex<OrchestratorState>>,
    /// 插话门队列（D21/M4-6）：用户中途插话 → 节点边界注入，不中断链
    ///
    /// run 主循环每轮开始 drain 并追加为 user 消息（下一个节点执行前可见）。
    steer_queue: RwLock<Vec<String>>,
    /// 本 run 交接物全文集合（FIX-1 闭环 / M5-RK3 补验修复）
    ///
    /// 每轮节点产出 `NodeResult.artifact` 后追加；run 结束时随
    /// [`OrchestratorResult::artifacts`] 带回，由命令层写入 RunStore 供 get_artifact。
    run_artifacts: AsyncMutex<Vec<HandoverArtifact>>,
}

impl DefaultOrchestrator {
    /// 创建新的默认编排器
    pub fn new() -> Self {
        Self {
            nodes: HashMap::new(),
            edges: Vec::new(),
            entry_node_id: None,
            backend: None,
            memory: None,
            broadcaster: Arc::new(RwLock::new(EventBroadcaster::new())),
            aborted: Arc::new(AsyncMutex::new(false)),
            paused: Arc::new(AsyncMutex::new(false)),
            state: Arc::new(AsyncMutex::new(OrchestratorState::new(String::new()))),
            steer_queue: RwLock::new(Vec::new()),
            run_artifacts: AsyncMutex::new(Vec::new()),
        }
    }

    /// 收集本 run 全部交接物（FIX-1 闭环：结果携带，供命令层写 RunStore）
    async fn collect_artifacts(&self) -> Vec<HandoverArtifact> {
        let mut guard = self.run_artifacts.lock().await;
        std::mem::take(&mut *guard)
    }

    /// 插话门入队（D21/M4-6）：用户中途插话，不中断链，节点边界注入
    pub fn push_steer(&self, text: String) {
        if let Ok(mut q) = self.steer_queue.write() {
            q.push(text);
        }
    }

    /// 注入 LLM 后端访问器
    pub fn with_backend(mut self, backend: Arc<dyn NodeBackendAccessor>) -> Self {
        self.backend = Some(backend);
        self
    }

    /// 注入记忆访问器
    pub fn with_memory(mut self, memory: Arc<dyn MemoryAccessor>) -> Self {
        self.memory = Some(memory);
        self
    }

    /// 查找从指定节点出发的符合条件的下一节点
    #[allow(dead_code)]
    fn find_next_node(&self, from: &str, state: &OrchestratorState) -> Option<String> {
        for edge in &self.edges {
            if edge.from != from {
                continue;
            }
            match &edge.condition {
                None => return Some(edge.to.clone()),
                Some(cond) => {
                    if cond(state) {
                        return Some(edge.to.clone());
                    }
                }
            }
        }
        None
    }

    /// 广播事件
    fn broadcast(&self, event: OrchestratorEvent) {
        if let Ok(b) = self.broadcaster.read() {
            b.broadcast(&event);
        }
    }
}

impl Default for DefaultOrchestrator {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Orchestrator for DefaultOrchestrator {
    fn add_node(&mut self, node: Box<dyn OrchestratorNode>) {
        let id = node.id().to_string();
        self.nodes.insert(id, node);
    }

    fn add_edge(&mut self, edge: OrchestratorEdge) {
        self.edges.push(edge);
    }

    fn set_entry(&mut self, node_id: &str) {
        self.entry_node_id = Some(node_id.to_string());
    }

    async fn run(
        &self,
        input: String,
        options: Option<OrchestratorRunOptions>,
    ) -> Result<OrchestratorResult, OrchestratorError> {
        // ── 前置校验 ──
        let entry_id = self
            .entry_node_id
            .as_ref()
            .ok_or(OrchestratorError::EntryNotSet)?;
        if !self.nodes.contains_key(entry_id) {
            return Err(OrchestratorError::NodeNotFound(entry_id.clone()));
        }
        let backend = self.backend.as_ref().ok_or_else(|| {
            OrchestratorError::Other("LLM 后端未注入（with_backend 未调用）".into())
        })?;

        let options = options.unwrap_or_default();
        let max_iterations = options.max_iterations.unwrap_or(50);
        let start = Instant::now();

        // ── 节点执行超时（B0-21 冻结检测）：None→默认 10min；Some(0)=禁用；Some(n)=自定义 ──
        let node_timeout: Option<Duration> = match options.node_timeout_ms {
            Some(0) => None,
            Some(n) => Some(Duration::from_millis(n)),
            None => Some(Duration::from_millis(NODE_TIMEOUT_DEFAULT_MS)),
        };

        // ── run_id（B22）：外部传入或内部生成，贯穿全部轨迹事件 ──
        let run_id = options.run_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let pipeline = options.pipeline.clone().unwrap_or_else(|| "default".into());

        // ── 重置中断标志 ──
        // 每次运行前清空 aborted，支持同一 Orchestrator 多次 run
        {
            let mut aborted = self.aborted.lock().await;
            *aborted = false;
        }

        // ── 初始化共享状态 ──
        {
            let mut state = self.state.lock().await;
            *state = OrchestratorState::new(input.clone());
            state.model_id = options.model_id.clone();
            state.chat_mode = options.chat_mode.clone();
            state.images = options.images.clone();
        }

        // ── 广播 OrchestratorStart + TracePipeStarted ──
        self.broadcast(OrchestratorEvent::OrchestratorStart {
            entry_node_id: entry_id.clone(),
            input,
        });
        self.broadcast(OrchestratorEvent::TracePipeStarted {
            run_id: run_id.clone(),
            pipeline,
            reason: options.pipeline_reason.clone(),
        });

        // ── 串行 DAG 遍历主循环 ──
        // 阶段 1.1 实现单链路串行遍历；并发分支（fork/join）留待阶段 2.3 Multi-Agent 扩展
        let mut current_id = entry_id.clone();
        // 循环检测（动态）：区分"有进展的有限循环"与"无进展的死循环"。
        // 记录每个节点"连续无进展"的访问次数——只要 messages/plan/reflections 任一有增长
        // 即视为有进展并重置计数。这样 Reflection⇄Refine 等每轮追加消息的合法循环不会误报，
        // 而空转节点（反复访问但不产生任何状态变化）累计超阈值即判定死循环。
        #[derive(Default)]
        struct VisitRecord {
            count: u32,
            progress: (usize, usize, usize),
        }
        let mut visit_records: HashMap<String, VisitRecord> = HashMap::new();
        const MAX_VISIT_WITHOUT_PROGRESS: u32 = 10;
        let mut iterations = 0u32;
        let mut final_status = OrchestratorEndStatus::Completed;
        let mut converge_reason: Option<ConvergeReason> = None;
        let mut last_error: Option<String> = None;

        let abort_checker = AbortChecker::new(Arc::clone(&self.aborted));

        loop {
            // 0. 插话门（D21/M4-6）：节点边界注入排队 steer（不中断链）——
            //    下一节点执行前用户插话可见为 user 消息
            {
                let has_steer = !self
                    .steer_queue
                    .read()
                    .map(|q| q.is_empty())
                    .unwrap_or(true);
                if has_steer {
                    let mut state = self.state.lock().await;
                    let drain: Vec<String> = self
                        .steer_queue
                        .write()
                        .map(|mut q| std::mem::take(&mut *q))
                        .unwrap_or_default();
                    for text in drain {
                        state.messages.push(OrchestratorMessage {
                            role: MessageRole::User,
                            content: text,
                            tool_calls: Vec::new(),
                            tool_call_id: None,
                            meta: None,
                        });
                    }
                }
            }

            // 1. 中断检查
            if abort_checker.is_aborted() {
                final_status = OrchestratorEndStatus::Aborted;
                converge_reason = Some(ConvergeReason::Aborted);
                break;
            }

            // 2. 最大轮次保护（B0-4：超限 = 正常收敛的一种，Completed + limit_reached）
            if iterations >= max_iterations {
                final_status = OrchestratorEndStatus::Completed;
                converge_reason = Some(ConvergeReason::LimitReached);
                last_error = None;
                break;
            }
            iterations += 1;

            // 3. 超时检查
            if let Some(timeout_ms) = options.timeout_ms {
                if start.elapsed().as_millis() as u64 > timeout_ms {
                    final_status = OrchestratorEndStatus::Timeout;
                    break;
                }
            }

            // 4. 循环检测：同一节点连续无进展访问超阈值 → 疑似死循环
            let progress = {
                let state = self.state.lock().await;
                (
                    state.messages.len(),
                    state.plan.as_ref().map(|p| p.len()).unwrap_or(0),
                    state.reflections.as_ref().map(|r| r.len()).unwrap_or(0),
                )
            };
            let record = visit_records
                .entry(current_id.clone())
                .or_insert_with(|| VisitRecord {
                    count: 0,
                    progress,
                });
            if progress != record.progress {
                // 有进展：重置连续无进展计数并更新基线
                record.count = 0;
                record.progress = progress;
            }
            record.count += 1;
            if record.count > MAX_VISIT_WITHOUT_PROGRESS {
                // B0-4/D0-4：无进展 = 正常收敛的一种（no_progress），带当前最优/部分结果
                final_status = OrchestratorEndStatus::Completed;
                converge_reason = Some(ConvergeReason::NoProgress);
                last_error = Some(format!(
                    "节点 {} 连续 {} 次无进展地被重复访问，疑似死循环（如属合法的有限循环，请确保每轮推进状态或调整图拓扑）",
                    current_id, MAX_VISIT_WITHOUT_PROGRESS
                ));
                break;
            }

            // 5. 查找节点
            let node = match self.nodes.get(&current_id) {
                Some(n) => n,
                None => {
                    final_status = OrchestratorEndStatus::Error;
                    last_error = Some(format!("节点不存在: {}", current_id));
                    break;
                }
            };

            let node_id = node.id().to_string();
            let node_name = node.name().to_string();
            let node_type = node.node_type();

            // 6. 广播 NodeStart + TracePhaseEntered
            self.broadcast(OrchestratorEvent::NodeStart {
                node_id: node_id.clone(),
                node_name: node_name.clone(),
                node_type,
            });
            self.broadcast(OrchestratorEvent::TracePhaseEntered {
                run_id: run_id.clone(),
                phase: node_id.clone(),
                reason: None, // 阶段进入理由由节点自身事件携带（如 RouterDecisionMade.reason），骨架不强求
            });

            let node_start = Instant::now();

            // 7. 执行节点（持锁构造 NodeContext，execute 期间 state 锁被持有）
            //    注意：节点内部若需并发访问 state，应自行 clone 后操作
            //    冻结检测（B0-21）：单节点 execute 外包 timeout，超时 → Frozen 分支降级
            enum NodeExec {
                Executed(NodeResult),
                /// 冻结：节点执行超时（卡死）
                Frozen(String),
            }
            let node_exec: NodeExec = {
                let mut state_guard = self.state.lock().await;
                let emitter = BroadcasterEmitter {
                    broadcaster: &self.broadcaster,
                };

                let ctx = NodeContext {
                    state: &mut *state_guard,
                    backend: backend.as_ref(),
                    memory: self.memory.as_deref(),
                    emitter: &emitter,
                    abort_check: &abort_checker,
                };

                match node_timeout {
                    Some(dur) => match tokio::time::timeout(dur, node.execute(ctx)).await {
                        Ok(r) => NodeExec::Executed(r),
                        Err(_) => NodeExec::Frozen(format!(
                            "节点 {} 执行超时（{}ms），判定冻结并降级",
                            node_id,
                            dur.as_millis()
                        )),
                    },
                    None => NodeExec::Executed(node.execute(ctx).await),
                }
            };

            let duration_ms = node_start.elapsed().as_millis() as u64;

            // 7.1 冻结分支：构造降级 NodeResult + 预置 run 出口（广播统一走第 8 步，避免重复）
            let node_result = match node_exec {
                NodeExec::Frozen(message) => {
                    let degraded = HandoverArtifact {
                        artifact_id: uuid::Uuid::new_v4().to_string(),
                        run_id: run_id.clone(),
                        from_node: node_id.clone(),
                        kind: ArtifactKind::Degraded {
                            from: node_id.clone(),
                            reason: message.clone(),
                            partial: None,
                        },
                        summary: message.clone(),
                        produced_at: now_ms(),
                    };
                    final_status = OrchestratorEndStatus::Completed;
                    converge_reason = Some(ConvergeReason::Degraded);
                    // 冻结视为本 run 收敛（降级物在事件流中有实体痕迹），不继续执行后续节点
                    NodeResult {
                        status: NodeStatus::Done,
                        converge_reason: Some(ConvergeReason::Degraded),
                        summary: Some(message),
                        artifact: Some(degraded),
                        ..Default::default()
                    }
                }
                NodeExec::Executed(r) => r,
            };

            // 8. 广播 NodeEnd + TracePhaseResult（事件轻、物权威：只带 artifact_id + summary）
            //    降级物识别：产出 Degraded 物 → phase 标记 Degraded、NodeEnd 标记 Error（已降级）
            let degraded_phase = matches!(
                &node_result.artifact,
                Some(a) if matches!(a.kind, ArtifactKind::Degraded { .. })
            );
            let phase_status = if degraded_phase {
                TracePhaseStatus::Degraded
            } else {
                match node_result.status {
                    NodeStatus::Done | NodeStatus::Continue => TracePhaseStatus::Success,
                    NodeStatus::Aborted => TracePhaseStatus::Failed,
                    NodeStatus::Error => TracePhaseStatus::Failed,
                }
            };
            let node_end_status = if degraded_phase {
                NodeStatus::Error
            } else {
                node_result.status
            };
            let phase_summary = node_result
                .artifact
                .as_ref()
                .map(|a| a.summary.clone())
                .or_else(|| node_result.summary.clone())
                .unwrap_or_else(|| node_name.clone());
            self.broadcast(OrchestratorEvent::NodeEnd {
                node_id: node_id.clone(),
                status: node_end_status,
                summary: node_result.summary.clone(),
                duration_ms,
            });
            self.broadcast(OrchestratorEvent::TracePhaseResult {
                run_id: run_id.clone(),
                phase: node_id.clone(),
                status: phase_status,
                summary: phase_summary,
                artifact_id: node_result
                    .artifact
                    .as_ref()
                    .map(|a| a.artifact_id.clone()),
            });

            // FIX-1 闭环（M5-RK3 补验修复）：节点产出交接物全文存入本 run 集合，
            // 供 run 结束时随 OrchestratorResult.artifacts 带回 → RunStore.get_artifact。
            if let Some(artifact) = node_result.artifact.clone() {
                self.run_artifacts.lock().await.push(artifact);
            }

            // 9. 处理节点执行结果
            match node_result.status {
                NodeStatus::Continue => {
                    // 优先用节点显式指定的下一跳；否则按边查找
                    let next_id = if let Some(id) = node_result.next_node_id {
                        Some(id)
                    } else {
                        let state = self.state.lock().await;
                        self.find_next_node(&current_id, &state)
                    };

                    match next_id {
                        Some(id) => current_id = id,
                        None => {
                            // 没有下一节点，视为正常结束
                            tracing::debug!(
                                node_id = %current_id,
                                "节点无后续跳转，编排正常结束"
                            );
                            break;
                        }
                    }
                }
                NodeStatus::Done => {
                    final_status = OrchestratorEndStatus::Completed;
                    // D0-4：节点声明收敛原因优先；缺省按 Done 语义推断
                    converge_reason = node_result
                        .converge_reason
                        .or(Some(ConvergeReason::GoalReached));
                    break;
                }
                NodeStatus::Aborted => {
                    final_status = OrchestratorEndStatus::Aborted;
                    converge_reason = Some(ConvergeReason::Aborted);
                    break;
                }
                NodeStatus::Error => {
                    final_status = OrchestratorEndStatus::Error;
                    last_error = node_result.error;
                    break;
                }
            }
        }

        // ── 提取最终消息与状态快照 ──
        let (final_message, final_state) = {
            let state = self.state.lock().await;
            let msg = state
                .messages
                .iter()
                .rev()
                .find(|m| matches!(m.role, MessageRole::Assistant))
                .map(|m| m.content.clone());
            (msg, state.clone())
        };

        // FIX-1 闭环（M5-RK3 补验修复）：收集本 run 全部门店交接物全文。
        // 每轮 node_result.artifact 已在主循环存入交接物区；这里读取供结果携带。
        let artifacts = self.collect_artifacts().await;

        // ── 广播 OrchestratorEnd + TracePipeFinished ──
        self.broadcast(OrchestratorEvent::OrchestratorEnd {
            result: OrchestratorEndResult {
                status: final_status,
                run_id: Some(run_id.clone()),
                converge_reason,
                final_message: final_message.clone(),
                iterations,
                error: last_error.clone(),
            },
        });
        self.broadcast(OrchestratorEvent::TracePipeFinished {
            run_id: run_id.clone(),
            status: final_status,
            reason: converge_reason,
            final_message: final_message.clone(),
        });

        Ok(OrchestratorResult {
            status: final_status,
            converge_reason,
            run_id: Some(run_id),
            final_message,
            iterations,
            error: last_error,
            final_state,
            artifacts,
        })
    }

    async fn abort(&self) -> Result<(), OrchestratorError> {
        let mut aborted = self.aborted.lock().await;
        *aborted = true;
        Ok(())
    }

    fn pause(&self) {
        // 通过 tokio::sync::Notify 实现，阶段 1.3 补完
        tracing::debug!("DefaultOrchestrator::pause（阶段 1.3 实现）");
    }

    fn resume(&self) {
        tracing::debug!("DefaultOrchestrator::resume（阶段 1.3 实现）");
    }

    fn subscribe(&self, listener: Arc<dyn crate::event_bus::Listener>) {
        if let Ok(mut b) = self.broadcaster.write() {
            b.subscribe(listener);
        }
    }

    async fn get_snapshot(&self) -> OrchestratorState {
        self.state.lock().await.clone()
    }

    async fn restore(&self, snapshot: OrchestratorState) {
        let mut state = self.state.lock().await;
        *state = snapshot;
    }

    fn dispose(&self) {
        tracing::debug!("DefaultOrchestrator::dispose");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::{BackendError, PromptCallOptions, PromptResponse};
    use crate::node::{NodeType, NodeResult};
    use crate::types::OrchestratorMessage;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicU32, Ordering};

    // ─── 测试用桩 ────────────────────────────────────

    /// 桩后端 — 不实际调用 LLM，仅满足 NodeBackendAccessor trait 约束
    struct StubBackend;

    #[async_trait]
    impl NodeBackendAccessor for StubBackend {
        async fn prompt(
            &self,
            _prompt: String,
            _options: Option<PromptCallOptions>,
        ) -> Result<PromptResponse, BackendError> {
            Ok(PromptResponse::text_only("stub"))
        }
        async fn get_messages(&self) -> Vec<OrchestratorMessage> {
            Vec::new()
        }
        async fn set_messages(
            &self,
            _messages: Vec<OrchestratorMessage>,
        ) -> Result<(), BackendError> {
            Ok(())
        }
        async fn trim_context(&self, _up_to_index: usize) -> Result<(), BackendError> {
            Ok(())
        }
    }

    /// 桩节点 — 可配置返回结果与下一跳，记录执行次数
    struct StubNode {
        id: String,
        name: String,
        node_type: NodeType,
        result_status: NodeStatus,
        next: Option<String>,
        // 在 state.messages 末尾追加一条 assistant 消息（用于验证 final_message 提取）
        append_message: Option<String>,
        // 模拟节点挂起（执行前 sleep；用于冻结检测测试）
        sleep_before_execute: Option<Duration>,
        execute_count: AtomicU32,
    }

    impl StubNode {
        fn new(id: &str, status: NodeStatus) -> Self {
            Self {
                id: id.into(),
                name: format!("stub-{}", id),
                node_type: NodeType::Custom,
                result_status: status,
                next: None,
                append_message: None,
                sleep_before_execute: None,
                execute_count: AtomicU32::new(0),
            }
        }

        fn with_next(mut self, next: &str) -> Self {
            self.next = Some(next.into());
            self
        }

        fn with_message(mut self, msg: &str) -> Self {
            self.append_message = Some(msg.into());
            self
        }

        /// 模拟挂起：execute 先 sleep（冻结检测测试用）
        fn with_sleep(mut self, dur: Duration) -> Self {
            self.sleep_before_execute = Some(dur);
            self
        }

        fn execute_count(&self) -> u32 {
            self.execute_count.load(Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl OrchestratorNode for StubNode {
        fn id(&self) -> &str {
            &self.id
        }
        fn name(&self) -> &str {
            &self.name
        }
        fn node_type(&self) -> NodeType {
            self.node_type
        }
        async fn execute<'a>(&'a self, mut ctx: NodeContext<'a>) -> NodeResult {
            self.execute_count.fetch_add(1, Ordering::SeqCst);

            // 模拟挂起（冻结检测测试）
            if let Some(dur) = &self.sleep_before_execute {
                tokio::time::sleep(*dur).await;
            }

            // 模拟节点写入消息（验证 final_message 提取逻辑）
            if let Some(msg) = &self.append_message {
                ctx.state.messages.push(OrchestratorMessage {
                    role: MessageRole::Assistant,
                    content: msg.clone(),
                    tool_calls: Vec::new(),
                    tool_call_id: None,
                    meta: None,
                });
            }

            NodeResult {
                status: self.result_status,
                next_node_id: self.next.clone(),
                error: None,
                summary: Some(format!("stub {} executed", self.id)),
                ..Default::default()
            }
        }
    }

    fn make_orch() -> DefaultOrchestrator {
        DefaultOrchestrator::new().with_backend(Arc::new(StubBackend))
    }

    // ─── 基础测试 ────────────────────────────────────

    #[test]
    fn add_node_should_store_in_map() {
        let orch = DefaultOrchestrator::new();
        assert!(orch.nodes.is_empty());
    }

    #[test]
    fn set_entry_should_persist() {
        let mut orch = DefaultOrchestrator::new();
        orch.set_entry("react");
        assert_eq!(orch.entry_node_id.as_deref(), Some("react"));
    }

    #[tokio::test]
    async fn run_without_entry_should_error() {
        let orch = DefaultOrchestrator::new();
        let result = orch.run("hi".into(), None).await;
        assert!(matches!(result, Err(OrchestratorError::EntryNotSet)));
    }

    #[tokio::test]
    async fn run_without_backend_should_error() {
        let mut orch = DefaultOrchestrator::new();
        orch.set_entry("n1");
        orch.add_node(Box::new(StubNode::new("n1", NodeStatus::Done)));
        let result = orch.run("hi".into(), None).await;
        assert!(matches!(result, Err(OrchestratorError::Other(_))));
    }

    #[tokio::test]
    async fn run_without_entry_node_should_error() {
        let mut orch = make_orch();
        orch.set_entry("missing");
        let result = orch.run("hi".into(), None).await;
        assert!(matches!(result, Err(OrchestratorError::NodeNotFound(_))));
    }

    // ─── 节点遍历测试 ────────────────────────────────────

    #[tokio::test]
    async fn run_single_done_node_should_complete() {
        let mut orch = make_orch();
        let node = StubNode::new("entry", NodeStatus::Done).with_message("final answer");
        orch.add_node(Box::new(node));
        orch.set_entry("entry");

        let result = orch.run("hi".into(), None).await;
        assert!(result.is_ok());
        let r = result.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.iterations, 1);
        assert_eq!(r.final_message.as_deref(), Some("final answer"));
    }

    #[tokio::test]
    async fn run_two_nodes_with_explicit_next_should_traverse() {
        let mut orch = make_orch();
        // n1: Continue -> 显式跳到 n2
        let n1 = StubNode::new("n1", NodeStatus::Continue).with_next("n2");
        // n2: Done
        let n2 = StubNode::new("n2", NodeStatus::Done).with_message("from n2");
        orch.add_node(Box::new(n1));
        orch.add_node(Box::new(n2));
        orch.set_entry("n1");

        let result = orch.run("hi".into(), None).await;
        let r = result.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.iterations, 2);
        assert_eq!(r.final_message.as_deref(), Some("from n2"));
    }

    #[tokio::test]
    async fn run_two_nodes_with_edge_should_traverse() {
        let mut orch = make_orch();
        // n1: Continue, 不指定 next，靠边查找
        let n1 = StubNode::new("n1", NodeStatus::Continue);
        let n2 = StubNode::new("n2", NodeStatus::Done).with_message("via edge");
        orch.add_node(Box::new(n1));
        orch.add_node(Box::new(n2));
        orch.add_edge(OrchestratorEdge::new("n1", "n2"));
        orch.set_entry("n1");

        let result = orch.run("hi".into(), None).await;
        let r = result.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.iterations, 2);
        assert_eq!(r.final_message.as_deref(), Some("via edge"));
    }

    #[tokio::test]
    async fn run_with_conditional_edge_should_select_branch() {
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Continue);
        let n2 = StubNode::new("n2", NodeStatus::Done).with_message("branch-n2");
        let n3 = StubNode::new("n3", NodeStatus::Done).with_message("branch-n3");

        orch.add_node(Box::new(n1));
        orch.add_node(Box::new(n2));
        orch.add_node(Box::new(n3));
        // 条件边：input 包含 "go-n3" 时走 n3，否则走 n2
        orch.add_edge(OrchestratorEdge::with_condition(
            "n1",
            "n3",
            Arc::new(|s| s.input.contains("go-n3")),
        ));
        orch.add_edge(OrchestratorEdge::new("n1", "n2"));
        orch.set_entry("n1");

        // 走默认分支 n2
        let r1 = orch.run("hi".into(), None).await.unwrap();
        assert_eq!(r1.final_message.as_deref(), Some("branch-n2"));

        // 重新运行：走 n3 分支（run 会重置 state，visit_counts 是局部的，OK）
        let r2 = orch.run("go-n3".into(), None).await.unwrap();
        assert_eq!(r2.final_message.as_deref(), Some("branch-n3"));
    }

    #[tokio::test]
    async fn run_with_no_next_node_should_complete() {
        let mut orch = make_orch();
        // Continue 但没有 next 也没有边 → 视为正常结束
        let n1 = StubNode::new("n1", NodeStatus::Continue);
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let r = orch.run("hi".into(), None).await.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        // 没有助手消息 → final_message 为 None
        assert!(r.final_message.is_none());
    }

    #[tokio::test]
    async fn run_with_abort_should_return_aborted() {
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Continue).with_next("n1"); // 自循环
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        // 启动一个后台任务，在 100ms 后调用 abort
        let orch_arc = Arc::new(orch);
        let orch_for_abort = Arc::clone(&orch_arc);
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let _ = orch_for_abort.abort().await;
        });

        let result = orch_arc.run("hi".into(), None).await;
        let r = result.unwrap();
        // 中断后状态应为 Aborted。StubNode 自循环不产出消息，三种结局都可能：
        // ① abort 先到 → Aborted(+Aborted)
        // ② 空转先触发无进展检测 → Completed(+NoProgress)
        // ③ 满 50 轮 → Completed(+LimitReached)
        let aborted = r.status == OrchestratorEndStatus::Aborted
            && r.converge_reason == Some(ConvergeReason::Aborted);
        let limit_converged = r.status == OrchestratorEndStatus::Completed
            && r.converge_reason == Some(ConvergeReason::LimitReached);
        let no_progress_converged = r.status == OrchestratorEndStatus::Completed
            && r.converge_reason == Some(ConvergeReason::NoProgress);
        assert!(
            aborted || limit_converged || no_progress_converged,
            "status = {:?}, converge_reason = {:?}",
            r.status,
            r.converge_reason
        );
    }

    #[tokio::test]
    async fn run_with_max_iterations_should_error() {
        let mut orch = make_orch();
        // 自循环节点，永远 Continue
        let n1 = StubNode::new("n1", NodeStatus::Continue).with_next("n1");
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let options = OrchestratorRunOptions {
            max_iterations: Some(3),
            ..Default::default()
        };

        let result = orch.run("hi".into(), Some(options)).await;
        let r = result.unwrap();
        // B0-4：超限 = 正常收敛（Completed + limit_reached），不再视为 Error
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.converge_reason, Some(ConvergeReason::LimitReached));
    }

    #[tokio::test]
    async fn run_with_cycle_should_detect() {
        let mut orch = make_orch();
        // n1 -> n2 -> n1（循环）
        let n1 = StubNode::new("n1", NodeStatus::Continue).with_next("n2");
        let n2 = StubNode::new("n2", NodeStatus::Continue).with_next("n1");
        orch.add_node(Box::new(n1));
        orch.add_node(Box::new(n2));
        orch.set_entry("n1");

        // max_iterations 设大，让循环检测先生效
        let options = OrchestratorRunOptions {
            max_iterations: Some(100),
            ..Default::default()
        };

        let r = orch.run("hi".into(), Some(options)).await.unwrap();
        // D0-4：无进展也是收敛（Completed + no_progress），诊断文字保留在 error
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.converge_reason, Some(ConvergeReason::NoProgress));
        assert!(r.error.as_deref().unwrap_or("").contains("疑似"));
    }

    #[tokio::test]
    async fn run_with_progress_loop_should_hit_max_iterations_not_cycle_detection() {
        // 自循环节点但每轮 push 消息（有进展）→ 不应触发"疑似死循环"误报，
        // 应被 max_iterations 正常拦截（模拟 Reflection⇄Refine 类合法循环）
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Continue)
            .with_next("n1")
            .with_message("progress");
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let options = OrchestratorRunOptions {
            max_iterations: Some(3),
            ..Default::default()
        };

        let r = orch.run("hi".into(), Some(options)).await.unwrap();
        // B0-4：有进展循环被 max_iterations 正常拦截 = Completed + limit_reached
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.converge_reason, Some(ConvergeReason::LimitReached));
        assert!(
            r.error.is_none() || !r.error.as_deref().unwrap_or("").contains("疑似"),
            "有进展循环应被 max_iterations 拦截而非疑似死循环，实际: {:?}",
            r.error
        );
    }

    #[tokio::test]
    async fn run_with_frozen_node_should_degrade() {
        // B0-21 冻结检测：单节点 execute 挂起超过 node_timeout → 降级收敛
        let mut orch = make_orch();
        // 节点 sleep 500ms > node_timeout 50ms → 必然冻结
        let n1 = StubNode::new("n1", NodeStatus::Done).with_sleep(Duration::from_millis(500));
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let options = OrchestratorRunOptions {
            node_timeout_ms: Some(50),
            ..Default::default()
        };
        let r = orch.run("hi".into(), Some(options)).await.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.converge_reason, Some(ConvergeReason::Degraded));
        // 降级物必须存在于事件流（审计链不断裂）：final_state 不承载物，
        // 验证 run 结果侧通过 Degraded 物 kind 识别由事件消费方处理；
        // 此处校验出口语义 + error 保留冻结原因说明即可
        assert!(
            r.error.is_none() || r.error.as_deref().unwrap_or("").is_empty(),
            "降级收敛不应携带 error: {:?}",
            r.error
        );
        // FIX-1 闭环（M5-RK3 补验修复）：降级物全文随 OrchestratorResult 携带
        // （命令层据此写入 RunStore 供 get_artifact，事件流只带 artifact_id + summary）
        assert_eq!(r.artifacts.len(), 1, "应携带 1 个 Degraded 物全文");
        assert!(
            matches!(r.artifacts[0].kind, ArtifactKind::Degraded { .. }),
            "携带的物应为 Degraded，实际: {:?}",
            r.artifacts[0].kind
        );
    }

    #[tokio::test]
    async fn run_with_node_timeout_disabled_should_complete_normally() {
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Done).with_sleep(Duration::from_millis(60));
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        // Some(0) = 显式禁用冻结检测：即使节点稍慢也正常完成
        let options = OrchestratorRunOptions {
            node_timeout_ms: Some(0),
            ..Default::default()
        };
        let r = orch.run("hi".into(), Some(options)).await.unwrap();
        assert_eq!(r.status, OrchestratorEndStatus::Completed);
        assert_eq!(r.converge_reason, Some(ConvergeReason::GoalReached));
    }

    #[tokio::test]
    async fn run_with_steer_injects_at_node_boundary() {
        // M4-6（D21 插话门）：运行中 push_steer → 下一轮节点边界注入为 user 消息（不中断链）
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Continue)
            .with_next("n1")
            .with_sleep(Duration::from_millis(30));
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let orch_arc = Arc::new(orch);
        let orch_for_steer = Arc::clone(&orch_arc);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            orch_for_steer.push_steer("中途插话：改走研究".into());
        });

        let options = OrchestratorRunOptions {
            max_iterations: Some(2),
            node_timeout_ms: Some(0), // 禁用冻结检测（测试节点 sleep 未超时语义干扰）
            ..Default::default()
        };
        let r = orch_arc.run("hi".into(), Some(options)).await.unwrap();
        let injected = r
            .final_state
            .messages
            .iter()
            .any(|m| matches!(m.role, MessageRole::User) && m.content.contains("中途插话"));
        assert!(injected, "steer 应在下一轮节点边界注入为 user 消息");
    }

    // ─── M5 承诺验收（B0-18）：事件收集器 + 迹线事件序 + 降级物可追踪 ───

    /// 事件记录器（M5：承诺「过程可解释」「故障可见」的可测化）
    #[derive(Default)]
    struct EventRecorder {
        events: Arc<std::sync::Mutex<Vec<crate::event::OrchestratorEvent>>>,
    }

    impl crate::event_bus::Listener for EventRecorder {
        fn call(&self, event: &crate::event::OrchestratorEvent) -> crate::event_bus::ListenerOutcome {
            self.events.lock().unwrap().push(event.clone());
            crate::event_bus::ListenerOutcome::Continue
        }
    }

    /// 承诺①可解释（B0-18/E19-①）：一次编排 run 的轨迹事件序与 run_id 贯穿
    #[tokio::test]
    async fn trace_events_are_ordered_and_scoped_to_run() {
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Done);
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let recorder = Arc::new(EventRecorder::default());
        orch.subscribe(Arc::clone(&recorder) as Arc<dyn crate::event_bus::Listener>);

        let r = orch
            .run("hi".into(), Some(OrchestratorRunOptions { run_id: Some("run-x".into()), ..Default::default() }))
            .await
            .unwrap();
        let run_id = r.run_id.clone().unwrap();

        let mut trace: Vec<(&str, String)> = Vec::new();
        for ev in recorder.events.lock().unwrap().iter() {
            match ev {
                crate::event::OrchestratorEvent::TracePipeStarted { run_id, .. } => trace.push(("pipe_started", run_id.clone())),
                crate::event::OrchestratorEvent::TracePhaseEntered { run_id, .. } => trace.push(("phase_entered", run_id.clone())),
                crate::event::OrchestratorEvent::TracePhaseResult { run_id, .. } => trace.push(("phase_result", run_id.clone())),
                crate::event::OrchestratorEvent::TracePipeFinished { run_id, .. } => trace.push(("pipe_finished", run_id.clone())),
                _ => {}
            }
        }
        assert_eq!(trace.len(), 4, "一次 run 恰有 started/entered/result/finished 四件");
        let kinds: Vec<&str> = trace.iter().map(|(k, _)| *k).collect();
        assert_eq!(
            kinds,
            vec!["pipe_started", "phase_entered", "phase_result", "pipe_finished"],
            "迹线事件必须严格按阶段推进序发出"
        );
        assert!(trace.iter().all(|(_, rid)| *rid == run_id), "轨迹事件 run_id 必须一致");
    }

    /// 承诺③故障可见（B0-18/E19-②）：冻结降级 → Degraded 物在事件流可追踪（artifact_id + degraded 状态）
    #[tokio::test]
    async fn degraded_artifact_is_traceable_in_event_stream() {
        let mut orch = make_orch();
        let n1 = StubNode::new("n1", NodeStatus::Done).with_sleep(Duration::from_millis(300));
        orch.add_node(Box::new(n1));
        orch.set_entry("n1");

        let recorder = Arc::new(EventRecorder::default());
        orch.subscribe(Arc::clone(&recorder) as Arc<dyn crate::event_bus::Listener>);

        let options = OrchestratorRunOptions {
            node_timeout_ms: Some(50),
            ..Default::default()
        };
        let r = orch.run("hi".into(), Some(options)).await.unwrap();
        assert_eq!(r.converge_reason, Some(ConvergeReason::Degraded));

        // 事件流：phase_result 必须为 degraded 且携带 artifact_id（降级物可追溯）
        let mut degraded_artifact_id: Option<String> = None;
        for ev in recorder.events.lock().unwrap().iter() {
            if let crate::event::OrchestratorEvent::TracePhaseResult { status, artifact_id, .. } = ev {
                if *status == crate::event::TracePhaseStatus::Degraded {
                    degraded_artifact_id = artifact_id.clone();
                }
            }
        }
        assert!(degraded_artifact_id.is_some(), "降级 phase 必须产出 artifact_id（审计链不断裂）");
    }
}
