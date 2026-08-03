import type { AgentMessage, ProviderConfig } from '@agent/index'

export interface GroupChatConfig {
  maxRounds: number
  maxTotalMessages: number
  maxDurationMs: number
  reviewInterval: number
  parallelCount: number
  autoDegradation: boolean
}

export const DEFAULT_GROUP_CHAT_CONFIG: GroupChatConfig = {
  maxRounds: 20,
  maxTotalMessages: 60,
  maxDurationMs: 600000,
  reviewInterval: 5,
  parallelCount: 1,
  autoDegradation: true,
}

export interface GroupChatBudget {
  maxCostUsd: number
  warnAtPercent: number
  perAgentBudget?: number
}

export const DEFAULT_GROUP_CHAT_BUDGET: GroupChatBudget = {
  maxCostUsd: 1.0,
  warnAtPercent: 80,
}

export interface GroupParticipant {
  id: string
  name: string
  avatar: string
  color: string
  role: string
  systemPrompt: string
  providerConfig?: ProviderConfig
  /** 引用的 ProviderSlot ID（同厂商多 Key 负载均衡） */
  providerSlotId?: string
  modelId?: string
  speakCount: number
  lastSpokeAt: number
}

export interface GroupChatCostEntry {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface GroupChatCostTracker {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  perAgentCost: Record<string, GroupChatCostEntry>
  remainingBudget: number
  budgetPercentUsed: number
}

export type GroupChatState = 'idle' | 'running' | 'paused' | 'completed' | 'terminated'

export type SpeakerSelectionMode = 'round-robin' | 'moderator' | 'auto-select'

export type HealthStatus = 'unknown' | 'healthy' | 'slow' | 'unreachable'

export interface ModelHealthResult {
  status: HealthStatus
  latency: number
  error?: string
  checkedAt: number
}

export interface DegradedAgentInfo {
  agentId: string
  agentName: string
  fromModelId: string
  fromModelName: string
  toModelId: string
  toModelName: string
  reason: string
  degradedAt: number
}

export interface StreamingAgentState {
  content: string
  thinking: string
  /** 当前正在执行的工具调用 */
  toolCalls: ToolCallInfo[]
}

export interface GroupSession {
  id: string
  name: string
  topic: string
  participants: GroupParticipant[]
  messages: AgentMessage[]
  config: GroupChatConfig
  budget: GroupChatBudget
  costTracker: GroupChatCostTracker
  state: GroupChatState
  createdAt: string
  updatedAt: string
  summary?: string
  currentRound: number
  startedAt: number | null
  pinned?: boolean
}

export interface GroupChatControls {
  pause(): void
  resume(): void
  terminate(): void
  injectMessage(text: string): void
  setNextSpeaker(agentId: string): void
}

export type ContextPressureLevel = 'none' | 'light' | 'moderate' | 'heavy' | 'critical'

export interface ContextStrategy {
  level: ContextPressureLevel
  maxMessages: number
  preserveFirstN: number
  summaryEnabled: boolean
  keyInfoExtraction: boolean
}

export interface TerminationCheckResult {
  shouldTerminate: boolean
  reason?: string
  confidence: number
}

export type GroupChatMode = 'meeting' | 'casual'

export type GroupRole = 'owner' | 'admin' | 'member'

/** 基础层模式：空（不共享）/ 共享（使用标准基础层）/ 自定义（用户填写） */
export type BaseLayerMode = 'empty' | 'shared' | 'custom'

/** 工具来源：derived=从技能派生，manual=手动指定 */
export type ToolSource = 'derived' | 'manual'

export interface GroupMember extends GroupParticipant {
  groupRole: GroupRole
  joinedAt: number
  muted: boolean
  mutedUntil?: number
  lastActiveAt: number
  enabledTools: string[]
  enabledSkills: string[]
  /** 基础层模式：默认 empty（空基础层），可选 shared（共享标准基础层）或 custom（自定义） */
  baseLayerMode: BaseLayerMode
  /** 自定义基础层内容（仅 baseLayerMode='custom' 时使用） */
  customBaseLayer?: string
  /** 工具来源：derived=从 enabledSkills 派生，manual=使用 enabledTools 列表。默认 derived */
  toolSource?: ToolSource
  /** 输出字体 family（空字符串=跟随全局 Agent 字体） */
  fontFamily?: string
  /** 输出字体 weight（默认 400） */
  fontWeight?: number
  /** 输出字体 style（默认 normal） */
  fontStyle?: string
}

export type MessageType = 'text' | 'image' | 'file' | 'system' | 'action' | 'world-event'

/** 工具调用信息（群聊公共动作事件） */
export interface ToolCallInfo {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed'
  /** 工具调用参数摘要（可选，用于展开详情） */
  params?: string
  /** 工具调用结果摘要（可选，用于展开详情） */
  result?: string
}

/** 世界事件：修改共享世界状态的操作，作为轻量系统消息插入对话流 */
export interface WorldEvent {
  id: string
  /** 触发者 Agent ID */
  agentId: string
  /** 触发者 Agent 名称 */
  agentName: string
  /** 动作类型：create/update/delete */
  action: 'create' | 'update' | 'delete'
  /** 目标对象类型 */
  targetType: string
  /** 目标对象名称 */
  targetName: string
  /** 触发的工具调用 ID（用于关联） */
  toolCallId?: string
  timestamp: number
}

/** 工具重要性分级 */
export type ToolImportance = 'world-change' | 'output-gen' | 'info-retrieval'

/** 工具分类映射 */
export const TOOL_CATEGORIES: Record<string, { label: string; importance: ToolImportance; icon: string }> = {
  entity_create: { label: '创建实体', importance: 'world-change', icon: 'plus' },
  entity_get: { label: '获取实体', importance: 'info-retrieval', icon: 'search' },
  entity_update: { label: '更新实体', importance: 'world-change', icon: 'edit' },
  entity_delete: { label: '删除实体', importance: 'world-change', icon: 'trash' },
  entity_list: { label: '实体列表', importance: 'info-retrieval', icon: 'list' },
  relation_create: { label: '创建关系', importance: 'world-change', icon: 'link' },
  relation_delete: { label: '删除关系', importance: 'world-change', icon: 'unlink' },
  relation_list: { label: '关系列表', importance: 'info-retrieval', icon: 'list' },
  web_search: { label: '联网搜索', importance: 'info-retrieval', icon: 'globe' },
  web_crawl: { label: '网页抓取', importance: 'info-retrieval', icon: 'download' },
  doc_convert: { label: '文档转换', importance: 'info-retrieval', icon: 'file-text' },
  output_table: { label: '表格', importance: 'output-gen', icon: 'table' },
  output_choice: { label: '选项', importance: 'output-gen', icon: 'check-square' },
  output_code: { label: '代码', importance: 'output-gen', icon: 'code' },
  output_entity_card: { label: '实体卡', importance: 'output-gen', icon: 'credit-card' },
  output_alert: { label: '提示', importance: 'output-gen', icon: 'alert-circle' },
  output_stat: { label: '统计', importance: 'output-gen', icon: 'bar-chart' },
  output_list: { label: '列表', importance: 'output-gen', icon: 'list' },
  output_progress: { label: '进度', importance: 'output-gen', icon: 'loader' },
  output_comparison: { label: '对比', importance: 'output-gen', icon: 'columns' },
  output_timeline: { label: '时间线', importance: 'output-gen', icon: 'clock' },
  output_image: { label: '图片', importance: 'output-gen', icon: 'image' },
  output_accordion: { label: '折叠区', importance: 'output-gen', icon: 'chevron-down' },
  consistency_check: { label: '一致性检查', importance: 'info-retrieval', icon: 'shield' },
  content_search: { label: '内容搜索', importance: 'info-retrieval', icon: 'search' },
  memory_store: { label: '存储记忆', importance: 'world-change', icon: 'database' },
  memory_recall: { label: '回忆记忆', importance: 'info-retrieval', icon: 'brain' },
  memory_delete: { label: '删除记忆', importance: 'world-change', icon: 'trash' },
  project_export: { label: '项目导出', importance: 'output-gen', icon: 'download' },
  project_import: { label: '项目导入', importance: 'world-change', icon: 'upload' },
  load_skill: { label: '加载技能', importance: 'info-retrieval', icon: 'zap' },
  daily_report: { label: '每日报告', importance: 'output-gen', icon: 'file-text' },
}

/** 判断工具是否属于世界变更类 */
export function isWorldChangeTool(toolName: string): boolean {
  return TOOL_CATEGORIES[toolName]?.importance === 'world-change'
}

/** 获取工具标签（友好名称） */
export function getToolLabel(toolName: string): string {
  return TOOL_CATEGORIES[toolName]?.label ?? toolName.replace(/_/g, ' ')
}

/** 获取工具图标 */
export function getToolIcon(toolName: string): string {
  return TOOL_CATEGORIES[toolName]?.icon ?? 'wrench'
}

/** 获取工具重要性级别 */
export function getToolImportance(toolName: string): ToolImportance {
  return TOOL_CATEGORIES[toolName]?.importance ?? 'info-retrieval'
}

export interface GroupChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'toolResult'
  content: string
  thinking?: string
  timestamp: number
  speakerId?: string
  speakerName?: string
  speakerAvatar?: string
  speakerColor?: string
  /** Agent 输出字体 family */
  speakerFontFamily?: string
  /** Agent 输出字体 weight */
  speakerFontWeight?: number
  /** Agent 输出字体 style */
  speakerFontStyle?: string
  type: MessageType
  replyTo?: string
  mentions?: string[]
  imageUrl?: string
  fileName?: string
  fileUrl?: string
  /** 工具调用信息（群聊公共动作事件） */
  toolCalls?: ToolCallInfo[]
}

