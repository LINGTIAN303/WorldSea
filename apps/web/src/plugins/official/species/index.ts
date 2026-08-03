import type { PluginAPIType } from '@worldsmith/entity-core'
import SpeciesView from './SpeciesView.vue'

export const manifest = {
  id: 'official.species',
  name: '种族/物种',
  version: '2.0.0',
  description: '管理世界观中的种族、物种及其群体属性',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建物种', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新物种属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑物种' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'species',
    label: '物种',
    icon: 'species',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'physical' },
      { traitId: 'ageable', fieldOverrides: {
        birthDate: { label: '起源时间' },
        deathDate: { label: '灭绝时间' },
      } },
    ],
    ownFields: [
      { key: 'speciesType', label: '类型', type: 'select',
        options: ['类人', '兽族', '精灵', '矮人', '龙族', '机械', '元素', '亡灵', '神话生物', '异界生物', '植物智能', '其他'] },
      { key: 'avgLifespan', label: '平均寿命', type: 'text' },
      { key: 'language', label: '语言', type: 'text' },
      { key: 'population', label: '人口/数量', type: 'number' },
      { key: 'society', label: '社会结构', type: 'textarea' },
      { key: 'abilities', label: '天赋能力', type: 'textarea' },
      { key: 'weakness', label: '弱点/缺陷', type: 'textarea' },
      { key: 'origin', label: '起源地', type: 'text' },
    ],
  })

  api.registerView({ id: 'species', label: '种族/物种', icon: 'species', component: SpeciesView })
}
