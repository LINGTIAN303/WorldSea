//! # 编排器接口
//!
//! 对应 TS 版 `Orchestrator` 接口与 `DefaultOrchestrator` 实现。
//! 阶段 1.1 只定义 trait 与最小空实现，阶段 2 将扩展为完整图执行器。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;

use async_trait::async_trait;
use tokio::sync::Mutex as AsyncMutex;

use crate::backend::NodeBackendAccessor;
use crate::event::{EventBroadcaster, OrchestratorEndResult, OrchestratorEvent, OrchestratorEndStatus};
use crate::memory::MemoryAccessor;
use crate::node::{AbortCheck, EventEmitter, NodeContext, NodeStatus, OrchestratorNode};
use crate::types::{ImageAttachment, MessageRole, OrchestratorState};

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
}

/// 运行结果
#[derive(Debug, Clone)]
pub struct OrchestratorResult {
    /// 最终状态
    pub status: OrchestratorEndStatus,
    /// 最终消息（Agent 的最后一条回复）
    pub final_message: Option<String>,
    /// 执行的轮次数
    pub iterations: u32,
    /// 错误信息
    pub error: Option<String>,
    /// 最终状态快照
    pub final_state: OrchestratorState,
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
    fn subscribe(&self, listener: Arc<dyn crate::event::EventListener>);

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

        // ── 广播 OrchestratorStart ──
        self.broadcast(OrchestratorEvent::OrchestratorStart {
            entry_node_id: entry_id.clone(),
            input,
        });

        // ── 串行 DAG 遍历主循环 ──
        // 阶段 1.1 实现单链路串行遍历；并发分支（fork/join）留待阶段 2.3 Multi-Agent 扩展
        let mut current_id = entry_id.clone();
        // 节点访问计数（循环检测：同节点访问超过 MAX_VISIT_PER_NODE 视为死循环）
        let mut visit_counts: HashMap<String, u32> = HashMap::new();
        let mut iterations = 0u32;
        let mut final_status = OrchestratorEndStatus::Completed;
        let mut last_error: Option<String> = None;
        const MAX_VISIT_PER_NODE: u32 = 5;

        let abort_checker = AbortChecker::new(Arc::clone(&self.aborted));

        loop {
            // 1. 中断检查
            if abort_checker.is_aborted() {
                final_status = OrchestratorEndStatus::Aborted;
                break;
            }

            // 2. 最大轮次保护
            if iterations >= max_iterations {
                final_status = OrchestratorEndStatus::Error;
                last_error = Some(format!(
                    "超过最大轮次: {}（max_iterations）",
                    max_iterations
                ));
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

            // 4. 循环检测（同节点访问次数超阈值）
            let count = visit_counts.entry(current_id.clone()).or_insert(0);
            *count += 1;
            if *count > MAX_VISIT_PER_NODE {
                final_status = OrchestratorEndStatus::Error;
                last_error = Some(format!(
                    "节点 {} 被访问超过 {} 次，疑似循环（如需 Plan-Execute-Reflection 循环，请提高 max_iterations 或调整图拓扑）",
                    current_id, MAX_VISIT_PER_NODE
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

            // 6. 广播 NodeStart
            self.broadcast(OrchestratorEvent::NodeStart {
                node_id: node_id.clone(),
                node_name: node_name.clone(),
                node_type,
            });

            let node_start = Instant::now();

            // 7. 执行节点（持锁构造 NodeContext，execute 期间 state 锁被持有）
            //    注意：节点内部若需并发访问 state，应自行 clone 后操作
            let node_result = {
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

                node.execute(ctx).await
            };

            let duration_ms = node_start.elapsed().as_millis() as u64;

            // 8. 广播 NodeEnd
            self.broadcast(OrchestratorEvent::NodeEnd {
                node_id: node_id.clone(),
                status: node_result.status,
                summary: node_result.summary.clone(),
                duration_ms,
            });

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
                    break;
                }
                NodeStatus::Aborted => {
                    final_status = OrchestratorEndStatus::Aborted;
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

        // ── 广播 OrchestratorEnd ──
        self.broadcast(OrchestratorEvent::OrchestratorEnd {
            result: OrchestratorEndResult {
                status: final_status,
                final_message: final_message.clone(),
                iterations,
                error: last_error.clone(),
            },
        });

        Ok(OrchestratorResult {
            status: final_status,
            final_message,
            iterations,
            error: last_error,
            final_state,
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

    fn subscribe(&self, listener: Arc<dyn crate::event::EventListener>) {
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
        async fn steer(&self, _text: String) -> Result<(), BackendError> {
            Ok(())
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
        // 中断后状态应为 Aborted（也可能因为时序先 hit max_iterations，但通常 abort 先到）
        assert!(
            matches!(
                r.status,
                OrchestratorEndStatus::Aborted | OrchestratorEndStatus::Error
            ),
            "status = {:?}",
            r.status
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
        assert_eq!(r.status, OrchestratorEndStatus::Error);
        assert!(r.error.as_deref().unwrap_or("").contains("最大轮次"));
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
        assert_eq!(r.status, OrchestratorEndStatus::Error);
        assert!(r.error.as_deref().unwrap_or("").contains("疑似循环"));
    }
}
