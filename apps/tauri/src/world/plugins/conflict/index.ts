import type { WorldPluginApi } from '../../api'
import ConflictView from './ConflictView.vue'

export const manifest = {
  id: 'official.conflict',
  domain: 'society',
  secondaryDomains: ['time'],
  name: '冲突/战争',
  version: '2.0.0',
  description: '管理世界观中的战争、战役、冲突事件',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
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
      { key: 'conflictType', label: '类型', fieldType: 'select', options: ['全面战争', '局部冲突', '内战', '起义', '侵略', '防御战', '冷冲突', '贸易战', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'scale', label: '规模', fieldType: 'select', options: ['全球', '区域', '国家', '地方', '小规模'].map(s => ({ value: s, label: s })) },
      { key: 'cause', label: '起因', fieldType: 'textarea' },
      { key: 'result', label: '结果', fieldType: 'textarea' },
      { key: 'casualties', label: '伤亡', fieldType: 'textarea' },
      { key: 'treaty', label: '和约/停战协议', fieldType: 'textarea' },
    ],
  })

  api.registerView({ id: 'conflicts', label: '冲突/战争', icon: 'combat', component: ConflictView })
}

export default { manifest, apply }
