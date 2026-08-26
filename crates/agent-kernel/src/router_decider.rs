//! 发送链路由决策抽象（RouterDecider）— 底座侧接口，消除 kernel→patterns 反向依赖
//!
//! 背景（crate 拆分前置，matrix §8 里程碑 2）：`AgentLoop::run` 的发送链路路由织入
//! 原直接依赖 `patterns::router::RouterNode`，构成「底座 → 模式」反向依赖，使
//! `agent-kernel` 与 `agent-patterns` 无法物理拆分。本模块把「路由决策」抽象为
//! 底座侧 trait + 数据类型，`patterns::router::RouterNode` 实现该 trait 注入。
//!
//! - `Pipeline`：A3 四管线语义（Query/Research/Experiment/Compose），底座横切能力
//! - `RouterDecision`：决策结果（target_id/target_name/reason），与 patterns 的
//!   `RouteResult` 解耦（RouteResult 保留在 RouterNode::execute 节点路径）
//! - `RouterDecider`：决策接口，AgentLoop 依赖此 trait，不再依赖具体 RouterNode

use async_trait::async_trait;

use crate::backend::NodeBackendAccessor;

/// A3 四管线 — 发送链路路由的语义管线
///
/// 由 `patterns::router` 的四管线策略产出 target_id 后，AgentLoop 据此
/// 解析出执行指引（`directive`）追加到 system prompt。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pipeline {
    /// 查询：快速问答
    Query,
    /// 研究：多源检索/综述
    Research,
    /// 实验：代码/数据分析
    Experiment,
    /// 创作：写作/润色
    Compose,
}

impl Pipeline {
    /// 管线对应的路由目标 ID
    pub fn target_id(self) -> &'static str {
        match self {
            Self::Query => "query",
            Self::Research => "research",
            Self::Experiment => "experiment",
            Self::Compose => "compose",
        }
    }

    /// 管线人类可读标签
    pub fn label(self) -> &'static str {
        match self {
            Self::Query => "查询专家",
            Self::Research => "研究专家",
            Self::Experiment => "实验专家",
            Self::Compose => "创作专家",
        }
    }

    /// 管线对应的最大工具轮次（语义提示，供未来接入 AgentLoop 时动态调整 MAX_ROUNDS）
    ///
    /// 与 OpenWorld 一致：Query=3（快问答）、Research/Experiment=10（深度/计算）、Compose=5（创作）。
    #[allow(dead_code)]
    pub fn max_tool_rounds(self) -> usize {
        match self {
            Self::Query => 3,
            Self::Research => 10,
            Self::Experiment => 10,
            Self::Compose => 5,
        }
    }

    /// 解析显式管线名（大小写不敏感），无效返回 `None`
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "query" => Some(Self::Query),
            "research" => Some(Self::Research),
            "experiment" => Some(Self::Experiment),
            "compose" => Some(Self::Compose),
            _ => None,
        }
    }

    /// 管线行为指引（追加到 system prompt，指导 Agent 处理方式）
    ///
    /// 供 AgentLoop 发送链路接入时，把路由决策转化为对本轮任务的执行指引。
    pub fn directive(self) -> &'static str {
        match self {
            Self::Query => {
                "本次任务按「查询」管线处理：快速、低开销地回答事实性问题，克制不必要的工具调用。"
            }
            Self::Research => {
                "本次任务按「研究」管线处理：可进行多步检索、多源整合，最后给出综述性结论。"
            }
            Self::Experiment => {
                "本次任务按「实验」管线处理：允许编写代码、分析数据、运行计算来验证或产出结果。"
            }
            Self::Compose => {
                "本次任务按「创作」管线处理：注重结构、文采与艺术联想性，产出高质量文本。"
            }
        }
    }
}

/// 发送链路路由决策结果 — `RouterDecider::decide` 的返回
///
/// 与 patterns::router 的 `RouteResult`（仅 target_id + reason）解耦：
/// 本类型补充 `target_name`（人类可读标签），供 AgentLoop 直接广播
/// `RouterDecisionMade` 事件，无需再查管线标签。
#[derive(Debug, Clone)]
pub struct RouterDecision {
    /// 被选中的路由目标 ID（如 "query"/"research"）
    pub target_id: String,
    /// 目标人类可读标签（如 "查询专家"）
    pub target_name: String,
    /// 决策理由（可选，LLM 策略会填充）
    pub reason: Option<String>,
}

/// 发送链路由决策接口 — AgentLoop 织入点依赖此 trait，而非具体 RouterNode
///
/// `patterns::router::RouterNode` 实现本 trait；外部也可实现自定义决策器注入。
/// 决策不产生 OrchestratorNode::execute 的事件/状态副作用（事件广播与
/// fallback 处理由调用方 AgentLoop 负责）。
#[async_trait]
pub trait RouterDecider: Send + Sync {
    /// 仅做路由决策，返回决策结果
    async fn decide(
        &self,
        input: &str,
        backend: &dyn NodeBackendAccessor,
    ) -> Result<RouterDecision, String>;

    /// 决策器 ID（日志/事件用）
    fn id(&self) -> String;
}