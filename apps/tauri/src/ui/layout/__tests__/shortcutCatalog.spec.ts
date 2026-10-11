/**
 * shortcutCatalog 单测 —— 快捷键「注册处 ↔ 设置面板目录」全目录一致性守卫（2026-09-30 C 批）。
 *
 * 【为什么需要】快捷键要在两处出现：`useShortcuts.register()`（权威、参与分发）与
 * ui-kit 的 `SHORTCUT_CATALOG`（设置面板展示目录）。目录死条目会在设置面板里可见、
 * 可点击录制、却改键静默失败（registry 查无此 id），且违反「目录不允许出现死条目」的维护约束。
 * 2026-09-27 E7 清出的 18 条 space/project 家族、以及旧图谱导图退役（`cf68e99c`）后滞留的
 * 21 条 mindmap 家族，都是此类（2026-09-30 C 批一并清退）。本守卫沿 `boardShortcuts.spec.ts`
 * 先例把两处绑定（该文件为 outline-board 前缀的局部双向守卫，本文件为全目录版）：
 *   1. 目录里的每条 id 必须在注册处源码出现（防死条目）——注释先剥除，防「被注释满足」；
 *   2. 注册处的字面量定义（`id: 'x'` … `keys:`）必须都在目录里（防「能按但面板看不到」）；
 *   3. scope 不得回插已退役的 'space'，且须在展示顺序内；id 不得重复。
 * 已知边界：动态拼接 id（实体视图 `${entityType}.delete` 等，未目录化，见文档 §6）与
 * 纯展示清单（帮助弹窗「系统级」固定键）不参与第 2 项，见系统级豁免清单。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCOPE_ORDER, SHORTCUT_CATALOG } from '@worldsea/ui-kit/components/settings/utils'

const ROOT = process.cwd()
/** 注册处/定义所在的两棵源码树（dsh 树与旧前端无关，不扫） */
const SRC_ROOTS = [join(ROOT, 'apps', 'tauri', 'src'), join(ROOT, 'packages')]
/** 目录自身与测试目录不在「注册处」证据范围内 */
const CATALOG_FILE = join(ROOT, 'packages', 'ui-kit', 'src', 'components', 'settings', 'utils.ts')
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist'])

function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, acc)
    else if (/\.(ts|tsx|vue|js)$/.test(entry.name) && full !== CATALOG_FILE) acc.push(full)
  }
  return acc
}

/** 剥除注释：防「裸字面量被注释满足」的假绿（既有验收教训） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const SOURCES = SRC_ROOTS.flatMap(root => collectSources(root))
  .map(file => ({ file, text: stripComments(readFileSync(file, 'utf8')) }))

/** 可目录化作用域的注册处定义扫描：`id: '字面量'` 与邻近 `scope: 'global|view'` 同现
 *  （单行 register({...}) 与多行 meta 均覆盖）。policy：modal/editor 层定义不入目录
 *  （弹窗固定不可改、editor 空置保留），不参与本方向；动态拼接 id（实体视图族）非字面量，天然不在此列。 */
function definedIds(): Map<string, string> {
  const found = new Map<string, string>()
  for (const { file, text } of SOURCES) {
    for (const match of text.matchAll(/id:\s*'([^']+)'[\s\S]{0,300}?scope:\s*'(global|view)'/g)) {
      if (!found.has(match[1])) found.set(match[1], file)
    }
  }
  return found
}

const CATALOGED = new Set(SHORTCUT_CATALOG.map(item => item.id))

describe('shortcutCatalog / 目录 ⊆ 注册处（防死条目）', () => {
  it('目录里的每条 id 都能在注册处源码中找到', () => {
    const missing = SHORTCUT_CATALOG
      .filter(item => !SOURCES.some(({ text }) => text.includes(`'${item.id}'`)))
      .map(item => item.id)
    expect(missing, `目录死条目（无注册处）：${missing.join('、')}`).toEqual([])
  })

  it('已退役作用域 space 不得回插', () => {
    const spaceScoped = SHORTCUT_CATALOG.filter(item => item.scope === 'space').map(item => item.id)
    expect(spaceScoped, `已退役作用域回插：${spaceScoped.join('、')}`).toEqual([])
  })

  it('scope 均在展示顺序内，且 id 不重复', () => {
    for (const item of SHORTCUT_CATALOG) {
      expect(SCOPE_ORDER as string[], `${item.id} 的 scope 不在展示顺序中`).toContain(item.scope)
    }
    const ids = SHORTCUT_CATALOG.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('shortcutCatalog / 注册处 ⊆ 目录（防「能按但面板看不到」）', () => {
  it('注册处的字面量定义都在目录里（modal/editor 层与动态 id 按政策除外）', () => {
    const missing = [...definedIds().entries()]
      .filter(([id]) => !CATALOGED.has(id))
      .map(([id, file]) => `${id}（${file.replace(`${ROOT}\\`, '')}）`)
    expect(missing, `注册未目录化：${missing.join('、')}`).toEqual([])
  })
})
