import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.search',
  name: '全局搜索',
  version: '1.0.0',
  description: '全局搜索（Ctrl+K）',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'search',
    label: '全局搜索',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.GlobalSearch)),
    menu: { label: '搜索', icon: 'search', order: 1, shortcutId: 'search.open' },
  })
}

export default { manifest, apply }
