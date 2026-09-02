//! # 编排事件
//!
//! 对应 TS 版 `OrchestratorEvent` 类型，扩展自基础 `AgentEvent`。
//! 前端可监听这些事件展示编排进度（如 Plan 进度、Reflection 评分）。

use std::sync::Arc;

use serde::Serialize;

use crate::a2ui::A2UIMessage;
use crate::memory::{MemoryArchiveResult, MemoryRecallResult};
use crate::node::{NodeStatus, NodeType};
use crate::types::{ConvergeReason, ImageAttachment, PlanItem, ReflectionResult};

// ─── 基础 Agent 事件 ────────────────────────────────────

/// 基础 Agent 事件（对应 TS 版 `AgentEvent`）
///
/// 阶段 1.1 只保留事件类型枚举，具体载荷在阶段 1.2-1.3 逐步填充。
///
/// 阶段 1.5 新增 `Serialize` 派生，便于 Tauri 命令层将其序列化为 JSON
/// 通过 `ipc::Channel` 推送到前端。
#[derive(Debug, Clone, Serialize)]
pub enum AgentEvent {
    /// Agent 启动
    AgentStart { model: String },
    /// 收到用户消息
    UserMessage { content: String, images: Vec<ImageAttachment> },
    /// 开始流式响应
    StreamStart { model: String },
    /// 流式增量
    StreamDelta { delta: String },
    /// 推理（思考）增量
    ///
    /// 与 `StreamDelta`（正文输出）区分：经 llm `ReasoningChunk` 驱动，逐条广播，
    /// 前端把它追加到助理消息的 thinking 字段并流式渲染。
    ReasoningDelta { delta: String },
    /// 流式结束
    StreamEnd { full_text: String },
    /// 工具调用开始
    ToolCallStart { tool_call_id: String, name: String, args: serde_json::Value },
    /// 工具调用结束
    ///
    /// H7 P0.5（2026-08-30）：补 `status`/`duration_ms`/`error` 顶层权威字段，
    /// 前端不再从 result 内 error 键 / `__meta.exit_code` 猜测成败与耗时
    /// （旧字段解析保留，兼容历史消息回源）。
    ToolCallEnd {
        tool_call_id: String,
        result: serde_json::Value,
        /// 成败终态："success" / "failed"（确认拒绝按 denied 结果返回，计 success）
        status: String,
        /// 执行耗时（毫秒）；含 HITL 确认等待（用户视角该步骤总耗时）
        duration_ms: u64,
        /// 失败时的错误摘要（成功为 None）
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// 错误
    Error { message: String },
    /// Agent 结束
    AgentEnd,
    /// A2UI 事件（P2 新增）
    ///
    /// 由 A2UI 工具（如 `ui_create_surface`、`ui_update_components` 等）触发，
    /// 携带目标画布 ID 与 A2UI 消息载荷。
    /// 前端监听此事件，更新 `a2uiSurfaces` 状态，由 `A2UIRenderer.vue` 渲染。
    ///
    /// # 字段
    /// - `surface_id`：目标画布 ID（与 `message` 内的 surface_id 一致，便于前端快速路由）
    /// - `message`：A2UI 消息（含 createSurface / updateComponents / updateDataModel / deleteSurface 变体）
    A2UI { surface_id: String, message: A2UIMessage },
}

// ─── Orchestrator 扩展事件 ────────────────────────────────────

/// Orchestrator 专用事件（扩展 `AgentEvent`）
///
/// 这些事件在 `AgentEvent` 基础上新增，用于编排层的可观测性。
#[derive(Debug, Clone)]
pub enum OrchestratorEvent {
    // ── 基础 Agent 事件透传 ──
    Agent(AgentEvent),

    // ── 编排器生命周期 ──
    /// 编排器启动
    OrchestratorStart { entry_node_id: String, input: String },
    /// 编排器结束
    OrchestratorEnd { result: OrchestratorEndResult },

