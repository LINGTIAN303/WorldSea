import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.version-history',
  name: '版本历史',
  version: '1.0.0',
  description: '实体版本历史',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'version',
    label: '版本历史',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.VersionHistory)),
    menu: { label: '最近修改', icon: 'timeline', order: 2 },
  })
}

export default { manifest, apply }
