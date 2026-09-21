//! # 编排事件
//!
//! 对应 TS 版 `OrchestratorEvent` 类型，扩展自基础 `AgentEvent`。
//! 前端可监听这些事件展示编排进度（如 Plan 进度、Reflection 评分）。

use std::sync::Arc;

use serde::Serialize;

use crate::a2ui::A2UIMessage;
use crate::confirmation::{AskOutcome, ConfirmationOutcome};
use crate::event_bus::{Listener, Outcome};
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
    ///
    /// A5 后续（2026-09-17）：附结构化字段——`code`（稳定错误码，如 `RATE_LIMIT`）/
    /// `retryable`（是否可重试）/ `retry_after_ms`（服务端 `Retry-After` 建议等待）。
    /// 仅 `AgentError::Backend` 类错误可填，其余为 `None`；`message` 内仍保留
    /// 用户可行动引导语（`user_hint` 文本逻辑不变）。
    Error {
        /// 错误消息（含用户引导语）
        message: String,
        /// 稳定错误码（`BackendErrorCode::as_str()`）
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        /// 是否可重试（瞬时性故障）
        #[serde(skip_serializing_if = "Option::is_none")]
        retryable: Option<bool>,
        /// 服务端建议等待（`Retry-After`，毫秒）
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_after_ms: Option<u64>,
    },
    /// Agent 结束
    AgentEnd,
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

    // ─ 上下文压缩事件族（阶段 3 · A2 补齐②③：事务括号 + 事件化）──
    // 括号语义：`Started` 在**任何副作用之前**（外置写盘 / 视图改写）广播；
    // 此后必须收到 `Finished` 或 `Failed`——右端缺失即「事务中断（崩溃）」，
    // 由压缩事务锁（孤儿锁）在会话下一次装载时检测。
    /// 压缩事务开始（括号左端）
    ContextCompactStarted {
        /// 触发源：`auto`（自动预算裁剪）/ `manual`（/compact 手动）
        trigger: String,
        /// 压缩前总占用（token = 历史 + 系统侧）
        before_tokens: usize,
        /// 压缩前所在压缩阶梯层（0=未达第一层，1–4）
        tier: u8,
    },
    /// 压缩事务完成（括号右端；视图改写与回填结束、重计量之后）
    ContextCompactFinished {
        /// 触发源：`auto` / `manual`
        trigger: String,
        /// 处理模式："folded"（折叠）/ "dropped"（删除）
        mode: String,
        /// 压缩前总占用（token）
        before_tokens: usize,
        /// 压缩后总占用（token，重计量）
        after_tokens: usize,
        /// 实际释放（token）
        saved_tokens: usize,
        /// 折叠组数（注入外置器的路径）
        folded_groups: usize,
        /// 被折叠的消息条数
        folded_messages: usize,
        /// 被删除的消息条数（无外置器的路径）
        dropped_messages: usize,
        /// 因受保护（System/最新 user/打标/最近 N 条）跳过未动的组数
        skipped_protected_groups: usize,
        /// 实际填回压缩文本的锚点数
        backfilled: usize,
    },
    /// 压缩事务失败（括号右端—异常；折叠 / 删除失败时先广播再上抛）
    ContextCompactFailed {
        /// 触发源：`auto` / `manual`
        trigger: String,
        /// 失败阶段："fold"（折叠）/ "trim"（选择性删除）
        stage: String,
        /// 错误摘要
        error: String,
    },

    // ── 请求快照事件族（阶段 3 · A2 补齐④）──
    /// 请求快照已采集（**派发之前**；命令层监听器经同步分发先落 WAL，崩溃可补齐）
    RequestSnapshotCaptured {
        /// 快照内容（除消息以外的一切 + 视图增量）——见 `agent::request_snapshot`
        snapshot: crate::agent::request_snapshot::RequestSnapshot,
    },

    // ── 输入模型事件族（阶段 2 · A3）──
    /// 输入准入（**waterfall 分发**：监听器可改写 / 丢弃 `items`；链尾内建 = 全部准入）
    ///
    /// 分发方式：调用方（`AgentLoop::consume_admitted_inputs`）以 `waterfall` 显式分发——
    /// 监听器不调 `next` 即否决本次准入（输入保留到下一轮）；`items` 置空 = 全部拒绝。
    InputAdmission {
        /// 当前循环轮次（`state.current_iteration`）
        iteration: u32,
        /// 待准入输入（**可改写负载**；`kind` 标记来源语义）
        items: Vec<crate::agent::input::InputItem>,
    },

    /// 本轮被中断（取消收口：已交付文本终结 + 中断锚点；先于 `AgentEnd` 广播）
    AgentInterrupted {
        /// 中断原因：`user_abort`（主动中断）/ `cooperative_cancel`（协作式取消）
        reason: String,
        /// 中断时所在循环轮次
        iteration: u32,
        /// 已交付文本字符数（0 = 无半成品）
        delivered_chars: usize,
    },

    // ─ 工具结果预处理事件族（阶段 1 第二段迁移：工具结果裁剪）──
    /// 工具结果**广播前同步预处理**（**waterfall 分发**：监听器可改写 `result`）
    ///
    /// 分发方式：调用方（`AgentLoop::preprocess_tool_result`）在串行 / 并行两条
    /// 工具执行路径上，于 `ToolCallEnd` 广播与 toolResult 消息构造**之前**以
    /// `waterfall` 显式分发（05 §2.4 红线：前端所见 = 入历史所见）。
    /// 链尾内建 = 现行裁剪（`clamp_tool_result_with`，含原文外置）——零监听器时
    /// 行为与迁移前逐字节一致；监听器不调 `next` 即否决 → 调用方**兜底裁剪**
    /// （「截断永不缺席」：本事件的否决不可绕过防爆兜底）。
    ///
    /// 本事件是"分发载具"（同 `InputAdmission`），**不向前端转发**。
    ToolResultPreBroadcast {
        /// 工具调用 ID
        tool_call_id: String,
        /// 工具名（供监听器按工具定制裁剪策略）
        tool_name: String,
        /// 工具结果（**可改写负载**）
        result: serde_json::Value,
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
    /// 在 `AgentLoop::run` 返回错误时触发（子 Agent 执行阶段失败）。
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
        /// 实际等待时长（毫秒；A5 后续起 = 退避与 `Retry-After` 取大后的最终值）
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
        /// 用户审批结果（D8 四值：approved / denied / skipped / timeout）
        outcome: ConfirmationOutcome,
    },

    // Q1 提问事件（2026-09-20），详细见 docs/details/注释/agent-runtime/event.md
    /// 请求用户回答问题（模型主动提问）
    ///
    /// 由 `ConfirmationBroker::ask` 广播，Tauri 端转发到前端
    /// `agent:ask:{session_id}`，前端弹提问面板后经 `cmd_agent_ask_answer` 回传。
    AskRequested {
        /// 提问请求唯一 ID（前端回传时原样返回）
        ask_id: String,
        /// 问题批次（camelCase：`[{id, question, header?, options?, multiSelect?}]`）
        questions: serde_json::Value,
    },
    /// 提问已解决（前端已响应或随轮取消，用于前端清理进行中的提问面板）
    AskResolved {
        /// 提问请求唯一 ID
        ask_id: String,
        /// 提问结果（answered / denied / cancelled，见 `AskOutcome::kind`）
        outcome: AskOutcome,
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


// ─── 事件 Key 与模式声明（S3-b：定义迁至 agent_engine::contracts——单一定义处，此处只读引用）──

/// 事件 Key（自 agent-engine 引入；常量表见 [`keys`]，模式表见 [`mode_of`]）
pub use agent_engine::contracts::{keys, mode_of, EventKey};

impl AgentEvent {
    /// 事件 Key
    pub fn key(&self) -> EventKey {
        match self {
            Self::AgentStart { .. } => keys::AGENT_START,
            Self::UserMessage { .. } => keys::USER_MESSAGE,
            Self::StreamStart { .. } => keys::STREAM_START,
            Self::StreamDelta { .. } => keys::STREAM_DELTA,
            Self::ReasoningDelta { .. } => keys::REASONING_DELTA,
            Self::StreamEnd { .. } => keys::STREAM_END,
            Self::ToolCallStart { .. } => keys::TOOL_CALL_START,
            Self::ToolCallEnd { .. } => keys::TOOL_CALL_END,
            Self::Error { .. } => keys::ERROR,
            Self::AgentEnd => keys::AGENT_END,
        }
    }
}

impl OrchestratorEvent {
    /// 事件 Key（穷尽 match 无 default——新增变体必须在此登记，编译期强制）
    pub fn key(&self) -> EventKey {
        match self {
            Self::Agent(inner) => inner.key(),
            Self::OrchestratorStart { .. } => keys::ORCHESTRATOR_START,
            Self::OrchestratorEnd { .. } => keys::ORCHESTRATOR_END,
            Self::NodeStart { .. } => keys::NODE_START,
            Self::NodeEnd { .. } => keys::NODE_END,
            Self::TracePipeStarted { .. } => keys::TRACE_PIPE_STARTED,
            Self::TracePhaseEntered { .. } => keys::TRACE_PHASE_ENTERED,
            Self::TracePhaseResult { .. } => keys::TRACE_PHASE_RESULT,
            Self::TracePipeFinished { .. } => keys::TRACE_PIPE_FINISHED,
            Self::PlanCreated { .. } => keys::PLAN_CREATED,
            Self::PlanStepUpdate { .. } => keys::PLAN_STEP_UPDATE,
            Self::PlanReplanned { .. } => keys::PLAN_REPLANNED,
            Self::ReflectionResult { .. } => keys::REFLECTION_RESULT,
            Self::SupervisorTaskAssigned { .. } => keys::SUPERVISOR_TASK_ASSIGNED,
            Self::SubAgentStarted { .. } => keys::SUB_AGENT_STARTED,
            Self::SubAgentCompleted { .. } => keys::SUB_AGENT_COMPLETED,
            Self::SubAgentError { .. } => keys::SUB_AGENT_ERROR,
            Self::RouterDecisionMade { .. } => keys::ROUTER_DECISION_MADE,
            Self::RouterNoMatch { .. } => keys::ROUTER_NO_MATCH,
            Self::RouterError { .. } => keys::ROUTER_ERROR,
            Self::ThoughtNodeCreated { .. } => keys::THOUGHT_NODE_CREATED,
            Self::ThoughtNodeScored { .. } => keys::THOUGHT_NODE_SCORED,
            Self::ThoughtBranchExplored { .. } => keys::THOUGHT_BRANCH_EXPLORED,
            Self::ToTGoalReached { .. } => keys::TOT_GOAL_REACHED,
            Self::ToTTerminated { .. } => keys::TOT_TERMINATED,
            Self::ToTError { .. } => keys::TOT_ERROR,
            Self::ThoughtsAggregated { .. } => keys::THOUGHTS_AGGREGATED,
            Self::LoopEngRateLimitExceeded { .. } => keys::LOOP_ENG_RATE_LIMIT_EXCEEDED,
            Self::LoopEngRetrying { .. } => keys::LOOP_ENG_RETRYING,
            Self::LoopEngRetryExhausted { .. } => keys::LOOP_ENG_RETRY_EXHAUSTED,
            Self::LoopEngSoftTimeoutWarning { .. } => keys::LOOP_ENG_SOFT_TIMEOUT_WARNING,
            Self::LoopEngSoftTimeoutCritical { .. } => keys::LOOP_ENG_SOFT_TIMEOUT_CRITICAL,
            Self::LoopEngWatchdogIdle { .. } => keys::LOOP_ENG_WATCHDOG_IDLE,
            Self::LoopEngWatchdogDead { .. } => keys::LOOP_ENG_WATCHDOG_DEAD,
            Self::LoopEngRecovered { .. } => keys::LOOP_ENG_RECOVERED,
            Self::StepBudgetWarning { .. } => keys::STEP_BUDGET_WARNING,
            Self::ContextCompactStarted { .. } => keys::CONTEXT_COMPACT_STARTED,
            Self::ContextCompactFinished { .. } => keys::CONTEXT_COMPACT_FINISHED,
            Self::ContextCompactFailed { .. } => keys::CONTEXT_COMPACT_FAILED,
            Self::RequestSnapshotCaptured { .. } => keys::REQUEST_SNAPSHOT_CAPTURED,
            Self::InputAdmission { .. } => keys::INPUT_ADMISSION,
            Self::AgentInterrupted { .. } => keys::AGENT_INTERRUPTED,
            Self::ToolResultPreBroadcast { .. } => keys::TOOL_RESULT_PRE_BROADCAST,
            Self::ToolCallDelta { .. } => keys::TOOL_CALL_DELTA,
            Self::FileChange { .. } => keys::FILE_CHANGE,
            Self::A2UIEvent { .. } => keys::A2UI_EVENT,
            Self::ConfirmationRequested { .. } => keys::CONFIRMATION_REQUESTED,
            Self::ConfirmationResolved { .. } => keys::CONFIRMATION_RESOLVED,
            Self::AskRequested { .. } => keys::ASK_REQUESTED,
            Self::AskResolved { .. } => keys::ASK_RESOLVED,
        }
    }
}

/// 事件广播器 — 会话级事件分发器（A1 第二步：换用 [`Listener`] + key 订阅）
///
/// 对外保留 `subscribe`（全量）/ `broadcast`（广播）命名与行为；新增
/// `subscribe_key`（精确订阅）与 `bail` / `waterfall`（模式化分发，供审批 / 裁剪 /
/// 超时迁移使用）。内部委托 [`crate::event_bus::EventBus`]。
#[derive(Default)]
pub struct EventBroadcaster {
    /// 总线（`Arc` 共享：分发方经 [`Self::handle`] 取句柄后**在壳锁外**运行监听器链）
    bus: Arc<crate::event_bus::EventBus>,
}

impl EventBroadcaster {
    pub fn new() -> Self {
        Self::default()
    }

    /// 取出总线句柄 —— 供调度方**先释放外包锁、再分发**（2026-09-17 风险点处置）
    ///
    /// 分发（`emit` / `bail` / `waterfall`）期间监听器链不持任何外包锁：
    /// 链内可安全注册（延后下一轮，C3）、可执行 I/O，不阻滞写者，
    /// 也不会令 `try_read` 型转发监听器静默丢事件。
    pub fn handle(&self) -> Arc<crate::event_bus::EventBus> {
        Arc::clone(&self.bus)
    }

    /// 全量订阅（去重：同一实例 `Arc::ptr_eq` 不重复订阅，避免事件多播如前端重复 delta）
    ///
    /// 返回 `true` 表示新增，`false` 表示已存在（幂等跳过）。
    pub fn subscribe(&mut self, listener: Arc<dyn Listener>) -> bool {
        self.bus.on_any(listener)
    }

    /// 精确订阅（仅接收 `key` 的分发；供 Plan 事件族等精确监听器使用）
    pub fn subscribe_key(&mut self, key: EventKey, listener: Arc<dyn Listener>) -> bool {
        self.bus.on(key, listener)
    }

    /// 分发事件（等价既有实现：按注册顺序逐个调用、忽略返回值）
    ///
    /// **注意**：本方法在调用方持有的壳锁下运行监听器链——调度方（AgentLoop /
    /// GenaiBackend）一律经 [`Self::handle`] 于锁外分发；本方法保留供外部
    /// 已持锁调用方（`broadcaster_ref()` 的既有用法）与测试使用。
    pub fn broadcast(&self, event: &OrchestratorEvent) {
        self.bus.emit(event);
    }

    /// bail 分发（同步串行、首个否决短路；返回是否被否决）
    pub fn bail(&self, event: &OrchestratorEvent) -> bool {
        self.bus.bail(event)
    }

    /// waterfall 分发（监听器链环绕 `inner`；监听器不调 `next` 即否决）
    pub fn waterfall<'a>(
        &self,
        event: &mut OrchestratorEvent,
        inner: impl FnOnce(&mut OrchestratorEvent) -> Outcome + 'a,
    ) -> Outcome {
        self.bus.waterfall(event, inner)
    }
}
