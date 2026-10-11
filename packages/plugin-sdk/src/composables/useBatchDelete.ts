import { ref } from 'vue'
import { useEntityStore, useRelationStore } from '@worldsea/entity-core'
import { useConfirm, toastSuccess, toastError, toastWarn } from '@worldsea/ui-kit'
import type { Entity } from '@worldsea/entity-core'

export function useBatchDelete() {
  const selectedIds = ref<Set<string>>(new Set())
  const selecting = ref(false)

  function toggleSelect(id: string) {
    const s = new Set(selectedIds.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    selectedIds.value = s
  }

  function selectAll(entities: Entity[]) {
    selectedIds.value = new Set(entities.map(e => e.id))
  }

  /** 只清空选中，不改批量态（「清空 ≠ 退出」，退出靠 toggleSelectMode 或 Esc） */
  function clearSelection() {
    selectedIds.value = new Set()
  }

  /** 批量态开关：进出都清空选中（选中项只活在批量会话内，避免退出后残留选中与工具条按钮） */
  function toggleSelectMode() {
    selecting.value = !selecting.value
    selectedIds.value = new Set()
  }

  async function batchDelete(entities: Entity[], entityLabel: string): Promise<boolean> {
    const ids = selectedIds.value
    if (ids.size === 0) {
      toastWarn('请先选择要删除的条目')
      return false
    }
    const { confirm } = useConfirm()
    const entityStore = useEntityStore()
    const relationStore = useRelationStore()

    const names = Array.from(ids).map(id => entities.find(e => e.id === id)?.name || '(未知)').join('、')

    // 单弹窗两段式确认（2026-10-02）：原「确认 + 二次确认」两连弹合并——两段警示文案并入
    // 一条描述，确认键第一击武装（变「再次确认删除」）、第二击才执行，取消/ESC 随时退出
    const ok = await confirm({
      type: 'danger',
      title: `批量删除 ${entityLabel}`,
      description: `确定删除以下 ${ids.size} 个${entityLabel}？\n\n${names}\n\n⚠️ 将同时清除相关关系数据，此操作不可撤销。`,
      armedConfirmText: '再次确认删除',
    })
    if (!ok) return false

    try {
      for (const id of ids) {
        await entityStore.remove(id)
      }
      await relationStore.loadAll()
      clearSelection()
      toastSuccess(`已删除 ${ids.size} 个${entityLabel}`)
      return true
    } catch (err) {
      toastError('批量删除失败')
      console.error('[useBatchDelete] error:', err)
      return false
    }
  }

  return {
    selectedIds,
    selecting,
    toggleSelect,
    selectAll,
    clearSelection,
    toggleSelectMode,
    batchDelete,
  }
}
