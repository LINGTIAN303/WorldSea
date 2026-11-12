import type { Entity } from '@worldsea/entity-core'
import type { WorldEntitiesService } from '../../../services'

/**
 * 写作统计（批1）：数据落所属书 `book.properties.writingStats`（每书独立，随实体存储
 * 天然按项目隔离）；未归书章节不计入（挂账说明）。
 * 累加口径 = 章节落库时的净增量 diff（新字数 − 落库前 wordCount），零额外状态；
 * 删字照扣，单日累计 clamp ≥0；保留近 180 天。
 */

export interface WritingStats {
  goal: number
  daily: Record<string, number>
}

export const STATS_RETENTION_DAYS = 180

/** 当日键（本地时区 YYYY-MM-DD，零填充，可直接字符串比较） */
export function statsDayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 读取规范化的 writingStats（容错解析；返回副本，不挂原对象） */
export function readWritingStats(book: Entity | null): WritingStats {
  const raw = book?.properties.writingStats as Partial<WritingStats> | undefined
  const daily: Record<string, number> = {}
  if (raw?.daily && typeof raw.daily === 'object') {
    for (const [k, v] of Object.entries(raw.daily)) {
      if (typeof v === 'number' && Number.isFinite(v)) daily[k] = v
    }
  }
  const goal = typeof raw?.goal === 'number' && Number.isFinite(raw.goal) ? raw.goal : 0
  return { goal, daily }
}

/** 清理保留期外的日键（YYYY-MM-DD 零填充键可直接字典序比较） */
export function pruneOldDays(daily: Record<string, number>, retentionDays: number): void {
  const cutoff = statsDayKey(new Date(Date.now() - retentionDays * 86400000))
  for (const key of Object.keys(daily)) {
    if (key < cutoff) delete daily[key]
  }
}

/**
 * 章节落库时记录净增量（在 es.update 之前取 beforeCount，落库后 wordCount 已被写新）。
 * 内部 await 第二次 update（book），调用方 catch 兜底。
 */
export async function recordChapterDelta(
  es: WorldEntitiesService,
  chapterLive: Entity,
  beforeCount: number,
  newTextLength: number,
): Promise<void> {
  const delta = newTextLength - beforeCount
  if (!delta) return
  const bookId = (chapterLive.properties.bookId as string) || ''
  if (!bookId) return
  const book = es.get(bookId)
  if (!book) return
  const stats = readWritingStats(book)
  const key = statsDayKey()
  stats.daily[key] = Math.max(0, (stats.daily[key] || 0) + delta)
  pruneOldDays(stats.daily, STATS_RETENTION_DAYS)
  await es.update(book.id, { properties: { ...book.properties, writingStats: stats } }, 'user', { skipUndo: true })
}

/** 连续写作天数：从今天往回数有正增量的天；今天没有则从昨天起（避免凌晨清零挫败） */
export function calcStreak(daily: Record<string, number>): number {
  const has = (d: Date) => (daily[statsDayKey(d)] || 0) > 0
  const cursor = new Date()
  if (!has(cursor)) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (has(cursor) && streak < STATS_RETENTION_DAYS) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** 近 n 天的日增量序列（含今天，升序；缺数据的天为 0） */
export function recentDays(daily: Record<string, number>, n: number): Array<{ key: string; words: number }> {
  const out: Array<{ key: string; words: number }> = []
  for (let i = n - 1; i >= 0; i--) {
    const key = statsDayKey(new Date(Date.now() - i * 86400000))
    out.push({ key, words: daily[key] || 0 })
  }
  return out
}
