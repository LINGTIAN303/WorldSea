/**
 * Orchestrator 类型定义 — Agent 编排框架核心抽象
 *
 * 设计参考：LangGraph 状态图 + Node/Edge 模型
 * 设计原则：
 * - 轻量：阶段 0 只做接口，不做复杂图引擎
 * - 可迁移：接口设计可直接映射到 Rust trait
 * - 兼容：事件流复用现有 AgentEvent
 * - 解耦：不依赖 pi-agent-core，可包装任何 LLM 后端
 *
 * 三层架构位置：
 *   编排框架层（ToT/GoT/Multi-Agent/Supervisor/Router/Loop）
 *   ↑ 本层提供 Node/State/Orchestrator 抽象
 *   Agent loop 层（ReAct/Plan/Reflection/Self-Refine）
 *   LLM 通信层（pi-ai/genai）
 */

import type { AgentEvent, AgentEventListener } from '../types'

// ─── 共享状态 ────────────────────────────────────────────

/**
 * 编排状态 — 节点间共享的数据容器
 *
 * 所有节点读取/写入同一个 State 实例，实现数据流传递。
 * 类比 LangGraph 的 State，但用宽松的 Record 而非强类型，
 * 避免限制节点扩展自定义字段。
 */
export interface OrchestratorState {
  /** 用户原始输入 */
  input: string
  /** 图片附件（多模态） */
  images?: Array<{ data: string; mimeType: string }>
  /** 当前累积的消息历史（含 user/assistant/toolResult） */
  messages: OrchestratorMessage[]
  /** 当前选中的模型 ID */
  modelId?: string
  /** 当前会话模式 */
  chatMode?: string
  /** Plan-and-Execute 模式的计划项 */
  plan?: PlanItem[]
  /** Reflection 模式的评审结果 */
  reflections?: ReflectionResult[]
  /** 自定义扩展字段（各模式专用数据放这里） */
  extra: Record<string, unknown>
}

/**
 * 编排消息（与 pi-agent-core 的内部消息格式解耦）
 */
export interface OrchestratorMessage {
  role: 'user' | 'assistant' | 'toolResult' | 'system'
  content: string
  /** 工具调用信息（assistant 消息触发工具时） */
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>
  /** 工具调用 ID（toolResult 消息） */
  toolCallId?: string
  /** 元数据（usage/thinking 等） */
  meta?: Record<string, unknown>
}

/**
 * 计划项（Plan-and-Execute 模式）
 *
 * 复用现有 usePlanStore 的 PlanItem 设计，但移除 Vue 响应式依赖。
 */
export interface PlanItem {
  id: string
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'
  order: number
  /** 执行结果摘要 */
  output?: string
}

/**
 * 评审结果（Reflection 模式）
 */
export interface ReflectionResult {
  /** 被评审的内容摘要 */
  target: string
  /** 评分（0-100，越高越好） */
  score: number
  /** 识别的问题列表 */
  issues: Array<{ severity: 'info' | 'warning' | 'error'; description: string }>
  /** 改进建议 */
  suggestions: string[]
  /** 评审轮次 */
  iteration: number
}

// ─── 节点抽象 ────────────────────────────────────────────

/**
 * 节点执行上下文 — 传入 Node.execute 的运行时环境
 *
 * 提供：
 * - state 读写
 * - 事件发射（与现有 AgentEvent 兼容）
 * - 中断检查（支持 Loop Engineering 的中断/恢复）
 * - LLM 后端访问（节点可通过 ctx.backend 调用 LLM）
 * - 记忆访问（阶段 0.6 新增：Memory Pattern 横切）
 */
