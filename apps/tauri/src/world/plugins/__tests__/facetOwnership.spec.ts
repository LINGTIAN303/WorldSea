// @vitest-environment node
/**
 * Facet 贡献位归属守卫（2026-11-17，阶段 2.2）。
 *
 * 背景：`weapon` / `apparel` 两个 Facet 原先由 `items` 插件顺手注册，而它们是
 * `weapons` / `apparel` 两个芽的语义本体——「谁贡献了哪个 Facet」在清单上不可见，
 * 与六个贡献位的口径不符。现已迁到各自插件。
 *
 * 钉四件事：
 * 1. `defineFacet` 只校验不注册（否则任何 import 到定义文件都产生注册副作用，
 *    归属又说不清了）
 * 2. 每个 facet id 恰好被一个插件注册（重复注册会因 `facetRegistry` 幂等而静默
 *    只生效一次，排查时极难定位）
 * 3. 注册方与 facet 语义一致（weapon → weapons 插件，而不是随便哪个插件）
 * 4. 引用了 facets 的实体类型，其 facets 列表里的 id 都有插件认领——否则实体上
 *    那块数据永远不出现，且不报错
 *
 * 判据全部走**源码扫描**而非 import：import 会拉起整条 Vue 链（实测 5s 超时）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// __tests__ → plugins → world → src → tauri → apps → 仓根
const repoRoot = join(here, '..', '..', '..', '..', '..', '..')
const PLUGINS_DIR = join(repoRoot, 'apps/tauri/src/world/plugins')

/** 插件目录名 → index.ts 源码。 */
function pluginSources(): Map<string, string> {
  const out = new Map<string, string>()
  for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '__tests__') continue
    out.set(entry.name, readFileSync(join(PLUGINS_DIR, entry.name, 'index.ts'), 'utf8'))
  }
  return out
}

/**
 * 扫 `api.registerFacet(Xxx)`，把变量名映射回 facet id。
 *
 * 变量名与 id 的对应关系取自 `packages/entity-core/src/facets/index.ts` 的定义
 * （`export const WeaponFacet ... id: 'weapon'`），不在本测试里手写第二份。
 */
function facetIdOf(): Map<string, string> {
  const facetsSource = readFileSync(join(repoRoot, 'packages/entity-core/src/facets/index.ts'), 'utf8')
  const map = new Map<string, string>()
  for (const match of facetsSource.matchAll(/export const (\w+):\s*FacetDefinition\s*=\s*defineFacet\(\{[\s\S]*?id:\s*'([^']+)'/g)) {
    map.set(match[1]!, match[2]!)
  }
  return map
}

describe('Facet 贡献位归属', () => {
  it('defineFacet 不再自行注册（只校验并返回）', () => {
    const runtime = readFileSync(join(repoRoot, 'packages/entity-core/src/core/TraitRuntime.ts'), 'utf8')
    const body = runtime.slice(runtime.indexOf('export function defineFacet'))
    const fnBody = body.slice(0, body.indexOf('\n}'))
    expect(fnBody, 'defineFacet 内不得调用 facetRegistry.register').not.toMatch(/facetRegistry\.register/)
  })

  it('每个 facet 恰好被一个插件注册（不重复、不遗漏）', () => {
    const sources = pluginSources()
    const varToId = facetIdOf()
    expect(varToId.size, 'facet 定义数（扫不到说明上面的正则失效了）').toBeGreaterThanOrEqual(2)

    const owners = new Map<string, string[]>()
    for (const [plugin, source] of sources) {
      for (const match of source.matchAll(/api\.registerFacet\((\w+)\)/g)) {
        const id = varToId.get(match[1]!)
        expect(id, `${plugin} 注册了未知 facet 变量 ${match[1]}`).toBeDefined()
        owners.set(id!, [...(owners.get(id!) ?? []), plugin])
      }
    }

    const duplicated = [...owners].filter(([, plugins]) => plugins.length > 1)
    expect(duplicated.map(([id, plugins]) => `${id} ← ${plugins.join(', ')}`), '同一 facet 被多个插件注册').toEqual([])

    const unowned = [...varToId.values()].filter(id => !owners.has(id))
    expect(unowned, '以下 facet 没有任何插件注册（实体上不会出现）').toEqual([])
  })

  it('注册方与 facet 语义一致（weapon → weapons，apparel → apparel）', () => {
    const sources = pluginSources()
    const varToId = facetIdOf()
    for (const [plugin, source] of sources) {
      for (const match of source.matchAll(/api\.registerFacet\((\w+)\)/g)) {
        const id = varToId.get(match[1]!)!
        expect(plugin, `facet ${id} 应由 ${id}s 之类的对应插件注册，实际在 ${plugin}`).toContain(id)
      }
    }
  })

  it('实体类型引用的 facet id 都有插件认领', () => {
    const sources = pluginSources()
    const varToId = facetIdOf()
    const registered = new Set<string>()
    for (const source of sources.values()) {
      for (const match of source.matchAll(/api\.registerFacet\((\w+)\)/g)) {
        registered.add(varToId.get(match[1]!)!)
      }
    }

    const dangling: string[] = []
    for (const [plugin, source] of sources) {
      // 只找 registerEntityV2 里的 facets: [...] 声明
      for (const match of source.matchAll(/facets:\s*\[([^\]]*)\]/g)) {
        const ids = [...match[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!)
        for (const id of ids) {
          if (!registered.has(id)) dangling.push(`${plugin} 的实体引用了未注册的 facet: ${id}`)
        }
      }
    }
    expect(dangling).toEqual([])
  })
})
