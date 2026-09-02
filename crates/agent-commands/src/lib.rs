//! agent-commands 命令层（服务层）：封装 AgentLoop 能力为 Tauri 可调用的命令服务，详细见 docs/details/注释/agent-commands/lib.md

mod error;
mod fs_tools;
mod long_task_store;
mod loop_control;
mod mock_backend;
mod pattern_registry;
mod pty;
mod run_store;
mod session_store;
mod subagent;
mod subagent_store;
mod terminal;

pub use error::CommandError;
pub use fs_tools::register_fs_tools;
pub use long_task_store::LongTaskRepository;
pub use loop_control::{
    LoopControlCheckResult, LoopControlEntry, LoopControlRegistry, LoopControlRegistryError,
    LoopControlStatus,
};
pub use mock_backend::{MockBackend, thinking_level_to_str};
pub use pattern_registry::{
    CapabilityGroup, PatternConfig, PatternRegistryEntry, get_pattern, list_patterns,
    pattern_registry, validate_registry,
};
pub use run_store::{DecisionRecord, OrchestrationRun, RunStatus, RunStore};
pub use session_store::{
    SessionKind, SessionRecord, SessionRepository, SqliteSessionRepository, WorkdirRecord,
    WorkspaceRecord,
};
pub use subagent::{register_subagent_tools, SubAgentInstanceInfo, SubAgentManager};
pub use subagent_store::{SqliteSubAgentSpecStore, SubAgentSpecStore};
pub use terminal::{register_terminal_tools, TerminalService};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_memory::MemoryCenterAccessor;
// B 轨统一骨架（S1 适配层：编排双轨收拢试点引擎；`b_rail` 前缀避免与 kernel 同名类型混淆）
use agent_patterns::orchestrator as b_rail;
use agent_runtime::agent::{AgentLoop, AgentLoopConfig, AgentState, AgentStateSnapshot};
use agent_runtime::backend::{NodeBackendAccessor, PromptCallOptions, ThinkingLevel};
use agent_runtime::confirmation::{ConfirmationBroker, ConfirmationPolicy};
use agent_runtime::event::{
    EventBroadcaster, EventListener, OrchestratorEndStatus, OrchestratorEvent, TracePhaseStatus,
};
use agent_runtime::llm::config::ProviderConfig as RuntimeProviderConfig;
use agent_runtime::llm::GenaiBackend;
use agent_runtime::long_task::HeartbeatStatus;
use agent_runtime::memory::MemoryAccessor;
use agent_runtime::memory::{
    ArchiveSource, MemoryArchiveResult, MemoryChunkContent, MemoryRecallOptions, MemoryRecallResult,
    RecallMode,
};
use agent_runtime::orchestrator::{
    DefaultOrchestrator, Orchestrator, OrchestratorError, OrchestratorResult,
    OrchestratorRunOptions,
};
use agent_runtime::scenario::{
    Scenario, ScenarioEntityProvider, ScenarioRegistry, WorldbuildingScenario,
};
use agent_runtime::router::{Pipeline, RouterConfig, RouterNode};
use agent_runtime::types::{
    ArtifactKind, ExecStatus, OrchestratorState, PlanItem, PlanItemStatus, StepResult, StepStatus,
};
// 编排 4 模式 UI 下沉：ToT / GoT / Supervisor 节点，用于构单节点编排图跑通前端口令
use agent_runtime::graph_of_thoughts::{GoTConfig, GoTNode};
use agent_runtime::multi_agent::{AgentSpec, MultiAgentConfig, MultiAgentNode, Topology};
use agent_runtime::supervisor::{SubAgentSpec, SupervisorConfig, SupervisorNode};
use agent_runtime::tree_of_thoughts::{ToTConfig, ToTNode};
use memory_center_core::model::ArchiveConfig;
use agent_runtime::tool::{SimpleToolBus, Tool, ToolBus};
use agent_runtime::types::{ConvergeReason, HandoverArtifact, MessageRole, OrchestratorMessage};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

// ─── 命令参数 / 返回类型 ────────────────────────────────────

/// 编排图运行参数（Plan→Execute→[Reflection→Refine]）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanExecuteOptions {
    /// 是否启用 Reflection/Self-Refine 循环（默认 false = 仅 Plan→Execute）
    #[serde(default)]
    pub refine: bool,
    /// 计划最大步骤数（默认 10）
    #[serde(default = "default_max_items")]
    pub max_items: usize,
    /// Reflection→Refine 最大迭代轮数（默认 3）
    #[serde(default = "default_max_refine_iterations")]
    pub max_refine_iterations: u32,
}

fn default_max_items() -> usize {
    10
}

fn default_max_refine_iterations() -> u32 {
    3
}

/// ToT（Tree of Thoughts）编排运行参数（可选项覆盖 `ToTConfig` 默认）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToTExecuteOptions {
    /// 最大深度（覆盖默认 5）
    #[serde(default)]
    pub max_depth: Option<usize>,
    /// Beam 宽度 — 每层保留 top-K（默认 3）
    #[serde(default)]
    pub beam_width: Option<usize>,
    /// 分支因子 — 每节点候选数（默认 3）
    #[serde(default)]
    pub branch_factor: Option<usize>,
    /// 最大节点数（默认 50）
    #[serde(default)]
    pub max_thoughts: Option<usize>,
    /// 节点执行超时（毫秒；M5 走查 ⑤ 触发 Degraded 用，B0-21）
    ///
    /// `None` = 默认 10 分钟；`Some(0)` = 禁用冻结检测；`Some(n)` = 自定义阈值。
    /// 超时 → 判定冻结 → 产出 Degraded 物 + run 出口 Completed + reason=degraded。
    #[serde(default)]
    pub node_timeout_ms: Option<u64>,
}

/// GoT（Graph of Thoughts）编排运行参数（复用 ToT 参数 + 聚合开关）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoTExecuteOptions {
    /// 基础 ToT 参数
    #[serde(flatten)]
    pub tot: ToTExecuteOptions,
    /// 是否启用聚合（默认 true）
    #[serde(default)]
    pub aggregation_enabled: Option<bool>,
}

impl GoTExecuteOptions {
    fn node_timeout_ms(&self) -> Option<u64> {
        self.tot.node_timeout_ms
    }
}

/// Supervisor 编排运行参数（子 Agent 规格 + 协调轮次）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupervisorExecuteOptions {
    /// 子 Agent 规格列表（委派目标）
    pub specs: Vec<SubAgentSpec>,
    /// 最大协调轮次（覆盖默认 1，多轮需 >1）
    #[serde(default)]
    pub max_rounds: Option<u32>,
    /// 节点执行超时（毫秒；M5 走查 ⑤ 触发 Degraded 用，B0-21）
    #[serde(default)]
    pub node_timeout_ms: Option<u64>,
}

/// Multi-Agent 编排运行参数（Agent 规格 + 拓扑 + 协作轮次）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiAgentExecuteOptions {
    /// 参与协作的 Agent 规格列表（必须含 system_prompt；建议首个配置 initial_message 启动协作）
    pub specs: Vec<AgentSpec>,
    /// 最大协作轮次（覆盖默认 10）
    #[serde(default)]
    pub max_rounds: Option<usize>,
    /// 拓扑结构（mesh/ring/star/pipeline；缺省 mesh）
    #[serde(default)]
    pub topology: Option<Topology>,
    /// 是否启用共享黑板（默认 true）
    #[serde(default)]
    pub blackboard_enabled: Option<bool>,
    /// 是否最后综合所有 Agent 输出（默认 true）
    #[serde(default)]
    pub require_synthesis: Option<bool>,
    /// 节点执行超时（毫秒；M5 走查 ⑤ 触发 Degraded 用，B0-21）
    #[serde(default)]
    pub node_timeout_ms: Option<u64>,
}

impl Default for MultiAgentExecuteOptions {
    fn default() -> Self {
        Self {
            specs: Vec::new(),
            max_rounds: None,
            topology: None,
            blackboard_enabled: None,
            require_synthesis: None,
            node_timeout_ms: None,
        }
    }
}

impl Default for PlanExecuteOptions {
    fn default() -> Self {
        Self {
            refine: false,
            max_items: default_max_items(),
            max_refine_iterations: default_max_refine_iterations(),
        }
    }
}

/// 事件转发监听器：把编排器事件转投到 AgentLoop 的广播器，
/// 使订阅会话事件的监听器（如 Tauri 事件桥）能收到 Plan/Reflection 进度。
///
/// 只读锁竞争时丢弃事件（不阻塞编排执行），与 AgentLoop 的 BackendEventBridge 同策略。
struct ForwardToAgentBroadcaster {
    target: Arc<RwLock<EventBroadcaster>>,
}

impl EventListener for ForwardToAgentBroadcaster {
    fn on_event(&self, event: &OrchestratorEvent) {
        if let Ok(b) = self.target.try_read() {
            b.broadcast(event);
        }
    }
}

// ═══ B 轨（统一骨架）Plan-and-Execute 试点引擎辅助层（S1 适配层）═══
// 编排双轨收拢试点：A/B 同契约（事件族 / run_store / 交接物），引擎切到
// `agent_patterns::orchestrator` 自持执行器。详见 04-方案「编排双轨收拢施工计划」。

/// B 轨计划生成提示（PlanExecuteNode.make_plan）
const B_RAIL_PLAN_PROMPT: &str = "你是任务规划者。请把用户任务拆解为可独立执行、结果可验收的步骤列表。";

/// 2026-09-02 统一待办：复杂任务引导提示（/plan 前缀与研究判型共用）——
/// 注入用户输入尾部走主 Agent react 链，模型用 plan_create 建待办并严格串行执行。
/// B 轨独立管线（run_plan_execute）自此退役不再触发（代码保留待后续清理）。
const PLAN_TODO_GUIDANCE: &str = "[执行方式] 这是一个复杂任务：请先用 plan_create 工具创建待办计划（把任务拆解为可独立验收的步骤），然后严格按串行规范推进——每步先 plan_update 设为 in_progress，执行该步骤的真实工作（调用 read_file/execute_command 等工具），完成后才设为 completed，再进行下一步；全部步骤完成后输出最终总结。";

/// B 轨步骤执行器工具化（2026-09-02）：
/// `BusToolHandle` 把 orchestrator 的 `ToolHandle`（ReAct 循环调用入口）桥接到
/// 会话的 kernel `ToolBus`，使计划步骤内真实执行工具（bash/read_file/write 等），
/// 并把工具调用广播为 kernel `ToolCallStart` / `ToolCallEnd` 事件——前端 turnModel
/// 据此把工具动作段归入当前激活的计划步骤（childRefIds），实现「步骤下跟动作行」。
struct BusToolHandle {
    /// 会话 ToolBus（与主 Agent 共享同一批工具）
    bus: Arc<dyn ToolBus>,
    /// 工具执行上下文（workdir 边界 / workspace_id / 流式 sink）
    ctx: agent_runtime::ToolContext,
    /// kernel 事件广播器（广播 ToolCallStart/End 供前端归入步骤）
    broadcaster: Arc<RwLock<EventBroadcaster>>,
}

#[async_trait::async_trait]
impl b_rail::ToolHandle for BusToolHandle {
    async fn invoke(&self, call: &b_rail::ToolCall) -> Result<b_rail::Observation, b_rail::NodeError> {
        let started = std::time::Instant::now();
        // 广播工具调用开始（前端据此建立工具动作段并入激活步骤的 childRefIds）
        if let Ok(b) = self.broadcaster.try_read() {
            b.broadcast(&OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallStart {
                tool_call_id: call.id.clone(),
                name: call.name.clone(),
                args: call.arguments.clone(),
            }));
        }
        let result = self.bus.call_tool_with_ctx(&call.name, &self.ctx, call.arguments.clone()).await;
        let duration_ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(value) => {
                let content = if value.is_null() {
                    "完成".to_string()
                } else {
                    value.to_string()
                };
                if let Ok(b) = self.broadcaster.try_read() {
                    b.broadcast(&OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallEnd {
                        tool_call_id: call.id.clone(),
                        result: value.clone(),
                        status: "success".to_string(),
                        duration_ms,
                        error: None,
                    }));
                }
                Ok(b_rail::Observation::ok(content))
            }
            Err(e) => {
                let message = e.to_string();
                if let Ok(b) = self.broadcaster.try_read() {
                    b.broadcast(&OrchestratorEvent::Agent(agent_runtime::event::AgentEvent::ToolCallEnd {
                        tool_call_id: call.id.clone(),
                        result: serde_json::json!({ "error": message }),
                        status: "failed".to_string(),
                        duration_ms,
                        error: Some(message.clone()),
                    }));
                }
                Ok(b_rail::Observation::failed(message))
            }
        }
    }
}

/// B 轨阶段状态 → kernel TracePhaseStatus（事件桥映射）
fn b_rail_phase_status_to_kernel(s: b_rail::PhaseStatus) -> TracePhaseStatus {
    match s {
        b_rail::PhaseStatus::Success => TracePhaseStatus::Success,
        b_rail::PhaseStatus::Degraded => TracePhaseStatus::Degraded,
        b_rail::PhaseStatus::Failed => TracePhaseStatus::Failed,
    }
}

/// B 轨 RunObserver → kernel Trace 事件族桥（S1 适配层）
///
/// 阶段进入/结果 → `TracePhaseEntered` / `TracePhaseResult`；
/// 终局 `TracePipeFinished` 由命令层收口时统一发（避免双发）。
struct BRailTraceBridge {
    target: Arc<RwLock<EventBroadcaster>>,
    run_id: String,
}

impl b_rail::RunObserver for BRailTraceBridge {
    fn on_phase(
        &self,
        _node_id: &str,
        phase: &str,
        status: Option<b_rail::PhaseStatus>,
        summary: &str,
    ) {
        if let Ok(b) = self.target.try_read() {
            match status {
                None => b.broadcast(&OrchestratorEvent::TracePhaseEntered {
                    run_id: self.run_id.clone(),
                    phase: phase.to_string(),
                    reason: None,
                }),
                Some(s) => b.broadcast(&OrchestratorEvent::TracePhaseResult {
                    run_id: self.run_id.clone(),
                    phase: phase.to_string(),
                    status: b_rail_phase_status_to_kernel(s),
                    summary: summary.to_string(),
                    artifact_id: None,
                }),
            }
        }
    }
}

/// B 轨终局 → kernel 收口三件（status / converge_reason / error + final_message）
fn b_rail_terminal(
    report: &b_rail::RunReport,
) -> (
    OrchestratorEndStatus,
    Option<ConvergeReason>,
    Option<String>,
    Option<String>,
) {
    match &report.reason {
        b_rail::TerminalReason::Done => (
            OrchestratorEndStatus::Completed,
            Some(ConvergeReason::GoalReached),
            report.result_text(),
            None,
        ),
        b_rail::TerminalReason::Fatal(e) => (
            OrchestratorEndStatus::Error,
            None,
            report.result_text(),
            Some(format!("{e}")),
        ),
        b_rail::TerminalReason::Governed(msg) => (
            OrchestratorEndStatus::Aborted,
            Some(ConvergeReason::Aborted),
            report.result_text(),
            Some(msg.clone()),
        ),
    }
}

