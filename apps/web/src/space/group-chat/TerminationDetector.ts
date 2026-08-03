import type { AgentMessage } from '@agent/index'
import type { TerminationCheckResult } from './types'

const DISCUSSION_END_MARKER = '[DISCUSSION_END]'
const CONSENSUS_KEYWORDS = ['同意', '赞同', '认可', '同意这个观点', '没有异议', '我也这么认为', 'agree', 'concur']
const SHORT_RESPONSE_THRESHOLD = 50

export class TerminationDetectorImpl {
  checkAll(messages: AgentMessage[]): TerminationCheckResult {
    const signalResult = this.checkEndSignal(messages)
    if (signalResult.shouldTerminate) return signalResult

    const repetitionResult = this.checkRepetition(messages)
    if (repetitionResult.shouldTerminate) return repetitionResult

    const stagnationResult = this.checkStagnation(messages)
    if (stagnationResult.shouldTerminate) return stagnationResult

    const consensusResult = this.checkConsensus(messages)
    if (consensusResult.shouldTerminate) return consensusResult

    return { shouldTerminate: false, confidence: 0 }
  }

  checkEndSignal(messages: AgentMessage[]): TerminationCheckResult {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg?.role === 'assistant' && lastMsg.content?.includes(DISCUSSION_END_MARKER)) {
      return {
        shouldTerminate: true,
        reason: 'Agent 标记讨论结束',
        confidence: 1.0,
      }
    }
    return { shouldTerminate: false, confidence: 0 }
  }

  checkRepetition(messages: AgentMessage[]): TerminationCheckResult {
    const assistantMsgs = messages.filter(m => m.role === 'assistant' && m.speakerId)
    if (assistantMsgs.length < 3) return { shouldTerminate: false, confidence: 0 }

    const speakerGroups = new Map<string, string[]>()
    for (const msg of assistantMsgs) {
      const id = msg.speakerId!
      if (!speakerGroups.has(id)) speakerGroups.set(id, [])
      speakerGroups.get(id)!.push(msg.content)
    }

    for (const [speakerId, contents] of speakerGroups) {
      if (contents.length < 3) continue
      const recent = contents.slice(-3)
      const similarities: number[] = []
      for (let i = 1; i < recent.length; i++) {
        similarities.push(jaccardSimilarity(recent[i - 1], recent[i]))
      }
      const avgSimilarity = similarities.reduce((a, b) => a + b, 0) / similarities.length
      if (avgSimilarity > 0.8) {
        return {
          shouldTerminate: true,
          reason: `${speakerId} 的发言出现重复`,
          confidence: avgSimilarity,
        }
      }
    }

    return { shouldTerminate: false, confidence: 0 }
  }

  checkStagnation(messages: AgentMessage[]): TerminationCheckResult {
    const assistantMsgs = messages.filter(m => m.role === 'assistant')
    if (assistantMsgs.length < 4) return { shouldTerminate: false, confidence: 0 }

    const lastTwo = assistantMsgs.slice(-2)
    const bothShort = lastTwo.every(m => m.content.length < SHORT_RESPONSE_THRESHOLD)
    if (bothShort) {
      return {
        shouldTerminate: true,
        reason: '对话停滞，Agent 回复过短',
        confidence: 0.7,
      }
    }

    return { shouldTerminate: false, confidence: 0 }
  }

  checkConsensus(messages: AgentMessage[]): TerminationCheckResult {
    const assistantMsgs = messages.filter(m => m.role === 'assistant')
    if (assistantMsgs.length < 4) return { shouldTerminate: false, confidence: 0 }

    const lastFour = assistantMsgs.slice(-4)
    const consensusCount = lastFour.filter(m =>
      CONSENSUS_KEYWORDS.some(kw => m.content.includes(kw))
    ).length

    if (consensusCount >= 3) {
      return {
        shouldTerminate: true,
        reason: 'Agent 已达成共识',
        confidence: 0.6,
      }
    }

    return { shouldTerminate: false, confidence: 0 }
  }
}

function tokenize(text: string): string[] {
  const tokens: string[] = []
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  if (cjk) tokens.push(...cjk)
  const words = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').split(/\s+/).filter(Boolean)
  tokens.push(...words)
  return tokens
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 && setB.size === 0) return 1.0
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return intersection.size / union.size
}
