import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.data-tools',
  name: '数据工具',
  version: '1.0.0',
  description: '数据管理面板组：回收站、随笔面板、一致性报告',
  author: 'WorldSea',
  kind: 'utility' as const,
}

/**
 * 三个全局覆盖层的登记（overlay 贡献位；defineAsyncComponent 保持原 Shell 侧懒加载语义）：
 * 打开 = `ws-open-trash / ws-open-artifacts / ws-open-consistency` 全局事件（菜单/快捷键/Agent 事件不变）；
 * 关闭 = 面板 emit close；插件卸载 = 自动撤登记（入口静默失效）。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({ id: 'trash', label: '回收站', component: defineAsyncComponent(() => import('./TrashPanel.vue')) })
  api.registerOverlay({ id: 'artifacts', label: '随笔面板', component: defineAsyncComponent(() => import('./ArtifactsPanel.vue')), menu: { label: '随笔', icon: 'document', order: 4 } })
  api.registerOverlay({ id: 'consistency', label: '一致性报告', component: defineAsyncComponent(() => import('./ConsistencyReportPanel.vue')), menu: { label: '一致性检查', icon: 'shield', order: 3 } })
}

export default { manifest, apply }
