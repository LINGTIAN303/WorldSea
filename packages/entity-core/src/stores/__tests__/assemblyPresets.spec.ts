/**
 * 装配预设（阶段 2「装配是数据不是代码」）契约测试。
 *
 * 验四件事：
 * 1. **id 真实性**：预设里写的每个芽 id 都必须在 manifest 里真实存在——
 *    写错一个字母，用户选该形态时会静默少一个功能，而 UI 不会报错。
 * 2. **无重复**：同一预设内不得重复列同一 id（去重是数据卫生，不是运行时职责）。
 * 3. **可转分组**：`presetAsGroup` 产出的形状能被既有 `applySproutGroup` 消费。
 * 4. **命中判定**：`matchPreset` 按集合相等判，子集不算命中。
 *
 * 芽 id 的权威来源是插件目录的 manifest（扫描源码而非 import：import 一个插件会连带
 * 拉起整条 Vue 渲染链，在 vitest 并行下会超时）。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ASSEMBLY_PRESETS, presetAsGroup, matchPreset } from '../assemblyPresets'

const here = dirname(fileURLToPath(import.meta.url))
/** 产品域插件目录（本 spec 位于 `packages/entity-core/src/stores/__tests__/`）。 */
const pluginsRoot = join(here, '..', '..', '..', '..', '..', 'apps', 'tauri', 'src', 'world', 'plugins')

/** 扫出全部插件 manifest 的 id（内联 index.ts 或独立 manifest.ts 两种布局都认）。 */
function collectPluginIds(): Set<string> {
  const ids = new Set<string>()
  for (const entry of readdirSync(pluginsRoot)) {
    const dir = join(pluginsRoot, entry)
    if (!statSync(dir).isDirectory() || entry === '__tests__') continue
    for (const file of ['index.ts', 'manifest.ts']) {
      let code: string
      try {
        code = readFileSync(join(dir, file), 'utf8')
      } catch {
        continue
      }
      // 只认 manifest 对象里的 `id: 'official.xxx'`（跳过 apply 内的其它 id）
      for (const match of code.matchAll(/\bid:\s*'(official\.[a-z0-9_.-]+)'/g)) {
        ids.add(match[1]!)
      }
    }
  }
  return ids
}

describe('装配预设', () => {
  it('每条预设的 id 唯一且带 preset: 前缀（与用户分组的 sg- 区分）', () => {
    const ids = ASSEMBLY_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.startsWith('preset:')).toBe(true)
  })

  it('预设里写的芽 id 都真实存在（写错即静默少功能，必须守）', () => {
    const known = collectPluginIds()
    // 前置自检：扫描本身得能扫到东西，否则下面的断言会假通过
    expect(known.size).toBeGreaterThan(30)

    const unknown: string[] = []
    for (const preset of ASSEMBLY_PRESETS) {
      for (const id of preset.sproutIds) {
        if (!known.has(id)) unknown.push(`${preset.id} 引用了不存在的芽：${id}`)
      }
    }
    expect(unknown, unknown.join('\n')).toEqual([])
  })

  it('同一预设内不重复列同一 id', () => {
    for (const preset of ASSEMBLY_PRESETS) {
      const dupes = preset.sproutIds.filter((id, index) => preset.sproutIds.indexOf(id) !== index)
      expect(dupes, `${preset.id} 有重复项：${dupes.join(', ')}`).toEqual([])
    }
  })

  it('每条预设都有非空名称与说明（UI 要显示，空字符串等于没有）', () => {
    for (const preset of ASSEMBLY_PRESETS) {
      expect(preset.name.trim(), `${preset.id} 缺 name`).not.toBe('')
      expect(preset.description.trim(), `${preset.id} 缺 description`).not.toBe('')
      expect(preset.sproutIds.length, `${preset.id} 没有任何芽`).toBeGreaterThan(0)
    }
  })

  it('presetAsGroup 产出可被 applySproutGroup 消费的形状', () => {
    const group = presetAsGroup(ASSEMBLY_PRESETS[0]!)
    expect(group).toEqual({
      id: ASSEMBLY_PRESETS[0]!.id,
      name: ASSEMBLY_PRESETS[0]!.name,
      sproutIds: [...ASSEMBLY_PRESETS[0]!.sproutIds],
    })
    // 必须是副本：改返回值不得污染常量表
    group.sproutIds.push('official.__injected__')
    expect(ASSEMBLY_PRESETS[0]!.sproutIds).not.toContain('official.__injected__')
  })

  it('matchPreset 按集合相等判：完全命中才算，子集不算', () => {
    const preset = ASSEMBLY_PRESETS[0]!
    expect(matchPreset(preset.sproutIds)?.id).toBe(preset.id)
    // 子集不命中（那是用户自定义形态）
    expect(matchPreset(preset.sproutIds.slice(0, 2))).toBeUndefined()
    // 多一个也不命中
    expect(matchPreset([...preset.sproutIds, 'official.extra'])).toBeUndefined()
    // 空集合不命中任何预设
    expect(matchPreset([])).toBeUndefined()
  })
})
