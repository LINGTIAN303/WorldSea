/**
 * ALT+←/→ 切页接线守卫（2026-10-08 Tab 优化批 B）。
 *
 * 算法单点（adjacentTabId）与 DetailShell 行为另有 spec；本守卫锁「接线还在」：
 * GEV（per-type 动态 id）与 TimelineView（timeline.* 字面量）都注册了 alt 键并接到
 * switchTabBy，目录（SHORTCUT_CATALOG）里 timeline 两键可被「注册处 ⊆ 目录」守卫核对。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(__dirname, '..', '..', '..', '..')

function read(rel: string): string {
  return readFileSync(join(REPO, rel), 'utf8')
}

describe('ALT+←/→ 切页接线', () => {
  it('GEV：注册 per-type 的 tab-prev/tab-next（alt 键）并接 switchTabBy', () => {
    const src = read('packages/plugin-sdk/src/components/GenericEntityView.vue')
    expect(src).toMatch(/id: `\$\{props\.entityType\}\.tab-prev`/)
    expect(src).toMatch(/id: `\$\{props\.entityType\}\.tab-next`/)
    expect(src).toMatch(/keys: \['alt', 'left'\]/)
    expect(src).toMatch(/keys: \['alt', 'right'\]/)
    expect(src).toMatch(/handler: \(\) => switchTabBy\(-1\)/)
    expect(src).toMatch(/handler: \(\) => switchTabBy\(1\)/)
    expect(src).toMatch(/adjacentTabId\(resolvedTabs\.value/)
  })

  it('TimelineView：注册 timeline.tab-prev/tab-next 并接 switchTabBy', () => {
    // 2026-10-24 T4：注册收拢到 useTimelineKeyboard（视图压尺寸基线），接线与注销成对仍锁住
    const src = read('apps/tauri/src/world/plugins/timeline/composables/useTimelineKeyboard.ts')
    expect(src).toContain('timeline.tab-prev')
    expect(src).toContain('timeline.tab-next')
    expect(src).toMatch(/keys: \['alt', 'left'\]/)
    expect(src).toMatch(/keys: \['alt', 'right'\]/)
    expect(src).toMatch(/switchTabBy\(-1\)/)
    expect(src).toMatch(/switchTabBy\(1\)/)
    // 注销成对（注册表不随组件销毁清理——不注销会叠陈闭包）
    expect(src).toMatch(/for \(const id of ids\) unregister\(id\)/)
    const view = read('apps/tauri/src/world/plugins/timeline/TimelineView.vue')
    expect(view).toMatch(/adjacentTabId\(detailTabs\.value/)
  })

  it('目录双登记：SHORTCUT_CATALOG 含 timeline 两键（注册处 ⊆ 目录守卫的凭据）', () => {
    const src = read('packages/ui-kit/src/components/settings/utils.ts')
    expect(src).toMatch(/\{ id: 'timeline\.tab-prev',[^}]*keys: \['alt', 'left'\], scope: 'view' \}/)
    expect(src).toMatch(/\{ id: 'timeline\.tab-next',[^}]*keys: \['alt', 'right'\], scope: 'view' \}/)
  })
})
