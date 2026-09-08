import type { PluginAPIType } from '@worldsea/entity-core'
import ManuscriptView from './ManuscriptView.vue'

export const manifest = {
  id: 'official.manuscript',
  name: '正文写作',
  version: '2.0.0',
  description: '正文写作与章节管理',
  author: 'WorldSea',
  agentSkills: ['writing'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建章节', params: ['title'] },
    { action: 'update_entity', description: '更新章节', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑章节' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'manuscript',
    label: '正文',
    icon: 'manuscript',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
      { traitId: 'narrative' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状态', options: ['草稿', '修订中', '终稿'].map(s => ({ value: s, label: s })) },
      } },
    ],
    ownFields: [
      { key: 'outlineNodeId', label: '关联大纲节点ID', fieldType: 'text' },
      { key: 'volumeName', label: '所属卷名', fieldType: 'text' },
      { key: 'entityMentions', label: '提及实体ID列表', fieldType: 'text' },
      { key: 'snapshots', label: '版本快照', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'manuscript', label: '正文写作', icon: 'manuscript', component: ManuscriptView })
}
