import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.theme-editor',
  name: '主题编辑器',
  version: '1.0.0',
  description: '主题编辑器（Quick/Pro/Code 三模式）',
  author: 'WorldSea',
  kind: 'utility' as const,
}

/** 主题编辑器 overlay：打开 = `ws-open-theme-editor`（外观面板按钮等入口不变），关闭 = emit close。 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'theme-editor',
    label: '主题编辑器',
    component: defineAsyncComponent(() => import('./ThemeEditor.vue')),
    menu: { label: '主题编辑器', icon: 'palette', order: 5 },
  })
}

export default { manifest, apply }
