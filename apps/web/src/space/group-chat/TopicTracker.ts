import type { AgentMessage } from '@agent/index'

export class TopicTrackerImpl {
  private topicKeywords: Set<string>

  constructor(topic: string) {
    this.topicKeywords = this.extractKeywords(topic)
  }

  getDriftScore(recentMessages: AgentMessage[]): number {
    if (this.topicKeywords.size === 0) return 0

    const recentKeywords = recentMessages
      .slice(-3)
      .flatMap(m => Array.from(this.extractKeywords(m.content ?? '')))

    if (recentKeywords.length === 0) return 1

    const overlap = recentKeywords.filter(k => this.topicKeywords.has(k)).length
    return 1 - (overlap / Math.max(recentKeywords.length, 1))
  }

  shouldInjectReminder(recentMessages: AgentMessage[]): boolean {
    return this.getDriftScore(recentMessages) > 0.7
  }

  getReminderMessage(topic: string): string {
    return `讨论似乎偏离了主题"${topic}"，请回到正题。`
  }

  private extractKeywords(text: string): Set<string> {
    const stopWords = new Set([
      '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
      '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
      '自己', '这', '他', '她', '它', '们', '那', '些', '什么', '如何', '怎么',
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    ])

    const tokens: string[] = []
    const cjk = text.match(/[\u4e00-\u9fff]{2,}/g)
    if (cjk) {
      for (const segment of cjk) {
        for (let i = 0; i < segment.length - 1; i++) {
          const bigram = segment.substring(i, i + 2)
          if (!stopWords.has(bigram)) tokens.push(bigram)
        }
      }
    }
    const words = text
      .replace(/[\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()))
    tokens.push(...words)

    return new Set(tokens.map(w => w.toLowerCase()))
  }
}
