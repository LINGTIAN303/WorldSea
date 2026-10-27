import { onBeforeUnmount, onMounted } from 'vue'

/**
 * 形象图编辑器撤销/重做键：捕获阶段优先消费。
 * 编辑器打开期间 Ctrl+Z/Y 归草稿，先于全局 `global.undo`（document 冒泡）执行并阻断传播；
 * 输入框聚焦时同样生效（编辑器内以草稿历史为准）。
 */
export function useMotionHistoryKeys(undo: () => void, redo: () => void) {
  function onHistoryKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (e.isComposing || e.repeat) return
    const key = e.key.toLowerCase()
    if (key === 'z') {
      e.preventDefault()
      e.stopPropagation()
      if (e.shiftKey) redo()
      else undo()
    } else if (key === 'y') {
      e.preventDefault()
      e.stopPropagation()
      redo()
    }
  }

  onMounted(() => window.addEventListener('keydown', onHistoryKey, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onHistoryKey, true))
}
