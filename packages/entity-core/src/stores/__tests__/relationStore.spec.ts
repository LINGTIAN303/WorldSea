/**
 * relationStore.loadAll —— loading 回落护栏（2026-10-23）。
 * 【为什么单独立这个 spec】此前 loadAll 在 storage 拒绝时不会执行 `loading.value = false`，
 * 标志永久留在 true；下游 `useHomeData.waitUntilIdle(() => relationStore.loading)` 会永久等待，
 * 首页骨架常驻（permanent skeleton）。本 spec 钉住：异常向上冒泡 + loading 必须回落 false。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { storage } from '../../core/StorageBackend'
import { useRelationStore } from '../relationStore'

describe('relationStore.loadAll —— 失败时 loading 也要回落', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('storage 拒绝 → loadAll reject，且 loading 回到 false（不永久挂起）', async () => {
    const spy = vi.spyOn(storage, 'getAllRelations').mockRejectedValueOnce(new Error('磁盘读失败'))

    const rs = useRelationStore()
    const pending = rs.loadAll()
    expect(rs.loading).toBe(true) // 装载期间置位

    await expect(pending).rejects.toThrow('磁盘读失败') // 异常不被吞掉，交由调用方处理
    expect(rs.loading).toBe(false) // 关键断言：finally 保证回落
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
