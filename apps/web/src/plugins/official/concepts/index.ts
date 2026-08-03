import type { PluginAPIType } from '@worldsmith/entity-core'
import ConceptView from './ConceptView.vue'

export const manifest = {
  id: 'official.concepts',
  name: '概念/设定库',
  version: '2.0.0',
  description: '世界观中的概念、规则、百科条目',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建概念', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新概念属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑概念' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'concept',
    label: '概念',
    icon: 'concept',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'conceptType', label: '类型', type: 'select',
        options: ['概念', '规则', '魔法', '科技', '文化', '历史', '宗教', '生物', '语言', '社会制度', '其他'] },
      { key: 'definition', label: '定义', type: 'textarea' },
      { key: 'aliases', label: '别名/同义词', type: 'tags' },
    ],
  })

  api.registerView({
    id: 'concepts',
    label: '概念/设定库',
    icon: 'concept',
    component: ConceptView,
  })
}
