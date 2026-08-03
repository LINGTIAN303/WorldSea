/**
 * useChatSession — 会话 drawer 的会话列表 / 切换 / 删除 / 新建
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - loadDrawerSessions：拉取会话列表
 *   - onDrawerSelect / onDrawerNewSession：切换 / 新建会话
 *   - onDrawerDelete：删除会话（含 H6.2 删除前归档 + 级联删除文境副本）
 *   - onSessionTitleUpdated：会话标题更新事件回调
 *
 * 依赖外部注入：
 *   - sessions / sessionDrawerOpen（来自 useChatPanel）
 *   - switchSession / newSession / currentSessionId（来自 useAgent）
 *   - cascadeDeleteManuscriptClones（来自 useManuscriptActions）
 */
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
