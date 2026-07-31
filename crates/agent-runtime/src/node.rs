//! # 节点接口
//!
//! 对应 TS 版 `OrchestratorNode` 接口与 `NodeContext`。
//! 所有编排模式（ReAct/Plan/Reflection/...）都实现 `OrchestratorNode` trait。

use async_trait::async_trait;

use crate::backend::NodeBackendAccessor;
use crate::event::OrchestratorEvent;
use crate::memory::MemoryAccessor;
use crate::types::OrchestratorState;

// ─── 节点类型 ────────────────────────────────────

/// 节点类型枚举（对应 TS 版 `NodeType`）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NodeType {
    /// ReAct 循环（基础工具调用）
    React,
    /// 生成计划
    Plan,
    /// 执行计划项
    Execute,
    /// 评审
    Reflection,
    /// 自我优化
    Refine,
    /// 路由
    Router,
    /// 监督者
    Supervisor,
    /// 子 Agent
    SubAgent,
    /// Tree of Thoughts 思维节点
    Thought,
    /// Graph of Thoughts 思维图节点（阶段 2.2 新增）
    ///
    /// 与 `Thought` 区分：GoT 支持多 parent 聚合，ToT 仅支持单 parent 树扩展。
    Graph,
    /// Multi-Agent 协作节点（阶段 2.3 新增）
    ///
    /// 去中心化对等协作：N 个 AgentLoop 通过 mpsc 通道 + SharedBlackboard 协作。
    /// 与 `Supervisor` 区分：Supervisor 是中心化调度，MultiAgent 是对等通信。
    MultiAgent,
    /// 记忆读写
    Memory,
    /// 自定义
    Custom,
}

impl NodeType {
    /// 转为字符串标识（用于序列化/日志）
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::React => "react",
            Self::Plan => "plan",
            Self::Execute => "execute",
            Self::Reflection => "reflection",
            Self::Refine => "refine",
            Self::Router => "router",
            Self::Supervisor => "supervisor",
            Self::SubAgent => "sub-agent",
            Self::Thought => "thought",
            Self::Graph => "graph",
            Self::MultiAgent => "multi-agent",
            Self::Memory => "memory",
            Self::Custom => "custom",
        }
    }
}

// ─── 节点执行结果 ────────────────────────────────────

/// 节点执行结果
#[derive(Debug, Clone)]
pub struct NodeResult {
    /// 状态
    pub status: NodeStatus,
    /// 下一个要执行的节点 ID（status=Continue 时有效，None=默认顺序）
    pub next_node_id: Option<String>,
    /// 错误信息（status=Error 时）
    pub error: Option<String>,
    /// 节点输出的摘要（用于日志/调试）
    pub summary: Option<String>,
}

impl NodeResult {
    /// 创建 Continue 结果
    pub fn continue_next() -> Self {
        Self {
            status: NodeStatus::Continue,
            next_node_id: None,
            error: None,
            summary: None,
        }
    }

    /// 创建 Continue 结果（指定下一节点）
    pub fn continue_to(node_id: impl Into<String>) -> Self {
        Self {
            status: NodeStatus::Continue,
            next_node_id: Some(node_id.into()),
            error: None,
            summary: None,
        }
    }

    /// 创建 Done 结果
    pub fn done() -> Self {
        Self {
            status: NodeStatus::Done,
            next_node_id: None,
            error: None,
            summary: None,
        }
    }

    /// 创建 Done 结果（带摘要）
    pub fn done_with_summary(summary: impl Into<String>) -> Self {
        Self {
            status: NodeStatus::Done,
            next_node_id: None,
            error: None,
            summary: Some(summary.into()),
        }
    }

    /// 创建 Aborted 结果
    pub fn aborted() -> Self {
        Self {
            status: NodeStatus::Aborted,
            next_node_id: None,
            error: None,
            summary: None,
        }
    }

    /// 创建 Error 结果
    pub fn error(message: impl Into<String>) -> Self {
        Self {
            status: NodeStatus::Error,
            next_node_id: None,
            error: Some(message.into()),
            summary: None,
        }
    }
}

