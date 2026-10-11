/**
 * localStorage 防抖写入。同一 key 在防抖窗口内多次写入只执行最后一次。
 * 读取时优先返回内存中最新值。
 */
export function createDebouncedStorage(options?: {
  debounce?: number
}): {
  set: (key: string, value: any) => void
  get: <T = any>(key: string) => T | null
  remove: (key: string) => void
  flush: () => void
  cancel: () => void
} {
  const debounce = options?.debounce ?? 100
  const pending = new Map<string, { value: any; timer: ReturnType<typeof setTimeout> }>()

  function set(key: string, value: any) {
    const existing = pending.get(key)
    if (existing) clearTimeout(existing.timer)

    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value))
      } catch (e) {
        console.warn('[debouncedStorage] write failed:', e)
      }
      pending.delete(key)
    }, debounce)

    pending.set(key, { value, timer })
  }

  function get<T = any>(key: string): T | null {
    const entry = pending.get(key)
    if (entry) return entry.value as T
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }

  function remove(key: string) {
    const entry = pending.get(key)
    if (entry) {
      clearTimeout(entry.timer)
      pending.delete(key)
    }
    localStorage.removeItem(key)
  }

  function flush() {
    for (const [key, entry] of pending) {
      clearTimeout(entry.timer)
      try {
        localStorage.setItem(key, JSON.stringify(entry.value))
      } catch (e) {
        console.warn('[debouncedStorage] flush write failed:', e)
      }
    }
    pending.clear()
  }

  function cancel() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
    }
    pending.clear()
  }

  return { set, get, remove, flush, cancel }
}
