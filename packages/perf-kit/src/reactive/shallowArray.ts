import { shallowRef, triggerRef, type ShallowRef } from 'vue'

/**
 * shallowRef 数组操作工具，避免 .filter()/.map() 创建新数组。
 * 直接修改原数组 + triggerRef，减少响应式开销。
 */
export function useShallowArray<T extends Record<string, any>>(
  keyField: keyof T & string
): {
  items: ShallowRef<T[]>
  setAll: (newItems: T[]) => void
  push: (item: T) => void
  unshift: (item: T) => void
  removeById: (id: T[keyof T]) => void
  updateById: (id: T[keyof T], changes: Partial<T>) => void
  indexOf: (id: T[keyof T]) => number
  findById: (id: T[keyof T]) => T | undefined
  /** 手动触发响应式更新（直接修改 items.value 后调用） */
  trigger: () => void
} {
  const items = shallowRef<T[]>([]) as ShallowRef<T[]>

  function setAll(newItems: T[]) {
    items.value = newItems
  }

  function push(item: T) {
    items.value.push(item)
    triggerRef(items)
  }

  function unshift(item: T) {
    items.value.unshift(item)
    triggerRef(items)
  }

  function removeById(id: T[keyof T]) {
    const idx = items.value.findIndex((e) => (e as any)[keyField] === id)
    if (idx !== -1) {
      items.value.splice(idx, 1)
      triggerRef(items)
    }
  }

  function updateById(id: T[keyof T], changes: Partial<T>) {
    const idx = items.value.findIndex((e) => (e as any)[keyField] === id)
    if (idx !== -1) {
      // 浅响应的正确语义是**按引用替换**：shallowRef 不代理对象属性，原地 Object.assign
      // 对 Vue 不可见（triggerRef 只能让 v-for 重跑，props 同引用会被子组件跳过——
      // 卡片封面等属性级更新全部失灵）。替换成本一次对象展开，可忽略。
      items.value[idx] = { ...items.value[idx], ...changes }
      triggerRef(items)
    }
  }

  function indexOf(id: T[keyof T]): number {
    return items.value.findIndex((e) => (e as any)[keyField] === id)
  }

  function findById(id: T[keyof T]): T | undefined {
    return items.value.find((e) => (e as any)[keyField] === id)
  }

  function trigger() {
    triggerRef(items)
  }

  return { items, setAll, push, unshift, removeById, updateById, indexOf, findById, trigger }
}
