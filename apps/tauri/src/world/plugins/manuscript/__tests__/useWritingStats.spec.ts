/**
 * 写作统计测试（批1）：锁定 diff 累加口径——净增量可负、单日 clamp ≥0、
 * 未归书章节不计入、180 天过期键清理、book 写入带 skipUndo（随自动保存，不进撤销栈）。
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { createPinia, type Pinia } from 'pinia'
import 'fake-indexeddb/auto'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import {
  recordChapterDelta, readWritingStats, calcStreak, recentDays,
  statsDayKey, pruneOldDays, STATS_RETENTION_DAYS,
} from '../composables/useWritingStats'
import { installStoreServices } from './storeServices'
import { clearWorldServiceTable } from '../../../service-registry'
import { entitiesSvc } from '../serviceAccess'

function makeEntity(id: string, type: 'book' | 'manuscript', props: Record<string, unknown>): Entity {
  const now = new Date().toISOString()
  return { id, type, name: id, description: '', properties: props, tags: [], createdAt: now, updatedAt: now }
}

describe('写作统计', () => {
  let pinia: Pinia
  let es: ReturnType<typeof useEntityStore>
  type UpdateSpy = MockInstance<
    (id: string, changes: Partial<Entity>, source?: 'user' | 'agent' | 'import', opts?: { skipUndo?: boolean }) => Promise<void>
  >
  let updateSpy: UpdateSpy

  beforeEach(() => {
    pinia = createPinia()
    es = useEntityStore(pinia)
    // 穿透式 spy：记录调用但走真实实现——recordChapterDelta 连续累加依赖 update 真实写回 entityMap
    updateSpy = vi.spyOn(es, 'update')
    // recordChapterDelta 已改收服务对象（批次 H），不起树时必须登记转发服务表
    installStoreServices()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearWorldServiceTable()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('statsDayKey 产出零填充本地日期键', () => {
    expect(statsDayKey(new Date(2026, 9, 27))).toBe('2026-10-27')
    expect(statsDayKey(new Date(2026, 0, 3))).toBe('2026-01-03')
  })

  it('正增量累加进当日（同一日多次落库求和）', async () => {
    await es.add(makeEntity('b1', 'book', {}), 'user')
    await es.add(makeEntity('c1', 'manuscript', { bookId: 'b1', wordCount: 100 }), 'user')
    const live = es.entityMap.get('c1')!
    await recordChapterDelta(entitiesSvc(), live, 100, 600)
    await recordChapterDelta(entitiesSvc(), live, 600, 900)
    const stats = readWritingStats(es.entityMap.get('b1')!)
    expect(stats.daily[statsDayKey()]).toBe(800)
  })

  it('负增量照扣但不低于 0（删字减产，刷不出负数日）', async () => {
    await es.add(makeEntity('b2', 'book', { writingStats: { goal: 0, daily: { [statsDayKey()]: 300 } } }), 'user')
    await es.add(makeEntity('c2', 'manuscript', { bookId: 'b2', wordCount: 300 }), 'user')
    const live = es.entityMap.get('c2')!
    await recordChapterDelta(entitiesSvc(), live, 300, 100) // -200 → 100
    await recordChapterDelta(entitiesSvc(), live, 100, 50) // -50 → 50
    expect(readWritingStats(es.entityMap.get('b2')!).daily[statsDayKey()]).toBe(50)
  })

  it('delta 为 0 不产生写入', async () => {
    await es.add(makeEntity('b3', 'book', {}), 'user')
    await es.add(makeEntity('c3', 'manuscript', { bookId: 'b3', wordCount: 10 }), 'user')
    const live = es.entityMap.get('c3')!
    await recordChapterDelta(entitiesSvc(), live, 10, 10)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('未归书章节不计入（bookId 为空直接跳过）', async () => {
    await es.add(makeEntity('c4', 'manuscript', { bookId: '', wordCount: 10 }), 'user')
    const live = es.entityMap.get('c4')!
    await recordChapterDelta(entitiesSvc(), live, 10, 500)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('book 写入带 skipUndo（随自动保存，不进全局撤销栈）', async () => {
    await es.add(makeEntity('b5', 'book', {}), 'user')
    await es.add(makeEntity('c5', 'manuscript', { bookId: 'b5', wordCount: 0 }), 'user')
    const live = es.entityMap.get('c5')!
    await recordChapterDelta(entitiesSvc(), live, 0, 100)
    expect(updateSpy).toHaveBeenCalledWith('b5', expect.anything(), 'user', { skipUndo: true })
  })

  it('pruneOldDays 清理保留期外的日键', () => {
    const daily: Record<string, number> = {
      [statsDayKey(new Date(Date.now() - (STATS_RETENTION_DAYS + 5) * 86400000))]: 999,
      [statsDayKey()]: 100,
    }
    pruneOldDays(daily, STATS_RETENTION_DAYS)
    expect(Object.keys(daily).length).toBe(1)
    expect(daily[statsDayKey()]).toBe(100)
  })

  it('calcStreak：今天有从今天数，今天没有从昨天数（凌晨不清零）', () => {
    const today = statsDayKey()
    const yesterday = statsDayKey(new Date(Date.now() - 86400000))
    expect(calcStreak({ [today]: 100, [yesterday]: 200 })).toBe(2)
    expect(calcStreak({ [yesterday]: 200 })).toBe(1)
    expect(calcStreak({})).toBe(0)
    expect(calcStreak({ [today]: 0 })).toBe(0) // 0 字不算有效写作日
  })

  it('recentDays 输出含今天的升序 n 天序列', () => {
    const seq = recentDays({ [statsDayKey()]: 42 }, 14)
    expect(seq.length).toBe(14)
    expect(seq.at(-1)?.words).toBe(42)
    expect(seq[0].words).toBe(0)
  })
})
