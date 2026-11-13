/**
 * 插件依赖声明守卫：`manifest.requires` 必须与插件源码的**实际服务取用**一致。
 *
 * 为什么需要这一例：`requires` 在 2026-11 之前是空转的——41 个插件里只有 `timeline`
 * 声明过，而装载器 `loader.ts:65` 的依赖预检因此从未真正生效过，插件与服务的真实
 * 依赖边在图上看不见。本守卫锁住三件事：
 *   1. **服务名合法**：声明的名字必须在 `WORLD_SERVICE_NAMES` 内（防拼错）
 *   2. **声明不得缺失**：源码用了服务，manifest 必须声明（否则预检形同虚设）
 *   3. **声明不得虚构**：manifest 声明的服务，源码必须真的取用（否则依赖图虚胖）
 *
 * 实现口径：**纯源码扫描，不 import 插件模块**。理由：`import` 一个插件 index.ts 会
 * 连带拉起它的 Vue 视图与整条渲染依赖链（实测 3 例均 5s 超时）。要锁的是「声明与
 * 取用是否一致」这一文本事实，扫描源码即可，且不受渲染环境影响。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { WORLD_SERVICE_NAMES } from '../../services'

const here = dirname(fileURLToPath(import.meta.url))
const pluginsRoot = join(here, '..', '..', 'plugins')

/** 递归收集插件目录下的全部生产源码（排除 spec 与 `__tests__`）。 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      collectSources(full, out)
    } else if (/\.(ts|vue)$/.test(entry) && !entry.endsWith('.spec.ts')) {
      out.push(full)
    }
  }
  return out
}

/** 去掉块注释与行注释（注释里提到服务名不算依赖）。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 从源码提取该插件**实际取用**的服务名。
 *
 * 两种取数写法都认：
 * - `getWorldService<T>('world.entities')` / `getWorldService('world.entities')`
 * - `ctx.get('world.projectExtras')`
 *
 * `serviceAccess.ts` 是插件级唯一取数点，被同目录其他文件经共享取值器 import 引用，
 * 故扫描整个插件目录即可自然覆盖，无需区分文件角色。
 */
function extractUsedServices(code: string): Set<string> {
  const used = new Set<string>()
  for (const match of code.matchAll(/getWorldService[^(]*\(\s*'((?:world)\.[a-zA-Z.]+)'/g)) {
    used.add(match[1]!)
  }
  for (const match of code.matchAll(/ctx\.get\(\s*'((?:world)\.[a-zA-Z.]+)'/g)) {
    used.add(match[1]!)
  }
  return used
}

/**
 * 从清单源码提取 `requires` 数组字面量。
 *
 * 两种布局并存：内联在 `index.ts`（40 个插件的现状）、独立 `manifest.ts`
 * （`mindmap` 先例）。两者都是 `requires: ['world.x', ...]` 的静态字面量写法——
 * 这条约束由 `manifest.ts` 的 `validateManifest` 保证（它只接受字符串数组）。
 */
function extractDeclaredRequires(dir: string): string[] {
  const candidates = [join(dir, 'index.ts'), join(dir, 'manifest.ts')]
  for (const file of candidates) {
    let code: string
    try {
      code = stripComments(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const match = code.match(/requires:\s*\[([^\]]*)\]/)
    if (!match) continue
    return [...match[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!)
  }
  return []
}

/** 枚举插件目录（排除 `__tests__`，要求有 index.ts 或 manifest.ts）。 */
function listPluginDirs(): string[] {
  return readdirSync(pluginsRoot)
    .filter(name => {
      const full = join(pluginsRoot, name)
      if (!statSync(full).isDirectory()) return false
      if (name === '__tests__') return false
      const entries = readdirSync(full)
      return entries.includes('index.ts') || entries.includes('manifest.ts')
    })
    .sort()
}

describe('插件依赖声明（manifest.requires）与实际取用一致', () => {
  it('每个内置插件都显式声明 kind（sprout / utility 二选一）', () => {
    // `kind` 曾靠 `manifest.ts` 的缺省语义兜底，28/41 未声明。缺省推断在「manifest 说
    // 它是什么」这一层是不可见的——侧栏分流、权限、审计都读它，必须显式。
    const missing: string[] = []
    for (const dir of listPluginDirs()) {
      const full = join(pluginsRoot, dir)
      const files = [join(full, 'index.ts'), join(full, 'manifest.ts')]
      let kind: string | undefined
      for (const file of files) {
        let code: string
        try {
          code = stripComments(readFileSync(file, 'utf8'))
        } catch {
          continue
        }
        const match = code.match(/kind:\s*'([^']+)'/)
        if (match) {
          kind = match[1]
          break
        }
      }
      if (kind === undefined) missing.push(`${dir} 未声明 kind`)
      else if (kind !== 'sprout' && kind !== 'utility') missing.push(`${dir} kind 取值非法：${kind}`)
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('声明的服务名都在权威名单内（防拼错）', () => {
    const bad: string[] = []
    for (const dir of listPluginDirs()) {
      for (const name of extractDeclaredRequires(join(pluginsRoot, dir))) {
        if (!WORLD_SERVICE_NAMES.includes(name)) bad.push(`${dir} 声明了未登记的服务：${name}`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('源码取用了服务，manifest 必须声明（防「依赖图不可见」回潮）', () => {
    const missing: string[] = []
    for (const dir of listPluginDirs()) {
      const full = join(pluginsRoot, dir)
      const used = extractUsedServices(
        stripComments(collectSources(full).map(f => readFileSync(f, 'utf8')).join('\n')),
      )
      if (used.size === 0) continue
      const declared = new Set(extractDeclaredRequires(full))
      for (const name of used) {
        if (!declared.has(name)) missing.push(`${dir} 用了 ${name} 但未在 requires 声明`)
      }
    }
    expect(missing, missing.join('\n')).toEqual([])
  })

  it('manifest 声明的服务，源码必须真的取用（防依赖图虚胖）', () => {
    const phantom: string[] = []
    for (const dir of listPluginDirs()) {
      const full = join(pluginsRoot, dir)
      const declared = extractDeclaredRequires(full)
      if (declared.length === 0) continue
      const used = extractUsedServices(
        stripComments(collectSources(full).map(f => readFileSync(f, 'utf8')).join('\n')),
      )
      for (const name of declared) {
        if (!used.has(name)) phantom.push(`${dir} 声明了 ${name} 但源码从未取用`)
      }
    }
    expect(phantom, phantom.join('\n')).toEqual([])
  })
})
