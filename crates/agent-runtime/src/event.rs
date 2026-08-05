//! # 编排事件
//!
//! 对应 TS 版 `OrchestratorEvent` 类型，扩展自基础 `AgentEvent`。
//! 前端可监听这些事件展示编排进度（如 Plan 进度、Reflection 评分）。

use std::sync::Arc;

use serde::Serialize;

use crate::a2ui::A2UIMessage;
use crate::memory::{MemoryArchiveResult, MemoryRecallResult};
use crate::node::{NodeStatus, NodeType};
use crate::types::{ImageAttachment, PlanItem, ReflectionResult};

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
    /// 流式结束
    StreamEnd { full_text: String },
    /// 工具调用开始
    ToolCallStart { tool_call_id: String, name: String, args: serde_json::Value },
    /// 工具调用结束
    ToolCallEnd { tool_call_id: String, result: serde_json::Value },
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

    // ── Plan-and-Execute 事件 ──
    /// 计划已创建
    PlanCreated { items: Vec<PlanItem> },
    /// 计划步骤更新
    PlanStepUpdate {
        step_id: String,
        status: crate::types::PlanItemStatus,
        output: Option<String>,
    },

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

    // ── Supervisor Pattern 事件（阶段 2.4 新增）──
    //
    // 这些事件用于跟踪 Supervisor 模式的任务分配、子 Agent 执行进度，
    // 前端可据此展示"Supervisor 正在分析任务"、"子 Agent X 正在执行"等状态。
    //
    // 事件触发顺序：
    //   SupervisorTaskAssigned → SubAgentStarted → SubAgentCompleted → (继续下一节点)
    //                            或 → SubAgentError (子 Agent 执行失败)
    //                            或 → SupervisorError (任务分配失败)
    //
    // 注意：阶段 1.2 不转发子 Agent 内部的 StreamDelta 等事件到父 Orchestrator，
    // 前端通过 SubAgentStarted/Completed 两个边界事件了解子 Agent 执行进度。
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

    // ── Router Pattern 事件（阶段 2.5 新增）──
    //
    // 这些事件用于跟踪 Router 模式的路由决策过程，
    // 前端可据此展示"Router 正在分析输入"、"已路由到分支 X"等状态。
    //
    // 事件触发顺序：
    //   RouterDecisionMade → (Orchestrator 调度下一节点)
    //   或 → RouterNoMatch (无匹配路由，触发 fallback 或报错)
    //   或 → RouterError (决策阶段失败)
    //
    // 注意：Router 是纯决策节点，不执行子 Agent，
    // 所以没有 RouterBranchStarted/Completed 等执行类事件。
    // 分支执行由 Orchestrator 按 next_node_id 调度，对应节点会触发自己的事件。
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

    // ── Tree of Thoughts 事件（阶段 2.1 新增）──
    //
    // 这些事件用于跟踪 ToT 模式的思维树探索过程，
    // 前端可据此展示"正在生成第 N 层思维"、"评分 X"、"已找到目标"等状态。
    //
    // 事件触发顺序（每层）：
    //   ThoughtNodeCreated（每个生成的子节点）→ ThoughtNodeScored（每个评分完成的节点）
    //   → ThoughtBranchExplored（层扩展完成）→ ToTGoalReached 或继续下一层
    //
    // 终止时触发：
    //   ToTGoalReached（LLM 判定目标达成）/ ToTTerminated（其他终止条件）
    //   或 ToTError（执行失败）
    //
    // 注意：ToT 是树探索模式，不像 Supervisor 那样执行子 Agent，
    // 所有思维生成/评分/目标检查都通过 LLM 调用完成。
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

    // ── Graph of Thoughts 事件（阶段 2.2 新增）──
    //
    // GoT 复用 ToT 的大部分事件（ThoughtNodeCreated / ThoughtNodeScored /
    // ThoughtBranchExplored / ToTGoalReached / ToTTerminated / ToTError），
    // 仅新增 `ThoughtsAggregated` 一个事件用于跟踪跨节点聚合。
    //
    // 事件触发顺序（每层）：
    //   ThoughtNodeCreated（每个生成的子节点）→ ThoughtNodeScored
    //   → ThoughtBranchExplored → ThoughtsAggregated（聚合阶段）
    //   → 下一层或 ToTGoalReached / ToTTerminated
    //
    // 注意：GoTNode.node_type() 返回 NodeType::Graph（与 ToTNode 的 Thought 区分），
    // 前端可据此区分事件来自 ToT 还是 GoT。
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

    // ── Multi-Agent Pattern 事件（阶段 2.3 新增）──
    //
    // 这些事件用于跟踪 Multi-Agent 模式的多轮协作过程，
    // 前端可据此展示"第 N 轮协作开始"、"Agent A → Agent B 消息"、
    // "黑板已更新"、"协作收敛"等状态。
    //
    // 事件触发顺序（一轮成功路径）：
    //   MultiAgentRoundStarted
    //     → MultiAgentMessageSent（每个 Agent 接收消息时）
    //     → MultiAgentBlackboardUpdated（Agent 写入黑板时）
    //   → MultiAgentRoundCompleted
    //   →（继续下一轮 或 MultiAgentConverged）
    //
    // 失败路径：
    //   - Agent 执行失败：MultiAgentError（agent_id=失败 Agent）
    //   - 收敛检查失败：MultiAgentError（agent_id="system"）
    //
    // 注意：MultiAgentNode 是去中心化对等协作节点（与 Supervisor 中心化调度互补），
    // 内部 N 个 AgentLoop 通过 mpsc 通道 + SharedBlackboard 协作。
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

    // ── Loop Engineering 事件（阶段 2.6 新增）──
    //
    // 这些事件用于跟踪 Loop Engineering 的循环控制行为，
    // 前端可据此展示"速率限制触发"、"重试中"、"软超时警告"等状态。
    //
    // 事件触发时机：
    //   - RateLimitExceeded：ReAct 循环每轮检查时发现超限
    //   - LoopEngRetrying：LLM/tool 调用失败，决定重试
    //   - LoopEngRetryExhausted：重试次数用尽，放弃重试
    //   - SoftTimeoutWarning / SoftTimeoutCritical：软超时阈值触发
    //   - WatchdogIdle / WatchdogDead：看门狗检测到任务无活动
    //   - LoopEngRecovered：任务恢复（手动或自动）
    //
    // 注意：Loop Engineering 事件不绑定特定 node_id，
    // 因为它横切所有编排模式（ReAct / ToT / GoT / Multi-Agent 等）。
    // `task_id` 字段对应 `LongTaskRecord.task_id`。
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

    // ── Deep Mode 事件（阶段 P2 新增）──
    //
    // 工具执行状态（用于 DeepPhaseChanged 事件标注触发工具状态）
    // 序列化为小写（running/completed/failed），与前端 ToolCallView.status 一致。
    //
    // 阶段 P2 扩展：DeepPhaseChanged 新增 `tool_status`（工具完成状态）与
    // `phase_completed`（阶段完成标记），前端据此更新工具状态与阶段状态。
    //
    // 这些事件用于跟踪 Deep Mode 的阶段切换过程，
    // 前端可据此构建 `deepSegments`，按"问题拆解→证据收集→推理分析→创作操作→结论输出"
    // 五阶段分组展示工具调用。
    //
    // 事件触发时机：
    //   - ReAct 循环每次执行工具后，调用 `classify_tool` 判定当前阶段
    //   - 若与 `last_phase_label` 不同，则广播 `DeepPhaseChanged`
    //   - 初始 `last_phase_label = None`，首次工具调用必定触发事件
    //
    // 设计选择：方案 A（Rust 端只发事件，前端构建 deepSegments）
    // - Rust 端不维护 segments 状态，只负责"阶段切换检测"
    // - 前端通过事件流构建 `deepSegments`（与 TS 版 `DeepMessageArea.vue` 一致）
    // - 优势：Rust 端状态最小化，与现有事件驱动架构一致
    //
    // 注意：`phase_index = -1` 表示"其他操作"（未匹配任何阶段），
    // 前端可将其作为兜底分组或忽略。
    /// Deep Mode 阶段切换
    ///
    /// 在工具执行后判定阶段变化时触发，携带阶段标签、索引与触发工具名。
    /// 前端监听此事件，更新 `deepSegments` 状态以激活 Deep Mode UI。
    DeepPhaseChanged {
        /// 会话 ID（与触发工具的 session 一致）
        ///
        /// 注意：此字段不参与 `from_orchestrator_event` 的转换逻辑，
        /// 因为 OrchestratorEvent 不携带 session_id（由调用方注入）。
        /// 这里保留是为了与 AgentEvent 的事件流对齐，Tauri 端会覆盖。
        node_id: String,
        /// 阶段标签（"问题拆解" / "证据收集" / "推理分析" / "创作操作" / "结论输出" / "其他操作"）
        phase_label: String,
        /// 阶段索引（0..4 对应五阶段，-1 为"其他操作"）
        phase_index: i8,
        /// 触发本次阶段判定的工具名
        trigger_tool: String,
        /// 触发工具执行状态（running/completed/failed）
        ///
        /// 阶段 P2 扩展：工具执行后广播，据此标注触发工具是成功还是失败。
        /// 前端据此更新 `deepSegments` 内对应 `ToolCallView.status`。
        tool_status: ToolStatus,
        /// 阶段完成标记（true=该阶段已完成，false=仍在进行）
        ///
        /// 阶段 P2 扩展：当前广播发生在"进入新阶段"时，新阶段刚激活，
        /// 故此处恒为 `false`；前端收到不同 `phase_index` 时，负责把旧阶段
        /// 标记为 `done`。保留该字段以便未来支持"阶段内全部工具完成"的精确判定。
        phase_completed: bool,
    },

    // ── A2UI 事件（阶段 P2 新增）──
    //
    // 这些事件用于跟踪 Agent-to-UI 的画布操作，
    // 前端可据此展示"Agent 创建了画布 X"、"Agent 更新了组件 Y"等状态。
    //
    // 事件触发时机：
    //   - AgentLoop 执行 A2UI 工具（如 ui_create_surface / ui_update_components 等）后，
    //     工具通过 FrontendToolBridge 调用 TS 实现，TS 实现内部调用 ctx.emitA2UI
    //   - FrontendToolBridge 将 emitA2UI 调用桥接回 Rust，封装为 A2UIEvent 广播
    //   - Tauri 命令层将 A2UIEvent 转换为 AgentEventPayload::A2UI 推送到前端
    //
    // 设计说明：
    //   - A2UI 事件本质是"工具副作用"，不依赖 Orchestrator 编排模式
    //   - 包装在 OrchestratorEvent 内是为了走现有事件广播通道（EventBroadcaster）
    //   - 与 Agent(AgentEvent::A2UI) 的关系：A2UIEvent 是 Orchestrator 层的包装，
    //     Tauri 端在转换时会同时处理两种形式（统一输出 AgentEventPayload::A2UI）
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
}

/// 工具执行状态（DeepPhaseChanged 事件扩展字段）
///
/// 序列化为小写（running/completed/failed），与前端 `ToolCallView.status` 一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ToolStatus {
    /// 正在执行
    Running,
    /// 执行成功
    Completed,
    /// 执行失败
    Failed,
}

/// 编排器结束结果（简化版，避免与 `OrchestratorResult` 循环引用）
#[derive(Debug, Clone)]
pub struct OrchestratorEndResult {
    pub status: OrchestratorEndStatus,
    pub final_message: Option<String>,
    pub iterations: u32,
    pub error: Option<String>,
}

/// 编排器结束状态
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrchestratorEndStatus {
    Completed,
    Aborted,
    Error,
    Timeout,
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
