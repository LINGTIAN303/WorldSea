// @vitest-environment node
/**
 * 排除清单完整性守卫（2026-11-17）。
 *
 * 钉一件事：凡是 `import ... from '../lib/index.js'` 的 spec，必须出现在
 * `vitest.config.ts` 的 schemastery 排除清单里。
 *
 * 为什么需要：`dsh/.gitignore` 忽略 `lib/`，所以 `dsh/vendor/schemastery/lib/index.cjs`
 * 这个产物只在本地存在、克隆里没有。依赖它的 spec 于是**本地绿、CI 红**——
 * `capability-tools.spec.ts` 漏登记过一次，表现为 PR 上第 312 个文件导入失败。
 *
 * 判据取「源码里有这行 import」而非「跑一遍看会不会炸」：后者要么本地跑不出问题
 * （产物在）、要么要构造无产物环境，两者都不适合当日常门禁。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')

/** 需要排除的 spec 目录（与 vitest.config.ts 的 include 面对齐）。 */
const SPEC_DIRS = [
  'apps/dsh-plugin-worldsea/__tests__',
  'apps/dsh-plugin-worldsea-console/__tests__',
]

/**
 * vitest.config.ts 的 exclude 块里登记的排除项（相对仓根，posix 分隔符）。
 *
 * 只截 `exclude: [...]` 那一段——`include` 里同样是一堆 `'…spec.ts'` 字符串，
 * 整文件扫会把它们误当成排除条目（实测 13 条假过期）。
 */
function registeredExcludes(): string[] {
  const config = readFileSync(join(repoRoot, 'vitest.config.ts'), 'utf8')
  const start = config.indexOf('exclude: [')
  if (start === -1) return []
  // 从 `exclude: [` 起找到匹配的 `]`（内部无嵌套数组，直接找第一个 `\n    ],`）
  const end = config.indexOf('\n    ],', start)
  const block = config.slice(start, end === -1 ? undefined : end)
  return [...block.matchAll(/'([^']+\.spec\.ts)'/g)].map(match => match[1]!)
}

/** 全部 import 了本包构建产物（`lib/index.js`）的 spec（相对仓根）。 */
function specsImportingBuiltOutput(): string[] {
  const found: string[] = []
  // 两种写法都认：同目录包的 `../lib/index.js`，与跨包的 `../../<包名>/lib/index.js`
  const IMPORT_RE = /^\s*import\b[^\n]*from\s+'[^']*\/lib\/index\.js'/m
  for (const dir of SPEC_DIRS) {
    for (const file of readdirSync(join(repoRoot, dir))) {
      if (!file.endsWith('.spec.ts')) continue
      const source = readFileSync(join(repoRoot, dir, file), 'utf8')
      if (IMPORT_RE.test(source)) found.push(`${dir}/${file}`)
    }
  }
  return found.sort()
}

describe('vitest 排除清单完整性', () => {
  it('扫到的 spec 数不是 0（否则下面的断言会假通过）', () => {
    expect(specsImportingBuiltOutput().length).toBeGreaterThanOrEqual(4)
  })

  it('每个 import 构建产物的 spec 都已登记进排除清单', () => {
    const registered = new Set(registeredExcludes())
    const missing = specsImportingBuiltOutput().filter(spec => !registered.has(spec))
    expect(missing, `以下 spec 依赖 dsh 构建产物但未登记排除，会在 CI 上失败：\n${missing.join('\n')}`).toEqual([])
  })

  it('清单里登记的都是真实存在的 spec（防条目过期）', () => {
    const actual = new Set(specsImportingBuiltOutput())
    const stale = registeredExcludes().filter(spec => !actual.has(spec))
    expect(stale, `以下条目已过期（文件不存在或已不 import 产物）：\n${stale.join('\n')}`).toEqual([])
  })
})
