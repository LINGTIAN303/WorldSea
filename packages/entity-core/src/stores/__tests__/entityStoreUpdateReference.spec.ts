// entityStore.update 按引用替换守卫（2026-10-05）：底座 useShallowArray 是浅响应，
// updateById 若原地 Object.assign，属性级变更对 Vue 不可见（卡片封面等不实时刷新）。
// 锁定契约：update 后数组里是**新对象**、旧对象不被改写、entityMap 同步指向新对象。
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { useEntityStore } from '../entityStore'

describe('entityStore.update —— 按引用替换（浅响应语义）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('update 后数组条目是新对象：新值生效、旧对象不被原地改写、entityMap 同步', async () => {
    const store = useEntityStore()
    await store.add({
      id: 'bld-1', type: 'building', name: '黑鸦堡', description: '', tags: [],
      properties: {}, createdAt: '', updatedAt: '',
    } as never)
    const before = store.entities.find(e => e.id === 'bld-1')

    await store.update('bld-1', { coverImage: 'https://x/castle.png' })

    const after = store.entities.find(e => e.id === 'bld-1')
    expect(after).not.toBe(before)
    expect(after?.coverImage).toBe('https://x/castle.png')
    expect(before?.coverImage).toBeUndefined()
    expect(store.entityMap.get('bld-1')).toBe(after)
  })

  it('重复 update 每次都换新引用（连续两次封面变更都可观察）', async () => {
    const store = useEntityStore()
    await store.add({
      id: 'bld-2', type: 'building', name: 'A', description: '', tags: [],
      properties: {}, createdAt: '', updatedAt: '',
    } as never)

    await store.update('bld-2', { coverImage: 'u1' })
    const first = store.entities.find(e => e.id === 'bld-2')
    await store.update('bld-2', { coverImage: 'u2' })
    const second = store.entities.find(e => e.id === 'bld-2')

    expect(first).not.toBe(second)
    expect(second.coverImage).toBe('u2')
  })
})
