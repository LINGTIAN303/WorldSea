import type { PluginAPIType } from '@worldsmith/entity-core'
import WeaponView from './WeaponView.vue'

export const manifest = {
  id: 'official.weapons',
  name: '武器',
  version: '2.0.0',
  description: '武器视图——展示和管理 Item 中拥有 WeaponFacet 的实体',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建武器', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新武器属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑武器' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

/**
 * 武器插件不再注册独立的 weapon 实体类型。
 * 武器是 Item + WeaponFacet 的组合。
 * 此插件仅保留视图，提供武器专属的浏览/筛选界面。
 */
export function activate(api: PluginAPIType) {
  api.registerView({ id: 'weapons', label: '武器', icon: 'weapon', component: WeaponView })
}
