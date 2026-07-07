import type { AgentMessage } from '@agent/index'
import type { GroupParticipant, SpeakerSelectionMode } from './types'

export class SpeakerSelectorImpl {
  private participants: GroupParticipant[]
  private roundIndex: number = 0
  private mode: SpeakerSelectionMode = 'round-robin'
  private maxRounds: number

  constructor(participants: GroupParticipant[], maxRounds: number) {
    this.participants = participants
    this.maxRounds = maxRounds
  }

  selectNext(messages: AgentMessage[], currentRound: number): GroupParticipant {
    if (this.participants.length === 0) {
      throw new Error('SpeakerSelector: 没有参与者')
    }
    this.totalRounds = currentRound
    this.mode = this.determineMode(currentRound)

    switch (this.mode) {
      case 'round-robin':
        return this.selectRoundRobin()
      case 'auto-select':
        return this.selectAuto(messages)
      case 'moderator':
        return this.selectAuto(messages)
    }
  }

  selectMultiple(messages: AgentMessage[], currentRound: number, count: number): GroupParticipant[] {
    if (this.participants.length === 0) return []
    const effectiveCount = Math.min(count, this.participants.length)
    if (effectiveCount <= 1) return [this.selectNext(messages, currentRound)]

    this.totalRounds = currentRound
    this.mode = this.determineMode(currentRound)

    const savedRoundIndex = this.roundIndex
    const first = this.selectRoundRobin()
    this.roundIndex = savedRoundIndex + 1

    const selected: GroupParticipant[] = []
    const usedIds = new Set<string>()

    selected.push(first)
    usedIds.add(first.id)

    const candidates = this.participants
      .filter(p => !usedIds.has(p.id))
      .map(p => ({
        participant: p,
        score: this.calculateScore(p, messages),
      }))
      .sort((a, b) => b.score - a.score)

    for (const c of candidates) {
      if (selected.length >= effectiveCount) break
      selected.push(c.participant)
    }

    return selected
  }

  setMode(mode: SpeakerSelectionMode): void {
    this.mode = mode
  }

  private determineMode(round: number): SpeakerSelectionMode {
    if (round <= 1) return 'round-robin'
    if (round >= this.maxRounds - 1) return 'round-robin'
    return 'auto-select'
  }

  private selectRoundRobin(): GroupParticipant {
    const idx = this.roundIndex % this.participants.length
    this.roundIndex++
    return this.participants[idx]
  }

  private selectAuto(messages: AgentMessage[]): GroupParticipant {
    const scores = this.participants.map(p => ({
      participant: p,
      score: this.calculateScore(p, messages),
    }))
    scores.sort((a, b) => b.score - a.score)
    return scores[0].participant
  }

  private calculateScore(participant: GroupParticipant, messages: AgentMessage[]): number {
    let score = 0.5

    const messagesSinceLastSpoke = messages.length - participant.lastSpokeAt
    score += Math.min(messagesSinceLastSpoke / 10, 0.3)

    const recentMessages = messages.slice(-5)
    const mentioned = recentMessages.some(m =>
      m.content?.includes(`@${participant.name}`) || m.content?.includes(`@${participant.id}`)
    )
    if (mentioned) score += 0.5

    const totalSpeaks = this.participants.reduce((sum, p) => sum + p.speakCount, 0)
    const avgSpeaks = totalSpeaks / this.participants.length
    if (participant.speakCount < avgSpeaks) {
      score += 0.2 * (1 - participant.speakCount / Math.max(avgSpeaks, 1))
    }

    return Math.min(score, 1.0)
  }
}