/// 节点执行状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeStatus {
    /// 继续（按图执行下一节点）
    Continue,
    /// 完成（编排结束）
    Done,
    /// 中断（被外部 abort）
    Aborted,
    /// 错误
    Error,
}

// ─── 节点执行上下文 ────────────────────────────────────

/// 节点执行上下文 — 传入 `OrchestratorNode::execute` 的运行时环境
///
/// 提供：
/// - `state` 读写（通过 `Arc<RwLock<OrchestratorState>>`）
/// - 事件发射（与 `AgentEvent` 兼容）
/// - 中断检查（支持 Loop Engineering 的中断/恢复）
/// - LLM 后端访问（节点可通过 `backend` 调用 LLM）
/// - 记忆访问（可选，未注入时节点应优雅降级）
pub struct NodeContext<'a> {
    /// 共享状态
    pub state: &'a mut OrchestratorState,
    /// LLM 后端访问器
    pub backend: &'a dyn NodeBackendAccessor,
    /// 记忆访问器（可选）
    pub memory: Option<&'a dyn MemoryAccessor>,
    /// 事件发射器
    pub emitter: &'a dyn EventEmitter,
    /// 中断检查器
    pub abort_check: &'a dyn AbortCheck,
}

/// 事件发射器 trait（用于 NodeContext.emit）
pub trait EventEmitter: Send + Sync {
    /// 发射事件（推送给前端）
    fn emit(&self, event: OrchestratorEvent);
}

/// 中断检查器 trait（用于 NodeContext.is_aborted / wait_if_paused）
#[async_trait]
pub trait AbortCheck: Send + Sync {
    /// 检查是否被中断（返回 true 时节点应尽快返回）
    fn is_aborted(&self) -> bool;

    /// 等待恢复（被中断后挂起，恢复后 resolve）
    async fn wait_if_paused(&self);
}

impl<'a> NodeContext<'a> {
    /// 发射事件
    pub fn emit(&self, event: OrchestratorEvent) {
        self.emitter.emit(event);
    }

    /// 检查是否被中断
    pub fn is_aborted(&self) -> bool {
        self.abort_check.is_aborted()
    }

    /// 等待恢复
    pub async fn wait_if_paused(&self) {
        self.abort_check.wait_if_paused().await;
    }

    /// 日志（调试用）
    pub fn log(&self, level: LogLevel, message: &str, data: Option<&serde_json::Value>) {
        match level {
            LogLevel::Debug => tracing::debug!(message, data = ?data),
            LogLevel::Info => tracing::info!(message, data = ?data),
            LogLevel::Warn => tracing::warn!(message, data = ?data),
            LogLevel::Error => tracing::error!(message, data = ?data),
        }
    }
}

/// 日志级别
#[derive(Debug, Clone, Copy)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

// ─── 节点 trait ────────────────────────────────────

/// 节点接口 — 所有编排模式的基础构建块
///
/// 实现示例：
/// - `ReactNode`：包装 ReAct 循环
/// - `PlanNode`：生成任务计划
/// - `ExecuteNode`：逐步执行计划项
/// - `ReflectionNode`：评审输出
/// - `RefineNode`：基于评审迭代优化
/// - `RouterNode`：根据输入路由到不同节点
/// - `SupervisorNode`：分配任务给子 Agent
#[async_trait]
pub trait OrchestratorNode: Send + Sync {
    /// 节点唯一 ID
    fn id(&self) -> &str;

    /// 人类可读名称（调试/日志用）
    fn name(&self) -> &str;

    /// 节点类型标识
    fn node_type(&self) -> NodeType;

    /// 执行节点逻辑
    async fn execute<'a>(&'a self, ctx: NodeContext<'a>) -> NodeResult;

    /// 重置节点状态（Orchestrator 重新运行时调用）
    /// 默认实现为空（无状态节点无需重置）
    fn reset(&mut self) {}
}
