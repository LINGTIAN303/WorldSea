import type { PluginAPIType } from '@worldsmith/entity-core'
import BuildingView from './BuildingView.vue'

export const manifest = {
  id: 'official.buildings',
  name: '建筑/地点细节',
  version: '2.0.0',
  description: '管理世界观中的建筑、室内场景、地点细节',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建建筑', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新建筑属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑建筑' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'building',
    label: '建筑',
    icon: 'building',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'locatable' },
      { traitId: 'deteriorable', fieldOverrides: {
        condition: { label: '现状', options: ['完好', '轻度损毁', '严重损毁', '废墟', '修缮中', '改建中'] },
      } },
    ],
    ownFields: [
      { key: 'buildingType', label: '类型', type: 'select', options: ['城堡', '宫殿', '寺庙', '酒馆', '商店', '工坊', '图书馆', '学院', '兵营', '监狱', '港口', '塔楼', '城墙', '民居', '地下城', '其他'] },
      { key: 'floors', label: '层数', type: 'text' },
      { key: 'area', label: '面积', type: 'text' },
      { key: 'style', label: '建筑风格', type: 'select', options: ['哥特', '罗马', '东方', '精灵', '矮人', '蒸汽朋克', '未来', '原始', '混合', '其他'] },
      { key: 'era', label: '建造年代', type: 'text' },
      { key: 'builder', label: '建造者', type: 'text' },
      { key: 'materials', label: '主要建材', type: 'textarea' },
      { key: 'significance', label: '历史意义', type: 'textarea' },
    ],
  })

  api.registerView({ id: 'buildings', label: '建筑/地点细节', icon: 'building', component: BuildingView })
}
