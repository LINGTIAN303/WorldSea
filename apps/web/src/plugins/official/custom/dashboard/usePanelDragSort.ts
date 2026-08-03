import { ref, type Ref } from 'vue'
import type { Panel } from './types'

/**
 * 面板内拖拽排序逻辑
 * - dragOverIdx: 当前悬停的目标索引（用于高亮指示）
 * - 拖拽起始索引使用闭包变量，避免无谓的响应式开销
 */
export function usePanelDragSort(
  panels: Ref<Panel[]>,
  savePanels: () => void
) {
  let dragFromIdx = -1
  const dragOverIdx = ref(-1)

  function onDragStart(idx: number, e: DragEvent) {
    dragFromIdx = idx
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
    }
  }

  function onDragOver(idx: number) {
    if (dragFromIdx !== -1 && dragFromIdx !== idx) {
      dragOverIdx.value = idx
    }
  }

  function onDragLeave(idx: number) {
    if (dragOverIdx.value === idx) {
      dragOverIdx.value = -1
    }
  }

  function onDrop(idx: number) {
    if (dragFromIdx !== -1 && dragFromIdx !== idx) {
      const [item] = panels.value.splice(dragFromIdx, 1)
      panels.value.splice(idx, 0, item)
      savePanels()
    }
    dragFromIdx = -1
    dragOverIdx.value = -1
  }

  function onDragEnd() {
    dragFromIdx = -1
    dragOverIdx.value = -1
  }

  return {
    dragOverIdx,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd
  }
}
