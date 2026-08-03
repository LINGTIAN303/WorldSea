import type { PluginAPIType } from '@worldsmith/entity-core'
import InspirationView from './InspirationView.vue'

export const manifest = {
  id: 'official.inspiration',
  name: '灵感/素材库',
  version: '2.0.0',
  description: '收集创作灵感、参考图、摘抄、链接等素材',
  author: 'WorldSmith',
  agentSkills: [],
  agentCapabilities: [
    { action: 'get_inspiration', description: '获取灵感素材' },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑素材' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
}

export function activate(api: PluginAPIType) {
  api.registerEntityV2({
    type: 'inspiration',
    label: '素材',
    icon: 'inspiration',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'taggable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'materialType', label: '类型', type: 'select', options: ['图片', '视频', '文章', '音乐', '概念', '角色', '场景', '对话', '其他'] },
      { key: 'source', label: '来源', type: 'text' },
      { key: 'url', label: 'URL', type: 'text' },
      { key: 'notes', label: '创作笔记', type: 'textarea' },
      { key: 'colors', label: '主色调', type: 'color' },
      { key: 'boardPosition', label: '画布位置', type: 'text' },
    ],
  })

  api.registerView({
    id: 'inspirations', label: '灵感/素材库', icon: 'inspiration',
    component: InspirationView,
  })
}
