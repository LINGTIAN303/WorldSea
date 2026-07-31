/**
 * DefaultOrchestrator — 阶段 0 的简单编排器实现
 *
 * 特性：
 * - 线性/条件序列执行（不涉及并行/回溯，那些留给阶段 2）
 * - 支持中断/暂停/恢复
 * - 事件订阅与状态快照
 * - 最大轮次限制（防无限循环）
 *
 * 不包含（阶段 2 再做）：
 * - 并行节点执行（ToT/GoT 需要）
 * - 图的环路检测
 * - 节点超时（单个节点级别）
 */

import type { AgentEvent, AgentEventListener } from '../types'
import type {
  OrchestratorState,
  OrchestratorNode,
  OrchestratorEdge,
  Orchestrator as IOrchestrator,
  OrchestratorRunOptions,
  OrchestratorResult,
  OrchestratorEvent,
  NodeContext,
  NodeResult,
  NodeBackendAccessor,
} from './types'

export class DefaultOrchestrator implements IOrchestrator {
  private nodes = new Map<string, OrchestratorNode>()
  private edges: OrchestratorEdge[] = []
  private entryNodeId: string | null = null
  private listeners = new Set<AgentEventListener>()
  private state: OrchestratorState = createEmptyState()
  private aborted = false
  private paused = false
  private resumePromise: Promise<void> | null = null
  private resumeResolve: (() => void) | null = null
  private backend: NodeBackendAccessor | null = null
  private maxIterations = 50

  constructor(options?: { backend?: NodeBackendAccessor; maxIterations?: number }) {
    if (options?.backend) this.backend = options.backend
    if (options?.maxIterations) this.maxIterations = options.maxIterations
  }

  /** 注入 LLM 后端访问器（阶段 0 由 bridge.ts 注入 pi-agent-core 包装） */
  setBackend(backend: NodeBackendAccessor): void {
    this.backend = backend
  }

  /**
   * 中继事件 — 将外部事件注入 Orchestrator 的事件流
   *
   * 用途：PiBackendAccessor 订阅 CoreBackend 事件后，
   * 通过此方法将 LLM 事件（message_start/update/end 等）转发给 Orchestrator 的订阅者。
   *
   * 使用方式：
   * ```ts
   * const orchestrator = new DefaultOrchestrator()
   * const accessor = new PiBackendAccessor(coreBackend, orchestrator.relayEvent.bind(orchestrator))
   * orchestrator.setBackend(accessor)
   * ```
   */
  relayEvent(event: AgentEvent): void {
    this.emit(event)
  }

