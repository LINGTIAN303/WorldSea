import type { WorldPluginApi } from '../../api'
import GlobalGraph from './GlobalGraph.vue'

export const manifest = {
  id: 'official.graph',
  domain: 'tool',
  entityTypes: [],
  name: '全局图谱',
  version: '1.0.0',
  description: '以关系图谱形式展示所有世界观实体',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({
    id: 'graph',
    label: '全局图谱',
    icon: 'graph',
    component: GlobalGraph,
    // 全屏地图：顶部 HUD 自带标题/搜索/筛选，不再叠一层视图工具条
    toolbar: 'none',
  })
}

export default { manifest, apply }
