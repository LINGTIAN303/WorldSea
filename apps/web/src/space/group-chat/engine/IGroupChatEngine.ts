import type { AgentEvent, AgentMessage, ProviderConfig, IToolContext } from '@agent/index'
import type { GroupMember, GroupChatMessage, GroupChatCostTracker, StreamingAgentState, ContextStrategy, RequestTrackerSnapshot } from '../types'
import type { IChatStrategy } from './IChatStrategy'
import type { TurnResult } from '@agent/group-chat/turn-engine'
import type { GroupChatEvent } from '@agent/group-chat/message-bus'
import type { TurnStrategy, ProviderSlot } from '@agent/group-chat/types'

export interface IGroupChatEngine {
  // ─── Agent 生命周期 ─────────────────────────────────────────────
  createAgents(participants: GroupMember[], providerConfig: ProviderConfig, toolContext: IToolContext): Promise<void>
  disposeAgents(): void
  subscribeAgent(agentId: string, callback: (event: AgentEvent) => void): () => void
  getStreamingState(agentId: string): StreamingAgentState | null

  // ─── 成本与上下文 ───────────────────────────────────────────────
  recordUsage(agentId: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): void
  getCostSnapshot(): GroupChatCostTracker
  getPreparedMessages(agentId: string): AgentMessage[]
  getPreparedCasualMessages(agentId: string): GroupChatMessage[]
  getContextStrategy(): ContextStrategy

  // ─── 模型降级与健康检查 ─────────────────────────────────────────
  tryFallback(agentId: string): Promise<boolean>
  preflightHealthCheck(participants: GroupMember[], providerConfig: ProviderConfig): Promise<void>

  // ─── 消息管理 ───────────────────────────────────────────────────
  addMessage(msg: GroupChatMessage): void
  getMessages(): GroupChatMessage[]

  // ─── 策略管理 ───────────────────────────────────────────────────
  setStrategy(strategy: IChatStrategy): void
  getStrategy(): IChatStrategy

  // ─── Agent 访问 ─────────────────────────────────────────────────
  getAgent(agentId: string): any | undefined

  // ─── 策略上下文 ─────────────────────────────────────────────────
  buildStrategyContext(topic?: string, round?: number, userMessage?: GroupChatMessage, mentionedAgentIds?: string[]): any
  getEngineState(round: number, startTime: number, maxCostUsd: number): any

  // ─── 后端模块集成 ───────────────────────────────────────────────

  /** 使用 TurnEngine 解析本轮发言人 */
  resolveTurn(userMessage: string, mentions: string[], members: GroupMember[]): Promise<TurnResult>

  /** 获取流控许可（acquire 返回 release 函数） */
  acquireFlowSlot(slotId: string): Promise<() => void>

  /** 订阅消息总线事件 */
  subscribeBus(listener: (event: GroupChatEvent) => void): () => void

  /** 设置发言策略 */
  setTurnStrategy(strategy: TurnStrategy): void

  /** 获取当前发言策略 */
  getTurnStrategy(): TurnStrategy

  /** 记录 Agent 发言（供 TurnEngine 更新内部状态） */
  recordSpeaking(agentId: string): void

  /** 获取流控统计 */
  getFlowStats(): { globalPending: number; slots: Record<string, number> }

  // ─── Provider 池管理 ─────────────────────────────────────────────

  /** 注册 Provider 池（同厂商多 Key 负载均衡） */
  registerProviderSlot(slot: ProviderSlot): void

  /** 注销 Provider 池 */
  unregisterProviderSlot(slotId: string): void

  /** 更新 Provider 池 */
  updateProviderSlot(slot: ProviderSlot): void

  /** 通过 ProviderSlot 解析 ProviderConfig */
  resolveProviderConfig(slotId: string): Promise<ProviderConfig>

  // ─── 请求追踪 ─────────────────────────────────────────────────

  /** 开始追踪一次请求 */
  startRequestTrace(agentId: string, agentName: string, protocol?: string): string

  /** 结束追踪一次请求（成功） */
  endRequestTrace(requestId: string, inputTokens?: number, outputTokens?: number): void

  /** 结束追踪一次请求（失败） */
  failRequestTrace(requestId: string, error: string): void

  /** 获取请求追踪快照 */
  getRequestSnapshot(): RequestTrackerSnapshot

  /** 清空请求记录 */
  clearRequestRecords(): void

  /** 重置引擎 */
  reset(): void
}
