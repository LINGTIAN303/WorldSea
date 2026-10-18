/**
 * outlineLateral 单测 —— 节点 ↔ 节点横向关系（2026-10-18 Q3-A）
 *
 * 护栏重点（三条容易写错的规则）：
 *   ① 对称关系（并列 / 对比）判重与删除都要**双向**看；递进只认正向。
 *   ② 自连与非横向类型必须被拒（不静默回退）。
 *   ③ 注册面：三型存在，并列/对比 inverse 自指，递进 inverse 是「承接」。
 */
import { describe, it, expect } from 'vitest'
import { relationshipRegistry } from '@worldsea/entity-core'
import {
  OUTLINE_LATERAL_RELATION,
  hasOutlineLateral,
  lateralRelationKeyOf,
  lateralRelationsOf,
  linkOutlineLateral,
  unlinkOutlineLateral,
  type OutlineLinkStore,
} from '@/entity/outlineLinks'

function rel(type: string, sourceId: string, targetId: string, id = `${type}-${sourceId}-${targetId}`) {
  return { id, type, sourceId, targetId, properties: {}, createdAt: '', updatedAt: '' } as never
}

/** 最小 store 替身：内存数组 + 记录调用 */
function makeStore(seed: never[] = []) {
  const rows = [...seed]
  const store: OutlineLinkStore & { rows: typeof rows } = {
    rows,
    async getAllRelations() { return rows },
    async add(r) { rows.push(r as never); return (r as { id: string }).id },
    async remove(id) {
      const i = rows.findIndex(x => (x as { id: string }).id === id)
      if (i >= 0) rows.splice(i, 1)
    },
  }
  return store
}

describe('OUTLINE_LATERAL_RELATION 常量', () => {
  it('三条简写与全名一一对应', () => {
    expect(OUTLINE_LATERAL_RELATION).toEqual({
      parallel: 'outline_parallel',
      progressive: 'outline_progressive',
      contrast: 'outline_contrast',
    })
  })

  it('全名 → 简写；未知返回 null（不回退默认值）', () => {
    expect(lateralRelationKeyOf('outline_progressive')).toBe('progressive')
    expect(lateralRelationKeyOf('outline_mentions')).toBeNull()
    expect(lateralRelationKeyOf('')).toBeNull()
  })
})

describe('注册面（entity-core）', () => {
  it('三型均已注册，且标签正确', () => {
    expect(relationshipRegistry.get('outline_parallel')?.label).toBe('并列')
    expect(relationshipRegistry.get('outline_progressive')?.label).toBe('递进')
    expect(relationshipRegistry.get('outline_contrast')?.label).toBe('对比')
  })

  it('并列 / 对比为对称关系（inverse 自指）', () => {
    for (const t of ['outline_parallel', 'outline_contrast']) {
      const s = relationshipRegistry.get(t)!
      expect(s.symmetric).toBe(true)
      expect(s.inverseType).toBe(t)
    }
  })

  it('递进有向，inverse = 承接（自动注册）', () => {
    const s = relationshipRegistry.get('outline_progressive')!
    expect(s.symmetric).toBe(false)
    expect(s.inverseType).toBe('outline_progressed_from')
    expect(relationshipRegistry.get('outline_progressed_from')?.label).toBe('承接')
  })

  it('源与目标都限定为 outline_node（不得连到其它芽实体）', () => {
    for (const t of Object.values(OUTLINE_LATERAL_RELATION)) {
      const s = relationshipRegistry.get(t)!
      expect(s.sourceTypes).toEqual(['outline_node'])
      expect(s.targetTypes).toEqual(['outline_node'])
    }
  })
})

describe('lateralRelationsOf（方向不敏感）', () => {
  it('取正向与反向两条，忽略其它关系类型', () => {
    const rows = [
      rel('outline_parallel', 'a', 'b'),
      rel('outline_progressive', 'c', 'a'),
      rel('outline_mentions', 'a', 'x'),
    ]
    const hits = lateralRelationsOf(rows, 'a')
    expect(hits.map(r => r.type)).toEqual(['outline_parallel', 'outline_progressive'])
  })

  it('其它节点的关系不返回', () => {
    expect(lateralRelationsOf([rel('outline_contrast', 'b', 'c')], 'a')).toEqual([])
  })
})

describe('hasOutlineLateral（对称双向 / 递进单向）', () => {
  it('并列：正向或反向都算已存在', () => {
    expect(hasOutlineLateral([rel('outline_parallel', 'a', 'b')], 'b', 'a', 'outline_parallel')).toBe(true)
  })

  it('递进：反向不算已存在', () => {
    expect(hasOutlineLateral([rel('outline_progressive', 'a', 'b')], 'b', 'a', 'outline_progressive')).toBe(false)
  })
})

describe('linkOutlineLateral', () => {
  it('创建成功并写入一条关系（source = 当前节点）', async () => {
    const store = makeStore()
    await expect(linkOutlineLateral(store, 'a', 'b', 'outline_parallel')).resolves.toBe('created')
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({ type: 'outline_parallel', sourceId: 'a', targetId: 'b' })
  })

  it('幂等：对称关系反向已存在时不重复写', async () => {
    const store = makeStore([rel('outline_contrast', 'b', 'a')] as never[])
    await expect(linkOutlineLateral(store, 'a', 'b', 'outline_contrast')).resolves.toBe('exists')
    expect(store.rows).toHaveLength(1)
  })

  it('递进：反向已存在时仍可正向新建（有向关系的两条独立语义）', async () => {
    const store = makeStore([rel('outline_progressive', 'b', 'a')] as never[])
    await expect(linkOutlineLateral(store, 'a', 'b', 'outline_progressive')).resolves.toBe('created')
    expect(store.rows).toHaveLength(2)
  })

  it('拒绝自连', async () => {
    const store = makeStore()
    await expect(linkOutlineLateral(store, 'a', 'a', 'outline_parallel')).resolves.toBe('missing-entity')
    expect(store.rows).toHaveLength(0)
  })

  it('拒绝非横向类型（不静默回退）', async () => {
    const store = makeStore()
    await expect(linkOutlineLateral(store, 'a', 'b', 'outline_mentions')).resolves.toBe('unknown-relation')
    expect(store.rows).toHaveLength(0)
  })
})

describe('unlinkOutlineLateral', () => {
  it('对称关系：反向存储也能删掉', async () => {
    const store = makeStore([rel('outline_parallel', 'b', 'a')] as never[])
    await expect(unlinkOutlineLateral(store, 'a', 'b', 'outline_parallel')).resolves.toBe(true)
    expect(store.rows).toHaveLength(0)
  })

  it('递进：反向调用不删正向那条', async () => {
    const store = makeStore([rel('outline_progressive', 'a', 'b')] as never[])
    await expect(unlinkOutlineLateral(store, 'b', 'a', 'outline_progressive')).resolves.toBe(false)
    expect(store.rows).toHaveLength(1)
  })

  it('不存在时返回 false（幂等）', async () => {
    const store = makeStore()
    await expect(unlinkOutlineLateral(store, 'a', 'b', 'outline_contrast')).resolves.toBe(false)
  })
})
