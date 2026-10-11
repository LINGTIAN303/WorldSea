import { shallowRef, triggerRef, type ShallowRef } from 'vue'

/**
 * 维护一个 shallowRef<Map> 索引，支持增量更新。
 * 替代 computed(() => new Map(...)) 模式，避免每次重建 Map。
 */
export function useShallowRefMap<K, V>(): {
  map: ShallowRef<Map<K, V>>
  set: (key: K, value: V) => void
  delete: (key: K) => void
  replaceAll: (entries: Iterable<[K, V]>) => void
  get: (key: K) => V | undefined
  has: (key: K) => boolean
  clear: () => void
} {
  const map = shallowRef<Map<K, V>>(new Map())

  function set(key: K, value: V) {
    map.value.set(key, value)
    triggerRef(map)
  }

  function delete_(key: K) {
    map.value.delete(key)
    triggerRef(map)
  }

  function replaceAll(entries: Iterable<[K, V]>) {
    map.value = new Map(entries)
  }

  function get(key: K): V | undefined {
    return map.value.get(key)
  }

  function has(key: K): boolean {
    return map.value.has(key)
  }

  function clear() {
    map.value = new Map()
  }

  return { map, set, delete: delete_, replaceAll, get, has, clear }
}
