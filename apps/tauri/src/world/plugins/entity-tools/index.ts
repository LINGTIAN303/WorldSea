import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

export const manifest = {
  id: 'official.entity-tools',
  name: '实体工具',
  version: '1.0.0',
  description: '实体辅助对话框：自定义关系类型、实体模板',
  author: 'WorldSea',
  kind: 'utility' as const,
}

/**
 * 两个实体辅助对话框 overlay：
 * 打开 = `ws-open-custom-rel-type` / `ws-open-entity-template`（全局事件，入口不变）；
 * 关闭 = emit close；插件卸载 = 自动撤登记。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'custom-rel-type',
    label: '自定义关系类型',
    component: defineAsyncComponent(() => import('./CustomRelationTypeDialog.vue')),
  })
  api.registerOverlay({
    id: 'entity-template',
    label: '实体模板',
    component: defineAsyncComponent(() => import('./EntityTemplateDialog.vue')),
  })
}

export default { manifest, apply }
