import type { WorldPluginApi } from '../../api'
import PlantView from './PlantView.vue'

export const manifest = {
  id: 'official.plants',
  domain: 'life',
  entityTypes: ['plant'],
  secondaryDomains: ['goods'],
  name: '植物/生态',
  version: '2.0.0',
  description: '管理世界观中的植物、药草、菌类、魔法植物',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'plant',
    label: '植物',
    icon: 'plant',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'rateable' },
      { traitId: 'physical', fieldOverrides: {
        appearance: { label: '外观' },
        avgHeight: { label: '平均高度' },
        avgWeight: { label: '平均重量' },
      } },
    ],
    ownFields: [
      { key: 'plantType', label: '类型', fieldType: 'select', options: ['药草', '树木', '菌类', '魔法植物', '花卉', '谷物', '水生植物', '藤本', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'habitat', label: '生长环境', fieldType: 'text' },
      { key: 'usage', label: '用途', fieldType: 'multi-select', options: ['炼金', '食用', '建材', '仪式', '制毒', '纺织', '观赏'].map(s => ({ value: s, label: s })) },
      { key: 'toxicity', label: '毒性/副作用', fieldType: 'textarea' },
      { key: 'growthCycle', label: '生长周期', fieldType: 'text' },
      { key: 'relatedProducts', label: '制成品', fieldType: 'textarea' },
    ],
  })

  api.registerView({
    id: 'plants', label: '植物/生态', icon: 'plant',
    component: PlantView,
  })
}

export default { manifest, apply }
