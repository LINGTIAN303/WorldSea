import { ref } from 'vue'
import type { Entity, Relation } from '../types'

type StoreType = 'entity' | 'relation'
type ActionType = 'add' | 'update' | 'delete'

interface UndoEntry {
  type: StoreType
  action: ActionType
  id: string
  before: any | null
  after: any | null
  description?: string
}

interface UndoGroup {
  entries: UndoEntry[]
  description?: string
  timestamp?: number
}

const undoStack = ref<UndoGroup[]>([])
const redoStack = ref<UndoGroup[]>([])

let transactionDepth = 0
let currentEntries: UndoEntry[] = []
let currentDescription: string | undefined

let _getMaxHistory: (() => number) | null = null

export function setUndoHistoryProvider(fn: () => number): void {
  _getMaxHistory = fn
}

function getMaxHistory(): number {
  if (_getMaxHistory) return _getMaxHistory()
  return 20
}

function record(type: StoreType, action: ActionType, id: string, before: any | null, after: any | null, description?: string) {
  const entry: UndoEntry = { type, action, id, before, after, description }

  if (transactionDepth > 0) {
    currentEntries.push(entry)
  } else {
    undoStack.value.push({ entries: [entry], timestamp: Date.now() })
    const maxHistory = getMaxHistory()
    while (undoStack.value.length > maxHistory) undoStack.value.shift()
  }

  redoStack.value = []
}

export let isUndoing = false

function beginTransaction() {
  if (transactionDepth === 0) {
    currentEntries = []
    currentDescription = undefined
  }
  transactionDepth++
}

function commitTransaction(description?: string) {
  transactionDepth--
  if (transactionDepth === 0 && currentEntries.length > 0) {
    undoStack.value.push({ entries: currentEntries, description: description || currentDescription, timestamp: Date.now() })
    const maxHistory = getMaxHistory()
    while (undoStack.value.length > maxHistory) undoStack.value.shift()
    currentEntries = []
    currentDescription = undefined
  }
}

function rollbackTransaction() {
  transactionDepth--
  if (transactionDepth === 0) {
    currentEntries = []
    currentDescription = undefined
  }
}

/**
 * 逆操作：给定一个 entry，生成其反向操作。
 * 用于两阶段撤销中预计算所有逆操作。
 */
function invertEntry(entry: UndoEntry): {
  execute: (entityStore: any, relationStore: any) => Promise<unknown>
  rollback: (entityStore: any, relationStore: any) => Promise<unknown>
} {
  const store = (type: StoreType, es: any, rs: any) => type === 'entity' ? es : rs

  if (entry.action === 'add') {
    // 逆操作：删除 → 回滚：重新添加
    return {
      execute: async (es, rs) => store(entry.type, es, rs).remove(entry.id),
      rollback: async (es, rs) => {
        if (entry.after) {
          const data = { ...entry.after, id: entry.id }
          await store(entry.type, es, rs).add(data)
        }
      },
    }
  } else if (entry.action === 'delete' && entry.before) {
    // 逆操作：恢复 → 回滚：重新删除
    const data = { ...entry.before, id: entry.id }
    return {
      execute: async (es, rs) => {
        await store(entry.type, es, rs).add(data)
        // Undo 恢复删除时，从回收站移除对应条目
        if (entry.type === 'entity') {
          try {
            const { useTrashStore } = await import('../stores/trashStore')
            const trashStore = useTrashStore()
            const trashItem = trashStore.items.find(
              i => i.entityType === 'entity' && (i.data as any).id === entry.id,
            )
            if (trashItem) {
              // 同时移除关联的关系回收站条目
              if (trashItem.cascadedRelationIds) {
                for (const relId of trashItem.cascadedRelationIds) {
                  const relTrash = trashStore.items.find(
                    ri => ri.entityType === 'relation' && (ri.data as any).id === relId,
                  )
                  if (relTrash) trashStore.permanentDelete(relTrash.id)
                }
              }
              trashStore.permanentDelete(trashItem.id)
            }
          } catch { /* 回收站清理失败不影响主流程 */ }
        } else if (entry.type === 'relation') {
          try {
            const { useTrashStore } = await import('../stores/trashStore')
            const trashStore = useTrashStore()
            const trashItem = trashStore.items.find(
              i => i.entityType === 'relation' && (i.data as any).id === entry.id,
            )
            if (trashItem) trashStore.permanentDelete(trashItem.id)
          } catch { /* 回收站清理失败不影响主流程 */ }
        }
      },
      rollback: async (es, rs) => store(entry.type, es, rs).remove(entry.id),
    }
  } else if (entry.action === 'update' && entry.before) {
    // 逆操作：恢复旧值 → 回滚：重新应用新值
    return {
      execute: async (es, rs) => store(entry.type, es, rs).update(entry.id, entry.before),
      rollback: async (es, rs) => {
        if (entry.after) {
          await store(entry.type, es, rs).update(entry.id, entry.after)
        }
      },
    }
  }

  // 空操作（不应到达）
  return {
    execute: async () => {},
    rollback: async () => {},
  }
}

