/**
 * @worldsea/memory-archive 核心类型定义
 *
 * 包含所有公共类型，应用了 P4/P5/P6/P8/P9/P16 等决策结论。
 */

// ============================================================================
// Agent 输出类型（分块维度之一，P8 决策）
// ============================================================================

export type AgentOutputType =
  | 'text' // 纯文本回复
  | 'tool_call' // 工具调用
  | 'entity_op' // 实体操作
  | 'code' // 代码生成
  | 'analysis' // 分析推理
  | 'creative' // 创意内容
  | 'other'

// ============================================================================
// Agent 消息快照（归档时的消息快照，与具体 Agent 框架解耦）
// ============================================================================

export interface AgentMessageSnapshot {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCallId?: string
  toolName?: string
  timestamp: number
  /** 宿主可扩展字段（含 outputType，P8 决策：metadata 优先检测输出类型） */
  metadata?: Record<string, unknown>
}

// ============================================================================
// 索引钩子（轻量元数据，可全部常驻内存）
// P4 决策：补充 8 个新字段（tags/summaryMethod/deprecatedAt/importance/pinned/relatedHookIds/source/version/customMetadata）
// P16 决策：新增 activeAccessCount 和 pinned
// ============================================================================

export interface Hook {
  /** nanoid，唯一标识 */
  id: string
  /** 指向记忆文件的 ID */
  fileId: string
  /** 来源会话 ID */
  sessionId: string
  /** 项目隔离 */
  projectId: string
  /** 归档时间戳 */
  createdAt: number
  /** 归档时的上下文 token 数 */
  tokenCount: number
  /** 归档的消息范围 */
  messageRange: {
    start: number // 起始消息索引（含）
    end: number // 结束消息索引（不含）
  }

  /** 文件内部结构（主题分块标题，用于精准定位） */
  chunkTitles: ChunkTitle[]
  /** 关键词标签（归档时自动提取） */
  keywords: string[]
  /** 用户/Agent 手动标签（P4 新增，区别于自动 keywords） */
  tags: string[]

  /** 向量嵌入（摘要的向量，用于语义检索） */
  embedding?: number[]
  /** 摘要（LLM 生成，2K-5K，用于注入和检索展示） */
  summary: string
  /** 摘要生成方式（P4/P10 新增，检索时降权 rule） */
  summaryMethod: 'llm' | 'rule' | 'none'

  /** 总访问次数 */
  accessCount: number
  /** 主动检索访问次数（P16 新增，不计自动注入） */
  activeAccessCount: number
  lastAccessedAt: number

  /** 衰减状态 */
  decayScore: number // 0-1，低于阈值标记淘汰
  /**
   * 钩子状态
   * - active: 活跃，可被检索
   * - deprecated: 已淘汰（周任务合并后标记），等待月任务硬删除
   * - pending_delete: 待删除（保留字段，当前未使用）
   * - orphan: 孤儿状态（H6.3 事务机制：Commit 失败时标记，月任务清理）
   * - trashed: 回收站（H5.2 软删除机制，等待保留期后清理）
   * - pending_merge: 待合并（H5.3 两阶段合并，周任务标记后等待用户确认）
   */
  status: 'active' | 'deprecated' | 'pending_delete' | 'orphan' | 'trashed' | 'pending_merge'
  /** P4 新增，标记 deprecated 的时间戳 */
  deprecatedAt?: number
  /** H5.2 新增，标记 trashed 的时间戳（回收站保留期计算用） */
  trashedAt?: number
  /** H5.3 新增，标记 pending_merge 的时间戳 */
  pendingMergeAt?: number

  /** 重要性评分（P4 新增，0-1，归档时 LLM 标注，影响衰减权重） */
  importance: number // 默认 0.5
  /** 永久保留标记（P16 新增，pinned=true 跳过衰减） */
  pinned: boolean // 默认 false

  /** 关联钩子（P4 新增，周任务合并时建立） */
  relatedHookIds: string[]
  /** 归档触发源（P4 新增，用于审计） */
  source: 'threshold' | 'session_end' | 'manual'
  /** 钩子格式版本（P4 新增，便于未来迁移） */
  version: string // 默认 '1.0'
  /** 宿主扩展字段（P4 新增，如 worldsea 可存 entityIds） */
  customMetadata?: Record<string, unknown>

