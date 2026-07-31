/**
 * 群聊消息总线
 *
 * 群聊的中央神经系统：路由消息、广播事件、维护对话历史。
 * 所有 Agent 的流式输出和完整消息都通过 MessageBus 分发到 UI。
 */

import type { GroupChatMessage } from './types'

export type GroupChatEvent =
  | { type: 'user_message'; content: string; mentions?: string[] }
  | { type: 'agent_start'; agentId: string }
  | { type: 'agent_streaming'; agentId: string; delta: string; thinking?: string }
  | { type: 'agent_message'; agentId: string; content: string }
  | { type: 'agent_end'; agentId: string }
  | { type: 'moderator_decision'; nextSpeakers: string[]; reason: string }
  | { type: 'turn_complete' }
  | { type: 'error'; agentId: string | null; error: string }

export type GroupChatEventListener = (event: GroupChatEvent) => void

export class GroupChatMessageBus {
  private listeners: Set<GroupChatEventListener> = new Set()
  private history: GroupChatMessage[] = []

  subscribe(listener: GroupChatEventListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  emit(event: GroupChatEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  appendMessage(msg: GroupChatMessage): void {
    this.history.push(msg)
  }

  getHistory(limit?: number): GroupChatMessage[] {
    return limit ? this.history.slice(-limit) : [...this.history]
  }

  clearHistory(): void {
    this.history = []
  }

  buildConversationContext(maxMessages = 20): string {
    const recent = this.history.slice(-maxMessages)
    if (recent.length === 0) return ''
    return recent.map(m => {
      const prefix = m.role === 'user'
        ? '用户'
        : m.role === 'moderator'
          ? '[主持人]'
          : (m.agentName ?? 'Agent')
      return `[${prefix}]: ${m.content}`
    }).join('\n')
  }
}
