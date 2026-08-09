import type { GroupMember, SpeakingDesire, DesireConfig, GroupChatMessage } from '../types'
import { DEFAULT_DESIRE_CONFIG } from '../types'

export class DesireCalculator {
  private config: DesireConfig
  private roleKeywords: Map<string, string[]> = new Map()

  constructor(config?: Partial<DesireConfig>) {
    this.config = { ...DEFAULT_DESIRE_CONFIG, ...config }
  }

  registerRoleKeywords(agentId: string, keywords: string[]): void {
    this.roleKeywords.set(agentId, keywords)
  }

  calculateAll(
    members: GroupMember[],
    triggerMessage: GroupChatMessage,
    recentMessages: GroupChatMessage[],
  ): SpeakingDesire[] {
    return members.map(m => this.calculate(m, triggerMessage, recentMessages))
  }

  calculate(
    member: GroupMember,
    triggerMessage: GroupChatMessage,
    recentMessages: GroupChatMessage[],
  ): SpeakingDesire {
    let score = 0.5

    if (member.muted && (!member.mutedUntil || Date.now() < member.mutedUntil)) {
      return { agentId: member.id, desireScore: 0, reason: '被禁言' }
    }

    const mentioned = triggerMessage.mentions || []
    if (mentioned.includes(member.id)) {
      score += this.config.mentionBoost
    }

    const roleRelevance = this.computeRoleRelevance(member.id, triggerMessage.content)
    score += roleRelevance * this.config.roleRelevanceWeight

    const recentCount = this.countRecentMessages(recentMessages, member.id)
    score -= recentCount * this.config.recentActivityDecay

    score = Math.max(0, Math.min(1, score))

    return {
      agentId: member.id,
      desireScore: score,
      reason: this.generateReason(score, member, mentioned.includes(member.id), roleRelevance, recentCount),
    }
  }

  filterByThreshold(desires: SpeakingDesire[]): SpeakingDesire[] {
    return desires.filter(d => d.desireScore >= this.config.threshold)
  }

  updateConfig(patch: Partial<DesireConfig>): void {
    this.config = { ...this.config, ...patch }
  }

  private computeRoleRelevance(agentId: string, messageContent: string): number {
    const keywords = this.roleKeywords.get(agentId)
    if (!keywords || keywords.length === 0) return 0

    const contentLower = messageContent.toLowerCase()
    let matchCount = 0
    for (const kw of keywords) {
      if (contentLower.includes(kw.toLowerCase())) matchCount++
    }

    return Math.min(matchCount / keywords.length, 1)
  }

  private countRecentMessages(messages: GroupChatMessage[], agentId: string): number {
    const recent = messages.slice(-10)
    return recent.filter(m => m.speakerId === agentId).length
  }

  private generateReason(
    score: number,
    _member: GroupMember,
    wasMentioned: boolean,
    roleRelevance: number,
    recentCount: number,
  ): string {
    if (score === 0) return '被禁言'
    const parts: string[] = []
    if (wasMentioned) parts.push('被@提及')
    if (roleRelevance > 0.3) parts.push('角色相关')
    if (recentCount >= 3) parts.push('近期发言较多')
    if (parts.length === 0) parts.push('话题相关度低')
    return parts.join('，')
  }
}