  addNode(node: OrchestratorNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node with id "${node.id}" already exists`)
    }
    this.nodes.set(node.id, node)
  }

  addEdge(edge: OrchestratorEdge): void {
    this.edges.push(edge)
  }

  setEntry(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Entry node "${nodeId}" does not exist`)
    }
    this.entryNodeId = nodeId
  }

  async run(input: string, options?: OrchestratorRunOptions): Promise<OrchestratorResult> {
    if (!this.entryNodeId) {
      throw new Error('Entry node not set. Call setEntry() first.')
    }
    if (!this.backend) {
      throw new Error('Backend not set. Call setBackend() first.')
    }

    // 重置状态
    this.aborted = false
    this.paused = false
    this.state = createEmptyState()
    this.state.input = input
    this.state.images = options?.images
    this.state.modelId = options?.modelId
    this.state.chatMode = options?.chatMode

    const maxIter = options?.maxIterations ?? this.maxIterations
    const startTime = Date.now()
    const timeoutMs = options?.timeoutMs

    this.emit({ type: 'orchestrator_start', entryNodeId: this.entryNodeId, input })

    let currentNodeId: string | null = this.entryNodeId
    let iterations = 0

    while (currentNodeId && !this.aborted) {
      if (iterations >= maxIter) {
        const result: OrchestratorResult = {
          status: 'timeout',
          iterations,
          error: `Max iterations (${maxIter}) reached`,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      if (timeoutMs && Date.now() - startTime > timeoutMs) {
        const result: OrchestratorResult = {
          status: 'timeout',
          iterations,
          error: `Timeout (${timeoutMs}ms) exceeded`,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      // 暂停检查
      await this.waitIfPaused()
      if (this.aborted) break

      const node = this.nodes.get(currentNodeId)
      if (!node) {
        const result: OrchestratorResult = {
          status: 'error',
          iterations,
          error: `Node "${currentNodeId}" not found`,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      const ctx: NodeContext = {
        state: this.state,
        emit: (event: OrchestratorEvent) => this.emit(event),
        isAborted: () => this.aborted,
        waitIfPaused: () => this.waitIfPaused(),
        backend: this.backend!,
        log: (level, message, data) => {
          const prefix = `[Orchestrator:${node.name}]`
          if (data !== undefined) {
            console[level === 'debug' ? 'log' : level](`${prefix} ${message}`, data)
          } else {
            console[level === 'debug' ? 'log' : level](`${prefix} ${message}`)
          }
        },
      }

      const nodeStart = Date.now()
      this.emit({ type: 'node_start', nodeId: node.id, nodeName: node.name, nodeType: node.type })

      let nodeResult: NodeResult
      try {
        nodeResult = await node.execute(ctx)
      } catch (err) {
        nodeResult = {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        }
      }

      const nodeDuration = Date.now() - nodeStart
      this.emit({
        type: 'node_end',
        nodeId: node.id,
        status: nodeResult.status,
        summary: nodeResult.summary,
        durationMs: nodeDuration,
      })

      iterations++

      if (nodeResult.status === 'done') {
        const finalMessage = this.state.messages[this.state.messages.length - 1]?.content
        const result: OrchestratorResult = {
          status: 'completed',
          finalMessage,
          iterations,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      if (nodeResult.status === 'error') {
        const result: OrchestratorResult = {
          status: 'error',
          iterations,
          error: nodeResult.error,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      if (nodeResult.status === 'aborted' || this.aborted) {
        const result: OrchestratorResult = {
          status: 'aborted',
          iterations,
          finalState: { ...this.state },
        }
        this.emit({ type: 'orchestrator_end', result })
        return result
      }

      // status === 'continue'：确定下一个节点
      currentNodeId = this.resolveNextNode(currentNodeId, nodeResult.nextNodeId)
    }

    // 循环结束但未显式完成（通常因 abort）
    const result: OrchestratorResult = {
      status: this.aborted ? 'aborted' : 'completed',
      iterations,
      finalState: { ...this.state },
    }
    this.emit({ type: 'orchestrator_end', result })
    return result
  }

  /**
   * 解析下一个要执行的节点
   *
   * 优先级：
   * 1. 节点显式返回的 nextNodeId
   * 2. 满足条件的条件边
   * 3. 无条件的默认边
   * 4. null（结束）
   */
  private resolveNextNode(currentNodeId: string, explicitNext?: string): string | null {
    if (explicitNext) {
      if (!this.nodes.has(explicitNext)) {
        throw new Error(`Next node "${explicitNext}" not found`)
      }
      return explicitNext
    }

    const outgoingEdges = this.edges.filter(e => e.from === currentNodeId)
    if (outgoingEdges.length === 0) return null

    // 先检查条件边
    for (const edge of outgoingEdges) {
      if (edge.condition && edge.condition(this.state)) {
        return edge.to
      }
    }

    // 再检查无条件边
    const defaultEdge = outgoingEdges.find(e => !e.condition)
    return defaultEdge ? defaultEdge.to : null
  }

  async abort(): Promise<void> {
    this.aborted = true
    if (this.resumeResolve) {
      this.resumeResolve()
      this.resumeResolve = null
      this.resumePromise = null
    }
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.emit({ type: 'orchestrator_paused' })
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (this.resumeResolve) {
      this.resumeResolve()
      this.resumeResolve = null
      this.resumePromise = null
    }
    this.emit({ type: 'orchestrator_resumed' })
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): OrchestratorState {
    return { ...this.state, messages: [...this.state.messages] }
  }

  restore(snapshot: OrchestratorState): void {
    this.state = { ...snapshot, messages: [...snapshot.messages] }
  }

  dispose(): void {
    this.listeners.clear()
    this.nodes.clear()
    this.edges = []
    this.backend = null
  }

  private emit(event: AgentEvent | { type: string; [key: string]: unknown }): void {
    for (const listener of this.listeners) {
      try {
        listener(event as AgentEvent)
      } catch (err) {
        console.error('[Orchestrator] listener error:', err)
      }
    }
  }

  private async waitIfPaused(): Promise<void> {
    if (!this.paused) return
    this.resumePromise = new Promise<void>(resolve => {
      this.resumeResolve = resolve
    })
    await this.resumePromise
  }
}

function createEmptyState(): OrchestratorState {
  return {
    input: '',
    messages: [],
    extra: {},
  }
}
