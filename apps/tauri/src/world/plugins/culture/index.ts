import type { WorldPluginApi } from '../../api'
import CultureView from './CultureView.vue'

export const manifest = {
  id: 'official.culture',
  domain: 'society',
  secondaryDomains: ['time'],
  name: '文化/习俗',
  version: '2.0.0',
  description: '管理世界观中的节日、仪式、禁忌、婚丧习俗等文化细节',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
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
      { key: 'cultureType', label: '类型', fieldType: 'select', options: ['节日', '仪式', '禁忌', '婚俗', '丧葬', '饮食', '服饰', '艺术', '建筑风格', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'cycle', label: '周期', fieldType: 'text' },
      { key: 'origin', label: '起源', fieldType: 'textarea' },
      { key: 'participants', label: '参与者', fieldType: 'textarea' },
      { key: 'significance', label: '意义/象征', fieldType: 'textarea' },
      { key: 'practices', label: '具体做法', fieldType: 'textarea' },
    ],
  })

  api.registerView({
    id: 'culture', label: '文化/习俗', icon: 'culture',
    component: CultureView,
  })
}

export default { manifest, apply }
