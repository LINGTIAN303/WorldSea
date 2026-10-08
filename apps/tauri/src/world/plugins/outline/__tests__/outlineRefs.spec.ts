/**
 * outlineRefs 单测 —— 关联实体徽章的分组逻辑（全纯函数）。
 *
 * 语义来源：旧树视图的「关联实体徽章组」（按类型聚合、点击跳转）。这里的护栏重点是
 * **三条容易写错的分组规则**：方向不敏感 / 同实体去重但保留多条关系类型 / 孤儿关系丢弃。
 */
import { describe, it, expect } from 'vitest'
import { relationshipRegistry, relationSchemaRegistry } from '@worldsea/entity-core'
import {
  groupOutlineRefs,
  pickRefRelationTypes,
  refRelationsOf,
  refRelationTypesForTarget,
  refTargetTypes,
  totalRefCount,
  type RefEntityLike,
} from '../board/forms/outlineRefs'

const REF_TYPES = ['outline_mentions', 'outline_located_in', 'outline_covers']

function rel(type: string, sourceId: string, targetId: string, id = `${type}-${sourceId}-${targetId}`) {
  return {
    id,
    type,
    sourceId,
    targetId,
    properties: {},
    createdAt: '',
    updatedAt: '',
  } as never
}

function entity(id: string, type: string, name?: string): RefEntityLike {
  return { id, type, name }
}

function indexOf(...list: RefEntityLike[]): Map<string, RefEntityLike> {
  return new Map(list.map(e => [e.id, e]))
}

describe('outlineRefs / refRelationsOf（方向不敏感）', () => {
  it('节点在 source 端 → 命中', () => {
    const hits = refRelationsOf([rel('outline_mentions', 'n1', 'c1')], 'n1', REF_TYPES)
    expect(hits).toHaveLength(1)
  })

  it('节点在 target 端（inverse 方向）→ 同样命中', () => {
    const hits = refRelationsOf([rel('outline_mentions', 'c1', 'n1')], 'n1', REF_TYPES)
    expect(hits).toHaveLength(1)
  })

  it('不属于 ref 类型的关系（如 parent_child）→ 排除', () => {
    const hits = refRelationsOf([rel('parent_child', 'n0', 'n1')], 'n1', REF_TYPES)
    expect(hits).toHaveLength(0)
  })

  it('与本节点无关的关系 → 排除', () => {
    const hits = refRelationsOf([rel('outline_mentions', 'n2', 'c1')], 'n1', REF_TYPES)
    expect(hits).toHaveLength(0)
  })

  it('空 nodeId → 空结果（不抛错）', () => {
    expect(refRelationsOf([rel('outline_mentions', 'n1', 'c1')], '', REF_TYPES)).toEqual([])
  })
})

describe('outlineRefs / groupOutlineRefs（按类型聚合）', () => {
  it('按目标实体类型分组，组内按名字拼音序', () => {
    const groups = groupOutlineRefs(
      [rel('outline_mentions', 'n1', 'c2'), rel('outline_mentions', 'n1', 'c1')],
      'n1',
      indexOf(entity('c1', 'character', '张三'), entity('c2', 'character', '李四')),
      REF_TYPES,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].entityType).toBe('character')
    // 李(l) 在 张(z) 前
    expect(groups[0].members.map(m => m.name)).toEqual(['李四', '张三'])
  })

  it('同一实体经多条关系关联 → 成员只出现一次，但 relationTypes 累积（便于 title 提示）', () => {
    const groups = groupOutlineRefs(
      [
        rel('outline_mentions', 'n1', 'b1', 'r1'),
        rel('outline_located_in', 'n1', 'b1', 'r2'),
      ],
      'n1',
      indexOf(entity('b1', 'building', '城堡')),
      REF_TYPES,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toHaveLength(1)
    expect(groups[0].members[0].relationTypes.sort()).toEqual(['outline_located_in', 'outline_mentions'])
  })

  it('孤儿关系（另一端实体已删）→ 丢弃，不显示幽灵条目', () => {
    const groups = groupOutlineRefs(
      [rel('outline_mentions', 'n1', 'gone')],
      'n1',
      indexOf(entity('c1', 'character', '张三')),
      REF_TYPES,
    )
    expect(groups).toEqual([])
  })

  it('多类型时：组间按成员数降序', () => {
    const groups = groupOutlineRefs(
      [
        rel('outline_mentions', 'n1', 'c1', 'r1'),
        rel('outline_mentions', 'n1', 'c2', 'r2'),
        rel('outline_located_in', 'n1', 'g1', 'r3'),
      ],
      'n1',
      indexOf(
        entity('c1', 'character', '甲'),
        entity('c2', 'character', '乙'),
        entity('g1', 'region', '北境'),
      ),
      REF_TYPES,
    )
    expect(groups.map(g => g.entityType)).toEqual(['character', 'region'])
    expect(groups[0].members).toHaveLength(2)
  })

  it('名字为空 → 回退「未命名」（不显示空白徽章）', () => {
    const groups = groupOutlineRefs(
      [rel('outline_mentions', 'n1', 'c1')],
      'n1',
      indexOf(entity('c1', 'character', '   ')),
      REF_TYPES,
    )
    expect(groups[0].members[0].name).toBe('未命名')
  })

  it('无关系 → 空数组', () => {
    expect(groupOutlineRefs([], 'n1', indexOf(), REF_TYPES)).toEqual([])
  })

  it('totalRefCount 汇总全部成员数', () => {
    const groups = groupOutlineRefs(
      [
        rel('outline_mentions', 'n1', 'c1', 'r1'),
        rel('outline_mentions', 'n1', 'c2', 'r2'),
        rel('outline_located_in', 'n1', 'g1', 'r3'),
      ],
      'n1',
      indexOf(entity('c1', 'character'), entity('c2', 'character'), entity('g1', 'region')),
      REF_TYPES,
    )
    expect(totalRefCount(groups)).toBe(3)
  })
})

