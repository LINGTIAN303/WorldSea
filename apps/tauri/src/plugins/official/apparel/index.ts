import type { PluginAPIType } from '@worldsmith/entity-core'
import ApparelView from './ApparelView.vue'

export const manifest = {
  id: 'official.apparel',
  name: '服饰/装备',
  version: '2.0.0',
  description: '服饰视图——展示和管理 Item 中拥有 ApparelFacet 的实体',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建服饰', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新服饰属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑服饰' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

/**
 * 服饰插件不再注册独立的 apparel 实体类型。
 * 服饰是 Item + ApparelFacet 的组合。
 * 此插件仅保留视图，提供服饰专属的浏览/筛选界面。
 */
export function activate(api: PluginAPIType) {
  api.registerView({ id: 'apparel', label: '服饰/装备', icon: 'apparel', component: ApparelView })
}
