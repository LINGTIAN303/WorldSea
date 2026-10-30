import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getCarrier } from '@worldsea/plugin-sdk'

/**
 * 「芽 → 载体」分配表的静态守卫。背景见
 * docs/plans/2026-10-02-实体详情表单地基与形态批计划.md §七之七 与 §七之十
 *
 * 分配表是**产品决定**，散在各芽视图文件里当属性写。没有守卫的话，
 * 一次顺手重构就能悄悄改掉某枚芽的默认容器，而这条变化只有真机打开详情才看得见。
 * 这里锁的是：**声明集合恰好是那 10 枚**、**每一枚的 id 都在注册表里**、**不许直挂抽屉**。
 *
 * 遍历必须**递归**：`outline/board/BoardView.vue` 这类入口在子目录里，
 * 早先只 `readdirSync` 走一层＝整个 outline 芽静默逃逸，子目录里的直挂也照样漏。
 */

const PLUGINS = join(__dirname, '..')

/** 档 B 均衡 9 枚（判据见 §七之七）+ 战术棋盘 1 枚：它原本就是常驻右栏，
 *  接载体时缺省必须还是分栏，否则"接入"会顺手把观感改成浮层抽屉（§七之十）
 *  + 生物图鉴 1 枚（2026-10-28 三芽批）：字段形态与 plants/species 同类（能力/弱点等多段文本），随姊妹芽取栏式
 *  + 信仰 1 枚（2026-10-30 信仰芽批）：字段形态与 culture 同类（教义/仪式等多段文本），随姊妹芽取栏式 */
const COLUMN_SPROUTS = [
  'buildings', 'characters', 'combat_stats', 'conflict', 'culture', 'faith',
  'languages', 'magic', 'plants', 'species', 'tactical-board', 'creatures',
]

interface SproutFile { sprout: string; file: string; src: string }

function walk(dir: string, sprout: string, base: string, out: SproutFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, sprout, base, out)
    else if (entry.name.endsWith('.vue')) {
      // 路径统一成 `/`：Windows 下 `relative()` 给反斜杠，断言与报告都会因此变得难读（也曾让这条守卫假失败）
      out.push({ sprout, file: relative(base, full).replace(/\\/g, '/'), src: readFileSync(full, 'utf8') })
    }
  }
}

function allSproutFiles(): SproutFile[] {
  const out: SproutFile[] = []
  for (const entry of readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    walk(join(PLUGINS, entry.name), entry.name, PLUGINS, out)
  }
  return out
}

function collectDeclarations(): { sprout: string; carrier: string; file: string }[] {
  const out: { sprout: string; carrier: string; file: string }[] = []
  for (const f of allSproutFiles()) {
    for (const m of f.src.matchAll(/detail-carrier="([\w-]+)"/g)) {
      out.push({ sprout: f.sprout, carrier: m[1], file: f.file })
    }
  }
  return out
}

describe('芽声明的详情载体', () => {
  it('声明集合恰为档 B 的 9 枚芽（多一枚少一枚都是改产品决定）', () => {
    expect(collectDeclarations().map(d => d.sprout).sort()).toEqual([...COLUMN_SPROUTS].sort())
  })

  it('只声明栏式整页；其余芽沿用缺省抽屉（缺省零变化仍是默认）', () => {
    for (const d of collectDeclarations()) expect(d.carrier).toBe('column')
  })

  it('声明的 id 必须在注册表里（写错的回落是兜底，不是可以带着的错）', () => {
    for (const d of collectDeclarations()) {
      expect(getCarrier(d.carrier), `${d.file} 写了未注册的载体 ${d.carrier}`).toBeTruthy()
    }
  })

  it('自绘详情/无实体列表面的芽不许声明（声明了也不生效，只会误导读代码的人）', () => {
    // timeline 已改吃注册表，但它没有 `detailCarrier` prop——
    // 载体只能由用户在设置里按类型覆写，所以仍列在"不许声明"里
    const unreachable = ['custom', 'drawing', 'graph', 'manuscript', 'mindmap', 'notebook', 'timeline']
    const declaredSprouts = collectDeclarations().map(d => d.sprout)
    for (const s of unreachable) {
      expect(declaredSprouts, `${s} 不经 GenericEntityView/SchemaRenderer`).not.toContain(s)
    }
  })

  it('没有哪个芽视图直挂抽屉组件（容器必须经载体注册表，否则该芽换不了载体）', () => {
    const direct = allSproutFiles()
      .filter(f => /<EntityDetailPanel[\s>]/.test(f.src))
      .map(f => f.file)
    expect(direct).toEqual([])
  })

  it('守卫自身扫得到子目录（outline 入口在 board 下，不再静默逃逸）', () => {
    const files = allSproutFiles().map(f => f.file)
    expect(files).toContain('outline/board/BoardView.vue')
    expect(files.some(f => f.includes('components/'))).toBe(true)
  })
})
