import { defineAsyncComponent } from 'vue'
import type { WorldPluginApi } from '../../api'

/**
 * 「我的模板」——用户自建的实体模板库（存下常用配置，下次一键套用）。
 *
 * 命名口径（2026-11-17 澄清）：本插件与 `entity-tools` 的「场景脚手架」是**两件事**，
 * 此前两者都叫「模板」造成混淆。区别：
 * - 本插件 = **把某个实体的配置存成模板复用**（浏览 / 从实体创建 / 应用）；
 * - 场景脚手架 = **一次性生成一整套相互关联的世界**（N 个实体 + M 条关系，内置中世纪王国等）。
 * 前者是「复用配置」，后者是「铺开局」。故改名以示区分。
 */
export const manifest = {
  id: 'official.templates',
  name: '我的模板',
  version: '1.1.0',
  description: '把常用实体配置存成模板复用（区别于「场景脚手架」的一键建整套世界）',
  author: 'WorldSea',
  kind: 'utility' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerOverlay({
    id: 'template',
    label: '我的模板',
    component: defineAsyncComponent(() => import('@worldsea/ui-kit').then(m => m.TemplateManager)),
    menu: { label: '我的模板', icon: 'list', order: 13, slot: 'view-toolbar' },
  })
}

export default { manifest, apply }