    // ── 节点生命周期 ──
    /// 节点启动
    NodeStart { node_id: String, node_name: String, node_type: NodeType },
    /// 节点结束
    NodeEnd {
        node_id: String,
        status: NodeStatus,
        summary: Option<String>,
        duration_ms: u64,
    },

    // ── 统一轨迹事件族 orchestration_trace（B7 / D23）──
    // 管线级骨架事件：轨迹是索引级摘要，细节事件族（Plan/ToT/MultiAgent 等）保留并存。
    // 全部携带 run_id；phase_result 只带 artifact_id + summary（事件轻、物权威）。
    /// 管线启动（判型选型完成 → run 形状确定）
    TracePipeStarted {
        run_id: String,
        pipeline: String,
        /// 判型理由（RouterDecisionMade.reason 直传，A1 可纠之"可见"半）
        reason: Option<String>,
    },
    /// 阶段进入
    TracePhaseEntered {
        run_id: String,
        phase: String,
        reason: Option<String>,
    },
    /// 阶段结果
    TracePhaseResult {
        run_id: String,
        phase: String,
        status: TracePhaseStatus,
        summary: String,
        /// 该阶段产出的交接物（D23）
        artifact_id: Option<String>,
    },
    /// 管线结束
    TracePipeFinished {
        run_id: String,
        status: OrchestratorEndStatus,
        /// 收敛原因（D0-4 六值枚举）
        reason: Option<ConvergeReason>,
        final_message: Option<String>,
    },

    // ── Plan-and-Execute 事件 ──
    /// 计划已创建
    PlanCreated { items: Vec<PlanItem> },
    /// 计划步骤更新
    PlanStepUpdate {
        step_id: String,
        status: crate::types::PlanItemStatus,
        output: Option<String>,
    },
    /// 计划已重规划（Replanner）
    ///
    /// 在 `plan_replan` 工具执行后触发，携带替换后的完整计划（保留了失败步骤及其之前的
    /// 已完成进度，仅替换其后的待执行步骤）。前端据此整体刷新 `usePlanStore` / PlanPanel。
    PlanReplanned { items: Vec<PlanItem> },

    // ── Reflection 事件 ──
    /// 评审结果
    ReflectionResult { result: ReflectionResult },

    // ── Memory Pattern 事件（阶段 0.6 新增）──
    /// 记忆检索
    MemoryRecall {
        query: String,
        results: Vec<MemoryRecallResult>,
        duration_ms: u64,
    },
    /// 记忆注入
    MemoryInject {
        summary: String,
        hook_count: usize,
    },
    /// 记忆归档
    MemoryArchive {
        result: Option<MemoryArchiveResult>,
    },
    /// 短期记忆 trim
    MemoryTrim {
        removed_count: usize,
        removed_tokens: usize,
    },

    // ── Working Memory 事件（阶段 0.7 新增）──
    /// 工作记忆推入
    WorkingMemoryPush {
        entry_id: String,
        tool_name: String,
        estimated_tokens: usize,
    },
    /// 工作记忆 trim
    WorkingMemoryTrim {
        removed_count: usize,
        remaining_count: usize,
    },
    /// 工作记忆清空
    WorkingMemoryClear,
    /// 工作记忆合并到 messages
    WorkingMemoryMerge {
        merged_count: usize,
        merged_tokens: usize,
    },

