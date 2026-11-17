/**
 * 关系权威源守卫：标签 / 逆类型 / 对称性 / 死枚举。
 *
 * 起因见 docs/plans/2026-11-17-关系权威源收敛.md：
 * 关系这个概念曾有 7 个互不同步的权威源，实测 187/211 条标签错误（89%）、
 * 15 条逆类型冲突（含 5 条被当作对称关系）。
 *
 * 本 spec 锁定收敛后的契约：`relationshipRegistry` 是唯一权威，
 * 其余（getRelationLabel / inverseRegistry / relationSchemaRegistry）都是它的视图。
 */
import { describe, expect, it } from 'vitest'
import {
  relationshipRegistry,
  relationSchemaRegistry,
  inverseRegistry,
  getRelationLabel,
  RelationTypes,
} from '../../index'

/** 幂等前提：包入口已加载 119 条声明 + 自动逆类型 */
const ALL = relationshipRegistry.getAll()

describe('守卫前置：注册表已装载（防扫描器失效假绿）', () => {
  it('注册表条目数在预期量级', () => {
    expect(ALL.length, 'relationshipRegistry 条目数异常——守卫会空转').toBeGreaterThan(100)
  })

  it('非对称关系数量足够做逆类型比对', () => {
    const asym = ALL.filter(s => !s.symmetric)
    expect(asym.length, '非对称关系数异常').toBeGreaterThan(80)
  })

  it('对称关系数量足够做对称性比对', () => {
    const sym = ALL.filter(s => s.symmetric)
    expect(sym.length, '对称关系数异常').toBeGreaterThan(10)
  })
})

describe('G1 标签单一权威', () => {
  it('每条关系的 getRelationLabel 与注册表一致', () => {
    const wrong = ALL.filter(s => getRelationLabel(s.type) !== s.label).map(
      s => `${s.type}（注册表=${s.label}，实得=${getRelationLabel(s.type)}）`,
    )
    expect(wrong, 'getRelationLabel 未读注册表').toEqual([])
  })

  it('未注册类型返回自身 id（fail-visible，不伪造中文）', () => {
    expect(getRelationLabel('__never_registered__')).toBe('__never_registered__')
  })
})

describe('G2 逆类型单一权威', () => {
  it('非对称关系的 inverseRegistry 与注册表一致', () => {
    const wrong = ALL.filter(s => !s.symmetric && inverseRegistry.getInverse(s.type) !== s.inverseType).map(
      s => `${s.type}（注册表=${s.inverseType}，inverseRegistry=${inverseRegistry.getInverse(s.type)}）`,
    )
    expect(wrong, 'inverseRegistry 与注册表冲突').toEqual([])
  })

  it('对称性判定与注册表一致', () => {
    const wrong = ALL.filter(s => inverseRegistry.isSymmetric(s.type) !== s.symmetric).map(
      s => `${s.type}（注册表 symmetric=${s.symmetric}，inverseRegistry=${inverseRegistry.isSymmetric(s.type)}）`,
    )
    expect(wrong, '对称性判定冲突').toEqual([])
  })

  it('对称关系的 inverseType 指向自身', () => {
    const wrong = ALL.filter(s => s.symmetric && s.inverseType !== s.type).map(s => s.type)
    expect(wrong).toEqual([])
  })
})

describe('G2b 已知的 15 条历史冲突（回归夹具）', () => {
  const FIXED = {
    mentor_of: 'student_of',
    belongs_to: 'has_member',
    resides_in: 'resident_of_place',
    participated_in: 'has_participant',
    member_of: 'has_member',
    controls: 'controlled_by',
    located_in: 'contains_location',
    route: 'reverse_route',
    enclave_of: 'has_enclave',
    capital_of: 'has_capital',
    notable_for: 'notable_in',
    causes: 'caused_by',
    contains: 'contained_in',
    references: 'referenced_by',
    inspired_by: 'inspiration_for',
  } as const

  it('全部按注册表修正，不再是旧值', () => {
    const bad: string[] = []
    for (const [type, expected] of Object.entries(FIXED)) {
      const schema = relationshipRegistry.get(type)
      if (!schema) {
        bad.push(`${type} 未注册`)
        continue
      }
      if (schema.inverseType !== expected) bad.push(`${type} 注册表 inverseType=${schema.inverseType}，期望 ${expected}`)
      const legacy = inverseRegistry.getInverse(type)
      if (legacy !== expected) bad.push(`${type} inverseRegistry=${legacy}，期望 ${expected}`)
    }
    expect(bad).toEqual([])
  })

  it('5 条曾自指的现已不再自指（否则会建出源目标相同的反向边）', () => {
    const wasSelfRef = ['mentor_of', 'participated_in', 'causes', 'references', 'route', 'notable_for']
    const still = wasSelfRef.filter(t => inverseRegistry.isSymmetric(t))
    expect(still, '这些关系被当作对称处理会建出重复边').toEqual([])
  })
})

describe('G3 旧版镜像自动跟随', () => {
  it('legacy 表覆盖注册表全部条目', () => {
    const missing = ALL.filter(s => !relationSchemaRegistry.get(s.type)).map(s => s.type)
    expect(missing, 'relationSchemaRegistry 落后于注册表').toEqual([])
  })

  it('legacy 表的 label 与注册表一致', () => {
    const wrong = ALL.filter(s => relationSchemaRegistry.get(s.type)?.label !== s.label).map(
      s => `${s.type}（注册表=${s.label}，legacy=${relationSchemaRegistry.get(s.type)?.label}）`,
    )
    expect(wrong).toEqual([])
  })
})

describe('G4 无死枚举', () => {
  it('RelationTypes 每个值都能在注册表内找到', () => {
    const dead = Object.entries(RelationTypes)
      .filter(([, v]) => !relationshipRegistry.has(v))
      .map(([k, v]) => `${k}=${v}`)
    expect(dead, '枚举常量在注册表内无对应关系（死枚举）').toEqual([])
  })

  it('枚举规模在预期量级（防枚举被清空导致上一条空转）', () => {
    expect(Object.keys(RelationTypes).length).toBeGreaterThanOrEqual(30)
  })
})