/// B 轨终局黑板快照 → HandoverArtifact 翻译（S1 映射 Plan 物 + Execution 物，
/// 与 A 轨 FIX-1 闭环同语义：事件轻、物权威，get_artifact 可回查）
fn b_rail_artifacts(run_id: &str, report: &b_rail::RunReport) -> Vec<HandoverArtifact> {
    let mut artifacts = Vec::new();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    // Plan 物：黑板 pne.plan（追加语义 → 末元素为当前值）→ kernel PlanItem 列表
    if let Some(plan) = report
        .blackboard
        .get("pne.plan")
        .and_then(|v| v.as_array())
        .and_then(|a| a.last())
        .cloned()
    {
        if let Ok(plan) = serde_json::from_value::<b_rail::Plan>(plan) {
            let items: Vec<PlanItem> = plan
                .steps
                .iter()
                .enumerate()
                .map(|(i, step)| PlanItem {
                    id: format!("step-{i}"),
                    title: step.clone(),
                    description: None,
                    status: PlanItemStatus::Completed,
                    order: i as i32,
                    output: None,
                })
                .collect();
            let summary = format!("计划：{} 个步骤", items.len());
            artifacts.push(HandoverArtifact {
                artifact_id: format!("{run_id}-plan"),
                run_id: run_id.to_string(),
                from_node: "plan_execute".into(),
                kind: ArtifactKind::Plan(items),
                summary,
                produced_at: now,
            });
        }
    }
    // Execution 物：result.draft → 聚合单步骤（Fatal 时标 Failed）
    if let Some(draft) = report.result_text() {
        let failed = matches!(report.reason, b_rail::TerminalReason::Fatal(_));
        artifacts.push(HandoverArtifact {
            artifact_id: format!("{run_id}-execution"),
            run_id: run_id.to_string(),
            from_node: "execute".into(),
            kind: ArtifactKind::Execution {
                step_results: vec![StepResult {
                    step_id: "execute".into(),
                    title: "执行".into(),
                    output: Some(draft.clone()),
                    status: if failed { StepStatus::Failed } else { StepStatus::Completed },
                }],
                status: if failed { ExecStatus::Failed } else { ExecStatus::Completed },
            },
            summary: draft.chars().take(80).collect(),
            produced_at: now,
        });
    }
    artifacts
}

/// 归一化指定 run 的 Trace 事件序列（S2 对齐口径①；run_id 过滤 + 事件族降维）
///
/// 对齐语义 = **管线骨架形状**（用户拍板，2026-09-01）：LLM 拆分步骤数不同导致
/// execute 等阶段重复进入/退出属模型非确定性噪音，归一化时**折叠重复 phase**——
/// 每个 phase 只保留首次 `enter` 与末次 `result`，pipe_started/pipe_finished 恒保留。
/// 这样 A/B 轨只比对「管线走了哪些阶段、各自成败」，而非步骤轮次数。
#[cfg(test)]
fn normalize_trace_sequence(events: &[OrchestratorEvent], run_id: &str) -> Vec<String> {
    use std::collections::HashSet;
    let mut out: Vec<String> = Vec::new();
    let mut seen_enter: HashSet<String> = HashSet::new();
    // 末次 result 位置（phase → 索引），遍历后覆盖为同 phase 最后一次
    let mut last_result_idx: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    let mut result_phases: Vec<(String, String)> = Vec::new(); // (phase, status)
    let mut seen_pipe_started = false;
    let mut seen_pipe_finished = false;

    for e in events.iter() {
        match e {
            OrchestratorEvent::TracePipeStarted { run_id: rid, .. } if rid == run_id => {
                if !seen_pipe_started {
                    out.push("pipe_started".to_string());
                    seen_pipe_started = true;
                }
            }
            OrchestratorEvent::TracePhaseEntered { run_id: rid, phase, .. } if rid == run_id => {
                // 首次进入才保留（重复进入折叠）
                if seen_enter.insert(phase.clone()) {
                    out.push(format!("enter:{phase}"));
                }
            }
            OrchestratorEvent::TracePhaseResult { run_id: rid, phase, status, .. }
                if rid == run_id =>
            {
                // 同 phase 只保留末次 result（记录位置，结束后统一回填）
                let entry = format!("result:{phase}:{status:?}");
                match last_result_idx.get(phase) {
                    Some(&idx) => {
                        result_phases[idx] = (phase.clone(), entry);
                    }
                    None => {
                        last_result_idx.insert(phase.clone(), result_phases.len());
                        result_phases.push((phase.clone(), entry));
                    }
                }
            }
            OrchestratorEvent::TracePipeFinished { run_id: rid, .. } if rid == run_id => {
                if !seen_pipe_finished {
                    seen_pipe_finished = true;
                }
            }
            _ => {}
        }
    }
    // 把末次 result 插到对应 enter 之后（骨架顺序：enter 后跟该 phase 的末次 result）；
    // 无对应 enter 的 result（如测试构造的 execute 只有 result 无 enter）追加到 pipe_finished 前
    let mut result_by_phase: std::collections::HashMap<String, String> =
        result_phases.clone().into_iter().collect();
    let mut merged: Vec<String> = Vec::new();
    for item in &out {
        merged.push(item.clone());
        if let Some(rest) = item.strip_prefix("enter:") {
            if let Some(r) = result_by_phase.remove(rest) {
                merged.push(r);
            }
        }
    }
    // 残留 result（无 enter）按原 result 顺序追加（保留：result_phases 已按出现序）
    if !result_by_phase.is_empty() {
        for (phase, _) in result_phases {
            if let Some(r) = result_by_phase.remove(&phase) {
                merged.push(r);
            }
        }
    }
    if seen_pipe_finished {
        merged.push("pipe_finished".to_string());
    }
    merged
}

/// 产物类型名列表（S2 对齐口径②；按产出顺序）
#[cfg(test)]
fn artifact_kind_names(artifacts: &[HandoverArtifact]) -> Vec<String> {
    artifacts.iter().map(|a| format!("{:?}", a.kind.tag())).collect()
}

/// 会话信息（列表项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub created_at: u64,
    pub message_count: u32,
    /// 会话标题（默认「新会话」，可经 update_session_title 重命名）
    pub title: String,
    /// 是否固定到列表顶部
    pub pinned: bool,
    /// 会话类型（chat/group，缺省 chat；group 为群聊参与者会话）
    #[serde(default)]
    pub kind: SessionKind,
    /// 会话绑定的工作区根目录（Phase 3 接入本地文件系统；None=不限定）
    #[serde(default)]
    pub workdir: Option<String>,
    /// 会话绑定的 Workspace 实体 id（Phase A；`None`=旧数据缺省，用 workdir 兜底）
    ///
    /// `workdir` 字符串保留做向后兼容展示，`workspace_id` 是新引入的实体引用；
    /// `list_sessions` 返回时若 `workspace_id` 存在，会用对应 workspaces.root 兜底 workdir。
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// 会话归属的项目 id（任务29/D1 锚点；`None`=旧数据/未归属）。
    /// 弱引用前端 ProjectManager 的项目 UUID，供按项目过滤/记忆隔离等后续消费。
    #[serde(default)]
    pub project_id: Option<String>,
}

/// 群聊参与者会话信息（映射查询结果）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupParticipantSessionInfo {
    /// 群聊内参与者 id（与前端 GroupParticipant.id 对应）
    pub participant_id: String,
    /// 该参与者对应的 Rust 会话 id
    pub session_id: String,
}

/// 发送消息参数
///
/// `rename_all = "camelCase"`：Tauri v2 只对顶层命令参数做 camelCase 转换，
/// 嵌套结构体需在 serde 层声明，前端才可用 `sessionId` / `mimeType` 等字段名。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    pub session_id: String,
    pub text: String,
    /// 图片附件（Base64 data + mime）—— 5.2 真实后端接入后生效
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageAttachmentParam>,
    /// 聊天模式（normal / deep 等）
    #[serde(default)]
    pub mode: Option<String>,
}

/// 图片附件参数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachmentParam {
    pub data: String,
    pub mime_type: String,
}

/// 发送消息结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct SendMessageResult {
    pub session_id: String,
    pub reply: String,
    pub state: AgentStateSnapshot,
    /// 会话累计用量（input/output tokens，供前端用量面板）
    pub usage: SessionUsageSummary,
}

/// 会话累计用量摘要（Tauri 序列化用）
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionUsageSummary {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// A7 安全级别（前端设置开关，运行时切换确认策略）
///
/// - `Off`：关闭确认，所有工具直接执行
/// - `DangerousOnly`：仅危险操作确认（默认，对应 `ConfirmationPolicy::dangerous_only`）
/// - `ModerateAndDangerous`：危险 + 中等（写操作/命令）一律确认
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SecurityLevel {
    Off,
    DangerousOnly,
    ModerateAndDangerous,
}

/// 更新模型参数
///
/// `rename_all = "camelCase"`：Tauri v2 只对顶层命令参数做 camelCase 转换，
/// 嵌套结构体需在 serde 层声明（与 `SendMessageParams` 一致），否则前端传
/// `sessionId`/`modelId` 会因字段名 `session_id` 不匹配触发反序列化失败，
/// 导致 key 注入不进 Rust 后端（表现为「API Key 缺失」）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateModelParams {
    pub session_id: String,
    pub provider: String,
    pub model_id: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// 采样 Top P（0~1；前端若存 0~100 需先 ÷100）
    #[serde(default)]
    pub top_p: Option<f32>,
    /// 采样 Top K
    #[serde(default)]
    pub top_k: Option<u32>,
    /// 思考模式开关
    #[serde(default)]
    pub thinking_mode: Option<bool>,
    /// 总步骤预算（工具调用轮数上限，1~500，None=不更新；语义见 AgentLoopConfig.total_steps）
    #[serde(default)]
    pub total_steps: Option<u32>,
}

/// Provider 配置（`get_provider_config` 回显的简化视图）
///
/// 仅含 provider / model / base_url 三个展示字段；完整配置（含 API Key、
/// 模式、api_type 等）由 [`RuntimeProviderConfig`] 承载，通过
/// [`AgentCommandService::set_provider_config`] 写入。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
}

// ─── 服务 ────────────────────────────────────────────────────

/// Agent 命令服务 — 会话管理 + 命令方法
///
/// 由 Tauri app 端 `manage` 为状态，供 `#[tauri::command]` 调用。
#[derive(Default)]
pub struct AgentCommandService {
    sessions: Mutex<HashMap<String, Arc<AgentLoop>>>,
    meta: Mutex<HashMap<String, SessionInfo>>,
    /// 子 Agent 规格注册表（跨会话共享，运行期可动态注册）
    ///
    /// 每个会话的 `SubAgentManager` 都持有此共享注册表，因此
    /// `register_subagent_spec` 的变更对所有会话可见。
    subagent_specs: Arc<RwLock<Vec<SubAgentSpec>>>,
    /// 子 Agent 规格持久化存储（可选）
    ///
    /// `None`：纯内存（默认，单测/无持久化场景）；`Some`：构造时从存储 `load_all`
    /// 装入内存注册表，此后注册/删除**写穿**到存储，应用重启后配置不丢失。
    subagent_store: Option<Arc<dyn SubAgentSpecStore>>,
    /// 各会话的子 Agent 管理器（按 session_id 跟踪）
    ///
    /// `new_session` 创建会话时把该会话的 `SubAgentManager` 存入此映射，
    /// 供「清空实例 / 查看实例」命令按会话定位管理器。实例池按会话隔离，
    /// 清空某会话的实例不影响其他会话。
    subagent_managers: Mutex<HashMap<String, Arc<SubAgentManager>>>,
    /// Loop Control 注册表（按 task_id 管理 LoopController 实例）
    ///
    /// 默认自建独立实例；Tauri 端用 [`Self::with_loop_control_registry`] 注入
    /// 与命令层共享的同一实例，使「内建自动（AgentLoop 内）与命令层手动」
    /// 操作同一份控制器状态，消除双轨不共享。
    loop_control_registry: Arc<LoopControlRegistry>,
    /// run 注册表（B22，M1）：请求级编排上下文实体，纯内存 HashMap。
    ///
    /// run_* 各入口在此登记 run（生成 run_id → 传入 OrchestratorRunOptions）、
    /// 结束后收口状态；`get_run` / `get_artifact` / `list_session_runs` 读取。
    runs: Arc<RunStore>,
    /// B10 判型请求级缓存（M4-5）：键 = (session_id, 原文)，值 = 判型管线。
    ///
    /// 同会话同文本重发不重复 LLM 判型；容量 128 简单防泄漏（超出清空）。
    pipeline_cache: Mutex<HashMap<(String, String), Pipeline>>,
    /// 当前活跃编排器（M4-6 插话门）：run_* 运行期间注册、结束后清除（B11 顶层串行 → 全局单例安全）。
    ///
    /// steer 命令据此选择「编排节点边界注入」或「AgentLoop steer（react）」。
    active_orchestrator: RwLock<Option<Arc<DefaultOrchestrator>>>,
    /// 记忆存储根目录（SQLite 落盘路径，来自 tauri 应用数据目录）
    ///
    /// `None`：不启用长期记忆（默认）；`Some`：`new_session` 时为每个会话构造
    /// `MemoryCenterAccessor` 并注入 `AgentLoop`（通过 `with_memory`）。
    memory_root: Option<PathBuf>,
    /// 会话持久化存储（可选）
    ///
    /// `None`：纯内存（默认，单测/无持久化场景）；`Some`：`new_session`/`send_message`/
    /// `clear_history`/`trim_context`/`delete_session` 各操作**写穿**到存储；启动时经
    /// [`Self::restore_sessions`] 加载全部会话重建 AgentLoop，应用重启后历史不丢失。
    session_store: Option<Arc<dyn SessionRepository>>,
    /// 场景插件注册中心（B1 多场景，MVP 仅 worldbuilding）
    ///
    /// 惰性注册：`ensure_scenarios` 在首次需要时注册内置场景。
    scenario_registry: ScenarioRegistry,
    /// 场景实体访问器（B1 场景上下文注入）
    ///
    /// `None`：不在会话中注入实体摘要（默认）；`Some`：`new_agent` 构造
    /// `AgentLoopConfig` 时注入，`build_prompt_options` 据此把项目实体摘要
    /// 填入 `ScenarioContext`，场景 `build_system_prompt` 拼入 system prompt。
    entity_provider: Option<Arc<dyn ScenarioEntityProvider>>,
    /// 额外注册进每个会话 ToolBus 的工具（B1 场景工具桥 MVP）
    ///
    /// `new_agent` 在注册 terminal/subagent 工具后，把本列表逐个注册进 tool_bus。
    /// 供 Tauri 层注入原生实体只读工具（entity_list/entity_get），使 worldbuilding
    /// 场景 `tool_ids()` 声明的同名工具对 LLM 可见且可执行。空列表 = 不注入。
    extra_tools: Vec<Arc<dyn Tool>>,
    /// 会话级实体读取工厂（任务29/M4 数据源收敛；Tauri 层注入）
    ///
    /// 按会话 workdir 构造文件版实体工具（entity_list/entity_get，扫 `{workdir}/entities/`）。
    /// 有 workdir 的会话在 extra_tools 之后注册（ToolBus 同名覆盖语义），使 Agent
    /// 读到文件主存储的真身数据；无 workdir 会话回退 extra_tools 的 SQLite 兜底。
    /// `None`（默认）：不覆盖，全部走 SQLite 兜底（旧行为）。
    session_entity_tools_factory:
        Option<Arc<dyn Fn(&std::path::Path) -> Vec<Arc<dyn Tool>> + Send + Sync>>,
    /// 会话级场景实体访问器工厂（任务29/M4；与上配套，按 workdir 构造文件版 provider）
    ///
    /// 有 workdir 时取代全局 `entity_provider`（SQLite 版）注入 `AgentLoopConfig`；
    /// 无 workdir 或未注入时回退全局 provider。
    session_entity_provider_factory:
        Option<Arc<dyn Fn(&std::path::Path) -> Arc<dyn ScenarioEntityProvider> + Send + Sync>>,
    /// H2 MCP 重建（P2，2026-08-30）：MCP 工具供给器（Tauri 层注入 McpHub 快照闭包）
    ///
    /// `new_agent` 每次构造会话时同步调用，把**当前已连接**的 MCP 工具注册进该会话的
    /// tool_bus（连接变更后新建的会话拿到新工具集，与技能/规则同策略；已有会话不热更新）。
    /// `None`（默认）：不注入。
    mcp_tools_provider:
        Option<Arc<dyn Fn() -> Vec<Arc<dyn Tool>> + Send + Sync>>,
}

