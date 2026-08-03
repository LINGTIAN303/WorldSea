import type { GroupMember, GroupChatMessage, SpeakingDesire, GroupChatConfig, TerminationCheckResult } from '../types'
import { DEFAULT_GROUP_CHAT_CONFIG } from '../types'
import type { IChatStrategy, StrategyContext, StrategyTrigger, EngineState, MeetingConfig } from './IChatStrategy'

export class MeetingStrategy implements IChatStrategy {
  private config: MeetingConfig
  private roundIndex: number = 0

  constructor(config?: Partial<GroupChatConfig>) {
    const full = { ...DEFAULT_GROUP_CHAT_CONFIG, ...config }
    this.config = {
      maxRounds: full.maxRounds,
      maxTotalMessages: full.maxTotalMessages,
      maxDurationMs: full.maxDurationMs,
      reviewInterval: full.reviewInterval,
      parallelCount: full.parallelCount,
      autoDegradation: full.autoDegradation,
    }
  }

  selectSpeakers(messages: GroupChatMessage[], members: GroupMember[], context: StrategyContext): GroupMember[] {
    if (members.length === 0) return []

    if (context.currentRound <= 1 || context.currentRound >= this.config.maxRounds - 1) {
      return [this.selectRoundRobin(members)]
    }

    return [this.selectAuto(messages, members)]
  }

  shouldRespond(_trigger: StrategyTrigger, members: GroupMember[]): SpeakingDesire[] {
    return members.map(m => ({
      agentId: m.id,
      desireScore: 1,
      reason: '轮次发言',
    }))
  }

  formatPrompt(member: GroupMember, messages: GroupChatMessage[], context: StrategyContext): string {
    const conversationContext = messages
      .map(m => {
        if (m.role === 'system') return `[系统] ${m.content}`
        if (m.role === 'user') return `[用户] ${m.content}`
        if (m.speakerName) return `[${m.speakerName}] ${m.content}`
        return `[助手] ${m.content}`
      })
      .join('\n\n')

    return `你正在参与一场关于「${context.topic || '未命名话题'}」的讨论。你的角色是：${member.role}。\n\n以下是之前的讨论：\n\n${conversationContext}\n\n请继续讨论，表达你的观点。`
  }

  shouldTerminate(messages: GroupChatMessage[], state: EngineState): TerminationCheckResult {
    if (state.round >= this.config.maxRounds) {
      return { shouldTerminate: true, reason: '达到最大轮次', confidence: 1 }
    }
    if (messages.length >= this.config.maxTotalMessages) {
      return { shouldTerminate: true, reason: '达到最大消息数', confidence: 1 }
    }
    if (Date.now() - state.startTime >= this.config.maxDurationMs) {
      return { shouldTerminate: true, reason: '达到最大持续时间', confidence: 1 }
    }
    if (state.costUsd >= state.maxCostUsd) {
      return { shouldTerminate: true, reason: '费用预算耗尽', confidence: 1 }
    }
    return { shouldTerminate: false, confidence: 0 }
  }

  getConfig(): MeetingConfig {
    return this.config
  }

  buildSystemPrompt(member: GroupMember, context: StrategyContext): string {
    const parts: string[] = []
    if (member.systemPrompt) {
      parts.push(member.systemPrompt)
    } else {
      parts.push(`你是群聊成员「${member.name}」，角色是「${member.role}」。`)
    }
    parts.push(`会议话题：${context.topic || '未命名话题'}。`)
    parts.push('请围绕话题展开讨论，表达清晰的观点。')
    if (context.mentionedAgentIds.includes(member.id)) {
      parts.push('你被 @提及了，请务必回应。')
    }
    return parts.join('\n\n')
  }

  buildDynamicContext(member: GroupMember, context: StrategyContext): string {
    const parts: string[] = []
    parts.push(`会议话题：${context.topic || '未命名话题'}。`)
    parts.push('请围绕话题展开讨论，表达清晰的观点。')
    if (context.mentionedAgentIds.includes(member.id)) {
      parts.push('你被 @提及了，请务必回应。')
    }
    return parts.join('\n\n')
  }

  private selectRoundRobin(members: GroupMember[]): GroupMember {
    const idx = this.roundIndex % members.length
    this.roundIndex++
    return members[idx]
  }

  private selectAuto(messages: GroupChatMessage[], members: GroupMember[]): GroupMember {
    const scores = members.map(m => ({
      member: m,
      score: this.calculateScore(m, messages),
    }))
    scores.sort((a, b) => b.score - a.score)
    return scores[0].member
  }

  private calculateScore(member: GroupMember, messages: GroupChatMessage[]): number {
    let score = 0.5
    let lastIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].speakerId === member.id) { lastIdx = i; break }
    }
    const messagesSinceLastSpoke = lastIdx === -1 ? messages.length : messages.length - 1 - lastIdx
    score += Math.min(messagesSinceLastSpoke / 10, 0.3)
    const recentMessages = messages.slice(-5)
    const mentioned = recentMessages.some(m =>
      m.content?.includes(`@${member.name}`) || m.content?.includes(`@${member.id}`)
    )
    if (mentioned) score += 0.5
    const totalSpeaks = messages.filter(m => m.speakerId === member.id).length
    const avgSpeaks = messages.length / Math.max(messages.length, 1)
    if (totalSpeaks < avgSpeaks) {
      score += 0.2 * (1 - totalSpeaks / Math.max(avgSpeaks, 1))
    }
    return Math.min(score, 1.0)
  }
}
