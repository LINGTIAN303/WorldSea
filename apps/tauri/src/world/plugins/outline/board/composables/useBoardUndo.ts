/**
 * useBoardUndo —— 白板撤销栈（**独立于实体全局撤销栈**）
 *
 * 【为什么独立】白板是当前唯一的技能入口（原树视图已下线为白板内容），其撤销语义应当是
 * 「白板里的上一步」。混进实体全局栈会让 Ctrl+Z 撤到别的芽的操作。
 *
 * 【三类条目（编辑器交互规格 §六「布局操作 + 内容写入统一单步」）】
 * · `snapshot`：布局体 + 大纲节点层级表。用于「移动/缩放/增删容器与区/改配置/层级重排」。
 * · `field`   ：**单节点字段的前后值**。用于「就地编辑」（标题式改名、句子式改描述…）。
 *   内容改动若也走快照，每步都要复制整份节点字段表（句子式描述可达上百字 × 数百节点），
 *   故用差分条目：一次编辑会话只入栈一步、只存一个字段的前后值。
 * · `entities`：**实体删除**（2026-10-19）。删除节点会同时改实体、关系、章节绑定与布局，
 *   单靠布局快照撤不回来；该条目带被删对象完整数据 + 删除前后的两份布局快照，
 *   使「Ctrl+Z 一次」能把节点、关系、章节关联与容器一起恢复。
 *
 * 【用法】离散操作在**变更前**调 `record()`；连续操作（拖动）只在**开始时**调 `record()`；
 * 就地编辑在**提交后**调 `recordContentEdit()`；删除节点在**删除前**调 `recordEntityDelete()`。
 * 内容写入本身仍带 `{ skipUndo }` 落库，实体全局栈不受污染。
 *
 * 【异步】`undo` / `redo` 返回 Promise —— `entities` 条目要重建实体与关系（store 是异步的）。
 * 两个同步条目不受影响，调用方可 `void` 或 `await`。
 */
import { computed, inject, provide, ref, type InjectionKey } from 'vue'
import type { Entity, Relation } from '@worldsea/entity-core'
import type { OutlineBoardLayout } from '../layoutSchema'

/** 栈深上限（对齐项目画布 maxHistory 惯例） */
export const BOARD_UNDO_LIMIT = 50

export interface BoardSnapshot {
  layout: OutlineBoardLayout
  /** 大纲节点层级（id → parentId/order）；仅层级可能变化时采集 */
  hierarchy?: Record<string, { parentId: string; order: number }>
}

/** 实体删除条目：被删对象的完整数据 + 删除前后的布局（撤销/重做各用一份） */
export interface EntityDeletePayload {
  nodes: Entity[]
  relations: Relation[]
  /** 章节 ↔ 节点绑定（撤销时按此重建章节侧 outlineNodeId） */
  chapterLinks: Array<{ chapterId: string; nodeId: string }>
  /** 非删除但被改动的节点（提升为根 / 转移到其它节点时改过 parentId/order）→ 撤销时写回 */
  restoreNodes?: Array<{ id: string; properties: Record<string, unknown> }>
  /** 删除前的布局（撤销 → 恢复到这份） */
  before: BoardSnapshot
  /** 删除后的布局（重做 → 恢复到这份） */
  after: BoardSnapshot
}

export type UndoEntry =
  | { kind: 'snapshot'; snapshot: BoardSnapshot }
  | {
    kind: 'field'
    nodeId: string
    /** 变更前字段值（撤销时写回） */
    prev: Record<string, unknown>
    /** 变更后字段值（重做时写回） */
    next: Record<string, unknown>
    /** 用于状态提示的可选标签，如「改名」 */
    label?: string
  }
  | { kind: 'entities'; payload: EntityDeletePayload }

function cloneSnapshot(snap: BoardSnapshot): BoardSnapshot {
  return JSON.parse(JSON.stringify(snap)) as BoardSnapshot
}

function cloneEntry(entry: UndoEntry): UndoEntry {
  return JSON.parse(JSON.stringify(entry)) as UndoEntry
}

/** 浅比较（字段值均为标量，浅比较足够；避免「点开又关掉」也占一步） */
function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => a[k] === b[k])
}

export interface BoardUndoOptions {
  getSnapshot: () => BoardSnapshot
  applySnapshot: (snap: BoardSnapshot) => void
  /** 回放字段条目：写入节点字段（调用方须带 skipUndo） */
  applyField?: (nodeId: string, values: Record<string, unknown>) => void
  /** 撤销删除：重建实体 + 关系 + 章节绑定（调用方负责实现，通常走 es/rs/chapterLink） */
  restoreEntities?: (payload: EntityDeletePayload) => Promise<void>
  /** 重做删除：再次删除这些实体（调用方负责实现） */
  removeEntities?: (payload: EntityDeletePayload) => Promise<void>
}

