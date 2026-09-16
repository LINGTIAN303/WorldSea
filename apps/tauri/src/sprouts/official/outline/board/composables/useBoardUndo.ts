/**
 * useBoardUndo —— 白板撤销栈（快照式，**独立于实体全局撤销栈**）
 *
 * 【为什么独立】白板操作是「布局 + 视图」性质，实体全局撤销面对的是数据；混在一起会让
 * Ctrl+Z 撤销到别的芽的操作（编辑器交互规格 §六）。内容写入（改 name 等）由各表现形式带
 * `{ skipUndo }` 落库，故其撤销同样由本栈负责——保证「一次 Ctrl+Z 就是用户眼里的上一步」。
 *
 * 【用法】离散操作（增删容器/组件、改配置）在**变更前**调 record()；
 * 连续操作（拖动）只在**开始时**调 record()，避免每一帧都入栈。
 */
import { computed, ref } from 'vue'
import type { OutlineBoardLayout } from '../layoutSchema'

/** 栈深上限（对齐项目画布 maxHistory 惯例） */
export const BOARD_UNDO_LIMIT = 50

function cloneLayout(layout: OutlineBoardLayout): OutlineBoardLayout {
  return JSON.parse(JSON.stringify(layout)) as OutlineBoardLayout
}

export function useBoardUndo(opts: {
  getLayout: () => OutlineBoardLayout
  applyLayout: (layout: OutlineBoardLayout) => void
}) {
  const undoStack = ref<OutlineBoardLayout[]>([])
  const redoStack = ref<OutlineBoardLayout[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const depth = computed(() => undoStack.value.length)

  /** 变更前打快照；新操作会清空重做栈（标准撤销语义） */
  function record(): void {
    undoStack.value.push(cloneLayout(opts.getLayout()))
    if (undoStack.value.length > BOARD_UNDO_LIMIT) undoStack.value.shift()
    redoStack.value.length = 0
  }

  function undo(): boolean {
    const prev = undoStack.value.pop()
    if (!prev) return false
    redoStack.value.push(cloneLayout(opts.getLayout()))
    opts.applyLayout(cloneLayout(prev))
    return true
  }

  function redo(): boolean {
    const next = redoStack.value.pop()
    if (!next) return false
    undoStack.value.push(cloneLayout(opts.getLayout()))
    opts.applyLayout(cloneLayout(next))
    return true
  }

  /** 切换白板时清空（撤销不跨白板） */
  function clear(): void {
    undoStack.value = []
    redoStack.value = []
  }

  return { canUndo, canRedo, depth, record, undo, redo, clear }
}
