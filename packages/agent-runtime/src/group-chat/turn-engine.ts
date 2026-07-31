/**
 * 群聊发言策略引擎
 *
 * 分层策略架构：
 *   层级1: @mention 优先路由（始终生效，不作为策略选项）
 *   层级2: 主策略 = random | speaking-desire | moderator
 *
 * random:        随机选择 1-3 个 Agent（最简单，零开销）
 * speaking-desire: 概率引擎评估每个 Agent 的发言意愿（默认）
 * moderator:     独立 LLM 调用选择发言者（最精准，有额外成本）
 *
 * TurnResult.mode 决定执行方式：
 *   sequential: 串行执行，后发言者能看到前者的回复
 *   parallel:   纯并行执行，Agent 间看不到彼此回复（模拟同时打字）
 *   staggered:  交错并行，第一个完成后后续者能看到其回复
 */

import type { IAgentBackend } from '../bridge'
import type { AgentProfile, TurnStrategy } from './types'
import {
  evaluateSpeakingDesire,
  computeTopicRelevance,
  type LuckState,
} from './speaking-desire'
import { runModerator } from './moderator'

export interface TurnResult {
  agentIds: string[]
  mode: 'sequential' | 'parallel' | 'staggered'
  strategy: TurnStrategy | 'mention'
  reason?: string
}

interface AgentSpeakingRecord {
  agentId: string
  lastSpokeAt: number
  recentCount: number
}

export class TurnEngine {
  private records: Map<string, AgentSpeakingRecord> = new Map()
  private luckState: LuckState
  private readonly maxSpeakers: number

  private strategy: TurnStrategy

  constructor(
    strategy: TurnStrategy,
    luckState: LuckState,
    maxSpeakers = 3,
  ) {
    this.strategy = strategy
    this.luckState = luckState
    this.maxSpeakers = maxSpeakers
  }

  setStrategy(strategy: TurnStrategy): void {
    this.strategy = strategy
  }

  updateLuckState(luck: LuckState): void {
    this.luckState = luck
  }

  recordSpeaking(agentId: string): void {
    const existing = this.records.get(agentId)
    if (existing) {
      existing.lastSpokeAt = Date.now()
      existing.recentCount++
    } else {
      this.records.set(agentId, {
        agentId,
        lastSpokeAt: Date.now(),
        recentCount: 1,
      })
    }
  }

  decayRecentCounts(): void {
    for (const record of this.records.values()) {
      record.recentCount = Math.max(0, record.recentCount - 1)
    }
  }

  async resolveTurn(
    userMessage: string,
    mentions: string[],
    agents: AgentProfile[],
    conversationContext: string,
    moderatorBackend?: IAgentBackend,
  ): Promise<TurnResult> {
    const enabled = agents.filter(a => a.enabled)
    if (enabled.length === 0) {
      return { agentIds: [], mode: 'sequential', strategy: this.strategy, reason: '无可用 Agent' }
    }

    // 层级1: @mention 优先路由（始终生效）
    if (mentions.length > 0) {
      const validMentions = mentions.filter(id => enabled.some(a => a.id === id))
      if (validMentions.length > 0) {
        return {
          agentIds: validMentions,
          mode: validMentions.length > 1 ? 'parallel' : 'sequential',
          strategy: 'mention',
          reason: `用户 @指定: ${validMentions.join(', ')}`,
        }
      }
    }

    // 层级2: 主策略
    switch (this.strategy) {
      case 'random':
        return this.resolveRandom(enabled)
      case 'moderator':
        return this.resolveWithModerator(userMessage, enabled, conversationContext, moderatorBackend)
      case 'speaking-desire':
      default:
        return this.resolveWithSpeakingDesire(userMessage, enabled)
    }
  }

  /**
   * 随机层：随机选择 1-3 个 Agent
   *
   * 最简单的策略，零额外开销。适合不需要复杂调度的场景。
   * 优先选择近期发言较少的 Agent（加权随机）。
   */
  private resolveRandom(agents: AgentProfile[]): TurnResult {
    const count = Math.min(this.maxSpeakers, Math.max(1, Math.ceil(Math.random() * agents.length)))

    // 加权随机：近期发言少的权重更高
    const weights = agents.map(a => {
      const record = this.records.get(a.id)
      const recentPenalty = record ? Math.max(0.1, 1 - record.recentCount * 0.3) : 1.0
      return recentPenalty
    })

    const selected: string[] = []
    const remaining = [...agents]
    const remainingWeights = [...weights]

    for (let i = 0; i < count && remaining.length > 0; i++) {
      const totalWeight = remainingWeights.reduce((s, w) => s + w, 0)
      let r = Math.random() * totalWeight
      let idx = 0
      for (; idx < remaining.length; idx++) {
        r -= remainingWeights[idx]
        if (r <= 0) break
      }
      idx = Math.min(idx, remaining.length - 1)

      selected.push(remaining[idx].id)
      remaining.splice(idx, 1)
      remainingWeights.splice(idx, 1)
    }

    return {
      agentIds: selected,
      mode: selected.length > 1 ? 'parallel' : 'sequential',
      strategy: 'random',
      reason: `随机选择: ${selected.length} 个 Agent`,
    }
  }

  private async resolveWithModerator(
    userMessage: string,
    agents: AgentProfile[],
    conversationContext: string,
    moderatorBackend?: IAgentBackend,
  ): Promise<TurnResult> {
    if (!moderatorBackend) {
      return this.resolveWithSpeakingDesire(userMessage, agents)
    }

    const decision = await runModerator(moderatorBackend, agents, conversationContext, userMessage)
    const mode = decision.nextSpeakers.length > 1 ? 'staggered' : 'sequential'
    return {
      agentIds: decision.nextSpeakers,
      mode,
      strategy: 'moderator',
      reason: decision.reason,
    }
  }

  private resolveWithSpeakingDesire(
    userMessage: string,
    agents: AgentProfile[],
  ): TurnResult {
    const now = Date.now()
    const candidates: { agentId: string; probability: number }[] = []

    for (const agent of agents) {
      const record = this.records.get(agent.id)
      const topicRelevance = computeTopicRelevance(userMessage, agent)
      const secondsSinceLastSpoke = record
        ? (now - record.lastSpokeAt) / 1000
        : 300

      const result = evaluateSpeakingDesire({
        agentProfile: agent,
        recentMessageCount: record?.recentCount ?? 0,
        secondsSinceLastSpoke,
        topicRelevance,
        luckState: this.luckState,
      })

      if (result.shouldTrigger) {
        candidates.push({ agentId: agent.id, probability: result.finalProbability })
      }
    }

    candidates.sort((a, b) => b.probability - a.probability)
    let selected = candidates.slice(0, this.maxSpeakers).map(c => c.agentId)

    // 无候选人时回退到随机层
    if (selected.length === 0) {
      const randomAgent = agents[Math.floor(Math.random() * agents.length)]
      selected = [randomAgent.id]
    }

    return {
      agentIds: selected,
      mode: selected.length > 1 ? 'parallel' : 'sequential',
      strategy: 'speaking-desire',
      reason: `发言欲望评估: ${candidates.length} 个候选, 选中 ${selected.length} 个`,
    }
  }
}