export function useBoardUndo(opts: BoardUndoOptions) {
  const undoStack = ref<UndoEntry[]>([])
  const redoStack = ref<UndoEntry[]>([])

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const depth = computed(() => undoStack.value.length)

  function pushEntry(entry: UndoEntry): void {
    undoStack.value.push(entry)
    if (undoStack.value.length > BOARD_UNDO_LIMIT) undoStack.value.shift()
    redoStack.value.length = 0
  }

  /** 变更前打快照（布局/层级） */
  function record(): void {
    pushEntry({ kind: 'snapshot', snapshot: cloneSnapshot(opts.getSnapshot()) })
  }

  /**
   * 变更后登记一次内容编辑（就地编辑提交时调用）。
   * 前后值相同或 nodeId 缺失则不占栈位。
   */
  function recordContentEdit(
    nodeId: string,
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    label?: string,
  ): void {
    if (!nodeId || shallowEqual(prev, next)) return
    const entry: UndoEntry = { kind: 'field', nodeId, prev: { ...prev }, next: { ...next } }
    if (label) entry.label = label
    pushEntry(entry)
  }

  /**
   * 删除节点前登记（2026-10-19）。
   * 必须在**执行删除之前**调用：`before` 取当前布局；`after` 由调用方在算出「删除后布局」后填入
   * （`useBoardNodeActions` 会先构造两份布局再执行删除）。
   */
  function recordEntityDelete(payload: EntityDeletePayload): void {
    if (!payload.nodes.length) return
    pushEntry({ kind: 'entities', payload: JSON.parse(JSON.stringify(payload)) as EntityDeletePayload })
  }

  async function undo(): Promise<boolean> {
    const entry = undoStack.value.pop()
    if (!entry) return false
    if (entry.kind === 'snapshot') {
      redoStack.value.push({ kind: 'snapshot', snapshot: cloneSnapshot(opts.getSnapshot()) })
      opts.applySnapshot(cloneSnapshot(entry.snapshot))
    } else if (entry.kind === 'field') {
      redoStack.value.push(cloneEntry(entry))
      opts.applyField?.(entry.nodeId, { ...entry.prev })
    } else {
      // 实体删除：布局回到删除前 + 重建节点/关系/章节绑定
      redoStack.value.push(cloneEntry(entry))
      opts.applySnapshot(cloneSnapshot(entry.payload.before))
      await opts.restoreEntities?.(entry.payload)
    }
    return true
  }

  async function redo(): Promise<boolean> {
    const entry = redoStack.value.pop()
    if (!entry) return false
    if (entry.kind === 'snapshot') {
      undoStack.value.push({ kind: 'snapshot', snapshot: cloneSnapshot(opts.getSnapshot()) })
      opts.applySnapshot(cloneSnapshot(entry.snapshot))
    } else if (entry.kind === 'field') {
      undoStack.value.push(cloneEntry(entry))
      opts.applyField?.(entry.nodeId, { ...entry.next })
    } else {
      // 实体删除：布局回到删除后 + 再删一次
      undoStack.value.push(cloneEntry(entry))
      opts.applySnapshot(cloneSnapshot(entry.payload.after))
      await opts.removeEntities?.(entry.payload)
    }
    return true
  }

  /** 切换白板时清空（撤销不跨白板） */
  function clear(): void {
    undoStack.value = []
    redoStack.value = []
  }

  return { canUndo, canRedo, depth, record, recordContentEdit, recordEntityDelete, undo, redo, clear }
}

// ─────────────────────────────────────────────
// 注入通道：形式组件（TitleForm / TreeForm / 句子式…）需要把自己的就地编辑登记进白板栈，
// 但它们层次较深且不应直接依赖装配层，故用 provide/inject 传递一个**极窄接口**。
// ─────────────────────────────────────────────

export interface BoardUndoContext {
  recordContentEdit(
    nodeId: string,
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    label?: string,
  ): void
}

export const BOARD_UNDO_KEY: InjectionKey<BoardUndoContext> = Symbol('worldsea-board-undo')

/** 装配层调用：把白板撤销能力提供给形式组件 */
export function provideBoardUndo(ctx: BoardUndoContext): void {
  provide(BOARD_UNDO_KEY, ctx)
}

/** 形式组件调用：拿不到（如独立单测渲染）时返回 null，调用处需容错 */
export function injectBoardUndo(): BoardUndoContext | null {
  return inject(BOARD_UNDO_KEY, null)
}
