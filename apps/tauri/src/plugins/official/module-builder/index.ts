import type { PluginAPIType } from '@worldsmith/entity-core'
import ModuleBuilder from './ModuleBuilder.vue'
import { initializeComponentTypes } from './moduleConfig'

export const manifest = {
  id: 'official.module-builder',
  name: '自定义模块',
  version: '2.0.0',
  description: '图形化构建属于自己的世界观管理模块 — 槽位式拼装',
  author: 'WorldSmith',
  agentSkills: ['module-builder'],
  agentCapabilities: [
    { action: 'add_component', description: '添加组件', params: ['type', 'props'] },
    { action: 'remove_component', description: '移除组件', params: ['componentId'] },
    { action: 'update_config', description: '更新配置', params: ['config'] },
  ],
  permissions: [
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  initializeComponentTypes()
  api.registerView({
    id: 'module-builder',
    label: '自定义模块',
    icon: 'module-builder',
    component: ModuleBuilder,
  })
}
