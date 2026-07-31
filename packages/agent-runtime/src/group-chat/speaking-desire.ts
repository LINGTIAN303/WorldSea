/**
 * 群聊发言欲望系统
 *
 * 复用 companionModeTrigger 的概率引擎，将其适配到群聊场景。
 * 每个 Agent 根据基础概率、话题相关度、近期参与度和全局运气系数决定是否主动发言。
 *
 * 参数映射：
 *   baseProbability × talkativeness → 基础发言意愿
 *   topicRelevance × 60            → 等效编辑时长（sceneFactor）
 *   recentMessageCount              → 亲密度（intimacy）
 *   secondsSinceLastSpoke           → 衰减（decay）
 *   luckState.coefficient           → 全局运气
 */

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
