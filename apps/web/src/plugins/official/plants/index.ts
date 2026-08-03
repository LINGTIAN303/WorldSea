import type { PluginAPIType } from '@worldsmith/entity-core'
import PlantView from './PlantView.vue'

export const manifest = {
  id: 'official.plants',
  name: '植物/生态',
  version: '2.0.0',
  description: '管理世界观中的植物、药草、菌类、魔法植物',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建植物', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新植物属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑植物' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
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
      { key: 'plantType', label: '类型', type: 'select', options: ['药草', '树木', '菌类', '魔法植物', '花卉', '谷物', '水生植物', '藤本', '其他'] },
      { key: 'habitat', label: '生长环境', type: 'text' },
      { key: 'usage', label: '用途', type: 'multi-select', options: ['炼金', '食用', '建材', '仪式', '制毒', '纺织', '观赏'] },
      { key: 'toxicity', label: '毒性/副作用', type: 'textarea' },
      { key: 'growthCycle', label: '生长周期', type: 'text' },
      { key: 'relatedProducts', label: '制成品', type: 'textarea' },
    ],
  })

  api.registerView({
    id: 'plants', label: '植物/生态', icon: 'plant',
    component: PlantView,
  })
}
