import type { PluginAPIType } from '@worldsmith/entity-core'
import MindmapView from './MindmapView.vue'

export const manifest = {
  id: 'official.mindmap',
  name: '思维导图',
  version: '1.0.0',
  description: '可视化全局关系图谱，自由探索世界观中的关联',
  author: 'WorldSmith',
  agentSkills: ['mindmap-builder'],
  agentCapabilities: [
    { action: 'create_node', description: '创建思维导图节点', params: ['parentId', 'label', 'style'] },
    { action: 'update_node', description: '更新节点', params: ['nodeId', 'changes'] },
    { action: 'delete_node', description: '删除节点', params: ['nodeId'] },
    { action: 'get_structure', description: '获取树结构' },
    { action: 'auto_layout', description: '自动布局', params: ['algorithm'] },
  ],
  permissions: [
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  // 思维导图不注册实体/关系类型——它读取已有的所有数据
  api.registerView({
    id: 'mindmap',
    label: '思维导图',
    icon: 'mindmap',
    component: MindmapView,
  })
}
