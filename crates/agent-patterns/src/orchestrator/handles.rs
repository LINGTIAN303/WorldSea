//! 通信层与记忆层句柄 — 节点看到的受控入口（设计 §8.5 / §7.3）
//!
//! 纪律（设计 3.5 纪律 2、7.3）：节点代码中禁止出现任何 Provider SDK 类型，
//! 一切 LLM 访问经 `ctx.llm`；记忆访问经 `ctx.memory`，禁止直连存储。
//!
//! 方法面按里程碑生长：M1 `complete`；M2 `propose_tool_call` / `react_step`
//! （Tool Use / ReAct 循环层）；classify / complete_stream 随 Router 与
//! 流式渲染需要再上（避免为不存在的调用者预建签名）。

use crate::orchestrator::error::{LlmError, MemoryError};
use crate::orchestrator::types::Usage;

/// 单轮补全请求
#[derive(Debug, Clone, Default)]
pub struct Request {
    /// system 提示（可空）
    pub system: String,
    /// user 输入
    pub user: String,
    /// 温度（None = 适配层默认）
    pub temperature: Option<f32>,
    /// 输出上限（None = 适配层默认）
    pub max_tokens: Option<u32>,
}

impl Request {
    pub fn new(system: impl Into<String>, user: impl Into<String>) -> Self {
        Self { system: system.into(), user: user.into(), temperature: None, max_tokens: None }
    }
}

/// 单轮补全响应
#[derive(Debug, Clone)]
pub struct Response {
    pub text: String,
    pub usage: Usage,
}

/// 上层节点看到的 LLM 统一入口（通信层对上的唯一界面，设计 §8.5）。
///
/// genai 适配改变的是「同一件事做得好不好、多少钱」，不改变「链路怎么走」——
/// 上层节点只认本 trait，换 Provider/加降级零改动（设计 8.4 影响面）。
///
/// 方法集按「上层实际用法」抽象（设计 8.5 说明）：complete 为 M1 面；
/// propose_tool_call / react_step 为 M2 循环层（Tool Use / ReAct）按需上，
/// 默认实现返回 Fatal——未支持该用法的句柄在其节点中会显式失败而非静默。
#[async_trait::async_trait]
pub trait LlmHandle: Send + Sync {
    /// 单轮补全（Single Agent、Reflection 的 actor/critic 等）
    async fn complete(&self, req: &Request) -> Result<Response, LlmError>;

    /// 工具调用意图（Tool Use 协议循环的 propose，设计 §5.6）
    async fn propose_tool_call(
        &self,
        _intent: &str,
        _tools: &crate::orchestrator::tools::ToolSpecSet,
        _history: &[(crate::orchestrator::tools::ToolCall, crate::orchestrator::tools::Observation)],
    ) -> Result<crate::orchestrator::tools::ToolProposal, LlmError> {
        Err(LlmError::Fatal("该 LlmHandle 未实现 propose_tool_call".into()))
    }

    /// ReAct 单步（思考 + 行动选择，设计 §5.2）
    async fn react_step(
        &self,
        _trace: &[crate::orchestrator::tools::TraceEntry],
        _tools: &crate::orchestrator::tools::ToolSpecSet,
    ) -> Result<crate::orchestrator::tools::ReactStep, LlmError> {
        Err(LlmError::Fatal("该 LlmHandle 未实现 react_step".into()))
    }
}

/// 四层记忆的层标识（设计 §7.2 表 7-1：按生命周期从短到长、抽象度从低到高）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MemLayer {
    /// 工作记忆：当前任务的黑板窗口（单任务）
    Working,
    /// 情景记忆：会话历史（单会话）
    Episodic,
    /// 语义记忆：代码库与项目知识（跨会话）
    Semantic,
    /// 程序性记忆：技能与策略库（跨会话）
    Procedural,
}

/// 记忆条目（M1 最小形态；M4 接入：serde 供 LayeredMemoryStore 快照持久化）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MemEntry {
    pub layer: MemLayer,
    pub key: String,
    pub content: String,
}

/// 记忆统一入口：所有节点经 `ctx.memory` 访问（设计 §7.3）。
///
/// 集成纪律：`before`/`after` 由**执行器**调用（钩子统一挂），节点不自调钩子；
/// 节点内主动读写走 `recall`/`store`。记忆不改变路由——图结构变化永远是
/// 节点的 `Spawn` 请求（设计 7.3 集成纪律末条）。
#[async_trait::async_trait]
pub trait MemoryHandle: Send + Sync {
    /// before 钩子（执行器调用）：按节点画像取回相关记忆，注入节点视图
    async fn before(&self, node: &str) -> Result<Vec<MemEntry>, MemoryError> {
        let _ = node;
        Ok(Vec::new())
    }

    /// after 钩子（执行器调用）：沉淀节点产出中有长期价值的增量
    async fn after(&self, node: &str, note: MemEntry) -> Result<(), MemoryError> {
        let _ = (node, note);
        Ok(())
    }

    /// 主动检索：按查询召回跨层相关条目（节点内直接调用）
    async fn recall(&self, _query: &str) -> Result<Vec<MemEntry>, MemoryError> {
        Ok(Vec::new())
    }

    /// 主动写入：节点内直接写入指定层
    async fn store(&self, _entry: MemEntry) -> Result<(), MemoryError> {
        Ok(())
    }
}

/// 空实现：M1 验收与单测的默认记忆层（before/after/recall/store 全空转）
#[derive(Debug, Clone, Copy, Default)]
pub struct NoopMemory;

#[async_trait::async_trait]
impl MemoryHandle for NoopMemory {}

/// 测试支撑：桩 LLM 与脚本化 LLM（仅 test 配置编译）
#[cfg(test)]
pub mod test_support {
    use super::*;

    /// 恒空响应（graph/executor 单测的占位句柄）
    pub struct NullLlm;

    #[async_trait::async_trait]
    impl LlmHandle for NullLlm {
        async fn complete(&self, _req: &Request) -> Result<Response, LlmError> {
            Ok(Response { text: String::new(), usage: Usage::default() })
        }
    }

    /// 脚本化 LLM：按调用序回放预设响应（第 N 次调用取第 N 条，越界回放最后一条）
    pub struct ScriptedLlm {
        pub script: std::sync::Mutex<Vec<Response>>,
        pub calls: std::sync::Mutex<Vec<Request>>,
    }

    impl ScriptedLlm {
        pub fn new(responses: Vec<Response>) -> Self {
            Self { script: std::sync::Mutex::new(responses), calls: std::sync::Mutex::new(Vec::new()) }
        }

        pub fn of_texts(texts: &[&str]) -> Self {
            Self::new(
                texts
                    .iter()
                    .map(|t| Response { text: t.to_string(), usage: Usage::of(10, 20) })
                    .collect(),
            )
        }

        pub fn call_count(&self) -> usize {
            self.calls.lock().unwrap().len()
        }
    }

    #[async_trait::async_trait]
    impl LlmHandle for ScriptedLlm {
        async fn complete(&self, req: &Request) -> Result<Response, LlmError> {
            self.calls.lock().unwrap().push(req.clone());
            let mut script = self.script.lock().unwrap();
            if script.is_empty() {
                return Err(LlmError::Fatal("脚本耗尽".into()));
            }
            Ok(if script.len() == 1 { script[0].clone() } else { script.remove(0) })
        }
    }
}