  /** 索引归属（日/周汇总索引引用） */
  dailyIndexId?: string
  weeklyIndexId?: string
}

// ============================================================================
// 主题块标题（记忆文件内部结构索引）
// P5 决策：移除 offset/length 字段（改用分块 JSON 文件，无需偏移）
// ============================================================================

export interface ChunkTitle {
  /** 块 ID，对应记忆文件内的块 */
  chunkId: string
  /** 主题标题（如"角色设计讨论"） */
  title: string
  /** Agent 输出类型 */
  outputType: AgentOutputType
  /** 用户消息锚点（首条用户消息摘要，50字内） */
  userMessageAnchor: string
  /** 该块 token 数 */
  tokenCount: number
}

// ============================================================================
// 记忆文件（完整无损原文，分块 JSON 文件存储）
// P5 决策：改用分块 JSON 文件，每个块独立文件
// ============================================================================

export interface MemoryFile {
  id: string
  header: MemoryFileHeader
  chunks: MemoryChunk[]
}

export interface MemoryFileHeader {
  fileId: string
  projectId: string
  sessionId: string
  createdAt: number
  totalTokens: number
  totalChunks: number
  formatVersion: string // '1.0'
  encoding: string // 'utf-8'
}

/** 主题块（记忆文件内部的一个分块） */
export interface MemoryChunk {
  chunkId: string
  title: string
  outputType: AgentOutputType
  userMessageAnchor: string
  tokenCount: number
  /** 该块包含的完整消息快照 */
  messages: AgentMessageSnapshot[]
}

// ============================================================================
// 汇总索引（日/周周期产物）
// ============================================================================

export interface ArchiveIndex {
  id: string
  type: 'daily' | 'weekly'
  projectId: string
  /** 周期开始时间戳 */
  periodStart: number
  /** 周期结束时间戳 */
  periodEnd: number
  /** 包含的钩子 ID 列表 */
  hookIds: string[]
  /** LLM 生成的周期摘要 */
  summary: string
  /** 周期关键词聚合 */
  keywords: string[]
  /** 周期摘要向量 */
  embedding?: number[]
  createdAt: number
}

// ============================================================================
// 配置（含 P6 新增的 5 个配置项）
// ============================================================================

export interface ArchiveConfig {
  /** 归档阈值（token 数，达到即触发归档） */
  archiveThreshold: number // 默认 400000
  /** 最小归档消息数（P7 新增，预检查用） */
  minArchiveMessages: number // 默认 10

  /** 归档触发条件 */
  triggers: {
    onTokenThreshold: boolean // 默认 true
    onSessionEnd: boolean // 默认 true
    manual: boolean // 默认 true
  }

  /** 周期管理 */
  scheduler: {
    enabled: boolean // 默认 true
    dailyHour: number // 默认 3（凌晨）
    weeklyDay: number // 默认 0（周日）
    monthlyDay: number // 默认 1
  }

  /** 衰减配置 */
  decay: {
    halfLifeDays: number // 默认 30
    /** 软淘汰阈值（P16 调整为 0.15） */
    deprecatedThreshold: number // 默认 0.15
    /** 硬删除天数（默认 90 天） */
    deleteAfterDays: number
  }

  /** 注入策略 */
  injection: {
    /** 新会话自动注入最近 N 个钩子摘要 */
    autoInjectRecentCount: number // 默认 2
    /** 注入摘要最大 token */
    maxSummaryTokens: number // 默认 2000
  }

  /** 分块策略 */
  chunking: {
    strategy: 'topic' // 当前仅 topic
    minChunkTokens: number // 默认 2000
    maxChunkTokens: number // 默认 20000
  }

  /** embedding 配置（P6 新增） */
  embedding: {
    model: string // 默认 'text-embedding-3-small'
    dimension: number // 默认 1536
    batchSize: number // 默认 100
  }