    // Supervisor Pattern 事件（任务分配/子 Agent 执行进度），详细见 docs/details/注释/agent-runtime/event.md
    /// Supervisor 任务分配完成
    ///
    /// 在 `AssignmentStrategy::assign` 成功返回后触发，
    /// 携带选中的子 Agent ID/名称、改写后的任务描述、LLM 决策理由。
    SupervisorTaskAssigned {
        /// 触发节点 ID（Supervisor 节点的 id）
        node_id: String,
        /// 被选中的子 Agent ID
        sub_agent_id: String,
        /// 被选中的子 Agent 名称（人类可读）
        sub_agent_name: String,
        /// 改写后的子任务描述（传给子 Agent 的 run）
        task_description: String,
        /// LLM 决策的推理过程（可选）
        reasoning: Option<String>,
    },
    /// 子 Agent 开始执行
    ///
    /// 在调用 `AgentLoop::run` 之前触发，前端可据此显示"子 Agent 正在执行..."。
    SubAgentStarted {
        /// 触发节点 ID（Supervisor 节点的 id）
        node_id: String,
        /// 子 Agent ID
        sub_agent_id: String,
        /// 子 Agent 名称
        sub_agent_name: String,
        /// 子任务描述
        task_description: String,
    },
    /// 子 Agent 执行完成
    ///
    /// 在 `AgentLoop::run` 成功返回后触发，携带输出长度与执行耗时。
    /// 前端可据此更新"子 Agent 已完成，输出 N 字符"。
    SubAgentCompleted {
        /// 触发节点 ID（Supervisor 节点的 id）
        node_id: String,
        /// 子 Agent ID
        sub_agent_id: String,
        /// 子 Agent 名称
        sub_agent_name: String,
        /// 子 Agent 输出的字符数
        output_chars: usize,
        /// 子 Agent 执行耗时（毫秒）
        duration_ms: u64,
    },
    /// 子 Agent 执行失败
    ///
    /// 在 `AgentLoop::run` 返回错误时触发。
    /// 与 `SupervisorError` 的区别：本事件特指子 Agent 执行阶段失败，
    /// `SupervisorError` 指任务分配阶段失败。
    SubAgentError {
        /// 触发节点 ID（Supervisor 节点的 id）
        node_id: String,
        /// 子 Agent ID
        sub_agent_id: String,
        /// 子 Agent 名称
        sub_agent_name: String,
        /// 错误信息
        error: String,
    },
    /// Supervisor 任务分配阶段失败
    ///
    /// 在 `AssignmentStrategy::assign` 返回错误时触发。
    SupervisorError {
        /// 触发节点 ID（Supervisor 节点的 id）
        node_id: String,
        /// 错误阶段（"assign" / "spec_lookup" / "agent_run"）
        stage: String,
        /// 错误信息
        error: String,
    },

    // Router Pattern 事件（路由决策过程），详细见 docs/details/注释/agent-runtime/event.md
    /// Router 路由决策完成
    ///
    /// 在 `RoutingStrategy::route` 成功返回后触发，
    /// 携带选中的目标 ID/名称、决策理由。
    /// 前端可据此展示"已路由到分支 X"。
    RouterDecisionMade {
        /// 触发节点 ID（Router 节点的 id）
        node_id: String,
        /// 被选中的路由目标 ID
        target_id: String,
        /// 被选中的路由目标名称（人类可读）
        target_name: String,
        /// 决策理由（可选，LLM 策略会填充）
        reason: Option<String>,
        /// 是否走了 fallback（true 表示无匹配后走了 fallback_target_id）
        is_fallback: bool,
    },
    /// Router 无匹配路由
    ///
    /// 在 `RoutingStrategy::route` 返回无匹配且无 fallback 时触发。
    /// 如果配置了 `fallback_target_id`，Router 会走 fallback 并触发 `RouterDecisionMade`，
    /// 而不是本事件。
    RouterNoMatch {
        /// 触发节点 ID（Router 节点的 id）
        node_id: String,
        /// 输入摘要（前 100 字符，用于调试）
        input_sample: String,
    },
    /// Router 决策阶段失败
    ///
    /// 在 `RoutingStrategy::route` 返回错误时触发。
    RouterError {
        /// 触发节点 ID（Router 节点的 id）
        node_id: String,
        /// 错误阶段（"route" / "target_lookup"）
        stage: String,
        /// 错误信息
        error: String,
    },

