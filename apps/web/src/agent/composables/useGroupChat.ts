/** 群聊 Composable：管理多 Agent 群聊生命周期（阶段 2.0 后暂不可用，详见文档），详细见 docs/details/注释/web/agent/composables/useGroupChat.md */

import { ref, reactive, readonly, type DeepReadonly, type Ref } from 'vue'
import type { IAgentBackend, AgentEvent } from '@agent/index'
import { invalidateContextCache } from '@agent/context/builder'
import { useEntityStore, useRelationStore, useFileStore } from '@worldsmith/entity-core'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useConfirm } from '@worldsmith/plugin-sdk'
import type {
  AgentProfile,
  GroupChatMessage,
  TurnStrategy,
  GroupChatSession,
} from '@agent/group-chat/types'
import { ProviderPool } from '@agent/group-chat/provider-pool'
import { FlowController } from '@agent/group-chat/flow-control'
import { GroupChatMessageBus } from '@agent/group-chat/message-bus'
import { TurnEngine } from '@agent/group-chat/turn-engine'
import { createLuckState, updateLuck, type LuckState } from '@agent/group-chat/speaking-desire'
import {
  saveGroupSession,
  getGroupSession,
} from '@agent/session/manager'

/* ─── Module-level singleton state ─── */

const backends = reactive<Map<string, IAgentBackend>>(new Map())
const messages = ref<GroupChatMessage[]>([])
const streaming = ref<Set<string>>(new Set())
const streamingContent = reactive<Map<string, string>>(new Map())
const isProcessing = ref(false)
const currentSessionId = ref<string | null>(null)

const privateMessages = reactive<Map<string, GroupChatMessage[]>>(new Map())
const privateStreaming = reactive<Map<string, string>>(new Map())

let providerPool: ProviderPool | null = null
let flowController: FlowController | null = null
let messageBus: GroupChatMessageBus | null = null
let turnEngine: TurnEngine | null = null
let luckState: LuckState = createLuckState()
let toolContext: any = null
let moderatorBackend: IAgentBackend | null = null
const unsubscribers = new Map<string, () => void>()

