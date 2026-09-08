import type { PluginAPIType } from '@worldsea/entity-core'
import CombatStatView from './CombatStatView.vue'

export const manifest = { id: 'official.combat_stats', name: '战力', version: '2.0.0', description: '管理角色战斗力数据', author: 'WorldSea',
  agentSkills: ['analysis-engine'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建战斗属性', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新战斗属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑战力' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'combat_stat',
    label: '战力',
    icon: 'combat',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'system', label: '体系', fieldType: 'select', options: ['境界制', '等级制', '数值制'].map(s => ({ value: s, label: s })) },
      { key: 'tier', label: '层级排序', fieldType: 'number' },
      { key: 'realm', label: '境界/等级', fieldType: 'text' },
      { key: 'promotion', label: '晋升条件', fieldType: 'textarea' },
      { key: 'bottleneck', label: '瓶颈/突破难点', fieldType: 'textarea' },
      { key: 'power', label: '战力表现', fieldType: 'textarea' },
      { key: 'culture', label: '所属文化圈', fieldType: 'select', options: ['中式', '西式', '混合'].map(s => ({ value: s, label: s })) },
    ],
  })

  api.registerView({ id: 'combat_stats', label: '战力', icon: 'combat', component: CombatStatView })
}