    // Tree of Thoughts 事件（思维树探索过程），详细见 docs/details/注释/agent-runtime/event.md
    /// 思维节点已创建
    ///
    /// 在 `ExplorationStrategy::expand` 成功生成候选思维后触发，
    /// 携带节点 ID、父节点 ID、深度与内容。
    ThoughtNodeCreated {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 思维节点 ID（本次生成的）
        thought_id: String,
        /// 父思维节点 ID（根节点为 None）
        parent_id: Option<String>,
        /// 深度（根节点=0）
        depth: usize,
        /// 思维内容（前 200 字符，用于 UI 展示）
        content_preview: String,
    },
    /// 思维节点已评分
    ///
    /// 在 `ScoringStrategy::score` 成功返回后触发，
    /// 携带节点 ID、评分（0-100）、评分理由。
    ThoughtNodeScored {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 思维节点 ID
        thought_id: String,
        /// 评分（0-100，越高越好）
        score: u8,
        /// 评分理由（可选，LLM 策略会填充）
        reasoning: Option<String>,
    },
    /// 一层分支扩展完成
    ///
    /// 在某一层的所有候选思维生成并评分完成后触发，
    /// 携带父节点 ID、子节点数量、深度。
    ThoughtBranchExplored {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 父节点 ID（这一层的扩展起点）
        parent_id: String,
        /// 生成的子节点数量
        child_count: usize,
        /// 当前深度
        depth: usize,
        /// 下一层保留的节点数（beam_width 限制后的结果）
        kept_count: usize,
    },
    /// ToT 目标达成
    ///
    /// 在 `GoalCheckStrategy::check_goal` 返回 true 时触发，
    /// 携带达成目标的思维节点 ID、深度、内容。
    ToTGoalReached {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 达成目标的思维节点 ID
        thought_id: String,
        /// 深度
        depth: usize,
        /// 思维内容（完整）
        content: String,
        /// 评分
        score: u8,
    },
    /// ToT 终止（非目标达成）
    ///
    /// 在其他终止条件触发时调用：
    /// - MaxDepthExceeded：深度超限
    /// - MaxThoughtsExceeded：节点数超限
    /// - ScoreConverged：评分收敛
    /// - NoCandidates：无候选节点
    /// - Aborted：外部中断
    ToTTerminated {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 终止原因
        reason: String,
        /// 总节点数
        total_nodes: usize,
        /// 最大深度
        max_depth_reached: usize,
        /// 最优节点 ID
        best_thought_id: Option<String>,
        /// 最优评分
        best_score: Option<u8>,
    },
    /// ToT 执行失败
    ///
    /// 在探索/评分/目标检查阶段失败时触发。
    ToTError {
        /// 触发节点 ID（ToT 节点的 id）
        node_id: String,
        /// 错误阶段（"expand" / "score" / "goal_check" / "init"）
        stage: String,
        /// 错误信息
        error: String,
    },

    // Graph of Thoughts 事件（复用 ToT 事件 + 聚合），详细见 docs/details/注释/agent-runtime/event.md
    /// 思维节点已聚合（GoT 专用）
    ///
    /// 在 `AggregationStrategy::aggregate` 成功返回后触发，
    /// 携带聚合生成的新思维节点 ID、源节点 ID 列表、深度与内容预览。
    /// 前端可据此展示"已将 N 个思维聚合为一个更优思维"。
    ThoughtsAggregated {
        /// 触发节点 ID（GoT 节点的 id）
        node_id: String,
        /// 聚合生成的新思维节点 ID
        aggregated_thought_id: String,
        /// 参与聚合的源节点 ID 列表（按评分降序）
        source_ids: Vec<String>,
        /// 聚合节点的深度（取源节点最大深度 + 1）
        depth: usize,
        /// 聚合后的思维内容预览（前 200 字符）
        content_preview: String,
    },