async function undo(
  entityStore: { add: (e: Entity) => Promise<unknown>; update: (id: string, data: Partial<Entity>) => Promise<unknown>; remove: (id: string) => Promise<unknown> },
  relationStore: { add: (r: Relation) => Promise<unknown>; update: (id: string, data: Partial<Relation>) => Promise<unknown>; remove: (id: string) => Promise<unknown> }
) {
  const group = undoStack.value.pop()
  if (!group) return false

  // 先将 group 放入 redoStack（两阶段完成后才是最终状态）
  redoStack.value.push(group)
  isUndoing = true

  // 预计算所有逆操作（逆序）
  const ops = group.entries.slice().reverse().map(e => invertEntry(e))

  // 两阶段执行：阶段1 — 执行所有逆操作，记录已成功的
  const executed: typeof ops = []
  try {
    for (const op of ops) {
      await op.execute(entityStore, relationStore)
      executed.push(op)
    }
  } catch (e) {
    // 阶段2 — 执行失败的回滚：逆序回滚已成功的操作
    console.error('[UndoRedo] 撤销操作失败，正在回滚:', e)
    for (let i = executed.length - 1; i >= 0; i--) {
      try {
        await executed[i].rollback(entityStore, relationStore)
      } catch (rollbackErr) {
        console.error('[UndoRedo] 回滚操作也失败，数据可能不一致:', rollbackErr)
      }
    }
    // 回滚栈状态：将 group 从 redoStack 移回 undoStack
    redoStack.value.pop()
    undoStack.value.push(group)
    isUndoing = false
    throw new Error(`撤销操作失败，已回滚所有变更: ${e instanceof Error ? e.message : String(e)}`)
  }

  isUndoing = false
  return true
}

async function redo(
  entityStore: { add: (e: Entity) => Promise<unknown>; update: (id: string, data: Partial<Entity>) => Promise<unknown>; remove: (id: string) => Promise<unknown> },
  relationStore: { add: (r: Relation) => Promise<unknown>; update: (id: string, data: Partial<Relation>) => Promise<unknown>; remove: (id: string) => Promise<unknown> }
) {
  const group = redoStack.value.pop()
  if (!group) return false

  undoStack.value.push(group)
  isUndoing = true

  // 预计算所有重做操作
  const ops = group.entries.map(e => {
    const store = (type: StoreType, es: any, rs: any) => type === 'entity' ? es : rs
    if (e.action === 'add' && e.after) {
      return {
        execute: async (es: any, rs: any) => store(e.type, es, rs).add({ ...e.after, id: e.id }),
        rollback: async (es: any, rs: any) => store(e.type, es, rs).remove(e.id),
      }
    } else if (e.action === 'delete') {
      return {
        execute: async (es: any, rs: any) => store(e.type, es, rs).remove(e.id),
        rollback: async (es: any, rs: any) => {
          if (e.before) await store(e.type, es, rs).add({ ...e.before, id: e.id })
        },
      }
    } else if (e.action === 'update' && e.after) {
      return {
        execute: async (es: any, rs: any) => store(e.type, es, rs).update(e.id, e.after),
        rollback: async (es: any, rs: any) => {
          if (e.before) await store(e.type, es, rs).update(e.id, e.before)
        },
      }
    }
    return {
      execute: async () => {},
      rollback: async () => {},
    }
  })

  // 两阶段执行
  const executed: typeof ops = []
  try {
    for (const op of ops) {
      await op.execute(entityStore, relationStore)
      executed.push(op)
    }
  } catch (e) {
    console.error('[UndoRedo] 重做操作失败，正在回滚:', e)
    for (let i = executed.length - 1; i >= 0; i--) {
      try {
        await executed[i].rollback(entityStore, relationStore)
      } catch (rollbackErr) {
        console.error('[UndoRedo] 回滚操作也失败，数据可能不一致:', rollbackErr)
      }
    }
    // 回滚栈状态
    undoStack.value.pop()
    redoStack.value.push(group)
    isUndoing = false
    throw new Error(`重做操作失败，已回滚所有变更: ${e instanceof Error ? e.message : String(e)}`)
  }

  isUndoing = false
  return true
}

function getUndoDescription(group: UndoGroup): string {
  if (group.description) return group.description
  const entries = group.entries
  if (entries.length === 1) {
    const e = entries[0]
    const actionText = e.action === 'add' ? '添加' : e.action === 'delete' ? '删除' : '更新'
    const typeText = e.type === 'entity' ? '实体' : '关系'
    return `${actionText}${typeText}${e.description ? '「' + e.description + '」' : ''}`
  }
  return `${entries.length} 个操作`
}

export function useUndoRedo() {
  return {
    undoStack,
    redoStack,
    record,
    undo,
    redo,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    getUndoDescription,
  }
}
