//! 事件 Key 常量表（S3-b：自 `agent-kernel::event::keys` 迁入——**单一声明点**）。
//!
//! 与旧 kernel `key()` 的穷尽 match 一一对应（新增变体必须在该 match 处登记，编译期强制）。
//! 命名沿既有口径：snake_case 单词式（如 `agent_start`）；新增事件族沿用同口径。

use super::EventKey;

// Agent 基础事件
pub const AGENT_START: EventKey = "agent_start";
pub const USER_MESSAGE: EventKey = "user_message";
pub const STREAM_START: EventKey = "stream_start";
pub const STREAM_DELTA: EventKey = "stream_delta";
pub const REASONING_DELTA: EventKey = "reasoning_delta";
pub const STREAM_END: EventKey = "stream_end";
pub const TOOL_CALL_START: EventKey = "tool_call_start";
pub const TOOL_CALL_END: EventKey = "tool_call_end";
pub const ERROR: EventKey = "error";
pub const AGENT_END: EventKey = "agent_end";

// 编排器生命周期
pub const ORCHESTRATOR_START: EventKey = "orchestrator_start";
pub const ORCHESTRATOR_END: EventKey = "orchestrator_end";
pub const NODE_START: EventKey = "node_start";
pub const NODE_END: EventKey = "node_end";

// 统一轨迹事件族
pub const TRACE_PIPE_STARTED: EventKey = "trace_pipe_started";
pub const TRACE_PHASE_ENTERED: EventKey = "trace_phase_entered";
pub const TRACE_PHASE_RESULT: EventKey = "trace_phase_result";
pub const TRACE_PIPE_FINISHED: EventKey = "trace_pipe_finished";

// Plan-and-Execute
pub const PLAN_CREATED: EventKey = "plan_created";
pub const PLAN_STEP_UPDATE: EventKey = "plan_step_update";
pub const PLAN_REPLANNED: EventKey = "plan_replanned";

// Reflection
pub const REFLECTION_RESULT: EventKey = "reflection_result";

// Supervisor / SubAgent
pub const SUPERVISOR_TASK_ASSIGNED: EventKey = "supervisor_task_assigned";
pub const SUB_AGENT_STARTED: EventKey = "sub_agent_started";
pub const SUB_AGENT_COMPLETED: EventKey = "sub_agent_completed";
pub const SUB_AGENT_ERROR: EventKey = "sub_agent_error";

// Router
pub const ROUTER_DECISION_MADE: EventKey = "router_decision_made";
pub const ROUTER_NO_MATCH: EventKey = "router_no_match";
pub const ROUTER_ERROR: EventKey = "router_error";

// Tree of Thoughts
pub const THOUGHT_NODE_CREATED: EventKey = "thought_node_created";
pub const THOUGHT_NODE_SCORED: EventKey = "thought_node_scored";
pub const THOUGHT_BRANCH_EXPLORED: EventKey = "thought_branch_explored";
pub const TOT_GOAL_REACHED: EventKey = "tot_goal_reached";
pub const TOT_TERMINATED: EventKey = "tot_terminated";
pub const TOT_ERROR: EventKey = "tot_error";

// Graph of Thoughts
pub const THOUGHTS_AGGREGATED: EventKey = "thoughts_aggregated";

// Loop Engineering
pub const LOOP_ENG_RATE_LIMIT_EXCEEDED: EventKey = "loop_eng_rate_limit_exceeded";
pub const LOOP_ENG_RETRYING: EventKey = "loop_eng_retrying";
pub const LOOP_ENG_RETRY_EXHAUSTED: EventKey = "loop_eng_retry_exhausted";
pub const LOOP_ENG_SOFT_TIMEOUT_WARNING: EventKey = "loop_eng_soft_timeout_warning";
pub const LOOP_ENG_SOFT_TIMEOUT_CRITICAL: EventKey = "loop_eng_soft_timeout_critical";
pub const LOOP_ENG_WATCHDOG_IDLE: EventKey = "loop_eng_watchdog_idle";
pub const LOOP_ENG_WATCHDOG_DEAD: EventKey = "loop_eng_watchdog_dead";
pub const LOOP_ENG_RECOVERED: EventKey = "loop_eng_recovered";
pub const STEP_BUDGET_WARNING: EventKey = "step_budget_warning";

// 上下文压缩（阶段 3 · A2 补齐②③：事务括号 + 事件化）
pub const CONTEXT_COMPACT_STARTED: EventKey = "context_compact_started";
pub const CONTEXT_COMPACT_FINISHED: EventKey = "context_compact_finished";
pub const CONTEXT_COMPACT_FAILED: EventKey = "context_compact_failed";

// 请求快照（阶段 3 · A2 补齐④）
pub const REQUEST_SNAPSHOT_CAPTURED: EventKey = "request_snapshot_captured";

// 输入模型（阶段 2 · A3：inbox 三通道 + pre-step 准入 + 取消收口）
/// 输入准入（**waterfall 分发**：监听器可改写/丢弃待准入输入）
pub const INPUT_ADMISSION: EventKey = "input_admission";
/// 本轮被中断（取消收口：已交付文本终结 + 中断锚点）
pub const AGENT_INTERRUPTED: EventKey = "agent_interrupted";

// 工具结果预处理（阶段 1 第二段迁移：工具结果裁剪，waterfall 分发）
/// 工具结果广播前同步预处理（监听器可改写 `result`；链尾内建 = 裁剪）
pub const TOOL_RESULT_PRE_BROADCAST: EventKey = "tool_result_pre_broadcast";

// 工具流式（只进流通道，不进入 LLM 上下文）
pub const TOOL_CALL_DELTA: EventKey = "tool_call_delta";
pub const FILE_CHANGE: EventKey = "file_change";

// A2UI
pub const A2UI_EVENT: EventKey = "a2ui_event";

// HITL 权限确认
pub const CONFIRMATION_REQUESTED: EventKey = "confirmation_requested";
pub const CONFIRMATION_RESOLVED: EventKey = "confirmation_resolved";

// Q1 提问（模型主动提问）
pub const ASK_REQUESTED: EventKey = "ask_requested";
pub const ASK_RESOLVED: EventKey = "ask_resolved";

// 会话分支（S3-c；04 会话模型草案 §2.5——分叉 / 回滚 / 检查点三事件族，前端可见）
/// 会话分叉（子会话自父会话某请求边界派生；父会话零影响）
pub const CONVERSATION_FORKED: EventKey = "conversation_forked";
