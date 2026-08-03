import type { GroupMember, GroupChatMessage, SpeakingDesire, TerminationCheckResult } from '../types'

export interface StrategyContext {
  topic?: string
  currentRound: number
  userMessage?: GroupChatMessage
  mentionedAgentIds: string[]
}

export type StrategyTriggerType = 'user_message' | 'agent_message' | 'mention' | 'timer' | 'manual'

export interface StrategyTrigger {
  type: StrategyTriggerType
  payload: GroupChatMessage
}

export interface MeetingConfig {
  maxRounds: number
  maxTotalMessages: number
  maxDurationMs: number
  reviewInterval: number
  parallelCount: number
  autoDegradation: boolean
}

export interface CasualConfig {
  desireConfig: {
    threshold: number
    mentionBoost: number
    roleRelevanceWeight: number
    recentActivityDecay: number
  }
  maxResponders: number
  maxResponseTokens: number
}

export interface IChatStrategy {
  selectSpeakers(messages: GroupChatMessage[], members: GroupMember[], context: StrategyContext): GroupMember[]
  shouldRespond?(trigger: StrategyTrigger, members: GroupMember[]): SpeakingDesire[]
  formatPrompt?(member: GroupMember, messages: GroupChatMessage[], context: StrategyContext): string
  buildSystemPrompt(member: GroupMember, context: StrategyContext): string
  /** 构建对话级动态上下文（@mention 提示、话题等），不包含系统提示词 */
  buildDynamicContext(member: GroupMember, context: StrategyContext): string
  shouldTerminate(messages: GroupChatMessage[], state: EngineState): TerminationCheckResult
  getConfig(): MeetingConfig | CasualConfig
  generateThoughts?(messages: GroupChatMessage[], members: GroupMember[]): ThoughtItem[]
  shouldInitiate?(thought: ThoughtItem, messages: GroupChatMessage[]): boolean
}

export interface EngineState {
  round: number
  startTime: number
  messageCount: number
  costUsd: number
  maxCostUsd: number
}

export interface ThoughtItem {
  agentId: string
  content: string
  priority: number
  triggeredAt: number
}
