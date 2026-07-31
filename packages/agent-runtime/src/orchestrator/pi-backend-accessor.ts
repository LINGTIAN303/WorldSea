/**
 * PiBackendAccessor — 将 CoreBackend（pi-agent-core 包装）适配为 NodeBackendAccessor
 *
 * 核心职责：
 * 1. 适配 prompt 签名：CoreBackend.prompt 返回 void → NodeBackendAccessor.prompt 返回 string
 *    通过临时订阅 backend 事件，捕获 message_end 的 content 作为返回值
 * 2. 事件转发：将 CoreBackend 的 AgentEvent 通过 relay 函数注入 Orchestrator 事件流
 * 3. 消息管理：委托 getRuntimeMessages/setRuntimeMessages/trimContext 给 CoreBackend
 *
 * 三层架构位置：
 *   编排框架层（Orchestrator/Node/Edge）
 *   Agent loop 层（ReAct/Plan/Reflection）
 *   LLM 通信层（pi-agent-core）← PiBackendAccessor 在此层之上，适配编排框架的接口
 *
 * 阶段 0：包装 CoreBackend（TS）
 * 阶段 1：替换为包装 Rust genai 的 Tauri invoke（接口不变，只换实现）
 */

import type {
  NodeBackendAccessor,
  PromptCallOptions,
  OrchestratorMessage,
} from '@worldsmith/agent-core/orchestrator'
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

  /**
   * 调用 LLM 并返回最终响应文本
   *
   * 内部流程：
   * 1. 临时订阅 backend 事件（捕获 message_end 和 agent_end）
   * 2. 调用 backend.prompt（返回 void）
   * 3. 等待 agent_end 事件
   * 4. 返回最后一条 message_end 的 content
   *
   * 注意：事件已通过构造时的持久订阅转发给 Orchestrator，这里只需捕获响应
   */
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

  /**
   * 将 PromptCallOptions 转换为 CoreBackend 的 PromptOptions
   *
   * 阶段 0 简化映射：
   * - images → options.images
   * - thinkingLevel → 通过 updateThinkingLevel 设置（在 prompt 前已处理）
   * - temperature/maxTokens → 暂不支持（需通过 updateModel，开销大，留到后续）
   * - systemPromptOverride → 暂不支持（需重建 agent）
   * - toolsOverride → 暂不支持（工具集在 agent 初始化时固定）
   */
  private convertOptions(options?: PromptCallOptions): Parameters<IAgentBackend['prompt']>[1] | undefined {
    if (!options) return undefined
    const result: NonNullable<Parameters<IAgentBackend['prompt']>[1]> = {}
    if (options.images) result.images = options.images
    return result
  }
}
