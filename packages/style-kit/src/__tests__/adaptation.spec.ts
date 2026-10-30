import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const TARGETS = [
  'packages/ui-kit/src/components/TuiButton.vue',
  'apps/tauri/src/components/ui/TuiSegmented.vue',
  'apps/tauri/src/components/ui/TuiCheckbox.vue',
  'apps/tauri/src/components/ui/TuiSelect.vue',
  'apps/tauri/src/components/ui/TuiModal.vue',
  'apps/tauri/src/components/ui/TuiDrawer.vue',
  'apps/tauri/src/components/ui/TuiToast.vue',
  'packages/ui-kit/src/components/feedback/Toast.vue',
  'packages/ui-kit/src/components/tooltip/globalTooltip.ts',
]

describe('B1 基础原子消费表面契约', () => {
  it('每个目标文件至少消费一个 --sf-* 变量', () => {
    for (const file of TARGETS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })

  it('按压反馈统一走 --sf-press-scale', () => {
    const pressFiles = [
      'packages/ui-kit/src/components/TuiButton.vue',
      'apps/tauri/src/components/ui/TuiSegmented.vue',
      'apps/tauri/src/components/ui/TuiCheckbox.vue',
      'apps/tauri/src/components/ui/TuiSelect.vue',
      'apps/tauri/src/components/ui/TuiModal.vue',
      'apps/tauri/src/components/ui/TuiDrawer.vue',
      'apps/tauri/src/components/ui/TuiToast.vue',
    ]
    for (const file of pressFiles) {
      expect(read(file), `${file}`).toContain('var(--sf-press-scale')
    }
  })
})

const B2_TARGETS = [
  'apps/tauri/src/ui/layout/TitleBar.vue',
  'apps/tauri/src/ui/layout/sidebar/SidebarV2.vue',
]

describe('B2 壳层消费表面契约', () => {
  it('窗口栏与侧栏至少消费一个 --sf-* 变量', () => {
    for (const file of B2_TARGETS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})
