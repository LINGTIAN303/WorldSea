import type { WorldPluginApi } from '../../api'
import CreatureView from './CreatureView.vue'

export const manifest = {
  id: 'official.creatures',
  domain: 'life',
  entityTypes: ['creature'],
  secondaryDomains: ['goods'],
  name: '生物图鉴',
  version: '1.0.0',
  description: '管理世界观中的动物、魔兽与异种生物',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'creature',
    label: '生物',
    icon: 'paw',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'rateable' },
      { traitId: 'physical', fieldOverrides: {
        appearance: { label: '外观' },
        avgHeight: { label: '平均体高' },
        avgWeight: { label: '平均体重' },
      } },
    ],
    ownFields: [
      { key: 'creatureType', label: '类别', fieldType: 'select', options: ['走兽', '飞禽', '水族', '虫豸', '魔兽', '异种', '元素生物', '不死生物', '机械造物', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'dangerLevel', label: '危险度', fieldType: 'select', options: ['无害', '低危', '中危', '高危', '灾厄'].map(s => ({ value: s, label: s })) },
      { key: 'diet', label: '食性', fieldType: 'select', options: ['草食', '肉食', '杂食', '腐食', '吸能', '未知'].map(s => ({ value: s, label: s })) },
      { key: 'size', label: '体型', fieldType: 'select', options: ['微型', '小型', '中型', '大型', '巨型', '超巨'].map(s => ({ value: s, label: s })) },
      { key: 'temperament', label: '性情', fieldType: 'select', options: ['温顺', '胆小', '领地意识', '凶猛', '群袭', '不可预测'].map(s => ({ value: s, label: s })) },
      { key: 'habitat', label: '栖息环境', fieldType: 'text' },
      { key: 'abilities', label: '能力', fieldType: 'textarea' },
      { key: 'weakness', label: '弱点', fieldType: 'textarea' },
      { key: 'yield', label: '产出物', fieldType: 'text' },
    ],
  })

  api.registerView({
    id: 'creatures', label: '生物图鉴', icon: 'paw',
    component: CreatureView,
  })
}

export default { manifest, apply }