export interface NodeContext {
  /** 共享状态 */
  state: OrchestratorState
  /** 发射事件（推送给前端，支持 AgentEvent + Orchestrator 扩展事件） */
  emit(event: OrchestratorEvent): void
  /** 检查是否被中断（返回 true 时节点应尽快返回） */
  isAborted(): boolean
  /** 等待恢复（被中断后挂起，恢复后 resolve） */
  waitIfPaused(): Promise<void>
  /** LLM 后端访问器（节点用它调用 LLM，具体类型由实现层注入） */
  backend: NodeBackendAccessor
  /**
   * 记忆访问器（阶段 0.6 新增）
   *
   * 节点通过此接口检索/注入/归档记忆。
   * 阶段 0：实现为对 memory-archive ArchiveManager 的包装
   * 阶段 1：实现为对 Rust memory 模块的 Tauri invoke 包装
   *
   * 可选字段：未注入记忆系统时为 undefined，节点应优雅降级。
   */
  memory?: MemoryAccessor
  /** 日志（调试用） */
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void
}

// ─── Memory Pattern 横切（阶段 0.6 新增） ────────────────────

/**
 * 记忆访问器 — 节点通过此接口访问记忆系统
 *
 * 设计原则：
 * - 解耦：不直接依赖 memory-archive，接口可适配任何记忆系统
 * - 可迁移：接口设计可直接映射到 Rust trait
 * - 轻量：只暴露节点需要的核心操作（recall/inject/archive）
 *
 * 三类记忆：
 * - 短期记忆：当前会话的消息历史（state.messages，trim 策略由 ShortTermMemoryHelper 管理）
 * - 工作记忆：ReAct 循环内的观察缓冲（state.extra.workingMemory）
 * - 长期记忆：跨会话的归档记忆（通过此接口检索/注入）
 */
export interface MemoryAccessor {
  /**
   * 检索长期记忆
   *
   * @param query 检索查询（用户原话或节点生成的关键词）
   * @param options 检索选项
   * @returns 检索结果列表（按相关度降序）
   */
  recall(query: string, options?: MemoryRecallOptions): Promise<MemoryRecallResult[]>

  /**
   * 注入记忆摘要到 system prompt
   *
   * 将检索到的记忆摘要拼接到 system prompt 中，供后续 LLM 调用使用。
   * 实现层负责维护"已注入"状态，避免重复注入。
   *
   * @param results 检索结果（来自 recall）
   * @param options 注入选项
   * @returns 注入到 system prompt 的文本片段（空字符串=无注入）
   */
  inject(results: MemoryRecallResult[], options?: MemoryInjectOptions): Promise<string>

  /**
   * 触发归档（将当前会话消息归档为长期记忆）
   *
   * @param source 触发源（threshold/session_end/manual）
   * @returns 归档结果（含 hookId、tokenCount 等），未触发归档时返回 null
   */
  archive(source?: 'threshold' | 'session_end' | 'manual'): Promise<MemoryArchiveResult | null>

  /**
   * 获取当前归档边界（已归档消息的结束索引）
   *
   * 节点可用此判断 state.messages 中哪些是"新消息"，哪些已被归档。
   */
  getArchiveBoundary(): number

  /**
   * 加载记忆块完整内容（按需加载片段）
   *
   * @param hookId 钩子 ID
   * @param chunkId 块 ID
   * @returns 块内容（含完整消息快照）
   */
  loadChunk?(hookId: string, chunkId: string): Promise<MemoryChunkContent | null>
}

/**
 * 记忆检索选项
 */
export interface MemoryRecallOptions {
  /** 检索模式（默认 hybrid） */
  mode?: 'keyword' | 'semantic' | 'hybrid' | 'list'
  /** 返回结果数（默认 5） */
  topK?: number
  /** 最低相似度（默认 0.25） */
  minScore?: number
  /** 时间范围过滤 */
  dateRange?: { start: number; end: number }
  /** 输出类型过滤 */
  outputTypes?: MemoryOutputType[]
}

/**
 * 记忆检索结果
 */
