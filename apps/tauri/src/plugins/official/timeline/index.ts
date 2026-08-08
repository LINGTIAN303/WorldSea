import type { PluginAPIType } from '@worldsmith/entity-core'
import TimelineView from './TimelineView.vue'

export const manifest = {
  id: 'official.timeline',
  name: '时间线',
  version: '2.0.0',
  description: '管理世界观中的历史事件与时间线',
  author: 'WorldSmith',
  agentSkills: ['worldbuilding'],
  agentCapabilities: [
    { action: 'create_entity', description: '创建事件', params: ['name', 'description'] },
    { action: 'update_entity', description: '更新事件属性', params: ['entityId', 'changes'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑事件' },
    { name: 'relations:read', description: '查询关联关系' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'event',
    label: '事件',
    icon: 'timeline',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
      { traitId: 'datable', fieldOverrides: {
        date: { label: '日期/纪年' },
        dateEnd: { label: '结束日期' },
      } },
    ],
    ownFields: [
      { key: 'era', label: '纪元', fieldType: 'text' },
      { key: 'importance', label: '重要程度', fieldType: 'select', options: ['关键', '重要', '普通', '细微'].map(s => ({ value: s, label: s })) },
      { key: 'status', label: '状态', fieldType: 'select', options: ['正史', '废案', '备选'].map(s => ({ value: s, label: s })) },
      { key: 'parentId', label: '父级事件', fieldType: 'entityRef' },
      { key: 'location', label: '发生地点', fieldType: 'text' },
    ],
  })

  api.registerView({ id: 'timeline', label: '时间线', icon: 'timeline', component: TimelineView })
}
