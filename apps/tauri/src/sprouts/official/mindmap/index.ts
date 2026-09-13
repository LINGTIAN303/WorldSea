import type { PluginAPIType } from '@worldsea/entity-core'
import MindmapView from './MindmapView.vue'

export const manifest = {
  id: 'official.mindmap',
  name: '思维导图',
  version: '2.0.0',
  description: '真正的树状思维导图——发散构思、整理世界观想法；节点可绑定实体，构思成熟后一键跳转落地',
  author: 'WorldSea',
  // Agent 桥接（生成/整理导图结构）规划为二期，暂不声明 capability
  agentSkills: [],
  agentCapabilities: [],
  permissions: [
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerView({
    id: 'mindmap',
    label: '思维导图',
    icon: 'mindmap',
    component: MindmapView,
  })
}