export interface MemoryRecallResult {
  /** 钩子 ID */
  hookId: string
  /** 摘要（LLM 生成，2K-5K） */
  summary: string
  /** 相关度评分（0-1） */
  score: number
  /** 匹配字段（keywords/summary/embedding 等） */
  matchedFields: string[]
  /** 归档时间戳 */
  createdAt: number
  /** 访问次数 */
  accessCount: number
  /** 关键词标签 */
  keywords: string[]
  /** 用户标签 */
  tags: string[]
  /** 永久保留标记 */
  pinned: boolean
}

/**
 * 记忆注入选项
 */
export interface MemoryInjectOptions {
  /** 注入最大 token 数（默认 2000） */
  maxTokens?: number
  /** 是否强制重新注入（默认 false，复用已注入摘要） */
  force?: boolean
}

/**
 * 记忆归档结果
 */
export interface MemoryArchiveResult {
  /** 钩子 ID */
  hookId: string
  /** 记忆文件 ID */
  fileId: string
  /** 归档的 token 数 */
  tokenCount: number
  /** 归档的分块数 */
  chunkCount: number
  /** 归档后新的边界索引 */
  newBoundaryIndex: number
  /** 摘要生成方式 */
  summaryMethod: 'llm' | 'rule' | 'none'
}

/**
 * 记忆块完整内容
 */
export interface MemoryChunkContent {
  /** 块 ID */
  chunkId: string
  /** 主题标题 */
  title: string
  /** 输出类型 */
  outputType: MemoryOutputType
  /** 用户消息锚点 */
  userMessageAnchor: string
  /** token 数 */
  tokenCount: number
  /** 完整消息快照 */
  messages: Array<{
    role: 'user' | 'assistant' | 'tool' | 'system'
    content: string
    toolCallId?: string
    toolName?: string
    timestamp: number
    metadata?: Record<string, unknown>
  }>
}

/**
 * Agent 输出类型（与 memory-archive 对齐，但解耦）
 */
export type MemoryOutputType =
  | 'text'
  | 'tool_call'
  | 'entity_op'
  | 'code'
  | 'analysis'
  | 'creative'
  | 'other'

// ─── 工作记忆（阶段 0.7 新增） ─────────────────────────────

/**
 * 工作记忆条目 — ReAct 循环内的单次观察记录
 *
 * 与 OrchestratorMessage 的区别：
 * - OrchestratorMessage：完整对话历史，含 user/assistant/system/toolResult
 * - WorkingMemoryEntry：仅工具调用的观察结果，是 ReAct 循环内的临时缓冲
 *
 * 用途：
 * - ReAct 节点在工具调用后，将观察结果推入 workingMemory
 * - Reflection/Refine 节点可读取 workingMemory 评估工具使用质量
 * - 循环结束时，workingMemory 可合并到 messages 或丢弃
 *
 * 存储位置：state.extra.workingMemory（数组）
 */
export interface WorkingMemoryEntry {
  /** 条目唯一 ID（nanoid 或 timestamp-based） */
  id: string
  /** 关联的工具调用 ID（与 OrchestratorMessage.toolCallId 对应） */
  toolCallId?: string
  /** 工具名称 */
  toolName: string
  /** 工具调用参数摘要（避免存储完整参数） */
  argsSummary?: string
  /** 观察结果（工具返回内容） */
  observation: string
  /** 创建时间戳 */
  timestamp: number
  /** 来源节点 ID（哪个节点产生的观察） */
  sourceNodeId?: string
  /** 重要性评分（0-1，影响 trim 时的保留优先级，默认 0.5） */
  importance?: number
}

/**
 * 工作记忆快照 — 供节点读取的只读视图
 *
 * 节点通过 NodeContext.getWorkingMemory() 获取快照，
 * 避免直接操作数组导致状态不一致。
 */
export interface WorkingMemorySnapshot {
  /** 所有观察条目（按时间顺序） */
  entries: ReadonlyArray<WorkingMemoryEntry>
  /** 条目总数 */
  count: number
  /** 估算的 token 数 */
  estimatedTokens: number
}

