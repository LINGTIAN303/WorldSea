import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.templates',
  name: '模板管理',
  version: '1.0.0',
  description: '实体模板管理',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'template',
    label: '模板管理',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.TemplateManager)),
  })
}

export default { manifest, apply }
