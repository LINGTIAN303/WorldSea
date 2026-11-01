import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 读取目标文件内容做契约匹配。.vue 的 scoped 样式允许外置为同名伴随 CSS
 * （`<style scoped src="./x.css">`，控制单文件规模的手法），此时 var(--sf-*)
 * 在 CSS 文件里——这里把伴随文件内容一并拼入，契约对两种形态同样生效。
 */
const read = (p: string) => {
  const main = readFileSync(resolve(process.cwd(), p), 'utf8')
  const companion = p.endsWith('.vue')
    ? resolve(process.cwd(), p.replace(/\.vue$/, '.css'))
    : null
  if (companion && existsSync(companion)) return main + readFileSync(companion, 'utf8')
  return main
}

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
  'apps/tauri/src/world/plugins/settings/settings-dialog.css',
  'apps/tauri/src/ui/home/home.css',
  'packages/ui-kit/src/components/search/GlobalSearch.vue',
  'apps/tauri/src/ui/WsConfirmDialog.vue',
  'apps/tauri/src/ui/WsAskDialog.vue',
  'apps/tauri/src/ui/GlobalEditMenu.vue',
  'apps/tauri/src/world/plugins/outline/board/components/BoardContextMenu.vue',
]

describe('B2 壳层消费表面契约', () => {
  it('窗口栏与侧栏至少消费一个 --sf-* 变量', () => {
    for (const file of B2_TARGETS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B3_TARGETS = [
  'packages/plugin-sdk/src/components/EntityCard.vue',
  'apps/tauri/src/world/plugins/outline/board/components/BoardContainerView.vue',
  'apps/tauri/src/world/plugins/outline/board/components/BoardSectionView.vue',
  'packages/ui-kit/src/components/data/DataTable.vue',
]

describe('B3 卡片与表格消费表面契约', () => {
  it('实体卡至少消费一个 --sf-* 变量', () => {
    for (const file of B3_TARGETS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_SETTINGS = ['packages/ui-kit/src/components/settings/settings-panels.css']

describe('B4 设置表单控件消费表面契约', () => {
  it('控件至少消费一个 --sf-* 变量', () => {
    for (const file of B4_SETTINGS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_DETAIL = [
  'packages/plugin-sdk/src/components/EntityDetailPanel.vue',
  'packages/plugin-sdk/src/components/ModalDetailView.vue',
  'packages/plugin-sdk/src/components/ColumnDetailView.vue',
  'packages/plugin-sdk/src/components/FloatingDetailView.vue',
  'packages/plugin-sdk/src/components/EntityFormModal.vue',
  'packages/plugin-sdk/src/detail/carrier-chrome.css',
]

describe('B4 详情载体消费表面契约', () => {
  it('每个载体至少消费一个 --sf-* 变量', () => {
    for (const file of B4_DETAIL) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_TOOLBAR = [
  'packages/ui-kit/src/components/layout/ViewToolbar.vue',
  'packages/ui-kit/src/components/layout/ViewToolbarFilter.vue',
  'packages/plugin-sdk/src/components/CustomDropdown.vue',
  'apps/tauri/src/components/ui/ToolbarOverflow.vue',
]

describe('B4 工具栏与下拉消费表面契约', () => {
  it('每个入口至少消费一个 --sf-* 变量', () => {
    for (const file of B4_TOOLBAR) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_MODALS = [
  'packages/ui-kit/src/components/editor/ColorPickerDialog.vue',
  // 两弹层的 scoped 样式均已外置为伴随 CSS（控制单文件规模），契约直接指向 CSS
  'packages/ui-kit/src/components/data/import-export-modal.css',
  'packages/plugin-sdk/src/components/batch-edit-modal.css',
]

describe('B4 共享弹层消费表面契约', () => {
  it('每个弹层至少消费一个 --sf-* 变量', () => {
    for (const file of B4_MODALS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_LISTS = [
  // FolderTree 的 scoped 样式已外置到 folder-tree.css（fd06a80），契约消费方随之改为样式文件
  'apps/tauri/src/world/plugins/notebook/components/folder-tree.css',
  'apps/tauri/src/world/plugins/manuscript/components/ChapterList.vue',
  'apps/tauri/src/world/plugins/outline/board/components/NodeSidebar.vue',
]

describe('B4 列表行消费表面契约', () => {
  it('每个列表至少消费一个 --sf-* 变量', () => {
    for (const file of B4_LISTS) {
      expect(read(file), `${file} 未接入表面契约`).toMatch(/var\(--sf-/)
    }
  })
})

const B4_RADIUS = [
  'packages/plugin-sdk/src/components/EntityCard.vue',
  'packages/plugin-sdk/src/components/ModalDetailView.vue',
  'packages/ui-kit/src/components/settings/settings-panels.css',
  'packages/ui-kit/src/components/layout/ViewToolbar.vue',
]

describe('B4 形变轴覆盖', () => {
  it('关键表面圆角消费 --sf-radius-scale', () => {
    for (const file of B4_RADIUS) {
      expect(read(file), `${file} 未接入形变轴`).toContain('var(--sf-radius-scale)')
    }
  })
})

const B4_PRESS = [
  'packages/ui-kit/src/components/settings/settings-panels.css',
  'packages/ui-kit/src/components/layout/ViewToolbar.vue',
]

describe('B4 触感轴覆盖', () => {
  it('控件按压消费 --sf-press-scale', () => {
    for (const file of B4_PRESS) {
      expect(read(file), `${file} 未接入触感轴`).toContain('var(--sf-press-scale')
    }
  })
})
