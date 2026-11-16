import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.import-export',
  name: '导入导出',
  version: '1.0.0',
  description: '项目数据导入导出',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'import-export',
    label: '导入导出',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.ImportExportModal)),
    menu: { label: '导入/导出', icon: 'trade', order: 12, slot: 'view-toolbar' },
  })
}

export default { manifest, apply }
