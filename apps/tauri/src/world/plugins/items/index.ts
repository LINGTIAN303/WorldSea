import type { WorldPluginApi } from '../../api'
import ItemView from './ItemView.vue'
import { WeaponFacet, ApparelFacet } from '@worldsea/entity-core/facets'

export const manifest = {
  id: 'official.items',
  name: '道具',
  version: '2.0.0',
  description: '管理世界观中的道具、武器、装备等物品',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  // 注册 Facet
  api.registerFacet(WeaponFacet)
  api.registerFacet(ApparelFacet)

  // 注册 Item 实体（吸收原 weapon/apparel 的通用字段）
  api.registerEntityV2({
    type: 'item',
    label: '道具',
    icon: 'item',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'material' },
      { traitId: 'rateable' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '状况', options: ['完好', '轻微破损', '严重破损', '已修复', '已毁', '遗失', '未知'].map(s => ({ value: s, label: s })) },
      } },
      { traitId: 'originated' },
      { traitId: 'ownable' },
    ],
    ownFields: [
      { key: 'itemType', label: '类型', fieldType: 'select', options: [
        '武器', '防具', '衣物', '饰品', '法器', '药水/丹药', '卷轴/书籍',
        '食物', '材料', '工具', '钥匙', '货币', '信物', '神器', '杂物', '其他',
      ].map(s => ({ value: s, label: s })) },
      { key: 'era', label: '所属时代', fieldType: 'text' },
      { key: 'powers', label: '能力/功效', fieldType: 'textarea' },
      { key: 'significance', label: '价值意义', fieldType: 'textarea' },
    ],
    facets: ['weapon', 'apparel'],
  })

  api.registerView({ id: 'items', label: '道具', icon: 'item', component: ItemView })
}

export default { manifest, apply }
