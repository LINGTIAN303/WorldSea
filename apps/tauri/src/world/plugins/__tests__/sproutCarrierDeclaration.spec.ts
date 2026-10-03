import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getCarrier } from '@worldsea/plugin-sdk'

/**
 * 「芽 → 载体」分配表的静态守卫。背景见
 * docs/plans/2026-10-02-实体详情表单地基与形态批计划.md §七之七
 *
 * 分配表是**产品决定**，散在 9 个视图文件里当属性写。没有守卫的话，
 * 一次顺手重构就能悄悄改掉某枚芽的默认容器，而这条变化只有真机打开详情才看得见。
 * 这里锁两件事：**声明集合恰好是那 9 枚**、**每一枚的 id 都在注册表里**。
 */

const PLUGINS = join(__dirname, '..')

/** 档 B 均衡：长文本 ≥4 或已定段落式的 9 枚（判据见 §七之七） */
const COLUMN_SPROUTS = [
  'buildings', 'characters', 'combat_stats', 'conflict', 'culture',
  'languages', 'magic', 'plants', 'species',
]

function collectDeclarations(): { sprout: string; carrier: string }[] {
  const out: { sprout: string; carrier: string }[] = []
  for (const dir of readdirSync(PLUGINS)) {
    const full = join(PLUGINS, dir)
    if (!statSync(full).isDirectory()) continue
    for (const file of readdirSync(full)) {
      if (!file.endsWith('.vue')) continue
      const src = readFileSync(join(full, file), 'utf8')
      for (const m of src.matchAll(/detail-carrier="([\w-]+)"/g)) {
        out.push({ sprout: dir, carrier: m[1] })
      }
    }
  }
  return out
}

describe('芽声明的详情载体', () => {
  it('声明集合恰为档 B 的 9 枚芽（多一枚少一枚都是改产品决定）', () => {
    const declared = collectDeclarations()
    expect(declared.map(d => d.sprout).sort()).toEqual([...COLUMN_SPROUTS].sort())
  })

  it('只声明栏式整页；其余芽沿用缺省抽屉（缺省零变化仍是默认）', () => {
    for (const d of collectDeclarations()) expect(d.carrier).toBe('column')
  })

  it('声明的 id 必须在注册表里（写错的回落是兜底，不是可以带着的错）', () => {
    for (const d of collectDeclarations()) {
      expect(getCarrier(d.carrier), `${d.sprout} 写了未注册的载体 ${d.carrier}`).toBeTruthy()
    }
  })

  it('自绘详情/无实体列表面的芽不许声明（声明了也不生效，只会误导读代码的人）', () => {
    const unreachable = ['custom', 'drawing', 'graph', 'manuscript', 'mindmap', 'notebook', 'timeline']
    const declaredSprouts = collectDeclarations().map(d => d.sprout)
    for (const s of unreachable) {
      expect(declaredSprouts, `${s} 不经 GenericEntityView/SchemaRenderer`).not.toContain(s)
    }
  })
})