    // Multi-Agent Pattern 事件（多轮协作过程），详细见 docs/details/注释/agent-runtime/event.md
    /// Multi-Agent 协作轮次开始
    ///
    /// 在每轮协作开始时触发，携带轮次编号与参与 Agent 数量。
    /// 前端可据此展示"第 N 轮协作开始（共 M 个 Agent）"。
    MultiAgentRoundStarted {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 当前轮次（从 1 开始）
        round: usize,
        /// 参与 Agent 数量
        agent_count: usize,
    },
    /// Agent 间消息已发送
    ///
    /// 在 Agent 从 mpsc 通道接收到消息时触发（接收方视角），
    /// 携带发送方/接收方 ID、消息类型与内容预览。
    /// 前端可据此展示"Agent A → Agent B: 任务消息"。
    MultiAgentMessageSent {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 发送方 Agent ID
        from: String,
        /// 接收方 Agent ID（"all" 表示广播）
        to: String,
        /// 消息类型（"task" / "result" / "broadcast" / "query" / "synchronize"）
        message_type: String,
        /// 消息内容预览（前 200 字符）
        content_preview: String,
    },
    /// 共享黑板已更新
    ///
    /// 在 Agent 写入共享黑板后触发，携带更新的 key 与写入方 Agent ID。
    /// 前端可据此展示"Agent A 更新了黑板 [agent_output:A]"。
    MultiAgentBlackboardUpdated {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 被更新的 key（如 "agent_output:agent_id"）
        key: String,
        /// 写入方 Agent ID
        by: String,
    },
    /// Multi-Agent 协作轮次完成
    ///
    /// 在每轮协作所有 Agent 执行完毕后触发，携带轮次编号与本轮输出列表。
    /// 前端可据此展示"第 N 轮协作完成（M 个输出）"。
    MultiAgentRoundCompleted {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 当前轮次
        round: usize,
        /// 本轮所有 Agent 的输出列表
        outputs: Vec<String>,
    },
    /// Multi-Agent 协作收敛
    ///
    /// 在协作满足收敛条件（max_rounds / goal_reached / all_agents_idle / aborted）后触发，
    /// 携带收敛原因与最终综合结果。
    /// 前端可据此展示"协作完成：目标达成"。
    MultiAgentConverged {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 收敛原因（"MaxRoundsReached" / "GoalReached" / "AllAgentsIdle" / "Aborted"）
        reason: String,
        /// 最终综合结果
        final_result: String,
    },
    /// Multi-Agent 执行失败
    ///
    /// 在 Agent 执行失败或收敛检查失败时触发。
    /// `agent_id="system"` 表示系统级错误（如收敛检查失败）。
    MultiAgentError {
        /// 触发节点 ID（Multi-Agent 节点的 id）
        node_id: String,
        /// 失败的 Agent ID（"system" 表示系统级错误）
        agent_id: String,
        /// 错误信息
        error: String,
    },

