//! 节点执行上下文与治理视图（设计 §3.2 `NodeCtx` / §4.4 Spawn 通道）
//!
//! `NodeCtx` 是受控视图：节点只能经由它访问黑板 / LLM / 记忆 / 预算 / 取消，
//! 钩子由执行器统一挂（设计 4.2 说明 3：「受控执行」）。
//! 容器节点的动态子图请求通过 `pending` 字段呈递（设计 4.4：
//! 「节点声明挂接请求（ExecuteContext 内以 pending_subgraph 呈现）」）。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::orchestrator::blackboard::Blackboard;
use crate::orchestrator::error::MemoryError;
use crate::orchestrator::handles::{LlmHandle, MemEntry, MemoryHandle};
use crate::orchestrator::types::{NodeId, Usage};

/// 取消信号：治理层或用户中止时置位（设计 §3.2）。
/// 节点在长循环的每轮边界检查 `is_cancelled()`。
#[derive(Debug, Clone, Default)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// 本节点预算剩余视图（治理层注入，设计 §3.2）。
/// 只读：预算的累计与判定在执行器的预算门（4.2 第 5 步），节点无法篡改台账。
#[derive(Debug, Clone, Default)]
pub struct BudgetView {
    /// 本节点开始时已累计的用量
    pub used: Usage,
    /// 全链路上限（None = 不设限）
    pub cap: Option<Usage>,
}

impl BudgetView {
    /// 距上限的余量（不设限时返回 None）
    pub fn remaining(&self) -> Option<Usage> {
        let cap = self.cap?;
        Some(Usage {
            input_tokens: cap.input_tokens.saturating_sub(self.used.input_tokens),
            output_tokens: cap.output_tokens.saturating_sub(self.used.output_tokens),
            llm_calls: cap.llm_calls.saturating_sub(self.used.llm_calls),
        })
    }
}

/// 并发车道（设计 §4.4 车道模型）：车道内顺序执行、车道间并发，
/// 写入键按车道命名空间隔离（如 `ma.results.<lane>`），
/// 黑板以「车道分身 → 汇合合并」实现（车道间本就要求写隔离，设计 6.3）。
pub struct LaneSpec {
    pub id: String,
    pub graph: crate::orchestrator::graph::Graph,
}

/// 动态子图挂接请求（设计 §4.4）。
///
/// 容器节点（TOT 展开 / Supervisor 派发 / GoT 车道 / Multi-Agent 车道）执行中构造
/// 本请求并写入 `ctx.pending`；执行器在 `Spawn` 端口处理时挂接：
/// - `Single`：单图语义，子图完成后经 return_port_map 回到父图继续；
/// - `Lanes`：车道间并发执行（各自黑板分身），全部车道终局后按车道序合并黑板，
///   再以 return_port_map 回父图（汇合点语义由子图内 join 声明承担，§4.4）。
pub enum SubgraphRequest {
    Single {
        graph: crate::orchestrator::graph::Graph,
        /// 子图终止端口 → 视为父图的哪个端口继续（通常映射到 Out / Done）
        return_port_map: Vec<(crate::orchestrator::types::Port, crate::orchestrator::types::Port)>,
    },
    Lanes {
        /// 并发车道（≥1；车道内顺序、车道间并发，设计 §4.4 车道模型）
        lanes: Vec<LaneSpec>,
        return_port_map: Vec<(crate::orchestrator::types::Port, crate::orchestrator::types::Port)>,
    },
}

/// 节点执行上下文：受控视图（设计 §3.2）。
pub struct NodeCtx<'a> {
    /// 黑板：跨节点共享的任务状态（计划、轨迹、工件、评分）
    pub state: &'a mut Blackboard,
    /// LLM 统一入口（genai 适配层暴露的句柄）
    pub llm: &'a dyn LlmHandle,
    /// 记忆统一入口（四层记忆的读写句柄）
    pub memory: &'a dyn MemoryHandle,
    /// 本节点预算剩余视图（治理层注入）
    pub budget: BudgetView,
    /// 取消信号：治理层或用户中止时置位
    pub cancel: CancelToken,
    /// Spawn 通道：节点执行中填写的待挂子图请求（设计 4.4）
    pub pending: Option<SubgraphRequest>,
    /// before 钩子取回的记忆条目（执行器在 execute 前注入，节点可直接读）
    pub recalled: Vec<MemEntry>,
}

impl<'a> NodeCtx<'a> {
    /// 执行器构造节点上下文
    pub fn new(
        state: &'a mut Blackboard,
        llm: &'a dyn LlmHandle,
        memory: &'a dyn MemoryHandle,
        budget: BudgetView,
        cancel: CancelToken,
    ) -> Self {
        Self { state, llm, memory, budget, cancel, pending: None, recalled: Vec::new() }
    }

    /// 节点内主动检索记忆（集成纪律：主动读写走 recall/store，不自调钩子）
    pub async fn recall(&self, query: &str) -> Result<Vec<MemEntry>, MemoryError> {
        self.memory.recall(query).await
    }

    /// 节点内主动写入记忆
    pub async fn store(&self, entry: MemEntry) -> Result<(), MemoryError> {
        self.memory.store(entry).await
    }

    /// 记忆后置钩子的沉淀载荷由执行器从黑板键收集时使用：
    /// 节点若要显式沉淀，写入约定键 `mem.notes`（设计 表 3-1）
    pub fn note_for_memory(&mut self, content: impl Into<String>) {
        self.state.append("mem.notes", serde_json::json!({ "content": content.into() }));
    }
}

/// 记忆钩子的默认沉淀：after 阶段执行器从 `mem.notes` 取最新条目交 MemoryHandle。
/// （公开给 executor 复用，避免键名字符串散落）
pub fn latest_mem_note(state: &Blackboard) -> Option<String> {
    state
        .read("mem.notes")
        .and_then(|v| v.get("content").and_then(|c| c.as_str()).map(|s| s.to_string()))
}

/// 供执行器构造派生上下文时的记忆句柄空实现引用（CompositeNode M3 复用）
pub fn noop_memory() -> &'static dyn MemoryHandle {
    &crate::orchestrator::handles::NoopMemory
}

/// NodeId 的便捷构造（测试与图构建常用）
pub fn node_id(id: impl Into<String>) -> NodeId {
    id.into()
}
