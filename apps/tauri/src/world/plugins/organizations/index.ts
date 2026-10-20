import type { WorldPluginApi } from '../../api'
import OrganizationView from './OrganizationView.vue'

export const manifest = {
  id: 'official.organizations',
  domain: 'society',
  entityTypes: ['organization'],
  secondaryDomains: ['life'],
  name: '势力/组织',
  version: '2.0.0',
  description: '管理世界观中的王国、公会、学派、家族等组织势力',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
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
      { key: 'orgType', label: '类型', fieldType: 'select', options: ['王国', '帝国', '共和国', '部落', '公会', '教团', '商会', '帮派', '军事组织', '秘密组织', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'size', label: '规模', fieldType: 'select', options: ['小型', '中型', '大型', '超大型'].map(s => ({ value: s, label: s })) },
      { key: 'alignment', label: '阵营', fieldType: 'select', options: ['守序善良', '中立善良', '混沌善良', '守序中立', '绝对中立', '混沌中立', '守序邪恶', '中立邪恶', '混沌邪恶'].map(s => ({ value: s, label: s })) },
      { key: 'motto', label: '座右铭', fieldType: 'text' },
      { key: 'headquarters', label: '总部', fieldType: 'text' },
      { key: 'leader', label: '领袖', fieldType: 'text' },
      { key: 'foundingDate', label: '创立日期', fieldType: 'text' },
      { key: 'dissolutionDate', label: '解散日期', fieldType: 'text' },
      { key: 'ideology', label: '理念/宗旨', fieldType: 'textarea' },
    ],
  })

  api.registerView({ id: 'organizations', label: '势力/组织', icon: 'organization', component: OrganizationView })
}

export default { manifest, apply }
