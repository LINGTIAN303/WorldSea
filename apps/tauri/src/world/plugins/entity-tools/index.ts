import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

/**
 * 「实体工具」——两个辅助对话框：自定义关系类型 + 场景脚手架。
 *
 * 命名口径（2026-11-17 澄清）：「实体模板」改名为「场景脚手架」，因为它做的是
 * **一次性铺开一整套相互关联的世界**（`WorldTemplate` 带 `entityTemplates[]` + `relationTemplates[]`，
 * 一键建 N 个实体 + M 条关系，内置中世纪王国等预设），与 `official.templates` 的
 * 「把某个实体的配置存成模板复用」是两件事。此前两者都叫「模板」，用户与后续开发者都会混淆。
 */
export const manifest = {
  id: 'official.entity-tools',
  name: '实体工具',
  version: '1.1.0',
  description: '实体辅助对话框：自定义关系类型、场景脚手架（一键建整套世界）',
  author: 'WorldSea',
  kind: 'utility' as const,
}

/**
 * 两个辅助对话框 overlay。
 *
 * 打开 = `ws-open-custom-rel-type` / `ws-open-entity-template`，关闭 = emit close，
 * 插件卸载 = 自动撤登记。
 *
 * 两者原先**在任何入口都打不开**（全仓零派发方，2026-11-13 实测）：既没有代码
 * dispatch 这两个事件，也没声明 `menu` 因而 AppMenu 不渲染。现补 `menu` 声明，
 * 入口由 AppMenu 按真源自动生成——收编进「声明式入口」正路，而非再加一处硬编码。
 *
 * 注：overlay id `entity-template` 是**持久化契约**（`ws-open-entity-template` 事件名与
 * 既有测试都按它写），故只改显示名，不改 id。
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
    label: '场景脚手架',
    component: defineAsyncComponent(() => import('./EntityTemplateDialog.vue')),
    menu: { label: '场景脚手架', icon: 'list', order: 6 },
  })
}

export default { manifest, apply }
