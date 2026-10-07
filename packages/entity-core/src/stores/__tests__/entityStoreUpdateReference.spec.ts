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

describe('entityStore —— 封面死值归一（properties.coverImage 提升到顶层）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('add 时 properties.coverImage 提升到顶层（AI/模板/导入写手收口）', async () => {
    const store = useEntityStore()
    await store.add({
      id: 'x1', type: 'building', name: 'A', description: '', tags: [],
      properties: { coverImage: 'https://ai.png' }, createdAt: '', updatedAt: '',
    } as never)
    expect(store.entities.find(e => e.id === 'x1')?.coverImage).toBe('https://ai.png')
  })

  it('update：顶层从未设过封面且载荷带 properties.coverImage → 提升', async () => {
    const store = useEntityStore()
    await store.add({
      id: 'x2', type: 'building', name: 'A', description: '', tags: [],
      properties: {}, createdAt: '', updatedAt: '',
    } as never)
    await store.update('x2', { properties: { coverImage: 'https://ai.png' } })
    expect(store.entities.find(e => e.id === 'x2')?.coverImage).toBe('https://ai.png')
  })

  it('显式移除（coverImage 空串）后，properties 旧副本不回填', async () => {
    const store = useEntityStore()
    await store.add({
      id: 'x3', type: 'building', name: 'A', description: '', tags: [],
      properties: { coverImage: 'https://old.png' }, createdAt: '', updatedAt: '',
    } as never)
    expect(store.entities.find(e => e.id === 'x3')?.coverImage).toBe('https://old.png')

    await store.update('x3', { coverImage: '' })
    expect(store.entities.find(e => e.id === 'x3')?.coverImage).toBe('')

    // AI 再携带 properties 旧副本更新 → 顶层从未设过？不——曾设过（后被清空），不回填
    await store.update('x3', { properties: { coverImage: 'https://old.png' } })
    expect(store.entities.find(e => e.id === 'x3')?.coverImage).toBe('')
  })
})
