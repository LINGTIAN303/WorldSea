import type { WorldPluginApi } from '../../api'
import InspirationView from './InspirationView.vue'

export const manifest = {
  id: 'official.inspiration',
  domain: 'narrative',
  name: '灵感/素材库',
  version: '2.0.0',
  description: '收集创作灵感、参考图、摘抄、链接等素材',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
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
      { key: 'materialType', label: '类型', fieldType: 'select', options: ['图片', '视频', '文章', '音乐', '概念', '角色', '场景', '对话', '其他'].map(s => ({ value: s, label: s })) },
      { key: 'source', label: '来源', fieldType: 'text' },
      { key: 'url', label: 'URL', fieldType: 'text' },
      { key: 'notes', label: '创作笔记', fieldType: 'textarea' },
      { key: 'colors', label: '主色调', fieldType: 'color' },
      { key: 'boardPosition', label: '画布位置', fieldType: 'text' },
    ],
  })

  api.registerView({
    id: 'inspirations', label: '灵感/素材库', icon: 'inspiration',
    component: InspirationView,
  })
}

export default { manifest, apply }
