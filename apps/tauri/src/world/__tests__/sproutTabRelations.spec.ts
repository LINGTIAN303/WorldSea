/**
 * 芽关系 Tab 守卫（2026-10-28 死关系 Tab 修复批）：
 * 全芽视图的 RelationTabDef relationType 引用必须 (1) 在关系注册表中存在 (2) 方向覆盖本芽实体类型。
 * 缘起：plants「生长区域」等 8 处 Tab 引用了注册表中不存在的类型（渲染为恒空死 Tab）、
 * 5 处活 Tab 的 add 流方向与 schema 相反——静态扫描对齐 sproutCarrierDeclaration.spec 模式。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { relationshipRegistry } from '@worldsea/entity-core'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGINS = join(HERE, '..', 'plugins')

interface TabRef { sprout: string; file: string; relationType: string; reverse: boolean }

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.vue')) out.push(full)
  }
}

function allViewFiles(): Array<{ sprout: string; file: string; src: string }> {
  const out: Array<{ sprout: string; file: string; src: string }> = []
  for (const entry of readdirSync(PLUGINS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const files: string[] = []
    walk(join(PLUGINS, entry.name), files)
    for (const file of files) {
      out.push({ sprout: entry.name, file: relative(PLUGINS, file).replace(/\\/g, '/'), src: readFileSync(file, 'utf8') })
    }
  }
  return out
}

/** 每芽实际注册的实体类型（index.ts registerEntityV2 type，与 sproutDomains.spec 同口径的轻量源码扫描） */
function sproutEntityTypes(sprout: string): string[] {
  const src = readFileSync(join(PLUGINS, sprout, 'index.ts'), 'utf8')
  return [...src.matchAll(/registerEntityV2\(\{\s*type: '([a-z_]+)'/g)].map(m => m[1])
}

const viewFiles = allViewFiles()
const tabRefs: TabRef[] = viewFiles.flatMap(({ sprout, file, src }) =>
  [...src.matchAll(/relationType: '([a-z_]+)'(, reverseDirection: true)?/g)].map(m => ({
    sprout, file, relationType: m[1], reverse: !!m[2],
  })),
)

describe('芽关系 Tab 引用', () => {
  it('存在引用可扫描（防扫描器失效假绿）', () => {
    expect(tabRefs.length).toBeGreaterThanOrEqual(36)
  })

  it('每个 relationType 引用都在关系注册表中存在（死 Tab 零容忍）', () => {
    const missing = tabRefs.filter(r => !relationshipRegistry.get(r.relationType))
    expect(missing.map(r => `${r.sprout}/${r.file} → ${r.relationType}`)).toEqual([])
  })

  it('Tab 方向覆盖本芽实体类型（add 流与 schema 同向）', () => {
    const mismatches: string[] = []
    for (const ref of tabRefs) {
      const schema = relationshipRegistry.get(ref.relationType)
      if (!schema) continue
      const myTypes = sproutEntityTypes(ref.sprout)
      if (myTypes.length === 0) continue // 纯视图芽不产关系
      const covered = ref.reverse
        ? myTypes.some(t => schema.targetTypes.includes(t))
        : myTypes.some(t => schema.sourceTypes.includes(t))
      if (!covered) mismatches.push(`${ref.sprout}/${ref.file} → ${ref.relationType} (reverse=${ref.reverse})`)
    }
    expect(mismatches).toEqual([])
  })
})