describe('outlineRefs / pickRefRelationTypes（注册表驱动）', () => {
  const schemas = [
    { type: 'outline_mentions', sourceTypes: ['outline_node'], targetTypes: ['character', 'item'] },
    { type: 'outline_located_in', sourceTypes: ['outline_node'], targetTypes: ['region'] },
    // 大纲内部关系：目标是 outline_node → 不该进徽章
    { type: 'parent_child', sourceTypes: ['outline_node'], targetTypes: ['outline_node'] },
    // 目标是白板 → 不该进徽章
    { type: 'board_holds', sourceTypes: ['outline_node'], targetTypes: ['outline_board'] },
    // 源不是 outline_node → 不相关
    { type: 'note_link', sourceTypes: ['notebook'], targetTypes: ['notebook'] },
    // defineRelation 自动注册的 inverse（sourceTypes 是芽实体）→ 不该进徽章
    { type: 'mentioned_by_outline', sourceTypes: ['character', 'item'], targetTypes: ['outline_node'] },
  ]

  it('只纳入「源为 outline_node 且目标全是芽实体」的类型', () => {
    expect(pickRefRelationTypes(schemas).sort()).toEqual(['outline_located_in', 'outline_mentions'])
  })

  it('兼容 typeKey 字段名（旧注册表用 typeKey 而非 type）', () => {
    const viaTypeKey = [
      { typeKey: 'outline_mentions', sourceTypes: ['outline_node'], targetTypes: ['character'] },
    ]
    expect(pickRefRelationTypes(viaTypeKey)).toEqual(['outline_mentions'])
  })

  it('无 type/typeKey 的脏数据 → 跳过（不产生空字符串类型名）', () => {
    expect(pickRefRelationTypes([{ sourceTypes: ['outline_node'], targetTypes: ['character'] }])).toEqual([])
  })

  it('targetTypes 为空 → 不纳入（无从判断是否大纲内部关系，保守排除）', () => {
    expect(pickRefRelationTypes([{ type: 'x', sourceTypes: ['outline_node'], targetTypes: [] }])).toEqual([])
  })

  it('空注册表 → 空结果', () => {
    expect(pickRefRelationTypes([])).toEqual([])
  })
})

// ── 2026-10-08「关联实体」编辑行：反查与并集 ──────────────────

const LOOKUP_SCHEMAS = [
  { type: 'outline_mentions', sourceTypes: ['outline_node'], targetTypes: ['character', 'item', 'building'] },
  { type: 'outline_located_in', sourceTypes: ['outline_node'], targetTypes: ['region', 'building'] },
  { type: 'outline_covers', sourceTypes: ['outline_node'], targetTypes: ['event', 'conflict'] },
  { type: 'parent_child', sourceTypes: ['outline_node'], targetTypes: ['outline_node'] },
  { type: 'mentioned_by_outline', sourceTypes: ['character'], targetTypes: ['outline_node'] },
]

describe('outlineRefs / refRelationTypesForTarget（反查；专一者优先）', () => {
  it('唯一合法：区域 → 发生于', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'region')).toEqual(['outline_located_in'])
  })

  it('二义（建筑）：专一者（2 目标）在首＝默认「发生于」，泛指「提及」（3 目标）在后', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'building')).toEqual([
      'outline_located_in',
      'outline_mentions',
    ])
  })

  it('事件 → 承载（唯一）', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'event')).toEqual(['outline_covers'])
  })

  it('其余目标 → 提及', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'character')).toEqual(['outline_mentions'])
  })

  it('无合法类型的目标 → 空（调用方据此拒建，不静默回退）', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'manuscript')).toEqual([])
  })

  it('inverse 方向（源是芽实体）不掺入', () => {
    expect(refRelationTypesForTarget(LOOKUP_SCHEMAS, 'character', 'character')).toEqual([])
  })

  it('真实注册表锁定：建筑默认「发生于」且「提及」可选（与立项裁定一致）', () => {
    const types = refRelationTypesForTarget(relationshipRegistry.getBySourceType('outline_node'), 'building')
    expect(types[0]).toBe('outline_located_in')
    expect(types).toContain('outline_mentions')
  })
})

describe('outlineRefs / refTargetTypes（合法目标并集）', () => {
  it('汇总去重、排除 outline 内部目标', () => {
    expect(refTargetTypes(LOOKUP_SCHEMAS).sort()).toEqual(
      ['building', 'character', 'conflict', 'event', 'item', 'region'].sort(),
    )
  })

  it('真实注册表：并集恰为 15 类芽实体（含 building 二义，不含 outline 自身）', () => {
    const types = refTargetTypes(relationshipRegistry.getBySourceType('outline_node'))
    expect(types).toHaveLength(15)
    expect(types).toContain('building')
    expect(types).not.toContain('outline_node')
    expect(types).not.toContain('manuscript')
  })

  it('V2 定义加载时同步到旧版 registry（canvas-engine 图标签等消费者的依赖）', () => {
    expect(relationSchemaRegistry.get('outline_mentions')?.label).toBe('提及')
    expect(relationSchemaRegistry.get('knows')?.label).toBe('认识')
  })
})