/// 场景摘要（Tauri 序列化用）
#[derive(Debug, Clone, Serialize)]
pub struct ScenarioInfo {
    pub id: String,
    pub display_name: String,
}

impl From<&dyn Scenario> for ScenarioInfo {
    fn from(s: &dyn Scenario) -> Self {
        Self {
            id: s.id().to_string(),
            display_name: s.display_name().to_string(),
        }
    }
}

/// 校验一个子 Agent 规格是否合法
///
/// 在命令层（`subagent_register_spec`）与批量导入（`import_subagent_specs`）两个入口
/// 统一调用，阻止非法规格进入注册表。返回 `Err` 时携带中文说明，可直接透传给前端展示。
pub fn validate_subagent_spec(spec: &SubAgentSpec) -> Result<(), String> {
    let id = spec.id.trim();
    if id.is_empty() {
        return Err("子 Agent 的 id 不能为空".into());
    }
    if id.len() > 64 {
        return Err("子 Agent 的 id 过长（最多 64 个字符）".into());
    }
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
    {
        return Err("子 Agent 的 id 仅允许字母、数字、下划线、连字符".into());
    }

    if spec.name.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 name 不能为空"));
    }
    if spec.description.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 description 不能为空"));
    }
    if spec.system_prompt.trim().is_empty() {
        return Err(format!("子 Agent [{id}] 的 system_prompt 不能为空"));
    }

    if let Some(n) = spec.max_iterations {
        if n == 0 {
            return Err(format!("子 Agent [{id}] 的 max_iterations 必须大于 0"));
        }
    }

    if let Some(tools) = &spec.tools_whitelist {
        if tools.iter().any(|t| t.trim().is_empty()) {
            return Err(format!("子 Agent [{id}] 的工具白名单不能包含空名称"));
        }
    }

    Ok(())
}

/// 编排器出口状态 → run 实体状态（B22/NIT-2：两套枚举 additive 对齐）
fn to_run_status(status: OrchestratorEndStatus) -> RunStatus {
    match status {
        OrchestratorEndStatus::Completed => RunStatus::Completed,
        OrchestratorEndStatus::Aborted => RunStatus::Aborted,
        OrchestratorEndStatus::Error => RunStatus::Error,
        OrchestratorEndStatus::Timeout => RunStatus::Timeout,
    }
}

/// 剥离输入首 token（M4-2：force_pipeline 前缀 /调研 等 Chip 不进规划提示）
fn strip_first_token(text: &str) -> String {
    let t = text.trim();
    match t.find(char::is_whitespace) {
        Some(i) => t[i..].trim_start().to_string(),
        None => String::new(),
    }
}

/// M5-RK1：专属 run_* 编排模式前缀（区别于 A3 四管线前缀 /调研 等）
///
/// 前端 `/` 命令菜单（PIPELINE_ITEMS）注入 5 个模式项按模式直发对应 run_*：
/// - `Plan` → run_plan_execute（强制规划管线，绕过 LLM 判型）
/// - `Tot` → run_tot（思维树分支探索）
/// - `Got` → run_got（多源聚合）
/// - `Supervisor` → run_supervisor（拆分子任务委派子 Agent）
/// - `Multi` → run_multi（黑板协作多智能体）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ModePrefix {
    Plan,
    Tot,
    Got,
    Supervisor,
    Multi,
}

impl ModePrefix {
    fn as_prefix(self) -> &'static str {
        match self {
            Self::Plan => "/plan",
            Self::Tot => "/tot",
            Self::Got => "/got",
            Self::Supervisor => "/supervisor",
            Self::Multi => "/multi",
        }
    }
}

/// 从输入首 token 提取模式前缀（大小写不敏感，`/tot 问题` 与 `/tot问题` 均可命中）
///
/// 与 [`agent_runtime::router::extract_force_pipeline`]（四管线前缀）互不重叠：
/// 模式前缀在四管线 kw 表之外，四管线前缀在本表之外，二者不会互相误判。
fn extract_mode_prefix(input: &str) -> Option<ModePrefix> {
    let first = input.trim().split_whitespace().next().unwrap_or("");
    let lower = first.to_lowercase();
    [
        ModePrefix::Plan,
        ModePrefix::Tot,
        ModePrefix::Got,
        ModePrefix::Supervisor,
        ModePrefix::Multi,
    ]
    .into_iter()
    .find(|m| lower == m.as_prefix() || lower.starts_with(m.as_prefix()))
}

/// M3-RK1：Supervisor 图节点委派路径的子 run 记账器（映射到 RunStore）
///
/// SupervisorNode（patterns 层）不感知 RunStore；本实现把「建子 run / 收口」映射到
/// 命令层 RunStore：父 run = 当前顶层 run（B11 顶层串行），session 继承父 run，
/// 使 Supervisor 委派的每个子 Agent 成为 run 树子节点（前端"查看委派现场"数据源）。
struct RunStoreSubRunAccountant {
    store: Arc<RunStore>,
}

#[async_trait::async_trait]
impl agent_runtime::sub_agent_pool::SubRunAccountant for RunStoreSubRunAccountant {
    async fn begin(
        &self,
        _parent_run_id: Option<String>,
        sub_agent_id: &str,
        _sub_agent_name: &str,
    ) -> Option<String> {
        // 父 run = 当前活跃顶层 run（顶层串行下即 supervisor 自身 run）
        let parent = self.store.current_top_run().await;
        let sub_session = if let Some(p) = &parent {
            self.store
                .get(p)
                .await
                .map(|r| r.session_id)
                .unwrap_or_else(|| "supervisor".into())
        } else {
            "supervisor".into()
        };
        Some(
            self.store
                .create(
                    &sub_session,
                    parent,
                    Some(format!("sub:{}", sub_agent_id)),
                )
                .await,
        )
    }

    async fn finish(&self, sub_run_id: &str, status: &str, summary: Option<String>) {
        let (run_status, reason) = match status {
            "error" => (RunStatus::Error, None),
            "timeout" => (RunStatus::Timeout, Some(ConvergeReason::LimitReached)),
            _ => (RunStatus::Completed, Some(ConvergeReason::GoalReached)),
        };
        self.store.finish(sub_run_id, run_status, reason, summary).await;
    }
}

/// M1-7/M1-8 收口：单节点链构图前硬校验（D23）。
///
/// 注册表提供产出 kind 声明（注册项③），构图期校验入口存在与节点合法；
/// 单节点链无组合边，kind 匹配不参与——拦截价值集中在入口/节点必达。
fn verify_single_node_pipeline(
    pattern_id: &str,
    node_id: &str,
    node_type: agent_runtime::node::NodeType,
) -> Result<(), CommandError> {
    use agent_runtime::pipeline::{validate_pipeline, PipelineDecl, PipelineNodeDecl};

    let entry = get_pattern(pattern_id).ok_or_else(|| {
        CommandError::Agent(format!("模式未注册，构图期拒绝: {pattern_id}"))
    })?;
    let decl = PipelineDecl {
        nodes: vec![PipelineNodeDecl {
            id: node_id.into(),
            node_type,
            output_kind: Some(entry.artifact_kind),
        }],
        edges: vec![],
        entry: node_id.into(),
    };
    validate_pipeline(&decl)
        .map_err(|e| CommandError::Agent(format!("管线定义非法，构图期拒绝: {e}")))
}

impl AgentCommandService {
    /// M4-6 插话门（FIX-3/D21）：运行期间注册当前编排器（steer 队列转发目标），结束后清除
    ///
    /// `fut` 为编排器 run future；无论成败都在结束后解除注册（B11 顶层串行 → 全局单例安全）。
    async fn run_with_active_orchestrator(
        &self,
        orch: Arc<DefaultOrchestrator>,
        fut: impl std::future::Future<Output = Result<OrchestratorResult, OrchestratorError>>,
    ) -> Result<OrchestratorResult, OrchestratorError> {
        *self.active_orchestrator.write().await = Some(Arc::clone(&orch));
        let result = fut.await;
        *self.active_orchestrator.write().await = None;
        result
    }

    /// 创建空服务
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建带持久化存储的服务（启动时把存储中已保存的规格装入内存注册表）
    ///
    /// 用于 Tauri 应用启动：用户在前端「子 Agent」标签页配置的规格会在重启后恢复。
    /// 存储失败（如数据库损坏）时返回 [`CommandError`]，由调用方决定是否降级为纯内存。
    pub async fn with_subagent_store(store: Arc<dyn SubAgentSpecStore>) -> Result<Self, CommandError> {
        let svc = Self {
            subagent_store: Some(store.clone()),
            ..Self::default()
        };
        let loaded = store.load_all().await?;
        *svc.subagent_specs.write().await = loaded;
        Ok(svc)
    }

    /// 注入共享的 Loop Control 注册表（链式）
    ///
    /// 默认服务自建独立注册表；Tauri 端把命令层 `LoopControlRegistry` 传入，
    /// 使 `cmd_loop_control_*` 与 [`Self::register_session_loop_control`] 操作同一实例。
    pub fn with_loop_control_registry(self, registry: Arc<LoopControlRegistry>) -> Self {
        Self {
            loop_control_registry: registry,
            ..self
        }
    }

    /// 获取 Loop Control 注册表引用（Arc 克隆）
    pub fn loop_control_registry(&self) -> Arc<LoopControlRegistry> {
        self.loop_control_registry.clone()
    }

    /// 设置记忆存储根目录（链式）
    ///
    /// 传入应用数据目录子路径（如 `{app_data}/worldsmith/memory`）。设置后
    /// `new_session` 会为每个会话构造 `MemoryCenterAccessor` 并注入 AgentLoop。
    pub fn with_memory_root(mut self, root: Option<PathBuf>) -> Self {
        self.memory_root = root;
        self
    }

    /// 注入会话持久化存储（链式）
    ///
    /// 传入后 `new_session` 等会话变更操作会**写穿**到存储；启动时调用
    /// [`Self::restore_sessions`] 从存储加载全部会话重建 AgentLoop。
    pub fn with_session_store(mut self, store: Arc<dyn SessionRepository>) -> Self {
        self.session_store = Some(store);
        self
    }

    /// 注入场景实体访问器（链式，B1 场景上下文注入）
    ///
    /// 传入后 `new_agent` 构造 `AgentLoopConfig` 时带上 provider，使场景
    /// `build_system_prompt` 能经 `ScenarioContext.entity_summary` 感知项目已有实体。
    pub fn with_entity_provider(mut self, provider: Option<Arc<dyn ScenarioEntityProvider>>) -> Self {
        self.entity_provider = provider;
        self
    }

    /// 注入额外工具（链式，B1 场景工具桥 MVP）
    ///
    /// 传入的原生工具（如 entity_list/entity_get）会在 `new_agent` 中注册进
    /// 每个会话的 ToolBus，使场景 `tool_ids()` 声明的同名工具可被 LLM 调用。
    pub fn with_extra_tools(mut self, tools: Vec<Arc<dyn Tool>>) -> Self {
        self.extra_tools = tools;
        self
    }

    /// H2 MCP 重建（P2，2026-08-30）：注入 MCP 工具供给器
    ///
    /// Tauri 层 setup 时传入闭包（内部读 McpHub 工具快照）。`new_agent` 每次
    /// 构造会话时同步调用，把**当前已连接**的 MCP 工具动态注册进该会话 tool_bus。
    pub fn set_mcp_tools_provider(
        &mut self,
        provider: Arc<dyn Fn() -> Vec<Arc<dyn Tool>> + Send + Sync>,
    ) {
        self.mcp_tools_provider = Some(provider);
    }

    /// 把指定 agent 的 tool_bus 用 MCP 工具快照做「分组注册」（T09①，2026-09-01）
    ///
    /// 按工具名前缀 `mcp_{server_id}_` 分组调用 `register_mcp_tools`，使
    /// SimpleToolBus 记录 server_id → 工具名归属（供 `unregister_mcp_server` 按服务器注销）。
    /// `new_agent` / `hot_inject_mcp_tools` 共用，保证两条注入路径归属一致。
    async fn register_mcp_bus(&self, bus: &dyn ToolBus, tools: &[Arc<dyn Tool>]) {
        let mut grouped: std::collections::BTreeMap<String, Vec<Arc<dyn Tool>>> = Default::default();
        for t in tools {
            // 名字契约：mcp_{server_id}_{tool_name}（server_id 不含下划线）
            if let Some(rest) = t.name().strip_prefix("mcp_") {
                if let Some(pos) = rest.find('_') {
                    grouped.entry(rest[..pos].to_string()).or_default().push(t.clone());
                    continue;
                }
            }
            // 非标 MCP 命名兜底：单工具组（服务器 id 取名字符串，可被按名注销）
            grouped.entry("misc".to_string()).or_default().push(t.clone());
        }
        for (server_id, tools) in grouped {
            bus.register_mcp_tools(server_id, tools).await;
        }
    }

    /// MCP 工具热注入（2026-08-30）：把当前快照注册进**所有活跃会话**的 tool_bus
    ///
    /// v1 冷策略（仅新会话生效）导致用户连接 MCP 后在当前会话看不到工具——
    /// 本方法在 cmd_mcp_connect 成功后调用，弥补已有会话。分组注册（见
    /// [`Self::register_mcp_bus`]）同名覆盖幂等，重复调用无副作用——同时记录
    /// server_id 归属，使断开后可按服务器注销（T09①）。返回本次注入的工具数
    /// （0 = 无 provider 或无工具）。
    pub async fn hot_inject_mcp_tools(&self) -> usize {
        let Some(provider) = &self.mcp_tools_provider else {
            return 0;
        };
        let tools = provider();
        if tools.is_empty() {
            return 0;
        }
        let sessions = self.sessions.lock().await;
        for agent in sessions.values() {
            let bus = agent.tool_bus();
            self.register_mcp_bus(bus.as_ref(), &tools).await;
        }
        tools.len()
    }

    /// 从**所有活跃会话**注销指定 MCP 服务器的工具（T09①，2026-09-01）
    ///
    /// 与 `hot_inject_mcp_tools` 对称的「删」操作：`cmd_mcp_disconnect` / `cmd_mcp_delete`
    /// 在断开连接后调用，把该 server 的工具从已建会话 tool_bus 移除（此前 v1 取舍：
    /// 断开后旧工具留存至重启/新建会话）。基于 `register_mcp_tools` 记录的归属关系，
    /// 按 `server_id` 批量注销。返回受影响会话数（0 = 无活跃会话含该服务器工具）。
    pub async fn remove_mcp_server_tools(&self, server_id: &str) -> usize {
        let sessions = self.sessions.lock().await;
        let mut affected = 0usize;
        for agent in sessions.values() {
            let bus = agent.tool_bus();
            // 仅当该服务器的工具确实存在于会话总线才注销（避免无谓遍历）
            let prefix = format!("mcp_{server_id}_");
            let exists = bus
                .list_all()
                .await
                .into_iter()
                .any(|d| d.name.starts_with(&prefix));
            if exists {
                bus.unregister_mcp_server(server_id).await;
                affected += 1;
            }
        }
        affected
    }