export function useGroupChat() {
  const entityStore = useEntityStore()
  const relationStore = useRelationStore()
  const fileStore = useFileStore()
  const profileStore = useAgentProfileStore()
  const { confirm } = useConfirm()

  /* ─── Initialization ─── */

  function ensureInfrastructure(): void {
    if (!providerPool) {
      providerPool = new ProviderPool()
      for (const slot of profileStore.slots) {
        providerPool.register(slot)
      }
    }
    if (!flowController) {
      flowController = new FlowController()
      for (const slot of profileStore.slots) {
        flowController.registerSlot(slot.id)
      }
    }
    if (!messageBus) {
      messageBus = new GroupChatMessageBus()
    }
    if (!turnEngine) {
      turnEngine = new TurnEngine('speaking-desire', luckState)
    }
  }

  function buildToolContext(): void {
    if (toolContext) return
    toolContext = {
      stores: {
        entity: entityStore,
        relation: relationStore,
        file: fileStore,
        settings: {
          getProviderConfig: () => null,
          getSearchConfig: () => null,
        },
        ui: {
          confirm: async (title: string, msg: string) => {
            return confirm({ type: 'warning', title, description: msg })
          },
        },
      },
      projectInfo: {
        name: 'WorldSmith',
        entityTypes: entityStore.types.map(t => t.type),
        relationTypes: [],
        dirPath: null, // 异步获取，在 Agent 运行时通过 getFileStorageBackend 获取
      },
      platform: 'web' as const,
    }
  }

  /* ─── Agent Backend Lifecycle ─── */

  async function createAgentBackend(profile: AgentProfile): Promise<IAgentBackend> {
    // 阶段 2.0 批次3：CoreBackend 已移除（依赖 pi-ai），群聊功能暂不可用
    // Agent 循环已由 Rust 端接管，多 Agent 实例管理待后续在 Rust 端实现
    throw new Error(
      '[useGroupChat] 群聊功能暂不可用（批次3 移除 pi-ai 依赖）。\n' +
      `Agent "${profile.name}" 创建失败：CoreBackend 已废弃，请等待 Rust 后端多 Agent 实例支持。`
    )
  }

  function destroyAgentBackend(agentId: string): void {
    const backend = backends.get(agentId)
    if (backend) {
      const unsub = unsubscribers.get(agentId)
      if (unsub) unsub()
      unsubscribers.delete(agentId)
      backend.dispose()
      backends.delete(agentId)
    }
  }

  /* ─── Send Message ─── */

  async function sendGroupMessage(text: string, mentions?: string[]): Promise<void> {
    ensureInfrastructure()
    buildToolContext()
    if (isProcessing.value) return
    isProcessing.value = true

    const userMsg: GroupChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      agentId: null,
      content: text,
      mentions,
      timestamp: Date.now(),
    }
    messages.value.push(userMsg)
    messageBus!.appendMessage(userMsg)
    messageBus!.emit({ type: 'user_message', content: text, mentions })

    try {
      const enabledAgents = profileStore.enabledProfiles
      if (enabledAgents.length === 0) {
        isProcessing.value = false
        return
      }

      for (const profile of enabledAgents) {
        if (!backends.has(profile.id)) {
          try {
            await createAgentBackend(profile)
          } catch (err) {
            messageBus!.emit({
              type: 'error',
              agentId: profile.id,
              error: `创建后端失败: ${err}`,
            })
          }
        }
      }

      luckState = updateLuck(luckState, 5, 10)
      turnEngine!.updateLuckState(luckState)
      turnEngine!.decayRecentCounts()

      const conversationContext = messageBus!.buildConversationContext()
      const turnResult = await turnEngine!.resolveTurn(
        text,
        mentions ?? [],
        profileStore.profiles,
        conversationContext,
        moderatorBackend ?? undefined,
      )

      if (turnResult.strategy === 'moderator' && turnResult.reason) {
        messageBus!.emit({
          type: 'moderator_decision',
          nextSpeakers: turnResult.agentIds,
          reason: turnResult.reason,
        })
      }

      for (const agentId of turnResult.agentIds) {
        const profile = profileStore.profiles.find(p => p.id === agentId)
        const backend = backends.get(agentId)
        if (!profile || !backend) continue

        const slotId = profile.providerSlotId
        const release = flowController
          ? await flowController.acquire(slotId)
          : () => {}

        try {
          const allHistory = messageBus!.getHistory(20)
          const contextHistory = allHistory.length > 0 ? allHistory.slice(0, -1) : []
          const context = contextHistory.map(m => {
            const prefix = m.role === 'user' ? '用户' : (m.agentName ?? 'Agent')
            return `[${prefix}]: ${m.content}`
          }).join('\n')
          invalidateContextCache()
          await backend.prompt(text, {
            contextOverride: context || undefined,
            chatMode: 'group-chat',
          })
          turnEngine!.recordSpeaking(agentId)
        } catch (err) {
          messageBus!.emit({
            type: 'error',
            agentId,
            error: `Agent ${profile.name} 请求失败: ${err}`,
          })
        } finally {
          release()
        }
      }

      messageBus!.emit({ type: 'turn_complete' })
    } finally {
      isProcessing.value = false
    }
  }

  /* ─── Private Chat (1v1) ─── */

  async function sendPrivateMessage(agentId: string, text: string): Promise<void> {
    ensureInfrastructure()
    buildToolContext()

    const profile = profileStore.profiles.find(p => p.id === agentId)
    if (!profile) return

    if (!backends.has(agentId)) {
      await createAgentBackend(profile)
    }
    const backend = backends.get(agentId)
    if (!backend) return

    const agentMsgs = privateMessages.get(agentId) ?? []
    const userMsg: GroupChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      agentId: null,
      content: text,
      timestamp: Date.now(),
    }
    agentMsgs.push(userMsg)
    privateMessages.set(agentId, agentMsgs)

    privateStreaming.set(agentId, '')

    const release = flowController
      ? await flowController.acquire(profile.providerSlotId)
      : () => {}

    try {
      const context = agentMsgs.slice(-20).map(m => {
        const prefix = m.role === 'user' ? '用户' : (profile.name)
        return `[${prefix}]: ${m.content}`
      }).join('\n')

      let accumulated = ''
      const unsub = backend.subscribe((event: AgentEvent) => {
        if (event.type === 'message_update') {
          accumulated = event.content ?? ''
          privateStreaming.set(agentId, accumulated)
        }
        if (event.type === 'agent_end') {
          privateStreaming.delete(agentId)
          const assistantMsgs = event.messages?.filter(m => m.role === 'assistant') ?? []
          const lastMsg = assistantMsgs[assistantMsgs.length - 1]
          const content = lastMsg?.content ?? accumulated
          if (content) {
            const reply: GroupChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              agentId,
              agentName: profile.name,
              agentAvatar: profile.avatar,
              agentColor: profile.color,
              content,
              thinking: lastMsg?.thinking,
              timestamp: Date.now(),
            }
            const msgs = privateMessages.get(agentId) ?? []
            msgs.push(reply)
            privateMessages.set(agentId, msgs)
          }
        }
      })

      await backend.prompt(text, {
        contextOverride: context || undefined,
        chatMode: 'group-chat',
      })
      unsub()
    } catch (err) {
      privateStreaming.delete(agentId)
      const errorMsg: GroupChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        agentId,
        agentName: profile.name,
        agentColor: '#ef4444',
        content: `[错误] ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      }
      const msgs = privateMessages.get(agentId) ?? []
      msgs.push(errorMsg)
      privateMessages.set(agentId, msgs)
    } finally {
      release()
    }
  }

  function getPrivateMessages(agentId: string): GroupChatMessage[] {
    return privateMessages.get(agentId) ?? []
  }

  function clearPrivateMessages(agentId: string): void {
    privateMessages.delete(agentId)
  }

  /* ─── Sync Prompt (non-streaming) ─── */

  async function promptSync(agentId: string, text: string): Promise<string> {
    ensureInfrastructure()
    buildToolContext()

    const profile = profileStore.profiles.find(p => p.id === agentId)
    if (!profile) throw new Error(`Agent "${agentId}" not found`)

    if (!backends.has(agentId)) {
      await createAgentBackend(profile)
    }
    const backend = backends.get(agentId)
    if (!backend) throw new Error(`Backend for "${agentId}" not available`)

    return new Promise<string>((resolve, reject) => {
      let content = ''
      const unsub = backend.subscribe((event: AgentEvent) => {
        if (event.type === 'message_update') {
          content = event.content ?? ''
        }
        if (event.type === 'agent_end') {
          unsub()
          const assistantMsgs = event.messages?.filter(m => m.role === 'assistant') ?? []
          const lastMsg = assistantMsgs[assistantMsgs.length - 1]
          resolve(lastMsg?.content ?? content)
        }
        if (event.type === 'error') {
          unsub()
          reject(event.error instanceof Error ? event.error : new Error(String(event.error)))
        }
      })

      backend.prompt(text, { chatMode: 'group-chat' }).catch((err) => {
        unsub()
        reject(err)
      })
    })
  }

  /* ─── Session Management ─── */

  async function newGroupSession(name?: string): Promise<string> {
    const session: GroupChatSession = {
      id: crypto.randomUUID(),
      name: name ?? '新群聊',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentIds: profileStore.enabledProfiles.map(p => p.id),
      moderatorAgentId: null,
      mode: 'free',
      turnStrategy: 'speaking-desire',
      messages: [],
      metadata: { totalTokens: 0, totalCost: 0, turnCount: 0 },
    }
    currentSessionId.value = session.id
    messages.value = []
    messageBus?.clearHistory()
    await saveGroupSession(session)
    return session.id
  }

  async function switchGroupSession(sessionId: string): Promise<void> {
    const session = await getGroupSession(sessionId)
    if (!session) return
    currentSessionId.value = sessionId
    messages.value = [...session.messages]
    messageBus?.clearHistory()
    for (const msg of session.messages) {
      messageBus?.appendMessage(msg)
    }
  }

  async function saveCurrentSession(): Promise<void> {
    if (!currentSessionId.value) return
    const session = await getGroupSession(currentSessionId.value)
    if (!session) return
    session.messages = [...messages.value]
    session.metadata.turnCount = messages.value.filter(m => m.role === 'user').length
    await saveGroupSession(session)
  }

  /* ─── Cleanup ─── */

  function disposeAll(): void {
    for (const id of Array.from(backends.keys())) {
      destroyAgentBackend(id)
    }
    if (moderatorBackend) {
      moderatorBackend.dispose()
      moderatorBackend = null
    }
    messages.value = []
    streaming.value.clear()
    streamingContent.clear()
    privateMessages.clear()
    privateStreaming.clear()
    currentSessionId.value = null
    providerPool = null
    flowController = null
    messageBus = null
    turnEngine = null
    luckState = createLuckState()
    toolContext = null
  }

  /* ─── Strategy ─── */

  function setTurnStrategy(strategy: TurnStrategy): void {
    turnEngine?.setStrategy(strategy)
  }

  async function setModeratorAgent(_agentId: string | null): Promise<void> {
    // 阶段 2.0 批次3：CoreBackend 已移除，Moderator Agent 创建不可用
    if (moderatorBackend) {
      moderatorBackend.dispose()
      moderatorBackend = null
    }
    if (!_agentId) return
    throw new Error(
      '[useGroupChat] Moderator Agent 暂不可用（批次3 移除 pi-ai 依赖）。\n' +
      '请等待 Rust 后端多 Agent 实例支持。'
    )
  }

  return {
    backends: readonly(backends),
    messages: readonly(messages) as DeepReadonly<Ref<GroupChatMessage[]>>,
    streaming: readonly(streaming),
    streamingContent: readonly(streamingContent),
    isProcessing: readonly(isProcessing),
    currentSessionId: readonly(currentSessionId),
    privateMessages: readonly(privateMessages),
    privateStreaming: readonly(privateStreaming),
    messageBus,
    sendGroupMessage,
    sendPrivateMessage,
    getPrivateMessages,
    clearPrivateMessages,
    promptSync,
    createAgentBackend,
    destroyAgentBackend,
    newGroupSession,
    switchGroupSession,
    saveCurrentSession,
    disposeAll,
    setTurnStrategy,
    setModeratorAgent,
  }
}
