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
  /** C3：重要性评分（0-1，加权融合排序因子）。存储时由 inferImportance 推断，旧数据缺省 0.5 */
  importance: number
}

/**
 * C3：按 key 关键词规则推断记忆重要性（0-1）
 *
 * - 命中高价值词（偏好/规则/决策/约束/世界观/项目等）→ 0.8
 * - 命中中价值词（风格/语气/约定/魔法等）→ 0.65
 * - 其余默认 0.5
 *
 * 供 memory_store 存储时自动标注；LLM 需精准控制时可在调用时显式传 importance 覆盖。
 */
export function inferImportance(key: string): number {
  const k = key.toLowerCase()
  const high = [
    'prefer', 'preference', '偏好',
    'setting', '设定', 'rule', '规则',
    'decision', '决策', 'constraint', '约束',
    'world', 'worldview', '世界观', 'project', '项目',
    'important', '重要', '关键',
  ]
  const mid = ['style', '风格', 'tone', '语气', 'convention', '约定', 'magic', '魔法']
  if (high.some(w => k.includes(w))) return 0.8
  if (mid.some(w => k.includes(w))) return 0.65
  return 0.5
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
      // C3：旧数据无 importance 字段，默认 0.5
      importance: e.importance ?? 0.5,
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
