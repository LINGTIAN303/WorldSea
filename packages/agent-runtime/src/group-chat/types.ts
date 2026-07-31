/**
 * 群聊系统核心类型定义
 *
 * 定义 Agent 档案、Provider 池、群聊会话、消息和发言策略等数据结构。
 * 这些类型是群聊系统的基础，贯穿前后端。
 */

import type { ProviderMode, CloudProvider, LocalApiType, CustomApiType } from '../providers/config'

/** Agent 个性配置 */
export interface AgentPersonality {
  /** 说话风格描述（如"严谨"、"幽默"、"简洁"） */
  speakingStyle?: string
  /** 专长领域关键词，用于话题相关度计算 */
  expertise?: string[]
  /** 默认情绪/状态 */
  mood?: string
}

/** Agent 发言欲望配置 */
export interface SpeakingDesireConfig {
  /** 基础发言概率 0.0-1.0 */
  baseProbability: number
  /** 话题→权重映射（如 { "魔法": 1.5, "历史": 0.8 }） */
  topicAffinities?: Record<string, number>
  /** 话痨系数 0.0-2.0，乘在基础概率上 */
  talkativeness?: number
}

/**
 * Agent 档案 — 用户在 UI 中创建的 Agent 定义
 *
 * 每个 Agent 拥有独立的身份、系统提示词和 Provider 配置。
 * 通过 providerSlotId 引用 ProviderSlot，间接获取模型和 API Key。
 */
export interface AgentProfile {
  id: string
  /** 显示名称 */
  name: string
  /** 头像（emoji 字符或图片 URL） */
  avatar: string
  /** UI 标识色（hex） */
  color: string
  /** 独立系统提示词 */
  systemPrompt: string
  /** 引用的 ProviderSlot ID */
  providerSlotId: string
  /** 个性配置 */
  personality?: AgentPersonality
  /** 发言欲望配置 */
  speakingDesire?: SpeakingDesireConfig
  /** 是否启用 */
  enabled: boolean
  /** 创建时间 (ISO 8601) */
  createdAt: string
  /** 更新时间 (ISO 8601) */
  updatedAt: string
  /** 字体族名（可选，覆盖全局 agent 层字体） */
  fontFamily?: string
}

/**
 * Provider 池条目 — 一个具体的 API 连接配置
 *
 * 支持三种模式：cloud（内置供应商）、local（本地模型）、custom（自定义端点）。
 * 每个条目可以有独立的 API Key，通过 apiKeyId 在 key-store 中查找。
 */
export interface ProviderSlotEntry {
  id: string
  /** 部署模式 */
  mode: ProviderMode
  /** 云端供应商名称（仅 cloud 模式） */
  provider?: CloudProvider
  /** 模型 ID */
  modelId: string
  /** key-store 中的标识（如 "slot:openai-key-a"） */
  apiKeyId?: string
  /** 自定义端点 URL（仅 custom/local 模式） */
  baseUrl?: string
  /** API 兼容类型（仅 custom 模式） */
  apiType?: CustomApiType
  /** 本地 API 类型（仅 local 模式） */
  localApiType?: LocalApiType
  /** 上下文窗口大小 */
  contextWindow?: number
  /** 最大输出 token 数 */
  maxTokens?: number
  /** 加权随机权重（用于 random 策略） */
  weight?: number
}

/** 负载均衡策略 */
export type LoadBalanceStrategy = 'round-robin' | 'random' | 'least-recent'

/**
 * Provider 池 — 一组 API 连接配置的集合
 *
 * 一个 ProviderSlot 可以包含多个 entry，通过负载均衡策略选择使用哪个。
 * 典型场景：同一厂商的多个 API Key 分摊速率限制。
 */
export interface ProviderSlot {
  id: string
  /** 池名称（如 "我的 OpenAI 池"） */
  name: string
  /** 池中的 API 连接配置列表 */
  entries: ProviderSlotEntry[]
  /** 负载均衡策略 */
  strategy: LoadBalanceStrategy
}

/** 发言策略类型（mention 始终作为内置优先级，不在此选择） */
export type TurnStrategy = 'random' | 'speaking-desire' | 'moderator'

/**
 * 群聊消息
 *
 * 扩展了 AgentMessage 的 speaker 字段，包含完整的 Agent 身份信息。
 * 支持 @mention 机制，通过 mentions 数组标记被 @的 Agent ID。
 */
export interface GroupChatMessage {
  id: string
  /** 消息角色 */
  role: 'user' | 'assistant' | 'moderator'
  /** 发言 Agent ID（user 消息为 null） */
  agentId: string | null
  /** Agent 显示名称 */
  agentName?: string
  /** Agent 头像 */
  agentAvatar?: string
  /** Agent 标识色 */
  agentColor?: string
  /** 消息正文 */
  content: string
  /** 思考过程 */
  thinking?: string
  /** 被 @的 Agent ID 列表 */
  mentions?: string[]
  /** 消息时间戳 (ms) */
  timestamp: number
  /** 扩展元数据 */
  metadata?: Record<string, unknown>
}

/** 群聊会话 */
export interface GroupChatSession {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 参与的 Agent ID 列表 */
  agentIds: string[]
  /** 主持 Agent ID（null 表示无主持） */
  moderatorAgentId: string | null
  /** 群聊模式 */
  mode: 'free' | 'moderated' | 'topic'
  /** 当前话题（仅 topic 模式） */
  topic?: string
  /** 发言策略 */
  turnStrategy: TurnStrategy
  /** 会话消息列表 */
  messages: GroupChatMessage[]
  /** 会话元数据 */
  metadata: {
    totalTokens: number
    totalCost: number
    turnCount: number
  }
}

/** 控流配置 */
export interface RateLimitConfig {
  /** 最大并发请求数 */
  maxConcurrent: number
  /** 每分钟请求数上限 */
  requestsPerMinute: number
}
