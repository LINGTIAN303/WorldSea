/** 将 CoreBackend 适配为 NodeBackendAccessor（签名适配/事件转发/消息管理），详细见 docs/details/注释/packages/agent-runtime/orchestrator-pi-backend-accessor.md */

import type {
  NodeBackendAccessor,
  PromptCallOptions,
  OrchestratorMessage,
} from '@worldsea/agent-core/orchestrator'
import type { AgentEvent, IAgentBackend } from '../bridge-types'

export type RelayFn = (event: AgentEvent) => void

export class PiBackendAccessor implements NodeBackendAccessor {
  private backend: IAgentBackend
  private relay: RelayFn
  /** 持久事件订阅（转发 backend 所有事件给 Orchestrator） */
  private persistentUnsub: (() => void) | null = null

  constructor(backend: IAgentBackend, relay: RelayFn) {
    this.backend = backend
    this.relay = relay
    // 持久订阅：backend 的所有事件都转发给 Orchestrator
    this.persistentUnsub = this.backend.subscribe((event) => {
      this.relay(event)
    })
  }

/** 调用 LLM 并返回最终响应文本（临时订阅捕获 message_end），详细见 docs/details/注释/packages/agent-runtime/orchestrator-pi-backend-accessor.md */
  async prompt(text: string, options?: PromptCallOptions): Promise<string> {
    // 应用 thinkingLevel（如有）
    if (options?.thinkingLevel) {
      this.backend.updateThinkingLevel(options.thinkingLevel)
    }

    // 临时订阅捕获最终响应
    let lastContent = ''
    let resolveEnd: (() => void) | null = null
    let rejectError: ((err: Error) => void) | null = null

    const endPromise = new Promise<void>((resolve, reject) => {
      resolveEnd = resolve
      rejectError = reject
    })

    const tempUnsub = this.backend.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case 'message_end':
          lastContent = event.content
          break
        case 'agent_end':
          resolveEnd?.()
          break
        case 'error':
          rejectError?.(event.error)
          break
      }
    })

    try {
      // 调用 backend.prompt（返回 void，响应通过事件流获取）
      await this.backend.prompt(text, this.convertOptions(options))
      // 等待 agent_end
      await endPromise
      return lastContent
    } finally {
      tempUnsub()
    }
  }

  async steer(text: string): Promise<void> {
    return this.backend.steer(text)
  }

  /**
   * 获取当前 messages 快照
   *
   * 注意：返回的是 pi-agent-core 内部格式（unknown[]），
   * 这里做轻量转换：只提取 role 和 content。
   * 完整格式（含 toolCalls/toolCallId）在阶段 1 完善。
   */
  getMessages(): OrchestratorMessage[] {
    const raw = this.backend.getRuntimeMessages?.() ?? []
    return raw.map((msg: any) => ({
      role: msg?.role ?? 'assistant',
      content: typeof msg?.content === 'string'
        ? msg.content
        : Array.isArray(msg?.content)
          ? msg.content
              .filter((c: any) => c?.type === 'text')
              .map((c: any) => c.text || '')
              .join('')
          : '',
      toolCalls: msg?.toolCalls,
      toolCallId: msg?.toolCallId,
      meta: msg?.meta,
    }))
  }

  /**
   * 写回 messages（断点恢复用）
   *
   * 直接写回 pi-agent-core 内部格式，不做转换（checkpoint 保存的就是原始格式）
   */
  setMessages(messages: OrchestratorMessage[]): void {
    // OrchestratorMessage 与 pi-agent-core 内部消息格式兼容
    // （都包含 role/content/toolCalls/toolCallId）
    this.backend.setRuntimeMessages?.(messages as unknown[])
  }

  /**
   * 清理上下文（释放窗口空间）
   */
  trimContext(upToIndex: number): void {
    this.backend.trimContext?.(upToIndex)
  }

  /**
   * 销毁：清理持久订阅
   */
  dispose(): void {
    if (this.persistentUnsub) {
      this.persistentUnsub()
      this.persistentUnsub = null
    }
  }

  /** 将 PromptCallOptions 转换为 CoreBackend 的 PromptOptions（阶段 0 简化映射），详细见 docs/details/注释/packages/agent-runtime/orchestrator-pi-backend-accessor.md */
  private convertOptions(options?: PromptCallOptions): Parameters<IAgentBackend['prompt']>[1] | undefined {
    if (!options) return undefined
    const result: NonNullable<Parameters<IAgentBackend['prompt']>[1]> = {}
    if (options.images) result.images = options.images
    return result
  }
}