    // Loop Engineering 事件（循环控制行为），详细见 docs/details/注释/agent-runtime/event.md
    /// 速率限制触发
    ///
    /// 在 RateLimiter 检测到任意维度超限（turns/tool_calls/tokens/duration）时触发。
    /// 携带超限类型与当前/最大值。
    /// 前端可据此展示"已达到最大轮次 100/100，任务将停止"。
    LoopEngRateLimitExceeded {
        /// 任务 ID
        task_id: String,
        /// 超限类型（"turns" / "tool_calls" / "tokens" / "duration"）
        limit_type: String,
        /// 当前值
        current: u64,
        /// 最大值
        max: u64,
    },
    /// 正在重试
    ///
    /// 在 RetryPolicy 决定重试后触发，携带重试次数、退避时长与错误信息。
    /// 前端可据此展示"第 2/3 次重试，等待 200ms（错误: timeout）"。
    LoopEngRetrying {
        /// 任务 ID
        task_id: String,
        /// 当前重试次数（1=首次重试，2=第二次重试，...）
        attempt: u32,
        /// 最大重试次数
        max_retries: u32,
        /// 退避时长（毫秒）
        backoff_ms: u64,
        /// 触发重试的错误信息
        error: String,
    },
    /// 重试次数用尽
    ///
    /// 在 RetryPolicy 决定不再重试后触发，携带最终错误信息。
    /// 前端可据此展示"重试 3 次后仍失败：timeout"。
    LoopEngRetryExhausted {
        /// 任务 ID
        task_id: String,
        /// 总重试次数
        total_attempts: u32,
        /// 最终错误信息
        final_error: String,
    },
    /// 软超时警告
    ///
    /// 在 SoftTimeout 检测到任务运行时长达到 `warn_threshold` 时触发。
    /// 不强制终止，仅提醒用户任务运行时间较长。
    LoopEngSoftTimeoutWarning {
        /// 任务 ID
        task_id: String,
        /// 已运行时长（秒）
        elapsed_secs: u64,
        /// 警告阈值（秒）
        threshold_secs: u64,
    },
    /// 软超时临界
    ///
    /// 在 SoftTimeout 检测到任务运行时长达到 `critical_threshold` 时触发。
    /// 建议用户停止任务，但不强制终止。
    LoopEngSoftTimeoutCritical {
        /// 任务 ID
        task_id: String,
        /// 已运行时长（秒）
        elapsed_secs: u64,
        /// 临界阈值（秒）
        threshold_secs: u64,
    },
    /// 看门狗空闲告警
    ///
    /// 在 Watchdog 检测到任务长时间无活动（达到 `idle_threshold`）时触发。
    /// 任务可能卡死，前端可提示用户检查。
    LoopEngWatchdogIdle {
        /// 任务 ID
        task_id: String,
        /// 最后活动时间（RFC3339）
        last_activity: chrono::DateTime<chrono::Utc>,
        /// 已空闲时长（秒）
        idle_secs: u64,
    },
    /// 看门狗死亡告警
    ///
    /// 在 Watchdog 检测到任务长时间无活动（达到 `dead_threshold`）时触发。
    /// 任务疑似崩溃，建议恢复。
    LoopEngWatchdogDead {
        /// 任务 ID
        task_id: String,
        /// 最后活动时间（RFC3339）
        last_activity: chrono::DateTime<chrono::Utc>,
        /// 已空闲时长（秒）
        idle_secs: u64,
    },
    /// 任务已恢复
    ///
    /// 在任务通过 resume_task 恢复后触发，携带恢复的 task_id 与已执行轮次。
    LoopEngRecovered {
        /// 任务 ID
        task_id: String,
        /// 恢复时已执行的轮次
        turn_count: u32,
        /// 恢复方式（"manual" / "auto"）
        recovery_method: String,
    },
    /// 总步骤预算告警（80%/95% 阈值，对齐 Claude Code maxTurns 的预算感知）
    /// 在 `total_steps_used` 首次跨过 80%/95% 阈值时触发（各自只触发一次）。
    /// 不强制终止——同一时刻会向模型注入「剩余 N 步，开始收尾」提示；
    /// 前端可据此展示"步骤预算 160/200，即将耗尽"。
    StepBudgetWarning {
        /// 任务 ID
        task_id: String,
        /// 已使用步骤（工具调用轮数）
        used: u32,
        /// 总步骤预算
        limit: u32,
        /// 阈值百分比（80 / 95）
        percent: u8,
    },
    /// 工具执行增量输出（2026-09-02，bash/powershell 流式）
    ///
    /// 工具执行过程中（如 bash/powershell 逐行输出）经 ToolStreamSink 推送。
    /// 只进流通道供前端实时渲染，不进入 LLM 消息上下文。
    ToolCallDelta {
        /// 工具调用 ID（与 ToolCallStart 的 tool_call_id 对齐）
        tool_call_id: String,
        /// 增量文本（已 clean_ansi；前端直接展示）
        delta: String,
    },
    /// 文件变更（2026-09-02，green/red diff 渲染）
    ///
    /// write/edit/edit_diff 工具执行成功后经 ToolStreamSink 推送一次。
    /// 携带被操作文件路径 + 变更 hunk（before/removed/added 行组），
    /// 前端据此在工具段渲染绿红对比；不进入 LLM 消息上下文。
    FileChange {
        /// 工具调用 ID（与 ToolCallStart 的 tool_call_id 对齐）
        tool_call_id: String,
        /// 被操作文件路径（路径渲染）
        path: String,
        /// 变更类型（"write" / "edit" / "edit_diff"）
        kind: String,
        /// 变更 hunks：[{ "context_before": [...], "removed": [...], "added": [...] }]
        hunks: serde_json::Value,
    },

