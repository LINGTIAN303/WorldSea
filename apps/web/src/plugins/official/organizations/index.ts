import type { PluginAPIType } from '@worldsmith/entity-core'
import OrganizationView from './OrganizationView.vue'

export const manifest = {
  id: 'official.organizations',
  name: '势力/组织',
  version: '2.0.0',
  description: '管理世界观中的王国、公会、学派、家族等组织势力',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建组织', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新组织属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑组织' },
    { name: 'relations:read', description: '查询关联关系' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'organization',
    label: '组织',
    icon: 'organization',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'orgType', label: '类型', type: 'select', options: ['王国', '帝国', '共和国', '部落', '公会', '教团', '商会', '帮派', '军事组织', '秘密组织', '其他'] },
      { key: 'size', label: '规模', type: 'select', options: ['小型', '中型', '大型', '超大型'] },
      { key: 'alignment', label: '阵营', type: 'select', options: ['守序善良', '中立善良', '混沌善良', '守序中立', '绝对中立', '混沌中立', '守序邪恶', '中立邪恶', '混沌邪恶'] },
      { key: 'motto', label: '座右铭', type: 'text' },
      { key: 'headquarters', label: '总部', type: 'text' },
      { key: 'leader', label: '领袖', type: 'text' },
      { key: 'foundingDate', label: '创立日期', type: 'text' },
      { key: 'dissolutionDate', label: '解散日期', type: 'text' },
      { key: 'ideology', label: '理念/宗旨', type: 'textarea' },
    ],
  })

  api.registerView({ id: 'organizations', label: '势力/组织', icon: 'organization', component: OrganizationView })
}
