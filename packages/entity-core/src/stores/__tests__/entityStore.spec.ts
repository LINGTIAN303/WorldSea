/**
 * entityStore —— `loadByType` 增量语义护栏（2026-09-18）。
 * 【为什么单独立这个 spec】此前实现是 setAll(getEntitiesByType(type)) 整体替换，加载 A 类型会把其它所有类型实体从内存挤掉（框架级陷阱，实际影响 4 条工作线，表现为「某芽写一次，别的芽实体集体消失」）。
 * 语义已修正为增量，本 spec 把这条语义钉住，防止将来又被"优化"回去。详见 docs/details/注释/packages/entity-core/stores/entityStore.md。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getProjectManager } from '../../core/ProjectManager'
import { storage } from '../../core/StorageBackend'
import { useEntityStore } from '../entityStore'
import type { Entity } from '../../types/entity'

function makeEntity(id: string, type: string, name = id): Entity {
  return {
    id,
    type,
    name,
    description: '',
    properties: {},
    tags: [],
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
  }
}

/** 直接写进 storage（绕过 store），模拟"磁盘上已有这些数据" */
async function seed(entities: Entity[]): Promise<void> {
  for (const e of entities) await storage.putEntity(e)
}

describe('entityStore.loadByType —— 增量语义（不挤掉其它类型）', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await getProjectManager().initialize()
    // 清空磁盘：fake-indexeddb 在同一测试文件内是**共享**的，不清会让上个用例的实体
    // 累积到本用例（表现为「期望 1 个却得到 2 个」这类"假失败"）
    const leftover = await storage.getAllEntities()
    for (const e of leftover) await storage.deleteEntity(e.id)
  })

  it('加载某类型不会挤掉其它类型的实体（本 spec 的核心护栏）', async () => {
    await seed([
      makeEntity('a1', 'character', '角色甲'),
      makeEntity('b1', 'outline_node', '节点乙'),
      makeEntity('c1', 'manuscript', '章节丙'),
    ])
    const es = useEntityStore()
    await es.loadAll()

    const typesAfterLoadAll = new Set(es.entities.map(e => e.type))
    expect(typesAfterLoadAll).toEqual(new Set(['character', 'outline_node', 'manuscript']))

    // 关键断言：按类型加载后，其它类型仍在
    await es.loadByType('character')

    expect(es.entities.map(e => e.id).sort()).toEqual(['a1', 'b1', 'c1'])
    expect(es.entities.filter(e => e.type === 'outline_node')).toHaveLength(1)
    expect(es.entities.filter(e => e.type === 'manuscript')).toHaveLength(1)
  })

  it('该类型以磁盘为准：磁盘上已删除的会从内存移除（删除同步）', async () => {
    await seed([makeEntity('a1', 'character'), makeEntity('a2', 'character')])
    const es = useEntityStore()
    await es.loadAll()
    expect(es.entities.filter(e => e.type === 'character')).toHaveLength(2)

    // 磁盘上删掉 a2，然后按类型加载
    await storage.deleteEntity('a2')
    await es.loadByType('character')

    expect(es.entities.map(e => e.id)).toEqual(['a1'])
  })

  it('该类型的新增会进来（磁盘为准 → 拿到最新）', async () => {
    await seed([makeEntity('a1', 'character')])
    const es = useEntityStore()
    await es.loadAll()

    await storage.putEntity(makeEntity('a3', 'character', '新角色'))
    await es.loadByType('character')

    expect(es.entities.map(e => e.id).sort()).toEqual(['a1', 'a3'])
  })

  it('幂等：连续调用结果一致（不累积、不重复）', async () => {
    await seed([makeEntity('a1', 'character'), makeEntity('b1', 'outline_node')])
    const es = useEntityStore()
    await es.loadAll()

    await es.loadByType('character')
    const once = es.entities.map(e => e.id).sort()
    await es.loadByType('character')
    const twice = es.entities.map(e => e.id).sort()

    expect(twice).toEqual(once)
    expect(new Set(twice).size).toBe(twice.length)
  })

  it('加载一个磁盘上不存在的类型 → 其它类型不受影响，且不抛错', async () => {
    await seed([makeEntity('a1', 'character')])
    const es = useEntityStore()
    await es.loadAll()

    await es.loadByType('nope_not_exist')

    expect(es.entities.map(e => e.id)).toEqual(['a1'])
  })

  it('无 loadAll 前置（store 为空）也能按类型加载', async () => {
    await seed([makeEntity('a1', 'character'), makeEntity('b1', 'outline_node')])
    const es = useEntityStore()
    expect(es.entities).toHaveLength(0)

    await es.loadByType('character')
    expect(es.entities.map(e => e.id)).toEqual(['a1'])

    // 再加载另一类型 → 两类都在（这正是增量语义相对旧行为的关键差异）
    await es.loadByType('outline_node')
    expect(es.entities.map(e => e.id).sort()).toEqual(['a1', 'b1'])
  })

  it('typeCounts 与 entities 保持一致（索引不被"挤掉"）', async () => {
    await seed([makeEntity('a1', 'character'), makeEntity('b1', 'outline_node')])
    const es = useEntityStore()
    await es.loadAll()
    await es.loadByType('character')

    expect(es.typeCounts.get('character')).toBe(1)
    expect(es.typeCounts.get('outline_node')).toBe(1)
  })

  it('loadAll 仍是全量替换（不受本次改动影响）', async () => {
    await seed([makeEntity('a1', 'character'), makeEntity('b1', 'outline_node')])
    const es = useEntityStore()
    await es.loadByType('character')
    expect(es.entities).toHaveLength(1)

    await es.loadAll()
    expect(es.entities).toHaveLength(2)
  })
})
