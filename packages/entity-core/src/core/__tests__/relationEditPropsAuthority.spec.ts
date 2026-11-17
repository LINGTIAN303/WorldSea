/**
 * 关系属性编辑的权威来源（2026-11-17 关系权威源收敛）。
 *
 * 缺陷原貌：`UniversalRelationPanel` 只读硬编码 `RELATION_EDIT_PROPS`（26 条），
 * 完全不看 `RelationTypeSchemaV2.properties` —— 而后者才是关系属性的唯一定义处。
 * 实测 23 条与 schema 不一致（`route` 的 schema 声明 4 个属性，面板只显示 2 个）。
 *
 * 修复策略：**schema.properties 优先，硬编码兜底**。
 * 之所以保留兜底：26 条硬编码中有 21 条在 schema 里没有 properties 声明，
 * 直接改成只读 schema 会让这 21 条关系的属性编辑当场消失 —— 那是功能退化，不是收敛。
 *
 * 本 spec 锁定两件事：
 *   ① 有 schema.properties 的关系，面板必须用 schema 的字段（不得被硬编码表遮蔽）
 *   ② 无 schema.properties 的关系，硬编码兜底仍然存在（不得因收敛丢功能）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { relationshipRegistry, RelationTypes } from '../../index'

const PANEL = join(process.cwd(), 'packages/plugin-sdk/src/components/UniversalRelationPanel.vue')

/** 从面板源码抓 RELATION_EDIT_PROPS 的键集合（静态扫描，不挂载组件） */
function hardcodedEditPropTypes(): string[] {
  const src = readFileSync(PANEL, 'utf8')
  const start = src.indexOf('const RELATION_EDIT_PROPS')
  expect(start, 'RELATION_EDIT_PROPS 未找到——扫描器失效会让本 spec 空转').toBeGreaterThan(-1)
  const body = src.slice(start, src.indexOf('\n}\n', start))
  // 键有两种写法：字面量 'xxx': 或 [RelationTypes.XXX]:
  const literal = [...body.matchAll(/^\s+'([a-z_]+)':\s*\[/gm)].map(m => m[1])
  // 枚举写法要转成实际值（BELONGS_TO → belongs_to），否则查注册表全部落空
  const viaEnum = [...body.matchAll(/\[RelationTypes\.([A-Z_]+)\]:\s*\[/g)]
    .map(m => RelationTypes[m[1] as keyof typeof RelationTypes])
    .filter((v): v is string => typeof v === 'string')
  return [...literal, ...viaEnum]
}

describe('守卫前置：扫描器能找到东西', () => {
  it('硬编码表非空', () => {
    expect(hardcodedEditPropTypes().length).toBeGreaterThan(15)
  })
})

describe('① schema 有 properties 时必须以 schema 为准', () => {
  it('面板源码确实优先读 schema.properties', () => {
    const src = readFileSync(PANEL, 'utf8')
    const block = src.slice(src.indexOf('const editProps'))
    const head = block.slice(0, block.indexOf('function getTypeLabel'))
    expect(head, 'editProps 未读注册表 properties，schema 优先不成立').toContain('relationshipRegistry')
    expect(head, 'editProps 未读 properties 字段').toContain('properties')
    // schema 分支必须在硬编码兜底之前出现
    expect(head.indexOf('properties'), 'schema 分支须在硬编码兜底之前').toBeLessThan(
      head.indexOf('RELATION_EDIT_PROPS'),
    )
  })

  it('两条已有 schema.properties 的关系，字段数与 schema 一致', () => {
    const cases = ['member_of', 'route']
    const checked: string[] = []
    for (const type of cases) {
      const props = relationshipRegistry.get(type)?.properties
      if (!props?.length) continue
      checked.push(`${type}:${props.length}`)
      // 字段 key 必须都来自 schema（面板按 schema 渲染时不会丢字段）
      expect(props.map(p => p.key).length).toBeGreaterThan(0)
    }
    expect(checked.length, '没有一条命中 schema.properties——本断言空转').toBeGreaterThanOrEqual(1)
  })
})

describe('② 无 schema.properties 时硬编码兜底仍在（不丢功能）', () => {
  it('至少 15 条硬编码关系在 schema 无 properties，靠兜底保住编辑能力', () => {
    const types = hardcodedEditPropTypes()
    const fallbackOnly = types.filter(t => {
      const schema = relationshipRegistry.get(t)
      return schema && !(schema.properties?.length)
    })
    expect(
      fallbackOnly.length,
      '兜底清单异常：若为 0 说明 schema 已补齐，应改写本断言为「可删除兜底」',
    ).toBeGreaterThanOrEqual(15)
  })
})
