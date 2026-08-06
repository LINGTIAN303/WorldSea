/** 群聊发言欲望系统：概率引擎评估每个 Agent 的发言意愿，详细见 docs/details/注释/packages/agent-runtime/group-chat-speaking-desire.md */

import type { AgentProfile } from './types'
import {
  calculateProbability,
  createLuckState,
  updateLuck,
  type LuckState,
  type ProbabilityResult,
} from '../utils/probability'

export interface SpeakingDesireContext {
  agentProfile: AgentProfile
  /** 近 N 轮中该 Agent 的发言次数 */
  recentMessageCount: number
  /** 距离上次发言的秒数 */
  secondsSinceLastSpoke: number
  /** 话题相关度 0.0-1.0 */
  topicRelevance: number
  /** 全局运气状态 */
  luckState: LuckState
}

export interface SpeakingDesireResult extends ProbabilityResult {
  agentId: string
  agentName: string
}

export function evaluateSpeakingDesire(ctx: SpeakingDesireContext): SpeakingDesireResult {
  const config = ctx.agentProfile.speakingDesire
  const baseProb = config?.baseProbability ?? 0.3
  const talkativeness = config?.talkativeness ?? 1.0
  const effectiveBase = baseProb * talkativeness

  const isImmediate = ctx.topicRelevance > 0.7
  const editDurationEquiv = ctx.topicRelevance * 60

  const result = calculateProbability(
    effectiveBase,
    editDurationEquiv,
    ctx.recentMessageCount,
    ctx.secondsSinceLastSpoke,
    ctx.luckState.coefficient,
    isImmediate,
  )

  return {
    ...result,
    agentId: ctx.agentProfile.id,
    agentName: ctx.agentProfile.name,
  }
}

/**
 * 计算话题相关度
 *
 * 通过 Agent 的 expertise 关键词与用户消息的匹配度来计算。
 * 无 expertise 配置的 Agent 获得中性分数 0.5。
 */
export function computeTopicRelevance(
  userMessage: string,
  agentProfile: AgentProfile,
): number {
  const expertise = agentProfile.personality?.expertise
  if (!expertise || expertise.length === 0) return 0.5

  const lower = userMessage.toLowerCase()
  const affinities = agentProfile.speakingDesire?.topicAffinities
  let score = 0.3

  for (const keyword of expertise) {
    if (lower.includes(keyword.toLowerCase())) {
      const affinity = affinities?.[keyword] ?? 1.0
      score += 0.2 * affinity
    }
  }

  return Math.min(1.0, score)
}

export type { LuckState }
export { createLuckState, updateLuck }