/**
 * LLM 后端访问器 — 节点通过此接口调用 LLM
 *
 * 设计为接口而非具体类型，解耦 pi-agent-core。
 * 阶段 0：实现为对 pi-agent-core Agent 的包装
 * 阶段 1：实现为对 Rust genai 的 Tauri invoke 包装
 */
export interface NodeBackendAccessor {
  /**
   * 发送 prompt 并流式获取响应
   *
   * @param prompt 用户输入
   * @param options 调用选项
   * @returns 最终响应文本（流式事件通过 ctx.emit 推送）
   */
  prompt(prompt: string, options?: PromptCallOptions): Promise<string>

  /**
   * 中途引导（不结束当前轮）
   */
  steer(text: string): Promise<void>

  /**
   * 获取当前 messages 快照（用于 checkpoint）
   */
  getMessages(): OrchestratorMessage[]

  /**
   * 写回 messages（用于断点恢复）
   */
  setMessages(messages: OrchestratorMessage[]): void

  /**
   * 清理上下文（释放窗口空间）
   * @param upToIndex 移除前 N 条
   */
  trimContext(upToIndex: number): void
}

/**
 * 节点调用 LLM 的选项
 */
export interface PromptCallOptions {
  /** 系统提示词覆盖 */
  systemPromptOverride?: string
  /** 工具集覆盖（空数组=禁用工具） */
  toolsOverride?: string[]
  /** 温度 */
  temperature?: number
  /** 最大 token */
  maxTokens?: number
  /** 思考级别 */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** 图片附件 */
  images?: Array<{ data: string; mimeType: string }>
}

/**
 * 节点执行结果
 */
export interface NodeResult {
  /** 状态：继续/完成/中断/错误 */
  status: 'continue' | 'done' | 'aborted' | 'error'
  /** 下一个要执行的节点 ID（status=continue 时有效，空=默认顺序） */
  nextNodeId?: string
  /** 错误信息（status=error 时） */
  error?: string
  /** 节点输出的摘要（用于日志/调试） */
  summary?: string
}

/**
 * 节点接口 — 所有编排模式的基础构建块
 *
 * 实现示例：
 * - ReactNode：包装 pi-agent-core 的 Agent 循环
 * - PlanNode：生成任务计划
 * - ExecuteNode：逐步执行计划项
 * - ReflectionNode：评审输出
 * - RefineNode：基于评审迭代优化
 * - RouterNode：根据输入路由到不同节点
 * - SupervisorNode：分配任务给子 Agent
 */
export interface OrchestratorNode {
  /** 节点唯一 ID */
  id: string
  /** 人类可读名称（调试/日志用） */
  name: string
  /** 节点类型标识 */
  type: NodeType
  /** 执行节点逻辑 */
  execute(ctx: NodeContext): Promise<NodeResult>
  /** 重置节点状态（Orchestrator 重新运行时调用） */
  reset?(): void
}

/**
 * 节点类型枚举
 */
export type NodeType =
  | 'react'           // ReAct 循环（基础工具调用）
  | 'plan'            // 生成计划
  | 'execute'         // 执行计划项
  | 'reflection'      // 评审
  | 'refine'          // 自我优化
  | 'router'          // 路由
  | 'supervisor'      // 监督者
  | 'sub-agent'       // 子 Agent
  | 'memory'          // 记忆读写
  | 'custom'          // 自定义

// ─── 边与图 ────────────────────────────────────────────

/**
 * 边 — 节点间的连接
 *
 * 阶段 0 用简单的线性/条件边，不引入完整图引擎。
 * 阶段 2（Rust）可扩展为支持任意拓扑的图。
 */
export interface OrchestratorEdge {
  /** 源节点 ID */
  from: string
  /** 目标节点 ID */
  to: string
  /** 条件函数（返回 true 时走这条边，空=无条件） */
  condition?: (state: OrchestratorState) => boolean
  /** 边的标签（调试用） */
  label?: string
}

// ─── Orchestrator 接口 ────────────────────────────────────

