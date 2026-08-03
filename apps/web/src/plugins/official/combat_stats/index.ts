import type { PluginAPIType } from '@worldsmith/entity-core'
import CombatStatView from './CombatStatView.vue'

export const manifest = { id: 'official.combat_stats', name: '战力', version: '2.0.0', description: '管理角色战斗力数据', author: 'WorldSmith',
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
      { key: 'system', label: '体系', type: 'select', options: ['境界制', '等级制', '数值制'] },
      { key: 'tier', label: '层级排序', type: 'number' },
      { key: 'realm', label: '境界/等级', type: 'text' },
      { key: 'promotion', label: '晋升条件', type: 'textarea' },
      { key: 'bottleneck', label: '瓶颈/突破难点', type: 'textarea' },
      { key: 'power', label: '战力表现', type: 'textarea' },
      { key: 'culture', label: '所属文化圈', type: 'select', options: ['中式', '西式', '混合'] },
    ],
  })

  api.registerView({ id: 'combat_stats', label: '战力', icon: 'combat', component: CombatStatView })
}
