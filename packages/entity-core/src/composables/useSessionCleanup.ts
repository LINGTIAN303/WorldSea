import { ref } from 'vue'
import { getConfirmApi, getToastApi } from '../core/serviceProvider'

const SESSION_LIMIT = 200
const REMIND_THRESHOLD = 180
const REMIND_INTERVAL = 5

export interface SessionCleanupState {
  sessionCount: number
  isNearLimit: boolean
  lastRemindCount: number
}

export function useSessionCleanup() {
  const state = ref<SessionCleanupState>({
    sessionCount: 0,
    isNearLimit: false,
    lastRemindCount: 0,
  })
  const showRemind = ref(false)
  const remindMessage = ref('')

  async function refreshCount(): Promise<void> {
    const { countSessions } = await import('@worldsea/agent-runtime/session/manager')
    const count = await countSessions()
    state.value.sessionCount = count
    state.value.isNearLimit = count >= REMIND_THRESHOLD
  }

  async function checkAndRemind(): Promise<void> {
    await refreshCount()
    const count = state.value.sessionCount

    if (count >= SESSION_LIMIT) {
      remindMessage.value = `会话数量已达上限（${count}/${SESSION_LIMIT}），新建会话将自动清理最早的未收藏会话。`
      showRemind.value = true
      return
    }

    if (count >= REMIND_THRESHOLD) {
      const lastRemind = state.value.lastRemindCount
      if (count - lastRemind >= REMIND_INTERVAL || lastRemind === 0) {
        remindMessage.value = `会话数量接近上限（${count}/${SESSION_LIMIT}），建议清理不需要的会话。`
        showRemind.value = true
        state.value.lastRemindCount = count
      }
    } else {
      showRemind.value = false
    }
  }

  async function enforceLimit(): Promise<void> {
    await refreshCount()
    if (state.value.sessionCount < SESSION_LIMIT) return

    const { listSessions, deleteSession } = await import('@worldsea/agent-runtime/session/manager')
    const sessions = await listSessions()
    const unpinned = sessions.filter((s: any) => !s.pinned)
    if (unpinned.length === 0) {
      getToastApi().warn('所有会话均已收藏，无法自动清理。请手动删除部分会话。')
      return
    }

    unpinned.sort((a: any, b: any) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    const toDelete = unpinned[0]
    await deleteSession(toDelete.id)
    state.value.sessionCount--
    getToastApi().info(`已自动清理最早的会话「${toDelete.name}」`)
  }

  async function pinSession(id: string): Promise<void> {
    const { pinSession: dbPin } = await import('@worldsea/agent-runtime/session/manager')
    await dbPin(id)
    getToastApi().success('已收藏该会话')
  }

  async function requestUnpin(id: string): Promise<boolean> {
    if (state.value.sessionCount >= SESSION_LIMIT) {
      getToastApi().warn('会话数量已达上限，无法取消收藏。请先手动删除其他会话。')
      return false
    }

    const { confirm } = getConfirmApi()
    const ok = await confirm({
      type: 'warning',
      title: '取消收藏',
      description: '取消收藏后，该会话将在达到上限时被自动清理。确定取消收藏？',
      confirmText: '取消收藏',
    })
    if (!ok) return false

    const { unpinSession: dbUnpin } = await import('@worldsea/agent-runtime/session/manager')
    await dbUnpin(id)
    getToastApi().success('已取消收藏')
    return true
  }

  function dismissRemind(): void {
    showRemind.value = false
  }

  return {
    state,
    showRemind,
    remindMessage,
    SESSION_LIMIT,
    REMIND_THRESHOLD,
    refreshCount,
    checkAndRemind,
    enforceLimit,
    pinSession,
    requestUnpin,
    dismissRemind,
  }
}
