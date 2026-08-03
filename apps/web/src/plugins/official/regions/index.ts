import type { PluginAPIType } from '@worldsmith/entity-core'
import RegionList from './RegionList.vue'

export const manifest = {
  id: 'official.regions',
  name: '区域图谱',
  version: '2.0.0',
  description: '管理世界观中的大陆、国家、城市、地标等地理区域',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建区域', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新区域属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑区域' },
    { name: 'relations:read', description: '查询关联关系' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'region',
    label: '区域',
    icon: 'region',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'locatable' },
    ],
    ownFields: [
      { key: 'regionType', label: '类型', type: 'select', options: ['大陆', '国家', '行省', '城市', '地标', '区域'] },
      { key: 'climate', label: '气候', type: 'select', options: ['热带雨林', '热带草原', '沙漠', '地中海', '温带海洋', '温带季风', '温带大陆', '亚寒带', '苔原', '冰原', '高原山地', '火山'] },
      { key: 'population', label: '人口', type: 'text' },
      { key: 'area', label: '面积', type: 'text' },
      { key: 'government', label: '政体/统治', type: 'select', options: ['君主专制', '君主立宪', '共和制', '联邦制', '部落制', '神权制', '军事统治', '无政府', '其他'] },
      { key: 'significance', label: '历史意义', type: 'textarea' },
    ],
  })

  api.registerView({ id: 'regions', label: '区域图谱', icon: 'region', component: RegionList })
}
