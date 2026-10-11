import { ref, computed } from 'vue'

/**
 * 脏数据追踪 composable。
 * 追踪自上次 loadAll/初始化以来是否有数据变更，
 * 在用户关闭/刷新页面时提供防丢失提醒。
 */
const dirtyEntityIds = ref(new Set<string>())
const dirtyRelationIds = ref(new Set<string>())

export function useDirtyTracker() {
  const isDirty = computed(() => dirtyEntityIds.value.size > 0 || dirtyRelationIds.value.size > 0)
  const dirtyCount = computed(() => dirtyEntityIds.value.size + dirtyRelationIds.value.size)

  function markEntityDirty(id: string) {
    const s = new Set(dirtyEntityIds.value)
    s.add(id)
    dirtyEntityIds.value = s
  }

  function markEntityClean(id: string) {
    const s = new Set(dirtyEntityIds.value)
    s.delete(id)
    dirtyEntityIds.value = s
  }

  function markRelationDirty(id: string) {
    const s = new Set(dirtyRelationIds.value)
    s.add(id)
    dirtyRelationIds.value = s
  }

  function markRelationClean(id: string) {
    const s = new Set(dirtyRelationIds.value)
    s.delete(id)
    dirtyRelationIds.value = s
  }

  function clearAllDirty() {
    dirtyEntityIds.value = new Set()
    dirtyRelationIds.value = new Set()
  }

  /** 注册 beforeunload 监听器，返回清理函数 */
  function setupBeforeUnload(): () => void {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty.value) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }

  return {
    isDirty,
    dirtyCount,
    dirtyEntityIds,
    dirtyRelationIds,
    markEntityDirty,
    markEntityClean,
    markRelationDirty,
    markRelationClean,
    clearAllDirty,
    setupBeforeUnload,
  }
}