export interface SpeakingDesire {
  agentId: string
  desireScore: number
  reason: string
}

export interface DesireConfig {
  threshold: number
  mentionBoost: number
  roleRelevanceWeight: number
  recentActivityDecay: number
}

export const DEFAULT_DESIRE_CONFIG: DesireConfig = {
  threshold: 0.4,
  mentionBoost: 0.5,
  roleRelevanceWeight: 0.3,
  recentActivityDecay: 0.1,
}

export interface GroupInfo {
  id: string
  name: string
  avatar: string
  announcement?: string
  mode: GroupChatMode
  createdAt: number
  updatedAt: number
}

/** 单次 API 请求追踪记录 */
export interface RequestRecord {
  id: string
  agentId: string
  agentName: string
  startTime: number
  endTime?: number
  status: 'pending' | 'success' | 'error'
  error?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs?: number
  /** 请求使用的 API 协议（openai-completions / anthropic-messages / google-generative-ai） */
  protocol?: string
}

/** 请求追踪快照（供 UI 展示） */
export interface RequestTrackerSnapshot {
  records: RequestRecord[]
  perAgent: Record<string, {
    total: number
    success: number
    errors: number
    avgLatencyMs: number
    lastError?: string
  }>
}

export interface CasualGroupSession {
  info: GroupInfo
  members: GroupMember[]
  messages: GroupChatMessage[]
  desireConfig: DesireConfig
  meetingConfig?: GroupChatConfig
  meetingBudget?: GroupChatBudget
  costTracker: GroupChatCostTracker
}

