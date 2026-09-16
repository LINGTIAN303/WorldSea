/**
 * useBoardSelection —— 白板选中态（选中粒度 = 容器）
 *
 * 规格：组件不单独选中（编辑器交互规格 §五）；单选为首版范围，多选/框选挂账。
 * 独立成模块是为了让「选中」在画布、右栏、工具条之间共享同一份真相。
 */
import { computed, ref } from 'vue'

export function useBoardSelection() {
  const selectedId = ref<string | null>(null)

  const hasSelection = computed(() => !!selectedId.value)

  function select(containerId: string | null): void {
    selectedId.value = containerId
  }

  function clear(): void {
    selectedId.value = null
  }

  function isSelected(containerId: string): boolean {
    return selectedId.value === containerId
  }

  /** 容器被删除后调用：避免选中态指向已不存在的容器 */
  function dropIfMissing(existingIds: Set<string>): void {
    if (selectedId.value && !existingIds.has(selectedId.value)) selectedId.value = null
  }

  return { selectedId, hasSelection, select, clear, isSelected, dropIfMissing }
}
