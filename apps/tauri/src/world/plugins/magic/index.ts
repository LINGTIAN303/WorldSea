import type { WorldPluginApi } from '../../api'
import MagicView from './MagicView.vue'

export const manifest = {
  id: 'official.magic',
  domain: 'knowledge',
  entityTypes: ['magic'],
  secondaryDomains: ['society'],
  name: '魔法/技能体系',
  version: '2.0.0',
  description: '管理世界观中的魔法体系、技能、法术',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'magic',
    label: '技能',
    icon: 'magic',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'magicType', label: '体系', fieldType: 'select', options: ['元素', '黑暗', '光明', '自然', '时间', '空间', '心灵', '召唤', '炼金', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'level', label: '等级/阶位', fieldType: 'select', options: ['入门', '初级', '中级', '高级', '大师', '传说', '神级'].map(s => ({ value: s, label: s })) },
      { key: 'cost', label: '消耗', fieldType: 'text' },
      { key: 'castingTime', label: '施法时间', fieldType: 'text' },
      { key: 'duration', label: '持续时间', fieldType: 'text' },
      { key: 'range', label: '范围/射程', fieldType: 'text' },
      { key: 'requirements', label: '学习条件', fieldType: 'textarea' },
      { key: 'effects', label: '效果', fieldType: 'textarea' },
      { key: 'sideEffects', label: '副作用', fieldType: 'textarea' },
      { key: 'magicSource', label: '来源', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'magic', label: '魔法/技能体系', icon: 'magic', component: MagicView })
}

export default { manifest, apply }
