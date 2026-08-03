import type { PluginAPIType } from '@worldsmith/entity-core'
import CustomView from './CustomView.vue'

export const manifest = {
  id: 'official.custom',
  name: '自定义视窗',
  version: '1.0.0',
  description: '界面内多窗口，自由拼装视图面板',
  author: 'WorldSmith',
  agentSkills: ['module-builder'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建自定义实体', params: ['name', 'type'] },
    { action: 'update_entity', description: '更新自定义实体', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerView({
    id: 'custom',
    label: '自定义视窗',
    icon: 'dashboard',
    component: CustomView,
  })
}
