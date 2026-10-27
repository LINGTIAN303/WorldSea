import type { WorldPluginApi } from '../../api'
import CodexView from './CodexView.vue'

export const manifest = {
  id: 'official.codex',
  domain: 'tool',
  entityTypes: [],
  secondaryDomains: ['knowledge'],
  name: '设定集',
  version: '1.0.0',
  description: '按语义域分章聚合阅读全部设定条目，支持整本导出 md / HTML',
  author: 'WorldSea',
  kind: 'sprout' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({
    id: 'codex', label: '设定集', icon: 'book-open',
    component: CodexView,
  })
}

export default { manifest, apply }
