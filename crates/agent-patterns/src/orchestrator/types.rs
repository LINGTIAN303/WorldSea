//! 统一类型层 — 端口/节点结果/用量/快照/元信息（设计 §3.2）
//!
//! 数据与路由分离：`execute` 的产出物写入黑板（`ctx.state`），
//! `NodeResult` 只携带出口端口与用量元信息（设计 3.2 要点解读）。

use std::fmt;

/// 节点稳定标识（图内唯一；同名不同实例用实例后缀区分，设计 3.2）
pub type NodeId = String;

/// 图中每个节点可声明的端口。端口是边的路由目标：
/// 执行器根据 `NodeResult.port` 决定下一跳（设计 §3.2）。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Port {
    /// 默认出口（线性下沿）
    Out,
    /// 循环回边：回到本节点或上游节点再迭代
    Loop,
    /// 条件分支出口（Router/判定门使用）
    Branch(String),
    /// 子图/子任务派发出口（TOT 展开、Supervisor 派发使用）
    Spawn,
    /// 成功终局：交付并结束
    Done,
    /// 失败终局：携带错误标签结束（可被外层治理捕获）
    Fatal(String),
}

impl Port {
    /// 路由表键（Branch 携带标签参与匹配）
    pub fn key(&self) -> String {
        match self {
            Port::Out => "out".into(),
            Port::Loop => "loop".into(),
            Port::Branch(s) => format!("branch:{s}"),
            Port::Spawn => "spawn".into(),
            Port::Done => "done".into(),
            Port::Fatal(s) => format!("fatal:{s}"),
        }
    }
}

impl fmt::Display for Port {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.key())
    }
}

/// 增量用量（token / LLM 调用数），供预算门累计（设计 §3.2）。
///
/// 三个计数器均为饱和加法：单次溢出不会 panic，也不会回卷为负。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// LLM 调用次数（供「调用数预算」使用）
    pub llm_calls: u64,
}

impl Usage {
    pub fn of(input: u64, output: u64) -> Self {
        Self { input_tokens: input, output_tokens: output, llm_calls: 1 }
    }

    /// 饱和累加（设计 3.5 纪律 5：用量如实上报，执行器据此累计）
    pub fn saturating_add(&mut self, other: &Usage) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.llm_calls = self.llm_calls.saturating_add(other.llm_calls);
    }

    /// 是否超过给定上限（任一维度超限即超）
    pub fn exceeds(&self, cap: &Usage) -> bool {
        self.input_tokens > cap.input_tokens
            || self.output_tokens > cap.output_tokens
            || self.llm_calls > cap.llm_calls
    }
}

impl std::ops::Add for Usage {
    type Output = Usage;
    fn add(mut self, rhs: Usage) -> Usage {
        self.saturating_add(&rhs);
        self
    }
}

/// 节点自评：进度是否可观测（供治理层日志与心跳，设计 §3.2）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProgressNote {
    /// 达到轮次/步数上限（治理性完成）
    MaxTurns,
    /// 达到调用数上限（治理性完成）
    MaxCalls,
    /// 预算触发（治理性完成）
    Budget,
    /// 自由文本进度
    Note(String),
}

/// 节点执行结果：数据一律写入黑板，结果只携带路由与元信息（设计 §3.2）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeResult {
    /// 本节点的出口端口，执行器据此路由下一跳
    pub port: Port,
    /// 本次执行的增量用量（token/调用数），供预算门累计
    pub usage: Usage,
    /// 本节点自评：进度是否可观测（供治理层日志与心跳）
    pub progress: Option<ProgressNote>,
}

impl NodeResult {
    /// 直通成功结果
    pub fn done(usage: Usage) -> Self {
        Self { port: Port::Done, usage, progress: None }
    }

    /// 治理性完成（达到上限，产出当前最好结果）
    pub fn governed_done(usage: Usage, note: ProgressNote) -> Self {
        Self { port: Port::Done, usage, progress: Some(note) }
    }
}

/// 节点快照：恢复所需的全部内部状态（设计 §3.2）。
/// 黑盒循环节点必须能在每轮迭代边界产出快照。
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct NodeSnapshot {
    /// 节点自定义的恢复载荷（如 ReAct 的轨迹、TOT 的树状态）
    pub payload: serde_json::Value,
}

/// 节点元信息：模式来源、端口规格、资源画像（设计 §3.2）。
/// 执行器用于构图校验与治理日志。
#[derive(Debug, Clone)]
pub struct NodeMeta {
    /// 模式来源（如 "single_agent" / "react" / "tot"）
    pub mode: &'static str,
    /// 人类可读名称
    pub title: String,
    /// 资源画像：预期是否执行 LLM 调用（供治理日志）
    pub llm_bound: bool,
}

impl NodeMeta {
    pub fn new(mode: &'static str, title: impl Into<String>) -> Self {
        Self { mode, title: title.into(), llm_bound: true }
    }

    pub fn without_llm(mode: &'static str, title: impl Into<String>) -> Self {
        Self { mode, title: title.into(), llm_bound: false }
    }
}
