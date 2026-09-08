import type { ContextStrategy } from './types'
import { getModelInfo } from '@worldsea/agent-runtime'

/** 上下文管理所依赖的最小消息结构（AgentMessage 与 GroupChatMessage 均满足） */
export interface ContextMessage {
  id: string
  role: string
  content: string
  thinking?: string
  timestamp: number
}

export class ContextManagerImpl {
  private contextWindow: number
  private agentContextWindows: Record<string, number> = {}

  constructor(contextWindow: number) {
    this.contextWindow = contextWindow
  }

  registerAgentModel(agentId: string, modelId: string): void {
    const info = getModelInfo(modelId)
    if (info) {
      this.agentContextWindows[agentId] = info.contextLength
    }
  }

  getContextWindowForAgent(agentId: string): number {
    return this.agentContextWindows[agentId] || this.contextWindow
  }

  getMinContextWindow(): number {
    const windows = Object.values(this.agentContextWindows)
    if (windows.length === 0) return this.contextWindow
    return Math.min(...windows)
  }

  getStrategy<T extends ContextMessage>(messages: T[], systemPromptTokens: number, worldContextTokens: number, options?: { summaryEnabled?: boolean }): ContextStrategy {
    const forceSummaryDisabled = options?.summaryEnabled === false
    const messagesTokens = this.estimateMessagesTokens(messages)
    const totalTokens = systemPromptTokens + worldContextTokens + messagesTokens
    const effectiveWindow = this.getMinContextWindow()
    const usageRatio = totalTokens / effectiveWindow

    if (usageRatio < 0.5) {
      return { level: 'none', maxMessages: Infinity, preserveFirstN: 0, summaryEnabled: false, keyInfoExtraction: false }
    }
    if (usageRatio < 0.7) {
      const available = Math.floor((effectiveWindow * 0.5 - systemPromptTokens - worldContextTokens) / 400)
      return { level: 'light', maxMessages: Math.max(available, 10), preserveFirstN: 2, summaryEnabled: false, keyInfoExtraction: false }
    }
    if (usageRatio < 0.85) {
      const available = Math.floor((effectiveWindow * 0.3 - systemPromptTokens - worldContextTokens) / 400)
      return { level: 'moderate', maxMessages: Math.max(available, 6), preserveFirstN: 2, summaryEnabled: forceSummaryDisabled ? false : true, keyInfoExtraction: false }
    }
    if (usageRatio < 0.95) {
      const available = Math.floor((effectiveWindow * 0.2 - systemPromptTokens - worldContextTokens) / 400)
      return { level: 'heavy', maxMessages: Math.max(available, 4), preserveFirstN: 2, summaryEnabled: forceSummaryDisabled ? false : true, keyInfoExtraction: true }
    }
    return { level: 'critical', maxMessages: 0, preserveFirstN: 0, summaryEnabled: false, keyInfoExtraction: false }
  }

  applyStrategy<T extends ContextMessage>(messages: T[], strategy: ContextStrategy): T[] {
    if (strategy.level === 'none' || strategy.level === 'critical') return messages

    if (messages.length <= strategy.maxMessages) return messages

    const first = messages.slice(0, strategy.preserveFirstN)
    const recent = messages.slice(-strategy.maxMessages + strategy.preserveFirstN)

    if (strategy.summaryEnabled) {
      const compressed = first.concat([
        {
          id: crypto.randomUUID(),
          role: 'system' as const,
          content: '[早期讨论已压缩，以下为最近发言]',
          timestamp: recent[0]?.timestamp ?? Date.now(),
        } as T,
        ...recent,
      ])
      return compressed
    }

    return [...first, ...recent]
  }

  isOverflow<T extends ContextMessage>(messages: T[], systemPromptTokens: number, worldContextTokens: number): boolean {
    const messagesTokens = this.estimateMessagesTokens(messages)
    const totalTokens = systemPromptTokens + worldContextTokens + messagesTokens
    const effectiveWindow = this.getMinContextWindow()
    return totalTokens > effectiveWindow * 0.95
  }

  reset(): void {
    this.agentContextWindows = {}
  }

  estimateMessagesTokens<T extends ContextMessage>(messages: T[]): number {
    let total = 0
    for (const msg of messages) {
      total += Math.ceil((msg.content?.length ?? 0) * 0.3)
      if (msg.thinking) total += Math.ceil(msg.thinking.length * 0.3)
    }
    return total
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length * 0.3)
  }
}