import type { PluginAPIType } from '@worldsmith/entity-core'
import CultureView from './CultureView.vue'

export const manifest = {
  id: 'official.culture',
  name: '文化/习俗',
  version: '2.0.0',
  description: '管理世界观中的节日、仪式、禁忌、婚丧习俗等文化细节',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建文化', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新文化属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑文化' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'culture',
    label: '文化',
    icon: 'culture',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'datable', fieldOverrides: {
        date: { label: '起始时间' },
        dateEnd: { label: '结束时间' },
      } },
    ],
    ownFields: [
      { key: 'cultureType', label: '类型', type: 'select', options: ['节日', '仪式', '禁忌', '婚俗', '丧葬', '饮食', '服饰', '艺术', '建筑风格', '其他'] },
      { key: 'cycle', label: '周期', type: 'text' },
      { key: 'origin', label: '起源', type: 'textarea' },
      { key: 'participants', label: '参与者', type: 'textarea' },
      { key: 'significance', label: '意义/象征', type: 'textarea' },
      { key: 'practices', label: '具体做法', type: 'textarea' },
    ],
  })

  api.registerView({
    id: 'culture', label: '文化/习俗', icon: 'culture',
    component: CultureView,
  })
}
