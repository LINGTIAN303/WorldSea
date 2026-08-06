/** useChatSession：会话 drawer 的列表/切换/删除/新建（从 AgentChat 拆分），详细见 docs/details/注释/web/agent/chat/useChatSession.md */
import { type Ref } from 'vue'
import { listSessions, deleteSession } from '@agent/index'

export interface DrawerSession {
  id: string
  name: string
  updatedAt: string
  modelId?: string
}

export interface UseChatSessionOptions {
  /** 会话列表（来自 useChatPanel） */
  sessions: Ref<DrawerSession[]>
  /** drawer 开关（来自 useChatPanel） */
  sessionDrawerOpen: Ref<boolean>
  /** useAgent.switchSession */
  switchSession: (sessionId: string) => Promise<void>
  /** useAgent.newSession */
  newSession: () => Promise<void>
  /** useAgent.currentSessionId（只读，可能为 null） */
  currentSessionId: Readonly<Ref<string | null>>
  /** useManuscriptActions.cascadeDeleteManuscriptClones */
  cascadeDeleteManuscriptClones: (sourceSessionId: string) => void
}

export function useChatSession(options: UseChatSessionOptions) {
  const {
    sessions, sessionDrawerOpen,
    switchSession, newSession, currentSessionId,
    cascadeDeleteManuscriptClones,
  } = options

  async function loadDrawerSessions(): Promise<void> {
    try {
      sessions.value = await listSessions()
    } catch {}
  }

  async function onDrawerSelect(sessionId: string): Promise<void> {
    sessionDrawerOpen.value = false
    await switchSession(sessionId)
  }

  async function onDrawerDelete(sessionId: string): Promise<void> {
    try {
      // H6.2: 删除会话前归档该会话（避免数据丢失）
      try {
        const { useMemoryArchive } = await import('@/memory-archive/useMemoryArchive')
        await useMemoryArchive().archiveSession(sessionId)
      } catch (err) {
        console.warn('[AgentChat] 删除前归档失败（不影响删除）:', err)
      }
      const isCurrent = sessionId === currentSessionId.value
      await deleteSession(sessionId)
      // 级联删除：移除所有从该会话复制的文境副本
      cascadeDeleteManuscriptClones(sessionId)
      await loadDrawerSessions()
      if (isCurrent) {
        await newSession()
        await loadDrawerSessions()
      }
    } catch {}
  }

  async function onDrawerNewSession(): Promise<void> {
    sessionDrawerOpen.value = false
    await newSession()
    await loadDrawerSessions()
  }

  function onSessionTitleUpdated(): void {
    loadDrawerSessions()
  }

  return {
    loadDrawerSessions,
    onDrawerSelect,
    onDrawerDelete,
    onDrawerNewSession,
    onSessionTitleUpdated,
  }
}

export type UseChatSessionReturn = ReturnType<typeof useChatSession>
