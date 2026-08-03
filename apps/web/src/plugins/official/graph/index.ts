import type { PluginAPIType } from '@worldsmith/entity-core'
import GlobalGraph from './GlobalGraph.vue'

export const manifest = {
  id: 'official.graph',
  name: '全局图谱',
  version: '1.0.0',
  description: '以关系图谱形式展示所有世界观实体',
  author: 'WorldSmith',
  agentSkills: ['graph-explorer'],
  agentCapabilities: [
    { action: 'get_nodes', description: '获取图谱节点列表', params: ['type', 'keyword'] },
    { action: 'get_edges', description: '获取图谱边列表', params: ['sourceId', 'targetId', 'type'] },
    { action: 'find_path', description: '查找两节点间最短路径', params: ['sourceId', 'targetId'] },
    { action: 'cluster_analysis', description: '聚类分析', params: ['method'] },
    { action: 'highlight_nodes', description: '高亮指定节点', params: ['nodeIds'] },
  ],
  permissions: [
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerView({
    id: 'graph',
    label: '全局图谱',
    icon: 'graph',
    component: GlobalGraph,
  })
}
