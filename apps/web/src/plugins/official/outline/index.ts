import type { PluginAPIType } from '@worldsmith/entity-core'
import OutlineView from './OutlineView.vue'

export const manifest = {
  id: 'official.outline',
  name: '大纲',
  version: '2.0.0',
  description: '大纲管理与章节规划',
  author: 'WorldSmith',
  agentSkills: ['writing'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建大纲节点', params: ['title'] },
    { action: 'update_entity', description: '更新大纲节点', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑大纲节点' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'outline_node',
    label: '大纲节点',
    icon: 'outline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状态', options: ['未写', '草稿', '完成'] },
      } },
    ],
    ownFields: [
      { key: 'parentId', label: '父节点ID', type: 'text' },
      { key: 'storylines', label: '所属线索', type: 'text' },
      { key: 'manuscriptId', label: '关联章节ID', type: 'text' },
    ],
  })

  api.registerView({ id: 'outline', label: '大纲', icon: 'outline', component: OutlineView })
}