    // A2UI 事件（画布操作），详细见 docs/details/注释/agent-runtime/event.md
    /// A2UI 事件广播
    ///
    /// 携带会话 ID、目标画布 ID 与 A2UI 消息载荷。
    /// Tauri 命令层将其转换为 `AgentEventPayload::A2UI` 推送到前端。
    A2UIEvent {
        /// 会话 ID（由 Tauri 端注入，OrchestratorEvent 本身不携带）
        ///
        /// 注意：此字段在 from_orchestrator_event 转换时由调用方注入，
        /// 这里保留是为了与事件流对齐，Tauri 端会覆盖。
        node_id: String,
        /// 目标画布 ID
        surface_id: String,
        /// A2UI 消息载荷
        message: A2UIMessage,
    },

    // HITL 权限确认事件（A5），详细见 docs/details/注释/agent-runtime/event.md
    /// 请求用户确认某次工具调用（危险操作）
    ///
    /// 由 `ConfirmationBroker::request` 广播，Tauri 端转发到前端
    /// `agent:confirm:{session_id}`，前端弹窗后经 `cmd_agent_confirm` 回传。
    ConfirmationRequested {
        /// 确认请求唯一 ID（前端回传时原样返回）
        confirm_id: String,
        /// 待确认的工具名
        tool_name: String,
        /// 待确认的工具参数
        args: serde_json::Value,
    },
    /// 确认已解决（前端已响应，用于前端清理进行中的确认弹窗）
    ConfirmationResolved {
        /// 确认请求唯一 ID
        confirm_id: String,
        /// 用户审批结果
        approved: bool,
    },
}

/// 编排器结束结果（简化版，避免与 `OrchestratorResult` 循环引用）
#[derive(Debug, Clone)]
pub struct OrchestratorEndResult {
    pub status: OrchestratorEndStatus,
    /// 归属 run（B22：轨迹事件聚合键；None = 未在 run 上下文运行的旧路径）
    pub run_id: Option<String>,
    /// 收敛原因（D0-4 六值枚举；B0-4：超限也是收敛的一种）
    pub converge_reason: Option<ConvergeReason>,
    pub final_message: Option<String>,
    pub iterations: u32,
    pub error: Option<String>,
}

/// 编排器结束状态
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OrchestratorEndStatus {
    Completed,
    Aborted,
    Error,
    Timeout,
}

/// 轨迹阶段结果状态（TracePhaseResult.status）
///
/// 与 `NodeStatus`（四出口）不同：阶段结果表达的是"这步走完的质量"，
/// 供前端迹线折叠态区分成功/降级/失败，独立于节点图语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TracePhaseStatus {
    /// 阶段正常完成（产出物或正常收敛）
    Success,
    /// 阶段降级（降级支路接管，产出 Degraded 物）
    Degraded,
    /// 阶段失败（不可恢复，run 走 Error 出口）
    Failed,
    /// 阶段被跳过（条件支路未命中）
    Skipped,
}

// ─── 事件监听器 ────────────────────────────────────

/// 事件监听器 trait
pub trait EventListener: Send + Sync {
    /// 处理事件
    fn on_event(&self, event: &OrchestratorEvent);
}

/// 事件广播器 — 简单的 fan-out 广播
#[derive(Default)]
pub struct EventBroadcaster {
    listeners: Vec<Arc<dyn EventListener>>,
}

impl EventBroadcaster {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&mut self, listener: Arc<dyn EventListener>) {
        // 去重：同一监听器实例（Arc 强指针相等）不重复订阅，
        // 避免调用方反复订阅同一监听器导致事件多播（如前端重复 delta）。
        if self.listeners.iter().any(|l| Arc::ptr_eq(l, &listener)) {
            return;
        }
        self.listeners.push(listener);
    }

    pub fn broadcast(&self, event: &OrchestratorEvent) {
        for listener in &self.listeners {
            listener.on_event(event);
        }
    }
}
