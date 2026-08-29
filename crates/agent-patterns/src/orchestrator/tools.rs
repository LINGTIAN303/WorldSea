//! 工具域共享类型 — ToolSpec / ToolCall / Observation / ToolHandle（设计 §5.6）
//!
//! 工具以 `ToolSpec`（JSON schema）声明；工具结果以结构化 `Observation` 回填。
//! `ToolHandle` 是宿主侧的工具执行入口（沙箱策略 M2 最小化：由实现方自行保证
//! 超时/权限，框架层不重复包装）。

use serde::{Deserialize, Serialize};

use crate::orchestrator::error::NodeError;

/// 工具声明（JSON schema，经通信层转换为 Provider 的 function calling 格式，设计 8.3）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// 参数 JSON schema（对象形式）
    #[serde(default)]
    pub parameters: serde_json::Value,
}

/// 工具声明集合（本链路可用的工具面）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolSpecSet {
    pub specs: Vec<ToolSpec>,
}

impl ToolSpecSet {
    pub fn new(specs: Vec<ToolSpec>) -> Self {
        Self { specs }
    }

    pub fn get(&self, name: &str) -> Option<&ToolSpec> {
        self.specs.iter().find(|s| s.name == name)
    }

    pub fn names(&self) -> Vec<&str> {
        self.specs.iter().map(|s| s.name.as_str()).collect()
    }
}

/// 一次工具调用意图（LLM 产出，宿主执行）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolCall {
    /// 调用唯一 id（配对结果用）
    pub id: String,
    pub name: String,
    /// 参数（已解析的 JSON 值）
    pub arguments: serde_json::Value,
}

impl ToolCall {
    pub fn new(id: impl Into<String>, name: impl Into<String>, arguments: serde_json::Value) -> Self {
        Self { id: id.into(), name: name.into(), arguments }
    }
}

/// 工具执行的结构化观察结果（设计 §5.6：stdout/stderr/文件变更归一于此）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Observation {
    /// 是否成功（ReAct 的连续失败判定、CallRecord 的状态都以此为准）
    pub ok: bool,
    /// 结果文本（可读摘要）
    pub content: String,
}

impl Observation {
    pub fn ok(content: impl Into<String>) -> Self {
        Self { ok: true, content: content.into() }
    }

    pub fn failed(content: impl Into<String>) -> Self {
        Self { ok: false, content: content.into() }
    }
}

/// `tool.calls` 的只追加记录（设计 表 3-1；设计 §5.6 数据流）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallRecord {
    pub call: ToolCall,
    pub observation: Observation,
    /// 执行耗时（毫秒）
    pub duration_ms: u64,
}

/// 宿主侧工具执行入口（NodeCtx 之外以构造参数注入节点——
/// 工具面是节点画像的一部分：`ToolUseNode.tools` + `ToolUseNode.tool_handle`）
#[async_trait::async_trait]
pub trait ToolHandle: Send + Sync {
    /// 执行一次工具调用。瞬态失败返回 `Retryable`，永久失败返回 `Fatal`
    /// （执行器与循环节点据此分级处置，设计 4.5）。
    async fn invoke(&self, call: &ToolCall) -> Result<Observation, NodeError>;
}

/// ReAct 轨迹条目（`react.trace` 的只追加条目，设计 §5.2 数据流）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TraceEntry {
    /// 思考：基于轨迹提出下一步假设/行动
    Thought { text: String },
    /// 行动 + 观察：工具调用与其结果
    ActObs { call: ToolCall, observation: Observation },
}

/// Tool Use 的提案（`propose_tool_call` 的返回）：直接回答或发起调用
#[derive(Debug, Clone)]
pub enum Decision {
    /// 最终回答（协议循环自然终止）
    Answer(String),
    /// 发起一次工具调用
    Call(ToolCall),
}

#[derive(Debug, Clone)]
pub struct ToolProposal {
    pub decision: Decision,
    pub usage: crate::orchestrator::types::Usage,
}

/// ReAct 单步结果（`react_step` 的返回）：思考 + 行动选择（设计 §8.5）
#[derive(Debug, Clone)]
pub struct ReactStep {
    /// 本轮思考（写入轨迹；None 表示模型未显式给思考）
    pub thought: Option<String>,
    /// 行动（None + final_answer None = 异常步，节点按 Fatal 处理）
    pub action: Option<ToolCall>,
    /// 最终答案（自然终止信号，设计 5.2 终止条件①）
    pub final_answer: Option<String>,
    pub usage: crate::orchestrator::types::Usage,
}