    /// 注入会话级实体读取工厂（任务29/M4 数据源收敛；Tauri 层 setup 时调用）
    ///
    /// - `tools_factory`：按会话 workdir 构造文件版 entity_list/entity_get（同名覆盖 extra_tools）
    /// - `provider_factory`：按会话 workdir 构造文件版场景实体访问器（取代全局 SQLite provider）
    pub fn with_session_entity_adapter(
        mut self,
        tools_factory: Arc<dyn Fn(&std::path::Path) -> Vec<Arc<dyn Tool>> + Send + Sync>,
        provider_factory: Arc<dyn Fn(&std::path::Path) -> Arc<dyn ScenarioEntityProvider> + Send + Sync>,
    ) -> Self {
        self.session_entity_tools_factory = Some(tools_factory);
        self.session_entity_provider_factory = Some(provider_factory);
        self
    }

    /// 把指定会话的内建 LoopController 注册为 loop_control 任务（共享同一实例）
    ///
    /// 解决"内建（自动）与命令层（手动）双轨不共享"：取该会话 `AgentLoop` 内建的
    /// `Arc<LoopController>` 注册为 `task_id` 对应条目，使手动命令与自动驱动
    /// 操作同一份速率/超时/看门狗状态。
    ///
    /// # 错误
    /// - 会话不存在：`SessionNotFound`
    /// - task_id 已存在：注册表 `AlreadyExists`（包装为 `Internal`）
    pub async fn register_session_loop_control(
        &self,
        task_id: impl Into<String>,
        session_id: &str,
    ) -> Result<(), CommandError> {
        let task_id = task_id.into();
        let agent = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(session_id)
                .cloned()
                .ok_or_else(|| CommandError::session_not_found(session_id))?
        };
        let controller = agent.loop_controller().clone();
        let config = controller.config();
        let entry = LoopControlEntry::new(controller, config);
        self.loop_control_registry
            .register(task_id, entry)
            .await
            .map_err(|e| CommandError::Internal(e.to_string()))?;
        Ok(())
    }

    /// 构造会话级 MemoryCenterAccessor（记忆适配层）
    ///
    /// 以 `root` 为存储根目录、`session_id` 为记忆隔离依据，为每个会话创建独立的
    /// SQLite 记忆后端。`project_id` 传 `None`（单聊按会话隔离，跨会话聚合检索暂不启用）。
    fn build_memory_accessor(
        root: &PathBuf,
        session_id: &str,
    ) -> std::result::Result<Arc<dyn MemoryAccessor>, agent_memory::Error> {
        // 归档阈值：MemoryCenter 默认 400K（生产长会话），对 Agent 会话过大——
        // 真实对话几乎达不到，归档永不触发。取 2000 token（约 10-20 轮普通对话）
        // 让阶段 3 闭环（归档 → 检索 → 注入）可在会话内验证，后续可按需调整。
        let config = ArchiveConfig::from_threshold(2000);
        let accessor = MemoryCenterAccessor::new_sqlite(root.clone(), session_id, None, config)?;
        Ok(Arc::new(accessor))
    }

    /// 构造一个 AgentLoop（Phase 5.4：使用 GenaiBackend 真实 LLM 后端）
    ///
    /// # 参数
    /// - `session_id`：会话 ID（记忆隔离依据，构造 MemoryCenterAccessor 用）
    /// - `system_prompt`：系统提示词
    /// - `provider_config`：Provider 配置（cloud/local/custom 三种模式）
    ///   - `Some`：按注入配置构造 GenaiBackend
    ///   - `None`：降级为默认 Cloud 占位（空 API Key，需 `set_provider_config` 后可用）
    /// - `workdir`：会话绑定的工作区根目录（`None`=不限定，FS 工具相对路径原样返回）
    ///   - Phase 2 接入：写入 `AgentLoopConfig.workdir`，供 AgentLoop 构造 ToolContext
    /// - `workspace_id`：会话绑定的 Workspace 实体 id（Phase A，`None`=旧数据缺省）
    ///   - 写入 `AgentLoopConfig.workspace_id`（ToolContext 亦带上），供前端/工具感知实体归属
    async fn new_agent(
        &self,
        session_id: &str,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
        scenario: Option<Arc<dyn Scenario>>,
        workdir: Option<PathBuf>,
        workspace_id: Option<String>,
    ) -> (Arc<AgentLoop>, Arc<SubAgentManager>) {
        let config = provider_config.unwrap_or_else(Self::default_provider_config);
        let backend = Arc::new(GenaiBackend::new(config));
        let tool_bus = Arc::new(SimpleToolBus::new());
        // 注册终端工具（execute_command + 持久化 shell 会话）
        terminal::register_terminal_tools(&*tool_bus).await;
        // 注册文件系统工具（read_file/write_file/list_directory/search_files/edit_file），
        // 基于 ToolContext.workdir 解析相对路径；写在 terminal 之后（FS 为独立工具组）。
        fs_tools::register_fs_tools(&*tool_bus).await;
        // 注册子 Agent 编排工具（delegate_to_sub_agent / list_sub_agents），
        // 共享服务级 `subagent_specs` 注册表，跨会话可见。
        let sub_agent_manager = subagent::register_subagent_tools(
            &*tool_bus,
            backend.clone(),
            tool_bus.clone(),
            self.subagent_specs.clone(),
        )
        .await;
        // B1 场景工具桥 MVP：注册注入的原生工具（如 entity_list/entity_get），
        // 使世界构建场景 `tool_ids()` 声明的同名工具对 LLM 可见且可执行。
        for tool in &self.extra_tools {
            tool_bus.register(tool.clone()).await;
        }
        // H2 MCP 重建（P2，2026-08-30）：注入当前已连接的 MCP 工具（动态拉取快照——
        // 连接变更后新建的会话拿到新工具集，与技能/规则同策略）
        // MCP 感知注记：工具名 `mcp_{server_id}_` 前缀对 LLM 不够显性（真机实测模型曾答
        // 「没有接入任何 MCP 工具」，尽管总线里已有 33 个 mcp_* 工具）——把已连接服务器
        // 清单写进 system prompt，使模型能直接回答/调用
        let mut mcp_note = String::new();
        if let Some(provider) = &self.mcp_tools_provider {
            let mcp_tools = provider();
            if !mcp_tools.is_empty() {
                let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
                for t in &mcp_tools {
                    // 名字契约：mcp_{server_id}_{tool_name}（server_id 不含下划线）
                    if let Some(rest) = t.name().strip_prefix("mcp_") {
                        if let Some(pos) = rest.find('_') {
                            *counts.entry(rest[..pos].to_string()).or_default() += 1;
                        }
                    }
                }
                let list: Vec<String> = counts
                    .iter()
                    .map(|(id, c)| format!("{id}（{c} 个工具，前缀 mcp_{id}_）"))
                    .collect();
                mcp_note = format!(
                    "\n\n[MCP 环境] 当前已连接 {} 个 MCP 服务器：{}。工具名以 mcp_ 开头的即 MCP 工具，可直接调用；若用户问及 MCP 能力，请基于本清单回答。",
                    list.len(),
                    list.join("、")
                );
            }
            self.register_mcp_bus(tool_bus.as_ref(), &mcp_tools).await;
        }
        // 任务29/M4 数据源收敛：有 workdir 的会话用文件版实体工具覆盖注册
        // （ToolBus 同名覆盖），使 Agent 读到项目目录 entities/ 的真身数据；
        // 无 workdir 或未注入工厂时保持 extra_tools 的 SQLite 兜底（旧行为）。
        let session_entity_provider: Option<Arc<dyn ScenarioEntityProvider>> = match workdir.as_ref()
        {
            Some(wd) => {
                if let Some(factory) = &self.session_entity_tools_factory {
                    for tool in factory(wd) {
                        tool_bus.register(tool).await;
                    }
                }
                match &self.session_entity_provider_factory {
                    Some(f) => Some(f(wd)),
                    None => self.entity_provider.clone(),
                }
            }
            None => self.entity_provider.clone(),
        };
        // MCP 感知注记追加到 system prompt 末尾（无 MCP 时为空串，不影响原 prompt）
        let system_prompt = match system_prompt {
            Some(p) if !mcp_note.is_empty() => Some(format!("{p}{mcp_note}")),
            other => other,
        };
        let agent_config = AgentLoopConfig {
            system_prompt,
            // B1：场景插件（None=默认静态 prompt / 默认工具视图）
            scenario,
            // B1 场景上下文注入：把实体访问器传给 AgentLoop，供 build_prompt_options 注入实体摘要
            // （任务29/M4：有 workdir 时为文件版 provider，否则回退全局 SQLite 版）
            entity_provider: session_entity_provider,
            // A5 HITL：启用默认危险操作确认策略（execute_command 危险命令 / delegate_to_sub_agent）
            confirmation_policy: Some(ConfirmationPolicy::dangerous_only()),
            // Phase 2：会话工作区（供 FS 工具解析相对路径，None=不限定）
            workdir,
            // Phase A：会话绑定的 Workspace 实体 id（供 ToolContext 注入，None=旧数据缺省）
            workspace_id,
            ..Default::default()
        };
        // A3 四管线路由：为每个会话注入四管线路由节点（发送时决策管线）
        // 四管线 = Query/Research/Experiment/Compose；PipelineRoutingStrategy 在发送时
        // 先做 LLM 意图分类（3s 超时降级关键词），force_pipeline Chip（/管线 前缀）命中则跳过 LLM。
        // 注意：router 需在 `AgentLoop::new(backend, …)` move backend 之前 clone。
        let router = Arc::new(RouterNode::with_pipeline_strategy(
            "router",
            "四管线",
            backend.clone(),
            RouterConfig::default(),
        ));
        let mut agent_builder = AgentLoop::new(backend, tool_bus).with_config(agent_config);
        // A5 HITL：为每个会话注入独立的确认协调器（配合 confirmation_policy 生效）
        agent_builder = agent_builder.with_confirmation(Some(Arc::new(ConfirmationBroker::new())));
        agent_builder = agent_builder.with_router(Some(router));
        // 记忆注入：配置了 memory_root 时为该会话构造 MemoryCenterAccessor 并注入，
        // 失败仅告警不阻断（弱提示语义，记忆不可用不影响主流程）。
        if let Some(root) = &self.memory_root {
            match Self::build_memory_accessor(root, session_id) {
                Ok(memory) => {
                    agent_builder = agent_builder.with_memory(Some(memory));
                }
                Err(e) => {
                    tracing::warn!("构造 MemoryCenterAccessor 失败，跳过记忆注入: {e}");
                }
            }
        }
        let agent = Arc::new(agent_builder);
        // 将子 Agent 管理器的广播器指向主 Agent 的广播器，
        // 使子 Agent 委派事件（Started/Completed/Error）能透传到订阅主 Agent 的前端。
        sub_agent_manager.set_broadcaster(agent.broadcaster_ref());
        // M3-1：子 Agent 管理器注入共享 run 注册表（委派创建子 run 构成 run 树）
        sub_agent_manager.set_run_store(Arc::clone(&self.runs));
        (agent, sub_agent_manager)
    }

    /// 默认 Provider 配置（未注入时使用，空 API Key 占位）
    ///
    /// 使用 DeepSeek 云端占位，便于 `get_provider_config` 有稳定返回值；
    /// 实际使用前前端必须调用 `set_provider_config` 写入真实配置。
    fn default_provider_config() -> RuntimeProviderConfig {
        RuntimeProviderConfig::Cloud {
            provider: "deepseek".into(),
            model_id: "deepseek-v4-flash".into(),
            api_key: String::new(),
        }
    }

    // ── B1 场景：惰性注册 / 解析 / 列表 ─────────────────────────

    /// 惰性注册内置场景（首次需要时注册 worldbuilding）
    fn ensure_scenarios(&self) {
        if self.scenario_registry.list().is_empty() {
            self.scenario_registry
                .register(Arc::new(WorldbuildingScenario::new()));
        }
    }

    /// 按 id 解析场景（None=默认场景，MVP 为 worldbuilding）
    fn resolve_scenario(&self, id: Option<&str>) -> Option<Arc<dyn Scenario>> {
        self.ensure_scenarios();
        match id {
            Some(id) => self.scenario_registry.find(id),
            None => self.scenario_registry.default_plugin(),
        }
    }

    /// 列出可用场景（供前端场景选择器）
    pub async fn list_scenarios(&self) -> Vec<ScenarioInfo> {
        self.ensure_scenarios();
        self.scenario_registry
            .list()
            .iter()
            .map(|p| ScenarioInfo::from(p.as_ref()))
            .collect()
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    // ── 会话生命周期 ────────────────────────────────────

    /// 新建会话
    ///
    /// # 参数
    /// - `system_prompt`：系统提示词
    /// - `provider_config`：Provider 配置（可选，缺省用默认 Cloud 占位，
    ///   随后可调用 [`Self::set_provider_config`] 写入真实配置）
    /// - `workdir`：会话绑定的工作区根目录（`None`=不限定，向后兼容；Phase 3）
    /// - `project_id`：会话归属项目 id（任务29/D1 锚点，可选；弱引用前端 ProjectManager）
    pub async fn new_session(
        &self,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
        scenario_id: Option<String>,
        workdir: Option<PathBuf>,
        project_id: Option<String>,
    ) -> Result<SessionInfo, CommandError> {
        self.new_session_with_kind(system_prompt, provider_config, SessionKind::Chat, scenario_id, workdir, project_id)
            .await
    }

    // ── WorkspaceManager（Phase A：Workspace 实体化）──────────────

    /// 为 `workdir` 生成/复用 Workspace 实体（幂等，按 root 去重）
    ///
    /// 按 workdir 根目录在 `workspaces` 表 upsert：已存在复用原 id，否则新建并落库。
    /// 返回 `WorkspaceRecord`，其 `id` 供 `new_session` 写入 `SessionRecord.workspace_id`。
    /// `label` 默认取目录名（workdir 末段）。
    pub async fn ensure_workspace(
        &self,
        workdir: &str,
        label: &str,
    ) -> Result<WorkspaceRecord, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => {
                return Err(CommandError::Internal(
                    "未配置会话持久化存储，无法创建 Workspace 实体".into(),
                ))
            }
        };
        store.upsert_workspace(workdir, label).await
    }

    /// 从目录路径导出展示用名称（取末段；根路径无末段时回退全路径）
    fn workspace_label_from(workdir: &PathBuf) -> String {
        workdir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| workdir.to_string_lossy().to_string())
    }

    /// 列出全部 Workspace 实体（前端目录选择器 / 会话树分组用）
    ///
    /// 未注入持久化存储时返回空列表（调用方按无实体处理）。
    pub async fn list_workspaces(&self) -> Result<Vec<WorkspaceRecord>, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(Vec::new()),
        };
        store.list_workspaces().await
    }

    /// 建会话（内部版，可指定 kind）：生成会话 ID、构造 AgentLoop、注册内存表、写穿持久化
    async fn new_session_with_kind(
        &self,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
        kind: SessionKind,
        scenario_id: Option<String>,
        workdir: Option<PathBuf>,
        project_id: Option<String>,
    ) -> Result<SessionInfo, CommandError> {
        // 先生成会话 ID，作为记忆隔离依据传入 new_agent（构造 MemoryCenterAccessor）
        let id = uuid::Uuid::new_v4().to_string();
        // new_agent 会 move system_prompt，先克隆一份供后续持久化使用
        let persisted_prompt = system_prompt.clone();
        // workdir 会被 move 进 new_agent，先转成字符串供 SessionInfo/SessionRecord 复用
        let workdir_str = workdir.as_ref().map(|p| p.to_string_lossy().to_string());
        // Phase A：workdir 存在时为其删除/复用 Workspace 实体取 workspace_id（幂等）
        let workspace_id = match workdir.as_ref() {
            Some(wd) => {
                let label = Self::workspace_label_from(wd);
                match self
                    .ensure_workspace(&wd.to_string_lossy().to_string(), &label)
                    .await
                {
                    Ok(ws) => Some(ws.id),
                    Err(e) => {
                        // 实体化失败不阻断建会话：退回 workdir 兼容层（仅告警）
                        tracing::warn!("ensure_workspace 失败，退回 workdir 兼容层: {e}");
                        None
                    }
                }
            }
            None => None,
        };
        let scenario = self.resolve_scenario(scenario_id.as_deref());
        let (agent, sub_agent_manager) = self
            .new_agent(&id, system_prompt, provider_config, scenario, workdir, workspace_id.clone())
            .await;
        let info = SessionInfo {
            id: id.clone(),
            created_at: Self::now(),
            message_count: 0,
            title: "新会话".into(),
            pinned: false,
            kind,
            workdir: workdir_str.clone(),
            workspace_id: workspace_id.clone(),
            project_id: project_id.clone(),
        };
        self.sessions.lock().await.insert(id.clone(), agent);
        self.subagent_managers
            .lock()
            .await
            .insert(id.clone(), sub_agent_manager);
        self.meta.lock().await.insert(id.clone(), info.clone());
        // 写穿会话头到持久化存储（不阻塞内存结果；失败仅记日志弱提示）
        if let Some(store) = &self.session_store {
            let record = SessionRecord {
                id: id.clone(),
                system_prompt: persisted_prompt.unwrap_or_default(),
                created_at: info.created_at,
                message_count: 0,
                updated_at: info.created_at,
                title: "新会话".into(),
                pinned: false,
                kind,
                workdir: workdir_str.clone(),
                workspace_id,
                project_id,
            };
            if let Err(e) = store.save_session(&record).await {
                tracing::warn!("持久化新会话失败（仅内存生效）: {e}");
            }
        }
        Ok(info)
    }

    /// 获取会话（不存在则报错）
    pub async fn get_agent(&self, session_id: &str) -> Result<Arc<AgentLoop>, CommandError> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))
    }

    /// 诊断：列出指定会话 tool_bus 的全部工具名（2026-08-30，MCP 注入链路验证用）
    ///
    /// 返回 LLM 工具视图的同源清单（`tool_bus.list_all()`），可用于核对
    /// MCP 工具（`mcp_{server_id}_` 前缀）是否真正注册进会话。
    pub async fn tool_names(&self, session_id: &str) -> Result<Vec<String>, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent
            .tool_bus()
            .list_all()
            .await
            .into_iter()
            .map(|d| d.name)
            .collect())
    }

    /// 运行 Plan-and-Execute 编排图（可附带 Reflection/Self-Refine 循环）
    ///
    /// 复用会话 AgentLoop 的 LLM 后端与事件通道：
    /// - backend：从会话 AgentLoop 取出，注入 `DefaultOrchestrator`
    /// - 事件：编排器事件经 [`ForwardToAgentBroadcaster`] 转投到会话广播器，
    ///   使前端现有 `agent:event:*` 通道能收到 `PlanCreated` / `ReflectionResult` 等进度
    ///
    /// 链路（refine=false）：Plan → Execute（内部循环逐步骤执行）
    /// 链路（refine=true）：Plan → Execute → Reflection ⇄ Refine（直至收敛）
    ///
    /// S3 切换（2026-09-01，T10 双跑对齐通过后）：内部切换到 B 轨引擎
    /// （`agent_patterns::orchestrator` 统一骨架），A 轨旧组图实现由本引擎取代，
    /// 对外契约不变（前端迹线/run_store/交接物零感知）。
    pub async fn run_plan_execute(
        &self,
        session_id: &str,
        input: String,
        options: PlanExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        self.run_plan_execute_b_engine(session_id, input, options).await
    }

    /// B 轨（统一骨架）Plan-and-Execute 引擎实现
    ///
    /// 执行引擎为 `agent_patterns::orchestrator` 自持执行器，S3 起作为
    /// [`Self::run_plan_execute`] 的内部实现（原 A 轨组图由本引擎取代）。
    async fn run_plan_execute_b_engine(
        &self,
        session_id: &str,
        input: String,
        options: PlanExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let backend = agent.node_backend();
        // B22：登记 run（管线名与 A 轨一致，前端迹线零感知）
        let pipeline = if options.refine { "research-plan" } else { "quick-plan" };
        let run_id = self
            .runs
            .create(session_id, None, Some(pipeline.to_string()))
            .await;
        // TracePipeStarted（run 形状确定；前端据此建编排段）
        if let Ok(b) = agent.broadcaster_ref().try_read() {
            b.broadcast(&OrchestratorEvent::TracePipeStarted {
                run_id: run_id.clone(),
                pipeline: pipeline.to_string(),
                reason: None,
            });
        }
        // B 轨依赖注入：复用会话 backend；记忆 S1 占位（NoopMemory）
        let llm: Arc<dyn b_rail::LlmHandle> = Arc::new(b_rail::KernelBackendLlm::new(backend));
        let memory: Arc<dyn b_rail::MemoryHandle> = Arc::new(b_rail::NoopMemory);
        // 2026-09-02 步骤工具化：inner 换为 ReActLoopNode（工具循环），经 BusToolHandle
        // 桥接会话 ToolBus，使计划步骤内真实执行工具并广播 ToolCallStart/End（前端归入步骤）。
        // 工具集取自会话 ToolBus 当前注册面（与主 Agent 一致）；intent_key 指向
        // `pne.step.current`——每步 ReAct 循环都能看到当前计划的步骤文本。
        let tool_bus = agent.tool_bus();
        let tool_specs: Vec<b_rail::ToolSpec> = tool_bus
            .list_all()
            .await
            .into_iter()
            .map(|def| b_rail::ToolSpec {
                name: def.name,
                description: def.description,
                parameters: def.parameters,
            })
            .collect();
        let tool_ctx = agent_runtime::ToolContext {
            workdir: agent.workdir(),
            project_id: None,
            workspace_id: agent.workspace_id(),
            tool_stream: None,
        };
        let tool_handle: Arc<dyn b_rail::ToolHandle> = Arc::new(BusToolHandle {
            bus: Arc::clone(&tool_bus),
            ctx: tool_ctx,
            broadcaster: agent.broadcaster_ref(),
        });
        let inner: Arc<dyn b_rail::OrchestratorNode> = Arc::new(
            b_rail::ReActLoopNode::new(
                "step",
                b_rail::ToolSpecSet::new(tool_specs),
                tool_handle,
                5, // 每步工具循环轮次上限（治理：防步骤原地打转）
            )
            .with_intent_key("pne.step.current"),
        );
        let plan_prompt = format!(
            "{B_RAIL_PLAN_PROMPT}\n最多拆分 {max} 个步骤。",
            max = options.max_items
        );
        // 2026-09-02 步骤进度 → PlanStepUpdate 广播：每步开工 in_progress、收工 completed。
        // 前端 setupPlanListener 消费 plan_update 通道 → 计划步骤行状态推进 + settlePlanStep 收口。
        let broadcaster = agent.broadcaster_ref();
        let step_cb = Arc::new(move |cursor: usize, step: &str, in_progress: bool| {
            if let Ok(b) = broadcaster.try_read() {
                b.broadcast(&OrchestratorEvent::PlanStepUpdate {
                    step_id: format!("step-{cursor}"),
                    status: if in_progress {
                        PlanItemStatus::InProgress
                    } else {
                        PlanItemStatus::Completed
                    },
                    output: if in_progress { None } else { Some(step.to_string()) },
                });
            }
        });
        // 2026-09-02 计划生成 → PlanCreated 广播（前端据此生成 plan 步骤行）
        let broadcaster2 = agent.broadcaster_ref();
        let plan_cb = Arc::new(move |steps: Vec<String>| {
            if let Ok(b) = broadcaster2.try_read() {
                let items: Vec<PlanItem> = steps
                    .into_iter()
                    .enumerate()
                    .map(|(i, title)| PlanItem {
                        id: format!("step-{i}"),
                        title,
                        description: None,
                        status: PlanItemStatus::Pending,
                        order: i as i32,
                        output: None,
                    })
                    .collect();
                b.broadcast(&OrchestratorEvent::PlanCreated { items });
            }
        });
        let plan_node = b_rail::PlanExecuteNode::new(
            "plan_execute",
            inner,
            plan_prompt,
            "你是验收者。请判断给定步骤是否已被「步骤产出」文本完成，输出 JSON。",
            options.max_refine_iterations,
        )
        .with_on_step(step_cb)
        .with_on_plan(plan_cb);
        let graph = b_rail::Graph::build(vec![Box::new(plan_node)], vec![], "plan_execute")
            .map_err(|e| CommandError::Agent(format!("B 轨构图失败: {e}")))?;
        let orch = b_rail::DefaultOrchestrator::new(&graph, llm, memory, b_rail::RunConfig::default())
            .with_seed(serde_json::json!({ "task.intent": input }))
            .with_observer(Arc::new(BRailTraceBridge {
                target: agent.broadcaster_ref(),
                run_id: run_id.clone(),
            }));
        let report = orch
            .run()
            .await
            .map_err(|e| CommandError::Agent(format!("B 轨执行失败: {e}")))?;
        // 产物映射（黑板快照 → HandoverArtifact）→ RunStore（get_artifact 可回查）
        let artifacts = b_rail_artifacts(&run_id, &report);
        for artifact in &artifacts {
            self.runs.add_artifact(&run_id, artifact.clone()).await;
        }
        let (status, reason, final_message, error) = b_rail_terminal(&report);
        // TracePipeFinished（管线结束）
        if let Ok(b) = agent.broadcaster_ref().try_read() {
            b.broadcast(&OrchestratorEvent::TracePipeFinished {
                run_id: run_id.clone(),
                status,
                reason,
                final_message: final_message.clone(),
            });
        }
        let result = OrchestratorResult {
            status,
            converge_reason: reason,
            run_id: Some(run_id.clone()),
            final_message: final_message.clone(),
            iterations: report.steps.len() as u32,
            error,
            final_state: OrchestratorState::new(final_message.clone().unwrap_or_default()),
            artifacts,
        };
        // B22：run 收口（状态 + 收敛原因 + 终局结论）
        self.runs
            .finish(
                &run_id,
                to_run_status(result.status),
                result.converge_reason,
                result.final_message.clone(),
            )
            .await;
        Ok(result)
    }

    /// 运行 ToT（Tree of Thoughts）编排图（单节点：ToTNode）
    ///
    /// 复用会话 AgentLoop 的 LLM 后端；思维树构建/评分/收敛由 `ToTNode`
    /// 在 `DefaultOrchestrator` 内执行，事件经 [`ForwardToAgentBroadcaster`] 转投会话广播器。
    pub async fn run_tot(
        &self,
        session_id: &str,
        input: String,
        options: ToTExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let backend = agent.node_backend();
        // B22：登记 run（管线名 = 链族预设语义）
        let run_id = self
            .runs
            .create(session_id, None, Some("tot".to_string()))
            .await;
        let config = ToTConfig {
            max_depth: options.max_depth.unwrap_or(ToTConfig::default().max_depth),
            beam_width: options.beam_width.unwrap_or(ToTConfig::default().beam_width),
            branch_factor: options
                .branch_factor
                .unwrap_or(ToTConfig::default().branch_factor),
            max_thoughts: options.max_thoughts.unwrap_or(ToTConfig::default().max_thoughts),
            ..Default::default()
        };
        // M1-7/8：单节点链构图期校验（注册表提供 kind 声明）
        verify_single_node_pipeline("tot", "tot", agent_runtime::node::NodeType::Thought)?;
        let mut orch = DefaultOrchestrator::new().with_backend(backend.clone());
        orch.add_node(Box::new(ToTNode::with_default_strategies(
            "tot", "ToT", backend, config,
        )));
        orch.set_entry("tot");
        let orch = Arc::new(orch);
        orch.subscribe(Arc::new(ForwardToAgentBroadcaster {
            target: agent.broadcaster_ref(),
        }));
        let result = self
            .run_with_active_orchestrator(
                Arc::clone(&orch),
                orch.run(
                    input,
                    Some(OrchestratorRunOptions {
                        run_id: Some(run_id.clone()),
                        pipeline: Some("tot".to_string()),
                        node_timeout_ms: options.node_timeout_ms,
                        ..Default::default()
                    }),
                ),
            )
            .await
            .map_err(|e| CommandError::Agent(format!("ToT 执行失败: {e}")))?;
        // FIX-1 闭环（M5-RK3 补验修复）：交接物全文写入 RunStore（get_artifact 查询源）
        for artifact in &result.artifacts {
            self.runs.add_artifact(&run_id, artifact.clone()).await;
        }
        self.runs
            .finish(
                &run_id,
                to_run_status(result.status),
                result.converge_reason,
                result.final_message.clone(),
            )
            .await;
        Ok(result)
    }

    /// 运行 GoT（Graph of Thoughts）编排图（单节点：GoTNode）
    ///
    /// `GoTNode` 的 backend 来自 `DefaultOrchestrator`（`with_backend` 注入），
    /// 无需重复传给构造器。聚合策略由 `with_default_strategies` 内置。
    pub async fn run_got(
        &self,
        session_id: &str,
        input: String,
        options: GoTExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let backend = agent.node_backend();
        // B22：登记 run
        let run_id = self
            .runs
            .create(session_id, None, Some("got".to_string()))
            .await;
        let ToTExecuteOptions {
            max_depth,
            beam_width,
            branch_factor,
            max_thoughts,
            ..
        } = options.tot;
        let config = GoTConfig {
            tot: ToTConfig {
                max_depth: max_depth.unwrap_or(ToTConfig::default().max_depth),
                beam_width: beam_width.unwrap_or(ToTConfig::default().beam_width),
                branch_factor: branch_factor.unwrap_or(ToTConfig::default().branch_factor),
                max_thoughts: max_thoughts.unwrap_or(ToTConfig::default().max_thoughts),
                ..Default::default()
            },
            aggregation_enabled: options.aggregation_enabled.unwrap_or(true),
            ..Default::default()
        };
        // M1-7/8：单节点链构图期校验（注册表提供 kind 声明）
        verify_single_node_pipeline("got", "got", agent_runtime::node::NodeType::Graph)?;
        let mut orch = DefaultOrchestrator::new().with_backend(backend);
        orch.add_node(Box::new(GoTNode::with_default_strategies("got", "GoT", config)));
        orch.set_entry("got");
        let orch = Arc::new(orch);
        orch.subscribe(Arc::new(ForwardToAgentBroadcaster {
            target: agent.broadcaster_ref(),
        }));
        let result = self
            .run_with_active_orchestrator(
                Arc::clone(&orch),
                orch.run(
                    input,
                    Some(OrchestratorRunOptions {
                        run_id: Some(run_id.clone()),
                        pipeline: Some("got".to_string()),
                        node_timeout_ms: options.node_timeout_ms(),
                        ..Default::default()
                    }),
                ),
            )
            .await
            .map_err(|e| CommandError::Agent(format!("GoT 执行失败: {e}")))?;
        // FIX-1 闭环（M5-RK3 补验修复）：交接物全文写入 RunStore（get_artifact 查询源）
        for artifact in &result.artifacts {
            self.runs.add_artifact(&run_id, artifact.clone()).await;
        }
        self.runs
            .finish(
                &run_id,
                to_run_status(result.status),
                result.converge_reason,
                result.final_message.clone(),
            )
            .await;
        Ok(result)
    }

    /// 运行 Supervisor 编排图（单节点：SupervisorNode）
    ///
    /// 复用会话的 backend 与 ToolBus（通过 `AgentLoop::tool_bus()`），使被委派的
    /// 子 Agent 与主 Agent 共享同一批工具。委派由内置 LLM 分配策略完成。
    pub async fn run_supervisor(
        &self,
        session_id: &str,
        input: String,
        options: SupervisorExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let backend = agent.node_backend();
        let tool_bus = agent.tool_bus();
        // B22：登记 run
        let run_id = self
            .runs
            .create(session_id, None, Some("supervisor".to_string()))
            .await;
        let config = SupervisorConfig {
            max_rounds: options.max_rounds.unwrap_or(SupervisorConfig::default().max_rounds),
            ..Default::default()
        };
        // M1-7/8：单节点链构图期校验（注册表提供 kind 声明）
        verify_single_node_pipeline("supervisor", "supervisor", agent_runtime::node::NodeType::Supervisor)?;
        let mut orch = DefaultOrchestrator::new().with_backend(backend.clone());
        // M3-RK1：注入子 run 记账器——Supervisor 图节点委派路径的子 Agent 挂到 run 树
        // （父 run = 当前顶层 run；session 继承父 run；front-end 据此渲染委派现场）
        let accountant = Arc::new(RunStoreSubRunAccountant {
            store: Arc::clone(&self.runs),
        });
        orch.add_node(Box::new(
            SupervisorNode::with_default_strategy(
                "supervisor",
                "Supervisor",
                options.specs,
                backend,
                tool_bus,
                config,
            )
            .with_accountant(accountant),
        ));
        orch.set_entry("supervisor");
        let orch = Arc::new(orch);
        orch.subscribe(Arc::new(ForwardToAgentBroadcaster {
            target: agent.broadcaster_ref(),
        }));
        let result = self
            .run_with_active_orchestrator(
                Arc::clone(&orch),
                orch.run(
                    input,
                    Some(OrchestratorRunOptions {
                        run_id: Some(run_id.clone()),
                        pipeline: Some("supervisor".to_string()),
                        node_timeout_ms: options.node_timeout_ms,
                        ..Default::default()
                    }),
                ),
            )
            .await
            .map_err(|e| CommandError::Agent(format!("Supervisor 执行失败: {e}")))?;
        // FIX-1 闭环（M5-RK3 补验修复）：交接物全文写入 RunStore（get_artifact 查询源）
        for artifact in &result.artifacts {
            self.runs.add_artifact(&run_id, artifact.clone()).await;
        }
        self.runs
            .finish(
                &run_id,
                to_run_status(result.status),
                result.converge_reason,
                result.final_message.clone(),
            )
            .await;
        Ok(result)
    }

    /// 运行 Multi-Agent 协作编排图（单节点：MultiAgentNode）
    ///
    /// 复用会话的 backend 与 ToolBus，使 N 个协作 Agent 共享同一批工具与 LLM 后端。
    /// 拓扑/黑板/综合由 `MultiAgentConfig` 控制；协作过程事件经
    /// [`ForwardToAgentBroadcaster`] 转投会话广播器，前端可实时展示黑板与轮次。
    pub async fn run_multi(
        &self,
        session_id: &str,
        input: String,
        options: MultiAgentExecuteOptions,
    ) -> Result<OrchestratorResult, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let backend = agent.node_backend();
        let tool_bus = agent.tool_bus();
        // B22：登记 run
        let run_id = self
            .runs
            .create(session_id, None, Some("multi-agent".to_string()))
            .await;
        let defaults = MultiAgentConfig::default();
        let config = MultiAgentConfig {
            max_rounds: options.max_rounds.unwrap_or(defaults.max_rounds),
            topology: options.topology.unwrap_or(defaults.topology),
            blackboard_enabled: options
                .blackboard_enabled
                .unwrap_or(defaults.blackboard_enabled),
            require_synthesis: options
                .require_synthesis
                .unwrap_or(defaults.require_synthesis),
            ..defaults
        };
        // M1-7/8：单节点链构图期校验（注册表提供 kind 声明）
        verify_single_node_pipeline("multi_agent", "multi_agent", agent_runtime::node::NodeType::MultiAgent)?;
        let mut orch = DefaultOrchestrator::new().with_backend(backend.clone());
        orch.add_node(Box::new(MultiAgentNode::new(
            "multi_agent", "MultiAgent", options.specs, backend, tool_bus, config,
        )));
        orch.set_entry("multi_agent");
        let orch = Arc::new(orch);
        orch.subscribe(Arc::new(ForwardToAgentBroadcaster {
            target: agent.broadcaster_ref(),
        }));
        let result = self
            .run_with_active_orchestrator(
                Arc::clone(&orch),
                orch.run(
                    input,
                    Some(OrchestratorRunOptions {
                        run_id: Some(run_id.clone()),
                        pipeline: Some("multi-agent".to_string()),
                        node_timeout_ms: options.node_timeout_ms,
                        ..Default::default()
                    }),
                ),
            )
            .await
            .map_err(|e| CommandError::Agent(format!("Multi-Agent 执行失败: {e}")))?;
        // FIX-1 闭环（M5-RK3 补验修复）：交接物全文写入 RunStore（get_artifact 查询源）
        for artifact in &result.artifacts {
            self.runs.add_artifact(&run_id, artifact.clone()).await;
        }
        self.runs
            .finish(
                &run_id,
                to_run_status(result.status),
                result.converge_reason,
                result.final_message.clone(),
            )
            .await;
        Ok(result)
    }

    /// 按 run_id 查 run 实体（B22 / FIX-1：迹线回看与调试用）
    pub async fn get_run(&self, run_id: &str) -> Option<OrchestrationRun> {
        self.runs.get(run_id).await
    }

    /// 按 artifact_id 取物全文（D23「事件轻、物权威」闭环 / FIX-1）
    pub async fn get_artifact(&self, artifact_id: &str) -> Option<HandoverArtifact> {
        self.runs.get_artifact(artifact_id).await
    }

    /// 按会话列 run（B11：事件按 run_id 隔离；调试与 M2 迹线兜底）
    pub async fn list_session_runs(&self, session_id: &str) -> Vec<OrchestrationRun> {
        self.runs.list_by_session(session_id).await
    }

    /// 会话列表（默认只返回单聊会话；群聊参与者会话走 [`Self::list_group_session_participants`] 按群聊查询）
    ///
    /// `kind` 为 `Some` 时按类型过滤（`Some(Chat)` 供单聊侧边栏避免污染）。
    pub async fn list_sessions(&self, kind: Option<SessionKind>) -> Result<Vec<SessionInfo>, CommandError> {
        let mut list: Vec<SessionInfo> = {
            let meta = self.meta.lock().await;
            meta.values()
                .filter(|s| kind.map_or(true, |k| s.kind == k))
                .cloned()
                .collect()
        };
        // Phase A：workspace_id 存在但 workdir 缺失时，用 workspaces.root 兜底，
        // 保证前端会话树按目录分组不回归（workdir 为实体 root 派生）。
        if list
            .iter()
            .any(|s| s.workspace_id.is_some() && s.workdir.is_none())
        {
            if let Some(store) = &self.session_store {
                let workspaces = store.list_workspaces().await?;
                let mut root_by_id: HashMap<String, String> = HashMap::new();
                for ws in &workspaces {
                    root_by_id.insert(ws.id.clone(), ws.root.clone());
                }
                for s in list.iter_mut() {
                    if s.workdir.is_none() {
                        if let Some(ws_id) = &s.workspace_id {
                            if let Some(root) = root_by_id.get(ws_id) {
                                s.workdir = Some(root.clone());
                            }
                        }
                    }
                }
            }
        }
        list.sort_by_key(|s| s.created_at);
        Ok(list)
    }

    /// 从持久化存储加载全部会话并重建 AgentLoop（应用启动时调用）
    ///
    /// 未注入持久化存储时返回空列表（调用方按无历史处理）。重建时复用
    /// [`Self::new_agent`]（注入记忆/子 Agent 工具），并以其持久化的消息历史
    /// 恢复 AgentLoop 状态——`run()` 对已含 system 消息的状态去重，不会重复注入。
    pub async fn restore_sessions(&self) -> Result<Vec<SessionInfo>, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(Vec::new()),
        };
        let records = store.load_sessions().await?;
        // Phase A：预载 workspace_id → root 映射，供按实体还原 workdir root（一次查询）
        let mut root_by_wsid: HashMap<String, String> = HashMap::new();
        if let Ok(workspaces) = store.list_workspaces().await {
            for ws in &workspaces {
                root_by_wsid.insert(ws.id.clone(), ws.root.clone());
            }
        }
        let mut restored = Vec::with_capacity(records.len());
        for record in records {
            // 重建 AgentLoop（provider 用默认占位，前端按需 set_provider_config）
            // workdir：优先按 workspace_id → workspaces.root 还原；无实体时退回持久化 workdir 列
            let workspace_id = record.workspace_id.clone();
            let workdir_str = match workspace_id.as_ref().and_then(|id| root_by_wsid.get(id)) {
                Some(root) => Some(root.clone()),
                None => record.workdir.clone(),
            };
            let workdir = workdir_str.clone().map(PathBuf::from);
            let (agent, sub_agent_manager) = self
                .new_agent(
                    &record.id,
                    Some(record.system_prompt),
                    None,
                    None,
                    workdir,
                    workspace_id.clone(),
                )
                .await;
            // 恢复消息历史（含 system 首条）
            let messages = store.load_messages(&record.id).await?;
            // X1 修复：message_count 从实际恢复的消息数派生——sessions 表的该列仅创建期
            // 写入、不随 persist_messages 更新，重启后若读列值会「归 0」，改为派生杜绝该问题
            let message_count = messages.len() as u32;
            // A4 Plan-Exec：恢复持久化的计划
            let plan = store.load_plan(&record.id).await?;
            agent
                .restore_state(AgentState {
                    messages,
                    current_iteration: 0,
                    total_steps_used: 0,
                    budget_warn_80_notified: false,
                    budget_warn_95_notified: false,
                    budget_final_notified: false,
                    aborted: false,
                    paused: false,
                    plan,
                })
                .await;
            // 注册回服务
            self.sessions.lock().await.insert(record.id.clone(), agent);
            self.subagent_managers
                .lock()
                .await
                .insert(record.id.clone(), sub_agent_manager);
            let info = SessionInfo {
                id: record.id.clone(),
                created_at: record.created_at,
                message_count,
                title: record.title.clone(),
                pinned: record.pinned,
                kind: record.kind,
                workdir: workdir_str,
                workspace_id: workspace_id,
                project_id: record.project_id,
            };
            self.meta.lock().await.insert(record.id.clone(), info.clone());
            restored.push(info);
        }
        restored.sort_by_key(|s| s.created_at);
        Ok(restored)
    }

    /// 创建群聊参与者会话（kind='group' + 写 participantId↔sessionId 映射）
    ///
    /// 供前端 `createRustGroupChatBackend` 在群聊场景调用：建独立 AgentLoop 会话，
    /// 并持久化 `group_id → participant_id → session_id` 映射，重启后可按群聊恢复。
    /// 模型热切换由前端创建后经 `update_model` 完成（与单聊路径一致），此处不重复。
    pub async fn create_group_session_participant(
        &self,
        group_id: &str,
        participant_id: &str,
        system_prompt: Option<String>,
        provider_config: Option<RuntimeProviderConfig>,
    ) -> Result<GroupParticipantSessionInfo, CommandError> {
        let info = self
            .new_session_with_kind(system_prompt, provider_config, SessionKind::Group, None, None, None)
            .await?;
        // 写映射（持久化；失败弱提示——会话仍可用，仅重启后无法恢复定位）
        if let Some(store) = &self.session_store {
            if let Err(e) = store
                .save_group_participant(group_id, participant_id, &info.id)
                .await
            {
                tracing::warn!("持久化群聊参与者会话映射失败: {e}");
            }
        }
        Ok(GroupParticipantSessionInfo {
            participant_id: participant_id.to_string(),
            session_id: info.id,
        })
    }

    /// 按群聊 id 查询参与者会话映射（重启后恢复群聊用）
    pub async fn list_group_session_participants(
        &self,
        group_id: &str,
    ) -> Result<Vec<GroupParticipantSessionInfo>, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(Vec::new()),
        };
        let rows = store.load_group_participants(group_id).await?;
        Ok(rows
            .into_iter()
            .map(|(participant_id, session_id)| GroupParticipantSessionInfo {
                participant_id,
                session_id,
            })
            .collect())
    }

    /// 删除群聊全部参与者会话（级联：逐会话删除 + 清映射行）
    pub async fn delete_group_session_participants(&self, group_id: &str) -> Result<(), CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(()),
        };
        let rows = store.load_group_participants(group_id).await?;
        for (_, session_id) in rows {
            self.delete_session(&session_id).await?;
        }
        store.delete_group_participants(group_id).await?;
        Ok(())
    }

    /// 删除会话
    ///
    /// 同时从持久化存储删除（消息级联清除），并清理该会话的孤儿记忆。
    pub async fn delete_session(&self, session_id: &str) -> Result<(), CommandError> {
        let mut sessions = self.sessions.lock().await;
        let mut meta = self.meta.lock().await;
        self.subagent_managers.lock().await.remove(session_id);
        sessions.remove(session_id);
        meta.remove(session_id);
        drop(sessions);
        drop(meta);
        // 持久化删除（消息级联）
        if let Some(store) = &self.session_store {
            if let Err(e) = store.delete_session(session_id).await {
                tracing::warn!("删除持久化会话失败: {e}");
            }
        }
        // 孤儿记忆清理：删除会话同时删除该会话在记忆库中的记录
        if let Ok(Some(memory)) = self.get_memory_before_drop(session_id).await {
            if let Err(e) = memory.delete_by_session_id(session_id).await {
                tracing::warn!("清理会话 {session_id} 孤儿记忆失败: {e}");
            }
        }
        Ok(())
    }

    /// 删除会话前的记忆访问器获取（会话仍存在时取到，供级联清理）
    ///
    /// 与 [`Self::get_memory`] 的区别：`get_memory` 走 `get_agent`（会话必须存在），
    /// 而 `delete_session` 内部已移除内存会话，故需在移除前独立取一次访问器。
    async fn get_memory_before_drop(&self, session_id: &str) -> Result<Option<Arc<dyn MemoryAccessor>>, CommandError> {
        let agent = {
            let sessions = self.sessions.lock().await;
            sessions.get(session_id).cloned()
        };
        Ok(agent.map(|a| a.memory()).flatten())
    }

    /// 重命名会话标题（更新内存 meta + 写穿持久化存储）
    pub async fn update_session_title(
        &self,
        session_id: &str,
        title: &str,
    ) -> Result<(), CommandError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(CommandError::InvalidArgument("标题不能为空".into()));
        }
        {
            let mut meta = self.meta.lock().await;
            let Some(info) = meta.get_mut(session_id) else {
                return Err(CommandError::session_not_found(session_id));
            };
            info.title = title.to_string();
        }
        if let Some(store) = &self.session_store {
            if let Err(e) = store.update_title(session_id, title).await {
                tracing::warn!("持久化会话标题失败: {e}");
            }
        }
        Ok(())
    }

    /// 更新会话绑定的工作区根目录（写穿持久化）。目录选择器切换工作区时同步当前会话归属，
    /// 使侧边栏会话树按新目录分组。workdir=None 表示不限定。
    pub async fn update_session_workdir(
        &self,
        session_id: &str,
        workdir: Option<String>,
    ) -> Result<(), CommandError> {
        // 同步内存会话元数据缓存（list_sessions 读 meta，不更新则列表仍显示旧目录）
        {
            let mut meta = self.meta.lock().await;
            let Some(info) = meta.get_mut(session_id) else {
                return Err(CommandError::session_not_found(session_id));
            };
            info.workdir = workdir.clone();
        }
        if let Some(store) = &self.session_store {
            store
                .update_workdir(session_id, workdir.as_deref())
                .await
                .map_err(|e| CommandError::Internal(format!("更新会话工作区目录失败: {e}")))?;
        }
        Ok(())
    }

    /// 更新会话 system prompt（H5 风险点③ 动态刷新，2026-08-30）
    ///
    /// 技能索引/规则文件中途变更时由前端调用：重建后的完整 system prompt 推送到
    /// 该会话 AgentLoop（下一轮 build_prompt_options 即生效）并写穿持久化
    /// （sessions.system_prompt，重启后 restore_sessions 用新值重建）。
    pub async fn update_session_system_prompt(
        &self,
        session_id: &str,
        system_prompt: Option<String>,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.set_system_prompt(system_prompt.clone()).await;
        if let Some(store) = &self.session_store {
            store
                .update_system_prompt(session_id, system_prompt.as_deref())
                .await?;
        }
        Ok(())
    }

    /// 生成会话标题（Phase 5：LLM 异步生成，首条消息 + 首条回复 → 轻量模型 → ≤60 字符）
    ///
    /// # 流程
    /// 1. 标题锁定：仅当当前标题为「新会话」时才覆盖（用户已手动重命名则不覆盖）。
    /// 2. 拼接「首条消息 + 首条回复」（各截断 600 字符），调 LLM 生成简洁标题。
    /// 3. 复用当前会话的 Provider 配置，但新建独立 `GenaiBackend`——单次生成不污染
    ///    会话消息历史（`prompt` 会把 user/assistant 消息推入自身 backend 消息表）。
    /// 4. 生成成功 → 更新标题（复用 `update_session_title`，含写穿持久化）并返回新标题；
    ///    失败/模型不可用 → 保留「新会话」占位（不阻断前端，等待下一次首消息再试）。
    ///
    /// 返回实际生效的标题（未改动时返回原标题/占位）。
    pub async fn generate_session_title(
        &self,
        session_id: &str,
        first_message: &str,
        first_reply: &str,
    ) -> Result<String, CommandError> {
        // 标题锁定：仅当前标题为「新会话」才生成覆盖（手动重命名不覆盖）
        {
            let meta = self.meta.lock().await;
            if let Some(info) = meta.get(session_id) {
                if info.title != "新会话" {
                    return Ok(info.title.clone());
                }
            }
        }
        let agent = self.get_agent(session_id).await?;
        // 复用会话当前 Provider 配置（含 API Key），单次生成，避免污染会话消息历史
        let config = agent
            .current_provider_config()
            .await
            .unwrap_or_else(Self::default_provider_config);
        let backend = GenaiBackend::new(config);
        // 拼接并截断首条消息/首条回复（各 600 字符）作为生成依据
        let input = format!(
            "用户首条消息：{}\n\n助手首条回复：{}",
            truncate_chars(first_message, 600),
            truncate_chars(first_reply, 600)
        );
        let options = PromptCallOptions {
            // 系统提示：生成 ≤60 字符简洁标题，匹配用户语言，名词短语优先，不逐字复制请求
            system_prompt_override: Some(
                "生成一个不超过60字符的简洁会话标题。要求：匹配用户语言，名词短语优先，\
                 提炼对话主题，不要逐字复制请求原文，不要引号或多余标点。只输出标题本身。"
                    .into(),
            ),
            max_tokens: Some(64),
            ..Default::default()
        };
        // 标题生成：偶发 LLM 失败（DeepSeek 限流/超时）会直接降级「新会话」，
        // 首条消息仅触发一次生成，失败则该会话永久留占位 → 重试 1 次提升成功率（L2 优化）
        let mut generated = String::new();
        let mut last_err = String::new();
        for attempt in 0..2u32 {
            match backend.prompt(input.clone(), Some(options.clone())).await {
                Ok(resp) => {
                    let t = resp.text.trim().to_string();
                    if !t.is_empty() {
                        generated = t;
                        break;
                    }
                    last_err = "空响应".into();
                }
                Err(e) => {
                    last_err = e.to_string();
                    tracing::warn!(attempt, "会话标题生成失败，准备重试: {e}");
                }
            }
        }
        if generated.is_empty() {
            // 两次失败降级：保留「新会话」占位，记录日志（不阻断前端输出流）
            tracing::warn!("会话标题生成失败（重试后仍失败），保留占位「新会话」: {last_err}");
            return Ok("新会话".into());
        }
        // 重入校验标题锁定：LLM 调用期间用户可能已手动重命名（title ≠ 新会话），
        // 此时不得再覆盖（避免把用户起的标题覆盖掉）。
        {
            let meta = self.meta.lock().await;
            if let Some(info) = meta.get(session_id) {
                if info.title != "新会话" {
                    return Ok(info.title.clone());
                }
            }
        }
        // 截断到 60 字符并写穿持久化（update_session_title 内含标题非空校验）
        let title = truncate_chars(&generated, 60);
        self.update_session_title(session_id, &title).await?;
        Ok(title)
    }

    /// 设置会话固定状态（更新内存 meta + 写穿持久化存储）
    pub async fn set_session_pinned(
        &self,
        session_id: &str,
        pinned: bool,
    ) -> Result<(), CommandError> {
        {
            let mut meta = self.meta.lock().await;
            let Some(info) = meta.get_mut(session_id) else {
                return Err(CommandError::session_not_found(session_id));
            };
            info.pinned = pinned;
        }
        if let Some(store) = &self.session_store {
            if let Err(e) = store.set_pinned(session_id, pinned).await {
                tracing::warn!("持久化会话固定状态失败: {e}");
            }
        }
        Ok(())
    }

    // ── 会话级记忆（阶段 4：前端 ArchivePanel 迁移后端）────────────────

    /// 获取会话记忆访问器（未启用记忆时返回 None）
    async fn get_memory(&self, session_id: &str) -> Result<Option<Arc<dyn MemoryAccessor>>, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.memory())
    }

    /// 记忆列表（空查询=全量，按时间排序），支持可选关键词过滤
    pub async fn memory_list(
        &self,
        session_id: &str,
        keyword: Option<String>,
        limit: Option<u32>,
    ) -> Result<Vec<MemoryRecallResult>, CommandError> {
        let memory = self
            .get_memory(session_id)
            .await?
            .ok_or_else(|| CommandError::Internal(format!("会话 {session_id} 未启用记忆后端")))?;
        let opts = MemoryRecallOptions {
            mode: RecallMode::List,
            top_k: limit.unwrap_or(50),
            ..Default::default()
        };
        let results = memory.recall(keyword.unwrap_or_default(), Some(opts)).await?;
        Ok(results)
    }

    /// 记忆检索（关键词）
    pub async fn memory_recall(
        &self,
        session_id: &str,
        query: String,
        top_k: Option<u32>,
    ) -> Result<Vec<MemoryRecallResult>, CommandError> {
        let memory = self
            .get_memory(session_id)
            .await?
            .ok_or_else(|| CommandError::Internal(format!("会话 {session_id} 未启用记忆后端")))?;
        let opts = MemoryRecallOptions {
            mode: RecallMode::Hybrid,
            top_k: top_k.unwrap_or(5),
            ..Default::default()
        };
        let results = memory.recall(query, Some(opts)).await?;
        Ok(results)
    }

    /// 手动触发归档（消费缓冲轮次）
    pub async fn memory_archive(
        &self,
        session_id: &str,
    ) -> Result<Option<MemoryArchiveResult>, CommandError> {
        let memory = self
            .get_memory(session_id)
            .await?
            .ok_or_else(|| CommandError::Internal(format!("会话 {session_id} 未启用记忆后端")))?;
        Ok(memory.archive(Some(ArchiveSource::Manual)).await?)
    }

    /// 加载记忆块完整内容
    pub async fn memory_load_chunk(
        &self,
        session_id: &str,
        hook_id: String,
        chunk_id: String,
    ) -> Result<Option<MemoryChunkContent>, CommandError> {
        let memory = self
            .get_memory(session_id)
            .await?
            .ok_or_else(|| CommandError::Internal(format!("会话 {session_id} 未启用记忆后端")))?;
        Ok(memory.load_chunk(hook_id, chunk_id).await?)
    }

    /// 获取当前归档边界
    pub async fn memory_boundary(&self, session_id: &str) -> Result<usize, CommandError> {
        let memory = self
            .get_memory(session_id)
            .await?
            .ok_or_else(|| CommandError::Internal(format!("会话 {session_id} 未启用记忆后端")))?;
        Ok(memory.get_archive_boundary().await?)
    }

    // ── 对话主链路 ────────────────────────────────────

    /// M5-RK1：按模式前缀分发到专属 run_* 编排（send_message 模式分流调用）
    ///
    /// 特权/委派类（supervisor/multi）需要规格：无规格时返回**明确引导错误**
    /// （反模式 6「永不静默降级」——不偷偷退回 plan_execute，让用户知道差什么）。
    async fn run_mode_prefix(
        &self,
        session_id: &str,
        mode: ModePrefix,
        text: String,
    ) -> Result<OrchestratorResult, CommandError> {
        match mode {
            ModePrefix::Plan => self
                .run_plan_execute(
                    session_id,
                    text,
                    PlanExecuteOptions {
                        refine: true,
                        ..Default::default()
                    },
                )
                .await,
            ModePrefix::Tot => self.run_tot(session_id, text, ToTExecuteOptions::default()).await,
            ModePrefix::Got => self.run_got(session_id, text, GoTExecuteOptions::default()).await,
            ModePrefix::Supervisor => {
                let specs = self.list_subagent_specs().await;
                if specs.is_empty() {
                    return Err(CommandError::Agent(
                        "/supervisor 需先配置子 Agent 规格：请先注册至少一个子 Agent（设置→子Agent）后再委派"
                            .into(),
                    ));
                }
                self.run_supervisor(
                    session_id,
                    text,
                    SupervisorExecuteOptions {
                        specs,
                        max_rounds: None,
                        node_timeout_ms: None,
                    },
                )
                .await
            }
            ModePrefix::Multi => {
                // MultiAgent 每个参与 Agent 需完整规格（system_prompt/角色），无全局默认阵容；
                // 空规格会黑盒失败，此处显式引导走右栏「多Agent」面板选择阵容。
                Err(CommandError::Agent(
                    "/multi 需显式指定协作阵容：请在右侧「多Agent」面板选择参与 Agent 与黑板书配置后运行"
                        .into(),
                ))
            }
        }
    }

    /// 发送消息（ReAct 循环执行）
    pub async fn send_message(&self, params: SendMessageParams) -> Result<SendMessageResult, CommandError> {
        let agent = self.get_agent(&params.session_id).await?;
        // 2026-09-02 统一待办：/plan 前缀与研究判型不再进 B 轨独立管线（run_plan_execute 退役不触发），
        // 统一注入待办引导走主 Agent react 链——模型用 plan_create 建待办、严格串行执行。
        // M5-RK1：其余命令前缀（/tot /got /supervisor /multi）仍直通专属 run_* 编排。
        let mut react_text = params.text.clone();
        if let Some(mode) = extract_mode_prefix(&params.text) {
            let text = strip_first_token(&params.text);
            if text.is_empty() {
                return Err(CommandError::Internal(
                    "模式前缀后缺少任务描述（如 /tot 你的问题）".into(),
                ));
            }
            if mode == ModePrefix::Plan {
                // 统一待办：/plan → 待办引导 + react 链（跳过下方判型）
                react_text = format!("{text}\n\n{PLAN_TODO_GUIDANCE}");
            } else {
                let result = self.run_mode_prefix(&params.session_id, mode, text).await?;
                // X1 修复：编排路径收口——用户消息+终稿入环、message_count 回写、写穿持久化
                // （此前仅 react 路径持久化，run_mode_prefix 编排消息零落库 → 刷新即丢历史）
                self.finalize_orchestration_turn(
                    &params.session_id,
                    &params.text,
                    result.final_message.as_deref(),
                )
                .await;
                let usage = agent.get_usage().await;
                let state = agent.get_state_snapshot().await;
                return Ok(SendMessageResult {
                    session_id: params.session_id,
                    reply: result.final_message.unwrap_or_default(),
                    state,
                    usage: SessionUsageSummary {
                        input_tokens: usage.input_tokens,
                        output_tokens: usage.output_tokens,
                    },
                });
            }
        }
        // M4-2/M4-5（A1 自动为主 + B10 缓存）：判型 = force_pipeline 前缀 → 请求级缓存 → LLM 预判型。
        // 非 query（研究/实验/创作）自动进编排：转 run_plan_execute（编排 run 发 orchestration_trace
        // 事件 → 前端编排段浮现 = 判型结果 = run 形状，B22）；Query / 无命中 → 快问答退化 run
        // （react，无编排段 = C20 分级透明）。
        let forced = agent_runtime::router::extract_force_pipeline(&params.text);
        let target = if let Some(p) = forced {
            p
        } else {
            // B10：同会话同文本缓存命中则复用（不重复 LLM 判型）
            let cache_key = (params.session_id.clone(), params.text.clone());
            let cached = self.pipeline_cache.lock().await.get(&cache_key).copied();
            if let Some(p) = cached {
                p
            } else {
                // LLM 预判型（classify_pipeline 复用 AgentLoop 判型链路；3s 超时降级 query）
                let p = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    agent.classify_pipeline(&params.text),
                )
                .await
                .ok()
                .flatten()
                .unwrap_or(Pipeline::Query);
                let mut cache = self.pipeline_cache.lock().await;
                if cache.len() >= 128 {
                    cache.clear();
                }
                cache.insert(cache_key, p);
                p
            }
        };
        let is_complex = matches!(
            target,
            Pipeline::Research | Pipeline::Experiment | Pipeline::Compose
        );
        if is_complex {
            // 2026-09-02 统一待办：复杂判型不再进 B 轨独立管线，注入待办引导落 react 链。
            // 有前缀（/调研 等 Chip）才剥离首 token；/plan 前缀已在上方注入过引导（防重复）。
            if !react_text.contains(PLAN_TODO_GUIDANCE) {
                let text = if forced.is_some() {
                    strip_first_token(&params.text)
                } else {
                    params.text.clone()
                };
                if !text.is_empty() {
                    react_text = format!("{text}\n\n{PLAN_TODO_GUIDANCE}");
                }
            }
        }

        // M4-1（B22）：send_message 亦建 run——快问答 = 退化 run（单阶段 ReAct，无编排段 = C20 分级透明）。
        // 退化 run 不产生 orchestration_trace 事件（未走编排引擎），前端据此天然无感。
        let run_id = self
            .runs
            .create(&params.session_id, None, Some("react".to_string()))
            .await;
        let agent = match self.get_agent(&params.session_id).await {
            Ok(a) => a,
            Err(e) => {
                self.runs
                    .finish(&run_id, RunStatus::Error, None, Some(e.to_string()))
                    .await;
                return Err(e);
            }
        };
        let reply = match agent.run(react_text).await {
            Ok(r) => r,
            Err(e) => {
                let msg = e.to_string();
                self.runs
                    .finish(&run_id, RunStatus::Error, None, Some(msg.clone()))
                    .await;
                return Err(e.into());
            }
        };
        let state = agent.get_state_snapshot().await;
        // 更新会话消息数
        let count = state.messages.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(&params.session_id) {
            meta.message_count = count;
        }
        // 写穿消息快照到持久化存储
        self.persist_messages(&params.session_id).await;
        // 读取会话累计用量
        let usage = agent.get_usage().await;
        self.runs
            .finish(
                &run_id,
                RunStatus::Completed,
                Some(ConvergeReason::GoalReached),
                Some(reply.clone()),
            )
            .await;
        Ok(SendMessageResult {
            session_id: params.session_id,
            reply,
            state,
            usage: SessionUsageSummary {
                input_tokens: usage.input_tokens,
                output_tokens: usage.output_tokens,
            },
        })
    }

    /// A7 安全级别（前端设置开关，运行时切换确认策略）
    ///
    /// 对应 `ConfirmationPolicy` 三档：`Off`/`DangerousOnly`(默认)/`ModerateAndDangerous`。
    pub async fn set_security_level(
        &self,
        session_id: &str,
        level: SecurityLevel,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        let policy = match level {
            SecurityLevel::Off => None,
            SecurityLevel::DangerousOnly => Some(ConfirmationPolicy::dangerous_only()),
            SecurityLevel::ModerateAndDangerous => {
                Some(ConfirmationPolicy::moderate_and_dangerous())
            }
        };
        agent.set_confirmation_policy(policy);
        Ok(())
    }

    /// 解析一次待定的工具确认（HITL，A5）
    ///
    /// 前端在 `agent:confirm:{session_id}` 弹窗后调用，`approved=true` 放行、
    /// `false` 拒绝。返回是否成功唤醒对应等待方（confirm_id 已超时/已处理时 false）。
    pub async fn resolve_confirmation(
        &self,
        session_id: &str,
        confirm_id: &str,
        approved: bool,
    ) -> Result<bool, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.resolve_confirmation(confirm_id, approved).await)
    }

    /// 中途引导（steer，对应前端 sendBlockAction）
    ///
    /// M4-6（FIX-3 / D21 插话门）：有活跃编排 run → steer 进编排器节点边界队列（不中断链）；
    /// 否则走 AgentLoop steer（react 路径原语义）。
    pub async fn steer(&self, session_id: &str, text: String) -> Result<(), CommandError> {
        if let Some(orch) = self.active_orchestrator.read().await.clone() {
            orch.push_steer(text);
            return Ok(());
        }
        let agent = self.get_agent(session_id).await?;
        agent.steer(text).await.map_err(CommandError::from)
    }

    /// 中断当前运行
    pub async fn abort(&self, session_id: &str) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.abort().await;
        Ok(())
    }

    /// 清空历史
    pub async fn clear_history(&self, session_id: &str) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.clear_history().await;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = 0;
        }
        // 写穿清空后的空消息快照
        self.persist_messages(session_id).await;
        Ok(())
    }

    /// 清理上下文窗口（移除前 up_to_index 条消息，同步 backend 与 state）
    ///
    /// 对应前端 `trimContext(upToIndex)`。用于长对话压缩上下文窗口，
    /// 避免超出模型 context window。移除后按剩余消息数刷新会话 message_count。
    pub async fn trim_context(&self, session_id: &str, up_to_index: usize) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.trim_context(up_to_index).await?;
        let count = agent.get_messages().await.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = count;
        }
        // 写穿压缩后的消息快照
        self.persist_messages(session_id).await;
        Ok(())
    }

    /// X1 修复：编排路径收口——把本轮「用户消息 + 终稿回复」追加进会话 AgentLoop 历史，
    /// 回写 meta.message_count 并写穿持久化（对齐 react 路径语义；编排引擎本身不触碰会话历史）。
    /// reply 为空（异常收敛）时只入环用户消息，避免空 assistant 轮污染上下文。
    async fn finalize_orchestration_turn(
        &self,
        session_id: &str,
        user_text: &str,
        reply: Option<&str>,
    ) {
        let agent = match self.sessions.lock().await.get(session_id).cloned() {
            Some(a) => a,
            None => return,
        };
        let mut msgs = vec![OrchestratorMessage {
            role: MessageRole::User,
            content: user_text.to_string(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            meta: None,
        }];
        if let Some(reply) = reply.filter(|r| !r.is_empty()) {
            msgs.push(OrchestratorMessage {
                role: MessageRole::Assistant,
                content: reply.to_string(),
                tool_calls: Vec::new(),
                tool_call_id: None,
                meta: None,
            });
        }
        agent.append_messages(msgs).await;
        let count = agent.get_messages().await.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = count;
        }
        self.persist_messages(session_id).await;
    }

    /// 写穿某会话当前消息快照到持久化存储（弱提示：失败仅记日志不阻断）
    async fn persist_messages(&self, session_id: &str) {
        let Some(store) = &self.session_store else {
            return;
        };
        let agent = match self.sessions.lock().await.get(session_id).cloned() {
            Some(a) => a,
            None => return,
        };
        let messages = agent.get_messages().await;
        if let Err(e) = store.replace_messages(session_id, &messages).await {
            tracing::warn!("持久化会话 {session_id} 消息失败: {e}");
        }
        // A4 Plan-Exec：随消息一并写穿当前计划（与消息同生命周期，send_message 后持久化）
        let plan = agent.get_plan().await;
        if let Err(e) = store.save_plan(session_id, &plan).await {
            tracing::warn!("持久化会话 {session_id} 计划失败: {e}");
        }
    }

    /// R6 第二部分：动作段事件持久化收口——把本会话累积的动作段事件（tauri emitter 缓冲）
    /// merge 进「最后一条 assistant 消息」的 meta.action_events（零迁移：`OrchestratorMessage.meta`
    /// 已有 HashMap 槽；追加语义，重复调用累计在同一消息），随后写穿持久化。
    /// 回源时按数组序重建（事件序 = 时间序，与实时流严格对齐）。
    pub async fn flush_action_events(&self, session_id: &str, events: Vec<serde_json::Value>) {
        let agent = match self.sessions.lock().await.get(session_id).cloned() {
            Some(a) => a,
            None => return,
        };
        agent.merge_last_assistant_meta("action_events", events).await;
        let count = agent.get_messages().await.len() as u32;
        if let Some(meta) = self.meta.lock().await.get_mut(session_id) {
            meta.message_count = count;
        }
        self.persist_messages(session_id).await;
    }

    // ── 目录实体（Workdir）──────────────────────────────────

    /// 列出全部目录实体（前端目录空间选择器 / 会话树分组用）
    ///
    /// 未注入持久化存储时返回空列表（调用方按无目录实体处理）。
    pub async fn list_workdirs(&self) -> Result<Vec<WorkdirRecord>, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(Vec::new()),
        };
        store.list_workdirs().await
    }

    /// 写入/覆盖一个目录实体（按 path 去重），返回 upsert 后的记录
    ///
    /// 未注入持久化存储时返回错误（目录实体必须先配库才能保存）。
    pub async fn save_workdir(
        &self,
        path: String,
        label: String,
    ) -> Result<WorkdirRecord, CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => {
                return Err(CommandError::Internal(
                    "未配置目录持久化存储，无法保存目录实体".into(),
                ))
            }
        };
        store.upsert_workdir(&path, &label).await
    }

    /// 删除一个目录实体（按 id）
    ///
    /// 未注入持久化存储时不作操作（按成功处理）。
    pub async fn delete_workdir(&self, id: String) -> Result<(), CommandError> {
        let store = match &self.session_store {
            Some(s) => s.clone(),
            None => return Ok(()),
        };
        store.delete_workdir(&id).await
    }

    // ── 子 Agent 编排 ────────────────────────────────────

    /// 注册一个子 Agent 规格（同名按 id 覆盖）
    ///
    /// 注册后，后续创建/已有会话的主 Agent 都可通过 `list_sub_agents` 查看、
    /// 通过 `delegate_to_sub_agent` 委派任务。规格注册表跨会话共享。
    ///
    /// 同名（相同 `id`）规格会覆盖旧定义，避免重复 push 导致列表出现重复项。
    /// 若配置了持久化存储，本方法会**写穿**到存储（异步，失败仅记日志不阻断内存更新）。
    pub async fn register_subagent_spec(&self, spec: SubAgentSpec) {
        {
            let mut specs = self.subagent_specs.write().await;
            if let Some(existing) = specs.iter_mut().find(|s| s.id == spec.id) {
                *existing = spec.clone();
            } else {
                specs.push(spec.clone());
            }
        } // 释放写锁后再写库，避免 DB I/O 期间阻塞其他读
        if let Some(store) = &self.subagent_store {
            if let Err(e) = store.upsert(&spec).await {
                tracing::warn!("持久化子 Agent 规格失败（仅内存生效）: {e}");
            }
        }
    }

    /// 删除一个子 Agent 规格（按 id）
    ///
    /// 返回是否删除成功（id 不存在时返回 `false`）。仅操作共享注册表，
    /// 不影响子 Agent 实例池——池中实例懒加载，下次委派按最新规格重建。
    /// 若配置了持久化存储，删除会**写穿**到存储。
    pub async fn remove_subagent_spec(&self, id: &str) -> bool {
        let removed = {
            let mut specs = self.subagent_specs.write().await;
            let before = specs.len();
            specs.retain(|s| s.id != id);
            specs.len() != before
        };
        if removed {
            if let Some(store) = &self.subagent_store {
                if let Err(e) = store.remove(id).await {
                    tracing::warn!("删除持久化子 Agent 规格失败: {e}");
                }
            }
        }
        removed
    }

    /// 列出已注册的子 Agent 规格
    pub async fn list_subagent_specs(&self) -> Vec<SubAgentSpec> {
        self.subagent_specs.read().await.clone()
    }

    /// 列出某会话子 Agent 实例池中所有活跃实例的对外信息
    ///
    /// 实例池按会话隔离：返回该 `session_id` 对应 `SubAgentManager` 的实例快照。
    /// 会话不存在时返回 [`CommandError::session_not_found`]。
    pub async fn list_subagent_instances(
        &self,
        session_id: &str,
    ) -> Result<Vec<SubAgentInstanceInfo>, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.list_instances().await)
    }

    /// 清空某会话的单个子 Agent 实例（重置其累积上下文）
    ///
    /// 返回是否成功移除（该 id 在实例池中不存在时返回 `false`）。
    /// 清空后该子 Agent 下次委派时按最新注册规格懒加载重建（全新上下文）。
    /// 与 [`Self::clear_subagent_instances`] 的清空全部互补，用于只重置
    /// 某个行为异常/上下文膨胀的单个子 Agent，而不影响其他实例。
    pub async fn clear_subagent_instance(
        &self,
        session_id: &str,
        sub_agent_id: &str,
    ) -> Result<bool, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.clear_instance(sub_agent_id).await)
    }

    /// 清空某会话的全部子 Agent 实例（重置累积上下文）
    ///
    /// 返回被清空的实例数量。清空后该会话下次委派时按最新注册规格重建实例。
    /// 单聊会话常用 `clear_agent_pool` 清主 Agent 上下文，子 Agent 实例池此前
    /// 无对应能力，本方法补齐该缺口。
    pub async fn clear_subagent_instances(&self, session_id: &str) -> Result<usize, CommandError> {
        let manager = self
            .subagent_managers
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| CommandError::session_not_found(session_id))?;
        Ok(manager.clear_instances().await)
    }

    /// 导出全部子 Agent 规格为 JSON 字符串（pretty 打印，便于人读与 diff）
    ///
    /// 用作备份或跨机器迁移：前端把返回的 JSON 保存为文件，换机后通过
    /// [`Self::import_subagent_specs`] 恢复。
    pub async fn export_subagent_specs(&self) -> Result<String, CommandError> {
        let specs = self.list_subagent_specs().await;
        serde_json::to_string_pretty(&specs)
            .map_err(|e| CommandError::Internal(format!("序列化子 Agent 规格失败: {e}")))
    }

    /// 从 JSON 字符串导入子 Agent 规格（按 id 覆盖，等同逐条 register）
    ///
    /// 接受 [`Self::export_subagent_specs`] 产生的数组 JSON。返回实际导入条数；
    /// JSON 结构非法或任一条规格校验不过时返回 [`CommandError`]（此时不写入任何规格，
    /// 保持原子性——要么全部导入，要么全部不导入）。
    pub async fn import_subagent_specs(&self, json: &str) -> Result<usize, CommandError> {
        let specs: Vec<SubAgentSpec> = serde_json::from_str(json)
            .map_err(|e| CommandError::Internal(format!("解析子 Agent 规格 JSON 失败: {e}")))?;
        // 先整体校验，任一非法即整体拒绝，避免部分写入
        for spec in specs.iter() {
            validate_subagent_spec(spec).map_err(CommandError::invalid_argument)?;
        }
        for spec in specs.iter() {
            self.register_subagent_spec(spec.clone()).await;
        }
        Ok(specs.len())
    }

    // ── 状态 / 消息查询 ────────────────────────────────────

    /// 状态快照
    pub async fn get_state(&self, session_id: &str) -> Result<AgentStateSnapshot, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.get_state_snapshot().await)
    }

    /// 消息列表
    pub async fn get_messages(&self, session_id: &str) -> Result<Vec<OrchestratorMessage>, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.get_messages().await)
    }

    /// 是否正在流式输出
    pub async fn is_streaming(&self, session_id: &str) -> Result<bool, CommandError> {
        let agent = self.get_agent(session_id).await?;
        Ok(agent.is_streaming())
    }

    // ── 模型 / 思考级别 ────────────────────────────────────

    /// 热切换模型
    pub async fn update_model(&self, params: UpdateModelParams) -> Result<(), CommandError> {
        let agent = self.get_agent(&params.session_id).await?;
        agent
            .update_model(
                params.provider,
                params.model_id,
                params.base_url,
                params.api_key,
                params.temperature,
                params.max_tokens,
                params.top_p,
                params.top_k,
                params.thinking_mode,
                params.total_steps,
            )
            .await
            .map_err(CommandError::from)
    }

    /// 更新思考级别（AgentLoop.update_thinking_level 为同步方法）
    pub async fn update_thinking_level(
        &self,
        session_id: &str,
        level: ThinkingLevel,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.update_thinking_level(level);
        Ok(())
    }

    // ── 配置 / 心跳 ────────────────────────────────────

    /// 获取 Provider 配置（Phase 5.4：回显真实运行配置）
    pub async fn get_provider_config(&self, session_id: &str) -> Result<ProviderConfig, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let cfg = agent
            .current_provider_config()
            .await
            .unwrap_or_else(Self::default_provider_config);
        Ok(ProviderConfig {
            provider: cfg.provider_id().to_string(),
            model: cfg.model_id().to_string(),
            base_url: Some(cfg.resolve_base_url()),
        })
    }

    /// 整体写入 Provider 配置（Phase 5.4：真实 LLM 后端接入）
    ///
    /// 接收完整 [`RuntimeProviderConfig`]（cloud/local/custom 三种模式），
    /// 前端从本地存储读取配置 + API Key 后传入。支持跨模式切换，不清空消息历史。
    pub async fn set_provider_config(
        &self,
        session_id: &str,
        config: RuntimeProviderConfig,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent.set_provider_config(config).await.map_err(CommandError::from)
    }

    /// 注入备用 API Key 池（A2 多 Key 降级）
    ///
    /// 主 key 由 `set_provider_config` 写入；`keys` 为备用 key 池，主 key 请求
    /// 命中认证/限流/网络错误时逐把降级重试。
    pub async fn set_api_key_pool(
        &self,
        session_id: &str,
        keys: Vec<String>,
    ) -> Result<(), CommandError> {
        let agent = self.get_agent(session_id).await?;
        agent
            .set_api_key_pool(keys)
            .await
            .map_err(CommandError::from)
    }

    /// 获取心跳状态（长任务监控）
    pub async fn get_heartbeat(&self, session_id: &str) -> Result<HeartbeatStatus, CommandError> {
        let agent = self.get_agent(session_id).await?;
        let status = agent.long_task_manager().get_heartbeat_status().await;
        Ok(status)
    }
}

/// 按字符边界截断字符串到最多 `max` 字符（避免在 UTF-8 多字节序列中间截断）
///
/// 供标题生成等场景：对首条消息/首条回复/生成标题做长度上限，防止超长文本进入 LLM 或侧边栏。
fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
