/**
 * 会话数据模型定义
 *
 * 定义 Agent 会话消息、工具调用记录、用量统计等核心数据结构。
 * 这些类型贯穿整个会话管理周期，从创建到持久化。
 */

import type { ProviderMode } from '../providers/config'
export type { ProviderMode }

/** 图片附件：base64 编码的图片数据及其 MIME 类型 */
export interface ImageAttachment {
  data: string
  mimeType: string
}

/** 文件附件：文件名和文本内容 */
export interface FileAttachment {
  name: string
  content: string
}

/** Agent 对话消息 */
export interface AgentMessage {
  /** 消息唯一 ID */
  id: string
  /** 角色：用户消息 / 助手回复 / 工具调用结果 / 系统消息 */
  role: 'user' | 'assistant' | 'toolResult' | 'system'
  /** 消息正文 */
  content: string
  /** 附加的图片（用于 vision 分析） */
  images?: ImageAttachment[]
  /** 附加的文件 */
  files?: FileAttachment[]
  /** 助手思考过程（扩写的 thinking 文本） */
  thinking?: string
  /** 消息时间戳 (ms) */
  timestamp: number
  /** 此消息关联的工具调用记录 */
  toolCalls?: ToolCallRecord[]
  /** 交互式 UI blocks（表格、选择器、图片等组件数据） */
  blocks?: import('../bridge-types').MessageBlock[]
  speakerId?: string
  speakerName?: string
  speakerAvatar?: string
  speakerColor?: string
  /** Agent 输出字体 family（群聊场景） */
  speakerFontFamily?: string
  /** Agent 输出字体 weight */
  speakerFontWeight?: number
  /** Agent 输出字体 style */
  speakerFontStyle?: string
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
}

/** 工具调用记录 */
export interface ToolCallRecord {
  /** 调用 ID */
  id: string
  /** 工具名称 */
  name: string
  /** 调用参数 */
  args: Record<string, unknown>
  /** 工具返回结果 (JSON 字符串) */
  result?: string
  /** 调用状态 */
  status: 'running' | 'completed' | 'failed'
  /** 开始时间戳 (ms) */
  startedAt: number
  /** 结束时间戳 (ms) */
  endedAt?: number
}

/** 会话级别的用量统计 */
export interface SessionUsage {
  /** 输入 token 数 */
  inputTokens: number
  /** 输出 token 数 */
  outputTokens: number
  /** 缓存读取 token 数（Anthropic prompt caching） */
  cacheReadTokens: number
  /** 缓存写入 token 数 */
  cacheWriteTokens: number
  /** 总费用 (USD) */
  totalCost: number
  /** 缓存节省的费用 */
  savedByCache: number
  /** 请求次数 */
  requestCount: number
}

/** 完整会话对象 */
export interface AgentSession {
  /** 会话唯一 ID */
  id: string
  /** 会话名称 */
  name: string
  /** 创建时间 (ISO 8601) */
  createdAt: string
  /** 最后更新时间 (ISO 8601) */
  updatedAt: string
  /** 供应商模式：云端 / 本地 / 自定义 */
  providerMode: ProviderMode
  /** 使用的模型 ID */
  modelId: string
  /** 会话中的消息列表 */
  messages: AgentMessage[]
  /** 会话元数据：token、费用、工具调用统计 */
  metadata: {
    totalTokens: number
    totalCost: number
    toolCallCount: number
    usage?: SessionUsage
  }
  /** 会话锁定的聊天模式（首次发送消息时锁定） */
  chatMode?: 'normal' | 'deep' | 'explore' | 'task'
  /** 深度模式虚拟段落（持久化以支持刷新后恢复） */
  deepSegments?: unknown[]
  /** 深度模式最终结论区（持久化以支持刷新后恢复） */
  finalOutput?: unknown
  /** 是否已固定（收藏），固定的会话不会被自动清理 */
  pinned?: boolean
}

/**
 * Agent 运行时状态快照
 * 用于 UI 展示当前会话的实时状态
 */
export interface AgentStateSnapshot {
  /** 会话 ID */
  sessionId: string
  /** 当前使用的模型信息（运行时快照，字段精简；与 providers/model-registry.ts 的 ModelInfo 语义不同） */
  model: RuntimeModelInfo | null
  /** 思考层级 */
  thinkingLevel: string
  /** 当前消息列表 */
  messages: AgentMessage[]
  /** 是否正在流式输出 */
  isStreaming: boolean
  /** 待处理的工具调用 */
  pendingToolCalls: ToolCallRecord[]
}

/**
 * 运行时模型快照（精简版）
 *
 * 从 Rust payload 或 ProviderConfig 构造，仅包含运行时可用字段。
 * 与 providers/model-registry.ts 的 ModelInfo（模型注册表条目，静态完整元数据）语义不同：
 * - RuntimeModelInfo：运行时快照，字段精简（modelId/displayName/contextWindow）
 * - ModelInfo：注册表条目，字段完整（id/name/contextLength/价格/能力等）
 */
export interface RuntimeModelInfo {
  /** 供应商名称 */
  provider: string
  /** 模型 ID */
  modelId: string
  /** 展示名称 */
  displayName: string
  /** 上下文窗口大小 */
  contextWindow?: number
}
