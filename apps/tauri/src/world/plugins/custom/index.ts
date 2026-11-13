import type { WorldPluginApi } from '../../api'
import CustomView from './CustomView.vue'

export const manifest = {
  id: 'official.custom',
  domain: 'tool',
  entityTypes: [],
  name: '自定义视窗',
  version: '1.0.0',
  description: '界面内多窗口，自由拼装视图面板',
  author: 'WorldSea',
  kind: 'sprout' as const,
  requires: ['world.settings', 'world.ui'],
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({
    id: 'custom',
    label: '自定义视窗',
    icon: 'dashboard',
    component: CustomView,
  })
}

export default { manifest, apply }
