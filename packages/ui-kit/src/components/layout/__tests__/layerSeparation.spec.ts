/**
 * 分层守卫：共享包不得认识产品域插件的身份。
 *
 * 背景（2026-11-13 实测）：`ViewToolbar` 曾把 5 个插件的 `ws-open-*` 事件名硬编码在模板里
 * （`ws-open-doc-export` / `-batch-edit` / `-import-export` / `-template` / `-trash`）。
 * 这造成两件事：
 *   1. **分层反了**：`packages/ui-kit` 知道 `apps/tauri/src/world/plugins/*` 的具体插件 id，
 *      而依赖方向应当是 插件 → 共享包。
 *   2. **卸载语义失效**：插件被停用后，工具条菜单项仍在、点击派发无人监听 = 静默死按钮。
 *
 * 正解是「插件在自己的 `overlay.menu.slot` 里声明落点，宿主只读真源」。
 * 本守卫锁住这条线：一旦有人把具体插件 id 写回共享包，立即报红。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
/** `packages/ui-kit/src`（本 spec 位于 `src/components/layout/__tests__/`，上溯三层）。 */
const uiKitSrc = join(here, '..', '..', '..')

/** 共享包里禁止出现的「插件 overlay id → 事件名」硬编码。 */
const FORBIDDEN_EVENT_IDS = [
  'doc-export',
  'batch-edit',
  'import-export',
  'template',
  'trash',
  'search',
  'settings',
  'version',
  'theme-editor',
  'artifacts',
  'consistency',
  'custom-rel-type',
  'entity-template',
]

/** 逐个检查共享包内的 Vue/TS 源文件。 */
const FILES = [
  'components/layout/ViewToolbar.vue',
  'components/layout/ViewContainer.vue',
  'components/layout/ViewToolbarFilter.vue',
]

describe('分层守卫：ui-kit 不含任何产品域插件 id', () => {
  it('共享包源码里不出现硬编码的 `ws-open-<插件id>` 事件名', () => {
    const offenders: string[] = []
    for (const rel of FILES) {
      let code: string
      try {
        code = readFileSync(join(uiKitSrc, rel), 'utf8')
      } catch {
        continue
      }
      for (const id of FORBIDDEN_EVENT_IDS) {
        // 只抓「字符串字面量形态」的硬编码：'ws-open-xxx' 或 "ws-open-xxx"
        // 模板字符串 `ws-open-${item.id}` 是通用形式，不算——那正是声明式驱动的证据
        if (code.includes(`'ws-open-${id}'`) || code.includes(`"ws-open-${id}"`)) {
          offenders.push(`${rel} 硬编码了 ws-open-${id}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('工具条入口经 overlay 真源驱动（有 menu.slot 过滤，而非写死清单）', () => {
    const code = readFileSync(join(uiKitSrc, 'components/layout/ViewToolbar.vue'), 'utf8')
    // 声明式驱动的三个可核查特征：读真源、按 slot 过滤、用模板字符串拼事件名
    expect(code).toMatch(/pluginAPI\.getOverlays\(\)/)
    expect(code).toMatch(/slot === 'view-toolbar'/)
    expect(code).toMatch(/ws-open-\$\{/)
  })
})
