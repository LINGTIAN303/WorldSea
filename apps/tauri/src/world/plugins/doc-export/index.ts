import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.doc-export',
  name: '文档导出',
  version: '1.0.0',
  description: '文档导出',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'doc-export',
    label: '文档导出',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.DocExport)),
  })
}

export default { manifest, apply }