  /** 摘要配置（P6 新增） */
  summary: {
    enabled: boolean // 默认 true
    maxLength: number // 默认 5000
    method: 'llm' | 'rule' // 默认 'llm'
  }

  /** 存储限制（P6 新增） */
  maxHooks: number // 默认 1000
  maxStorageMB: number // 默认 500

  /** 排除模式（P6 新增，排除消息的正则模式） */
  exclusionPatterns: string[]

  // ===== H 系列修复新增配置 =====

  /** H1.4 阈值动态范围（结合消息长度动态决定触发点） */
  archiveThresholdMin?: number // 默认 archiveThreshold * 0.75
  archiveThresholdMax?: number // 默认 archiveThreshold * 1.25

  /** H4.3 限制注入的摘要数量（归档后注入的摘要上限） */
  maxInjectedSummaries?: number // 默认 3

  /** H2.5 检索默认 minScore（前端可配置） */
  defaultMinScore?: number // 默认 0.25

  /** H7.4 钩子内存缓存 LRU 最大数量（0 表示不淘汰） */
  hooksCacheMaxSize?: number // 默认 200

  /** H5.2 回收站保留天数（超过后月任务自动清空） */
  trashRetentionDays?: number // 默认 7
}

// ============================================================================
// 归档结果与工具定义
// ============================================================================

export interface ArchiveResult {
  hookId: string
  fileId: string
  tokenCount: number
  chunkCount: number
  /** 归档后新的边界索引 */
  newBoundaryIndex: number
  summaryMethod: 'llm' | 'rule' | 'none'
}

export interface ArchiveTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<unknown>
}

// ============================================================================
// 检索相关类型（P9 决策：新增 list 模式）
// ============================================================================

export type RecallMode = 'keyword' | 'semantic' | 'hybrid' | 'list'

export interface RecallParams {
  /** 检索查询（list 模式可为空） */
  query: string
  /** 检索模式（默认 hybrid） */
  mode: RecallMode
  /** 返回钩子数（默认 5） */
  topK?: number
  /** 最低相似度（默认 0.25） */
  minScore?: number
  /** 指定块加载（按需加载片段时用） */
  chunkId?: string
  /** 时间范围过滤 */
  dateRange?: { start: number; end: number }
  /** 输出类型过滤 */
  outputTypes?: AgentOutputType[]
}

export interface RecallResult {
  hook: Hook
  score: number
  matchedFields: string[]
}

// ============================================================================
// 衰减算法参数（P16 决策）
// ============================================================================

export interface DecayParams {
  halfLifeDays: number
  deprecatedThreshold: number
  deleteAfterDays: number
}

// ============================================================================
// 记忆库元数据（meta.json，P18 增强）
// ============================================================================

export interface ArchiveMeta {
  version: string
  lastDailyRun: number
  lastWeeklyRun: number
  lastMonthlyRun: number
  totalHooks: number
  totalFiles: number
  totalStorageBytes: number
  /** P18 新增：失败删除队列 */
  failedDeletions: string[]
  /** P18 新增：每日统计 */
  dailyStats: Record<string, { accessCount: number; newHooks: number }>
}

// ============================================================================
// 归档触发参数
// ============================================================================

export interface ArchiveTriggerOptions {
  source: 'threshold' | 'session_end' | 'manual'
  reason?: string
}

// ============================================================================
// 事件类型
// ============================================================================

export type ArchiveEventName =
  | 'archive:complete'
  | 'archive:error'
  | 'archive:inject-failed'
  | 'archive:vectors-rebuilt'
  | 'archive:failed'        // H6.3 新增：事务 Commit 失败
  | 'recall:accessed'
  | 'scheduler:task-success'
  | 'scheduler:task-failed'
  | 'scheduler:merge-pending' // H5.3 新增：待合并通知

export interface ArchiveEventListener {
  (payload: unknown): void
}

// ============================================================================
// 任务日志（P18 新增）
// ============================================================================

export interface TaskLogEntry {
  taskName: 'daily' | 'weekly' | 'monthly'
  startTime: number
  endTime: number
  status: 'success' | 'failed' | 'partial'
  failedStep?: string
  error?: string
  processedCount?: number
}
