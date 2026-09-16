/**
 * useBoardUndo —— 白板撤销栈（快照式，**独立于实体全局撤销栈**）
 *
 * 【为什么独立】白板是当前唯一的技能入口（原树视图已下线为白板内容），其撤销语义应当是
 * 「白板里的上一步」——包括画布布局（移/增/删容器）与**层级重排**（右栏拖拽改 parentId/order）。
 * 混进实体全局栈会让 Ctrl+Z 撤到别的芽的操作。
 *
 * 【快照内容】`layout`（必带）+ `hierarchy`（大纲节点的 parentId/order 表，体积小）。
 * 布局回放走 useBoardLayout.replaceLayout；层级回放由调用方按 diffHierarchy 写库
 * （内容与结构写入带 `{ skipUndo }`，保证不污染实体栈）。
 *
 * 【用法】离散操作（增删容器/组件、改配置、层级重排）在**变更前**调 record()；
 * 连续操作（拖动）只在**开始时**调 record()，避免每一帧入栈。
 */
import { computed, ref } from 'vue'
import type { OutlineBoardLayout } from '../layoutSchema'

/** 栈深上限（对齐项目画布 maxHistory 惯例） */
export const BOARD_UNDO_LIMIT = 50

export interface BoardSnapshot {
  layout: OutlineBoardLayout
  /** 大纲节点层级（id → parentId/order）；仅层级可能变化时采集 */
  hierarchy?: Record<string, { parentId: string; order: number }>
}

function cloneSnapshot(snap: BoardSnapshot): BoardSnapshot {
  return JSON.parse(JSON.stringify(snap)) as BoardSnapshot
}

export function useBoardUndo(opts: {
  getSnapshot: () => BoardSnapshot
  applySnapshot: (snap: BoardSnapshot) => void
}) {
  const undoStack = ref<BoardSnapshot[]>([])
  const redoStack = ref<BoardSnapshot[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const depth = computed(() => undoStack.value.length)

  /** 变更前打快照；新操作会清空重做栈（标准撤销语义） */
  function record(): void {
    undoStack.value.push(cloneSnapshot(opts.getSnapshot()))
    if (undoStack.value.length > BOARD_UNDO_LIMIT) undoStack.value.shift()
    redoStack.value.length = 0
  }

  function undo(): boolean {
    const prev = undoStack.value.pop()
    if (!prev) return false
    redoStack.value.push(cloneSnapshot(opts.getSnapshot()))
    opts.applySnapshot(cloneSnapshot(prev))
    return true
  }

  function redo(): boolean {
    const next = redoStack.value.pop()
    if (!next) return false
    undoStack.value.push(cloneSnapshot(opts.getSnapshot()))
    opts.applySnapshot(cloneSnapshot(next))
    return true
  }

  /** 切换白板时清空（撤销不跨白板） */
  function clear(): void {
    undoStack.value = []
    redoStack.value = []
  }

  return { canUndo, canRedo, depth, record, undo, redo, clear }
}
