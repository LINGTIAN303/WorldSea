import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.batch-edit',
  name: '批量编辑',
  version: '1.0.0',
  description: '实体批量编辑',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'batch-edit',
    label: '批量编辑',
    component: defineAsyncComponent(() => import('@worldsea/plugin-sdk').then(m => m.BatchEditModal)),
  })
}

export default { manifest, apply }
