import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { TRANSITION_PRESETS } from '../transitions'

const css = readFileSync(resolve(process.cwd(), 'packages/motion-kit/src/presets.css'), 'utf8')

describe('预设表与 presets.css 一致', () => {
  it('每个预设都有进场与退场类', () => {
    for (const preset of Object.values(TRANSITION_PRESETS)) {
      expect(css, `${preset.name} 缺少进场类`).toContain(`.${preset.name}-enter-active`)
      expect(css, `${preset.name} 缺少退场类`).toContain(`.${preset.name}-leave-active`)
    }
  })

  it('视图进场动画存在', () => {
    expect(css).toContain('@keyframes ws-view-in')
    expect(css).toContain('.view-content.is-view-entering')
  })
})

/** 尚未迁移的旧过渡名（批 1 完成后只剩批 2/3 的清单）。 */
const LEGACY_TRANSITION_NAMES = new Set([
  'dropdown',
  'fm-panel-switch',
  'g-panel',
  'lightbox',
  'ws-loading',
  'ws-toast',
  'panel-move',
  'fpp-backdrop',
  'fpp-panel',
  'fs-dropdown',
  // 背景图批（92675d9）新增未登记，静态守卫补录（快捷键整理批跑门禁时发现）
  'bg-map-fade',
])

/** 画布专用 TransitionGroup 名（由 board-motion.css 自带实现，不走全局预设表）。 */
const CANVAS_TRANSITION_NAMES = new Set(['board-card'])

function walkVue(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (['node_modules', 'dist', 'workspace-dist', '__tests__'].includes(name)) continue
      walkVue(p, out)
    } else if (name.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

describe('Transition 使用点必须命中预设或旧名单', () => {
  it('全仓静态过渡名可解析', () => {
    const known = new Set(Object.values(TRANSITION_PRESETS).map(p => p.name))
    const files = [
      ...walkVue('apps/tauri/src'),
      ...walkVue('packages/ui-kit/src'),
      ...walkVue('packages/plugin-sdk/src'),
    ]
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(/<Transition(?:Group)?[^>]*\bname="([^"]+)"/g)) {
        const name = m[1]
        if (name.includes('${')) continue
        expect(
          known.has(name) || LEGACY_TRANSITION_NAMES.has(name) || CANVAS_TRANSITION_NAMES.has(name),
          `${file} 使用了未登记的过渡名 ${name}`,
        ).toBe(true)
      }
    }
  })
})

describe('弹层家族使用统一预设', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

  it('TuiModal', () => {
    const src = read('apps/tauri/src/components/ui/TuiModal.vue')
    expect(src).toContain('<Transition name="ws-scale-fade">')
    expect(src).not.toContain('name="tui-modal"')
  })

  it('确认与询问', () => {
    const confirm = read('apps/tauri/src/ui/WsConfirmDialog.vue')
    const ask = read('apps/tauri/src/ui/WsAskDialog.vue')
    expect(confirm).toContain('<Transition name="ws-scale-fade">')
    expect(ask).toContain('<Transition name="ws-scale-fade">')
    expect(confirm).not.toContain('name="ws-confirm"')
    expect(ask).not.toContain('name="ws-ask"')
  })

  it('设置与全局搜索', () => {
    const settings = read('apps/tauri/src/world/plugins/settings/SettingsDialog.vue')
    const search = read('packages/ui-kit/src/components/search/GlobalSearch.vue')
    expect(settings).toContain('<Transition name="ws-scale-fade" appear>')
    expect(search).toContain('<Transition name="ws-scale-fade" appear>')
  })
})

describe('抽屉 / Toast / 下拉使用统一预设', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

  it('TuiDrawer', () => {
    const src = read('apps/tauri/src/components/ui/TuiDrawer.vue')
    expect(src).toContain('<Transition name="ws-fade">')
    expect(src).toContain(':name="`ws-slide-${placement}`"')
    expect(src).not.toContain('name="tui-drawer-mask"')
  })

  it('TuiToast', () => {
    const src = read('apps/tauri/src/components/ui/TuiToast.vue')
    expect(src).toContain('<TransitionGroup name="ws-slide-up">')
    expect(src).not.toContain('name="tui-toast"')
  })

  it('TuiSelect', () => {
    const src = read('apps/tauri/src/components/ui/TuiSelect.vue')
    expect(src).toContain('<Transition name="ws-menu">')
    expect(src).toContain('--ws-origin: top center')
  })
})

describe('右键菜单使用统一预设', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const files = [
    'apps/tauri/src/ui/GlobalEditMenu.vue',
    'apps/tauri/src/world/plugins/outline/board/components/BoardContextMenu.vue',
    'apps/tauri/src/world/plugins/characters/components/FamilyContextMenu.vue',
    'apps/tauri/src/world/plugins/custom/dashboard/PanelContextMenu.vue',
  ]

  it('每个菜单都包裹 ws-menu', () => {
    for (const file of files) {
      expect(read(file), `${file} 未使用 ws-menu`).toContain('<Transition name="ws-menu">')
    }
  })

  it('时间线菜单在宿主处包裹 ws-menu', () => {
    const host = read('apps/tauri/src/world/plugins/timeline/components/TimelineChart.vue')
    const menu = read('apps/tauri/src/world/plugins/timeline/components/TimelineEventMenu.vue')
    expect(host).toContain('<Transition name="ws-menu">')
    expect(menu).toContain("'--ws-origin': '0 0'")
  })
})

describe('旧过渡名清退', () => {
  it('不再使用 ws-detail-slide / ws-detail-backdrop', () => {
    const files = [
      'apps/tauri/src/world/plugins/timeline/calendar/components/CalendarEditorPanel.vue',
      'apps/tauri/src/world/plugins/characters/CharacterList.vue',
    ]
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src).not.toContain('ws-detail-slide')
      expect(src).not.toContain('ws-detail-backdrop')
    }
  })

  it('ws-menu 只在 presets.css 定义一次', () => {
    const files = [
      'packages/ui-kit/src/components/layout/ViewToolbar.vue',
      'apps/tauri/src/components/ui/ToolbarOverflow.vue',
    ]
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(src).not.toContain('.ws-menu-enter-active')
    }
  })
})

describe('详情载体使用统一预设', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const base = 'packages/plugin-sdk/src/components/'

  it('抽屉与居中弹层', () => {
    expect(read(`${base}EntityDetailPanel.vue`)).toContain('<Transition name="ws-slide-right" appear>')
    expect(read(`${base}ModalDetailView.vue`)).toContain('<Transition name="ws-scale-fade" appear>')
  })

  it('栏式 / 沉浸 / 浮窗 / 遮罩', () => {
    expect(read(`${base}ColumnDetailView.vue`)).toContain('<Transition name="ws-fade" appear>')
    expect(read(`${base}ImmersiveDetailView.vue`)).toContain('<Transition name="ws-fade" appear>')
    expect(read(`${base}FloatingDetailView.vue`)).toContain('<Transition name="ws-menu" appear>')
    expect(read(`${base}DetailBackdrop.vue`)).toContain('<Transition name="ws-fade" appear>')
  })

  it('栏式宽度随载体收展，关闭窗口保留 split 布局', () => {
    const column = read(`${base}ColumnDetailView.vue`)
    expect(column).toContain('width: 0 !important')
    expect(read('packages/plugin-sdk/src/components/GenericEntityView.vue')).toContain('useCarrierOpenWindow')
    expect(read('apps/tauri/src/world/plugins/timeline/TimelineView.vue')).toContain('useCarrierOpenWindow')
  })
})