/**
 * Orchestrator — 编排器，驱动节点图执行
 *
 * 使用方式：
 * 1. 创建 Orchestrator 实例
 * 2. 添加节点和边
 * 3. 调用 run(input) 启动
 * 4. 通过 subscribe 监听事件
 * 5. 通过 abort 中断
 *
 * 阶段 0 实现：简单的线性/条件序列执行器
 * 阶段 2 实现：完整的图执行器（支持并行/回溯）
 */
export interface Orchestrator {
  /** 添加节点 */
  addNode(node: OrchestratorNode): void
  /** 添加边 */
  addEdge(edge: OrchestratorEdge): void
  /** 设置入口节点 */
  setEntry(nodeId: string): void
  /** 启动执行 */
  run(input: string, options?: OrchestratorRunOptions): Promise<OrchestratorResult>
  /** 中断执行 */
  abort(): Promise<void>
  /** 暂停执行（可恢复） */
  pause(): void
  /** 恢复执行 */
  resume(): void
  /** 订阅事件 */
  subscribe(listener: AgentEventListener): () => void
  /** 获取当前状态快照（checkpoint 用） */
  getSnapshot(): OrchestratorState
  /** 从快照恢复 */
  restore(snapshot: OrchestratorState): void
  /** 销毁 */
  dispose(): void
}

/**
 * 运行选项
 */
export interface OrchestratorRunOptions {
  /** 图片附件 */
  images?: Array<{ data: string; mimeType: string }>
  /** 模型 ID 覆盖 */
  modelId?: string
  /** 会话模式 */
  chatMode?: string
  /** 最大轮次（防止无限循环） */
  maxIterations?: number
  /** 超时（毫秒） */
  timeoutMs?: number
}

/**
 * 运行结果
 */
export interface OrchestratorResult {
  /** 最终状态 */
  status: 'completed' | 'aborted' | 'error' | 'timeout'
  /** 最终消息（Agent 的最后一条回复） */
  finalMessage?: string
  /** 执行的轮次数 */
  iterations: number
  /** 错误信息 */
  error?: string
  /** 最终状态快照 */
  finalState: OrchestratorState
}

// ─── 事件扩展 ────────────────────────────────────────────

/**
 * Orchestrator 专用事件（扩展 AgentEvent）
 *
 * 这些事件在现有 AgentEvent 基础上新增，用于编排层的可观测性。
 * 前端可监听这些事件展示编排进度（如 Plan 进度、Reflection 评分）。
 */
export type OrchestratorEvent =
  | AgentEvent
  | { type: 'orchestrator_start'; entryNodeId: string; input: string }
  | { type: 'orchestrator_end'; result: OrchestratorResult }
  | { type: 'node_start'; nodeId: string; nodeName: string; nodeType: NodeType }
  | { type: 'node_end'; nodeId: string; status: NodeResult['status']; summary?: string; durationMs: number }
  | { type: 'plan_created'; items: PlanItem[] }
  | { type: 'plan_step_update'; stepId: string; status: PlanItem['status']; output?: string }
  | { type: 'reflection_result'; result: ReflectionResult }
  // 阶段 0.6 新增：Memory Pattern 事件
  | { type: 'memory_recall'; query: string; results: MemoryRecallResult[]; durationMs: number }
  | { type: 'memory_inject'; summary: string; hookCount: number }
  | { type: 'memory_archive'; result: MemoryArchiveResult }
  | { type: 'memory_trim'; removedCount: number; remainingCount: number }
  // 阶段 0.7 新增：Working Memory 事件
  | { type: 'working_memory_push'; entry: WorkingMemoryEntry; trimmedCount: number }
  | { type: 'working_memory_trim'; removedCount: number; remainingCount: number }
  | { type: 'working_memory_clear'; removedCount: number }
  | { type: 'working_memory_merge'; mergedCount: number; toMessages: number; discarded: number }
  | { type: 'orchestrator_paused' }
  | { type: 'orchestrator_resumed' }
