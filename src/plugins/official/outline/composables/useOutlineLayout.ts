import { ref, shallowRef, triggerRef, watch } from 'vue'

const STORAGE_KEY = 'ws-outline-layout'

interface OutlineLayout {
  expandedIds: string[]
  selectedNodeId: string | null
}

export function useOutlineLayout() {
  // 性能优化:用 shallowRef 替代 ref,避免 Vue 对 Set 做深层响应式包装
  // toggleExpanded 时直接 mutate Set + triggerRef,不再 new Set(...) 复制整个集合
  const expandedIds = shallowRef<Set<string>>(new Set())
  const selectedNodeId = ref<string | null>(null)

  function saveLayout() {
    const data: OutlineLayout = {
      expandedIds: [...expandedIds.value],
      selectedNodeId: selectedNodeId.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  function loadLayout() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const data: OutlineLayout = JSON.parse(raw)
      if (data.expandedIds) expandedIds.value = new Set(data.expandedIds)
      if (data.selectedNodeId) selectedNodeId.value = data.selectedNodeId
    } catch {}
  }

  // 性能优化:直接 mutate Set + triggerRef,零复制(同 WsTree 优化)
  // 原实现每次 toggle 都 new Set(...) 复制整个集合,大树频繁展开/收起有 GC 压力
  function toggleExpanded(id: string) {
    const set = expandedIds.value
    if (set.has(id)) {
      set.delete(id)
    } else {
      set.add(id)
    }
    triggerRef(expandedIds)
  }

  function isExpanded(id: string): boolean {
    return expandedIds.value.has(id)
  }

  // 去掉 deep:true:shallowRef + triggerRef 已能正确触发,
  // selectedNodeId 是 string 不需要 deep,避免 deep watch 对 Set 全量遍历
  watch([expandedIds, selectedNodeId], () => {
    saveLayout()
  })

  return {
    expandedIds,
    selectedNodeId,
    loadLayout,
    toggleExpanded,
    isExpanded,
  }
}