export interface ChatAgent {
  id: string
  name: string
  avatar: string
  color: string
  role: string
  systemPrompt: string
  modelId?: string
  /** 独立 Provider 配置（不使用全局配置时设置） */
  providerConfig?: ProviderConfig
  /** 引用的 ProviderSlot ID（同厂商多 Key 负载均衡） */
  providerSlotId?: string
  sourceType: 'entity' | 'custom'
  sourceEntityId?: string
  enabledTools: string[]
  enabledSkills: string[]
  /** 基础层模式：默认 empty */
  baseLayerMode: BaseLayerMode
  /** 自定义基础层内容 */
  customBaseLayer?: string
  /** 工具来源：derived=从 enabledSkills 派生，manual=使用 enabledTools 列表。默认 derived */
  toolSource?: ToolSource
  /** 输出字体 family（空字符串=跟随全局 Agent 字体） */
  fontFamily?: string
  /** 输出字体 weight（默认 400） */
  fontWeight?: number
  /** 输出字体 style（默认 normal） */
  fontStyle?: string
  createdAt: number
  updatedAt: number
}

export const AGENT_COLORS = [
  '#3b82f6', '#8b5cf6', '#ef4444', '#f59e0b',
  '#10b981', '#ec4899', '#06b6d4', '#f97316',
]

export function assignAgentColor(index: number): string {
  return AGENT_COLORS[index % AGENT_COLORS.length]
}
