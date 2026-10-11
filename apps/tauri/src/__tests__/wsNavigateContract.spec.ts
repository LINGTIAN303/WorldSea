import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ws-navigate 事件契约守卫（2026-10-08 全链修复）。
 *
 * 契约 = `{ entityType, entityId }`。修复以前四路口径并存（view=实体类型 / view=视图 id /
 * type+entityType / 无 view），Shell handler 只认其中一种 ⇒ 多数调用者「只选中、不切视图」。
 * 本守卫锁三件事：
 * 1. 全部派发点的形状（含 entityType、不再出现 view: / type:'entity' 旧形状）；
 * 2. Shell handler 的读法（单一口径读 entityType + 写挂起位）；
 * 3. 三处消费组件的监听注册/注销成对（调用形状正则，非裸串——裸串会被同文件的旁证满足）。
 *
 * 计数下限（≥20 派发点）是**测量面自检**：扫描规则失效时 0 命中会让下面「全部通过」，
 * 必须让它先红。
 */

const APP_SRC = join(__dirname, '..')
const REPO = join(__dirname, '..', '..', '..', '..')
const SCAN_ROOTS = [
  APP_SRC,
  join(REPO, 'packages', 'plugin-sdk', 'src'),
  join(REPO, 'packages', 'ui-kit', 'src'),
]

interface Hit { file: string; snippet: string }

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      walk(full, out)
    } else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
}

/** 全部 ws-navigate 派发点（含其后的 detail 对象片段，派发可能跨行书写） */
function collectDispatches(): Hit[] {
  const hits: Hit[] = []
  for (const root of SCAN_ROOTS) {
    const files: string[] = []
    walk(root, files)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/new CustomEvent\(\s*['"]ws-navigate['"]/g)) {
        hits.push({
          file: file.replace(/\\/g, '/').split('/src/').slice(1).join('/src/'),
          snippet: src.slice(m.index, m.index + 200).replace(/\s+/g, ' '),
        })
      }
    }
  }
  return hits
}

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

describe('ws-navigate 契约', () => {
  const dispatches = collectDispatches()

  it('派发点全覆盖（防扫描面失效：规则坏了会先在这里红）', () => {
    expect(dispatches.length).toBeGreaterThanOrEqual(20)
  })

  it('每个派发点都带 entityType，且不再出现 view: / type:\'entity\' 旧形状', () => {
    for (const d of dispatches) {
      expect(d.snippet, `${d.file} 的派发缺 entityType`).toContain('entityType')
      expect(d.snippet, `${d.file} 残留 view: 旧口径`).not.toMatch(/\bview\s*:/)
      expect(d.snippet, `${d.file} 残留 type:'entity' 旧口径`).not.toMatch(/type:\s*'entity'/)
    }
  })

  it('Shell handler 单一口径：读 entityType、写挂起位（挂载兜底通道）', () => {
    const shell = read('apps/tauri/src/ui/layout/Shell.vue')
    expect(shell).toContain('const { entityType, entityId } = detail')
    expect(shell).not.toContain('view: entityType')
    expect(shell).toContain('uiStore.selectEntity(entityId)')
  })

  it('消费组件监听注册与注销成对（调用形状正则，非裸串）', () => {
    const consumers: Array<[string, string]> = [
      ['packages/plugin-sdk/src/components/GenericEntityView.vue', 'GenericEntityView'],
      ['apps/tauri/src/world/plugins/timeline/TimelineView.vue', 'TimelineView'],
      ['apps/tauri/src/world/plugins/characters/CharacterList.vue', 'CharacterList'],
    ]
    for (const [rel, name] of consumers) {
      const src = read(rel)
      expect(src, `${name} 缺注册`).toMatch(/addEventListener\('ws-select-entity',\s*onWsSelectEntity\)/)
      expect(src, `${name} 缺注销`).toMatch(/removeEventListener\('ws-select-entity',\s*onWsSelectEntity\)/)
    }
  })
})
