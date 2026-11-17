/**
 * 静态选择器表的幽灵关系类型守卫（2026-11-17 关系权威源收敛补充）。
 *
 * 背景：`relationPickerOptions.ts` / `faithRelationOptions.ts` 是关系的**第 8 个权威源**——
 * 它用字符串字面量重复声明「哪对实体之间能建哪种关系」及其中文标签。
 * 字符串字面量绕过 TypeScript 检查：注册表删掉一个关系类型，这里不会报错，
 * 只会变成「UI 里能选中、但注册表不认识」的幽灵，写进数据后无法反查标签与逆类型。
 *
 * 实测发现的两处幽灵（已修）：`happens_in`→`happened_in`、`precedes`→`parallel_to`。
 *
 * 本 spec 静态扫描源码的**关系类型位置**，与注册表比对。
 * 扫描按对象块切分——配对 key（形如 `character_organization`）不是关系类型，
 * 整行正则会把它们一起抓走（初版误报 57 条）。故：
 *   ① RELATION_TYPE_OPTIONS 块 → `{ type: 'xxx', label:`
 *   ② guessRelationType 块      → 箭头右侧值，不含键
 *   ③ RELATION_PROPERTIES 块    → 块内行首 `'xxx': [`
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { relationshipRegistry } from '../../index'

const COMPONENTS = join(process.cwd(), 'packages/plugin-sdk/src/components')

/**
 * 取某标识符**声明处**到下一个顶层 export 之间的源码块。
 *
 * 按声明形态定位（`export const NAME` / `export function NAME`），不能用裸 indexOf：
 * 文件顶部有 `import { FAITH_RELATION_TYPE_OPTIONS }` 也含该子串，
 * 裸 indexOf 会命中 import 行、截出几十字符的空块，导致守卫静默空转却显示通过。
 */
function blockOf(src: string, name: string): string {
  const declRes = [
    new RegExp(`^export const ${name}\\b`, 'm'),
    new RegExp(`^export function ${name}\\b`, 'm'),
    new RegExp(`^const ${name}\\b`, 'm'),
    new RegExp(`^function ${name}\\b`, 'm'),
  ]
  let start = -1
  for (const re of declRes) {
    const m = re.exec(src)
    if (m) {
      start = m.index
      break
    }
  }
  if (start < 0) return ''
  const rest = src.slice(start)
  const end = rest.indexOf('\nexport ', 1)
  return end < 0 ? rest : rest.slice(0, end)
}

interface ScanResult {
  file: string
  referenced: number
  ghosts: Array<{ id: string; where: string }>
}

/**
 * 两份静态表的标识符不同：`relationPickerOptions` 用裸名，
 * `faithRelationOptions` 全部带 `FAITH_` 前缀（按芽拆分时加的）。
 * 用两套名字各扫一遍，命中哪套算哪套——不写死单套，否则第二份文件会静默空转。
 */
function scanPicker(file: string): ScanResult {
  const src = readFileSync(join(COMPONENTS, file), 'utf8')
  const found = new Map<string, Set<string>>()
  const add = (id: string, where: string) => {
    if (!found.has(id)) found.set(id, new Set())
    found.get(id)!.add(where)
  }

  for (const optName of ['RELATION_TYPE_OPTIONS', 'FAITH_RELATION_TYPE_OPTIONS']) {
    const optBlock = blockOf(src, optName)
    for (const m of optBlock.matchAll(/\{ type: '([a-z_]+)', label:/g)) add(m[1], 'TYPE_OPTIONS')
  }

  for (const guessName of ['guessRelationType', 'FAITH_GUESS_RELATION']) {
    const guessBlock = blockOf(src, guessName)
    for (const m of guessBlock.matchAll(/\[`[a-z_]+_[a-z_]+`\]: '([a-z_]+)'/g)) add(m[1], 'GUESS')
  }

  for (const propName of ['RELATION_PROPERTIES', 'FAITH_RELATION_PROPERTIES']) {
    const propBlock = blockOf(src, propName)
    for (const m of propBlock.matchAll(/^  '([a-z_]+)': \[$/gm)) add(m[1], 'PROPERTIES')
  }

  const ghosts = [...found.entries()]
    .filter(([id]) => !relationshipRegistry.has(id))
    .map(([id, where]) => ({ id, where: [...where].join('+') }))

  return { file, referenced: found.size, ghosts }
}

const results = ['relationPickerOptions.ts', 'faithRelationOptions.ts'].map(scanPicker)

describe('守卫前置：扫描器确实扫到了东西（防空转假绿）', () => {
  it('三处扫描位置都提取到了引用（类型候选 / 推断 / 属性）', () => {
    const src = readFileSync(join(COMPONENTS, 'relationPickerOptions.ts'), 'utf8')
    // 分别验证每个块各自非空——只要有一块切错，对应断言就会空转
    expect(blockOf(src, 'RELATION_TYPE_OPTIONS').length, 'RELATION_TYPE_OPTIONS 块切错').toBeGreaterThan(500)
    expect(blockOf(src, 'guessRelationType').length, 'guessRelationType 块切错').toBeGreaterThan(300)
    expect(blockOf(src, 'RELATION_PROPERTIES').length, 'RELATION_PROPERTIES 块切错').toBeGreaterThan(500)
  })

  it('两份静态表都提取到了关系类型引用', () => {
    for (const r of results) {
      expect(r.referenced, `${r.file} 未提取到任何关系类型——扫描器失效会让后面的断言空转`).toBeGreaterThan(5)
    }
  })

  it('注册表已装载足量关系（否则所有引用都会被误判为幽灵）', () => {
    expect(relationshipRegistry.getAll().length).toBeGreaterThan(100)
  })
})

describe('静态选择器表零幽灵', () => {
  it('且每个引用的关系类型都在注册表内', () => {
    const bad = results.flatMap(r => r.ghosts.map(g => `${r.file} → ${g.id}（出现在 ${g.where}）`))
    expect(bad, 'UI 能选中但注册表不认识的关系类型——写入数据后无法反查标签与逆类型').toEqual([])
  })

  it('曾经的四处幽灵已按注册表改名', () => {
    // happens_in → happened_in（同为「事件→地区」，注册表用后者）
    expect(relationshipRegistry.has('happened_in'), '替代类型应存在').toBe(true)
    expect(relationshipRegistry.has('happens_in'), '旧 id 不应存在于注册表').toBe(false)
    // precedes → parallel_to（注册表用「并行于」表达同一语义）
    expect(relationshipRegistry.has('parallel_to'), '替代类型应存在').toBe(true)
    expect(relationshipRegistry.has('precedes'), '旧 id 不应存在于注册表').toBe(false)
  })
})
