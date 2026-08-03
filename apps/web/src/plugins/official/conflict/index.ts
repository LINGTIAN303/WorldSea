import type { PluginAPIType } from '@worldsmith/entity-core'
import ConflictView from './ConflictView.vue'

export const manifest = {
  id: 'official.conflict',
  name: '冲突/战争',
  version: '2.0.0',
  description: '管理世界观中的战争、战役、冲突事件',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding', 'roleplay'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建冲突', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新冲突', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑冲突' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'conflict',
    label: '冲突',
    icon: 'combat',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'datable', fieldOverrides: {
        date: { label: '开始时间' },
        dateEnd: { label: '结束时间' },
      } },
    ],
    ownFields: [
      { key: 'conflictType', label: '类型', type: 'select', options: ['全面战争', '局部冲突', '内战', '起义', '侵略', '防御战', '冷冲突', '贸易战', '其他'] },
      { key: 'scale', label: '规模', type: 'select', options: ['全球', '区域', '国家', '地方', '小规模'] },
      { key: 'cause', label: '起因', type: 'textarea' },
      { key: 'result', label: '结果', type: 'textarea' },
      { key: 'casualties', label: '伤亡', type: 'textarea' },
      { key: 'treaty', label: '和约/停战协议', type: 'textarea' },
    ],
  })

  api.registerView({ id: 'conflicts', label: '冲突/战争', icon: 'combat', component: ConflictView })
}
