import type { WorldPluginApi } from '../../api'
import FaithView from './FaithView.vue'

export const manifest = {
  id: 'official.faith',
  domain: 'society',
  entityTypes: ['faith'],
  name: '信仰',
  version: '1.0.0',
  description: '管理世界观中的神祇、教义、仪式与圣地',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'faith',
    label: '信仰',
    icon: 'sparkles',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'rateable' },
    ],
    ownFields: [
      { key: 'faithType', label: '信仰类型', fieldType: 'select', options: ['多神教', '一神教', '泛灵信仰', '祖先崇拜', '图腾崇拜', '哲学信条', '秘密教派', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'deities', label: '神祇', fieldType: 'textarea' },
      { key: 'doctrine', label: '核心教义', fieldType: 'textarea' },
      { key: 'origin', label: '起源传说', fieldType: 'textarea' },
      { key: 'ritual', label: '主要仪式', fieldType: 'textarea' },
      { key: 'taboo', label: '禁忌', fieldType: 'textarea' },
      { key: 'scripture', label: '经文圣典', fieldType: 'text' },
      { key: 'holySymbol', label: '圣徽圣物', fieldType: 'text' },
      { key: 'clergy', label: '神职体系', fieldType: 'textarea' },
      { key: 'scope', label: '传播范围', fieldType: 'select', options: ['世界主流', '区域国教', '民间信仰', '秘密教派', '已消亡', '其他'].map(s => ({ value: s, label: s })) },
    ],
  })

  api.registerView({
    id: 'faith', label: '信仰', icon: 'sparkles',
    component: FaithView,
  })
}

export default { manifest, apply }
