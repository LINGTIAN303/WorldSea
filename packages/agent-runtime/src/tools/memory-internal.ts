/**
 * 记忆系统内部函数导出
 *
 * 供 kb-extractor.ts 等内部模块直接访问 localStorage 记忆的加载/保存函数，
 * 不经过 ToolDefinition 的 execute 流程。
 */

const STORAGE_KEY = 'agent_memory'

export interface MemoryEntry {
  key: string
  value: string
  tags: string[]
  timestamp: number
  accessCount: number
  lastAccessedAt: number
}

export function loadMemory(): MemoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const entries: MemoryEntry[] = JSON.parse(raw)
    return entries.map(e => ({
      ...e,
      accessCount: e.accessCount || 0,
      lastAccessedAt: e.lastAccessedAt || e.timestamp,
    }))
  } catch { return [] }
}

export function saveMemory(entries: MemoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {}
}

export function evictIfNeeded(entries: MemoryEntry[]): { kept: MemoryEntry[]; evictedKeys: string[] } {
  const MAX_ENTRIES = 200
  if (entries.length <= MAX_ENTRIES) return { kept: entries, evictedKeys: [] }
  const sorted = [...entries].sort((a, b) => {
    const scoreA = a.accessCount * 10000 + (a.lastAccessedAt / 86400000)
    const scoreB = b.accessCount * 10000 + (b.lastAccessedAt / 86400000)
    return scoreA - scoreB
  })
  const evictedKeys = sorted.slice(0, sorted.length - MAX_ENTRIES).map(e => e.key)
  const kept = sorted.slice(sorted.length - MAX_ENTRIES)
  return { kept, evictedKeys }
}
