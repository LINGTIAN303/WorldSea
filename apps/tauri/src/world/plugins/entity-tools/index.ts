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
 * 两个实体辅助对话框 overlay。
 *
 * 打开 = `ws-open-custom-rel-type` / `ws-open-entity-template`，关闭 = emit close，
 * 插件卸载 = 自动撤登记。
 *
 * 两者原先**在任何入口都打不开**（全仓零派发方，2026-11-13 实测）：既没有代码
 * dispatch 这两个事件，也没声明 `menu` 因而 AppMenu 不渲染。现补 `menu` 声明，
 * 入口由 AppMenu 按真源自动生成——收编进「声明式入口」正路，而非再加一处硬编码。
 */
export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'custom-rel-type',
    label: '自定义关系类型',
    component: defineAsyncComponent(() => import('./CustomRelationTypeDialog.vue')),
    menu: { label: '自定义关系类型', icon: 'link', order: 5 },
  })
  api.registerOverlay({
    id: 'entity-template',
    label: '实体模板',
    component: defineAsyncComponent(() => import('./EntityTemplateDialog.vue')),
    menu: { label: '实体模板', icon: 'list', order: 6 },
  })
}

export default { manifest, apply }
