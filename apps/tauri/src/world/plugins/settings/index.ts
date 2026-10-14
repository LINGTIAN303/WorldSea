import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.settings',
  name: '设置',
  version: '1.0.0',
  description: '应用设置（全分区，含插件管理）',
  author: 'WorldSea',
  kind: 'utility' as const,
}

/**
 * 设置 overlay（插件管理面的宿主——utility 常驻装载不可停用，自锁风险不存在）：
 * 打开 = `ws-open-settings`（ctrl+, / AppMenu / 托盘入口不变）；关闭 = emit close。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'settings',
    label: '设置',
    component: defineAsyncComponent(() => import('./SettingsDialog.vue')),
    menu: { label: '设置', icon: 'settings', order: 99, shortcutId: 'settings.open' },
  })
}

export default { manifest, apply }
