import type { WorldPluginApi } from '../../api'
import DrawingView from './DrawingView.vue'

export const manifest = {
  id: 'official.drawing',
  domain: 'tool',
  entityTypes: ['drawing'],
  name: '画板',
  version: '2.0.0',
  description: '自由绘画、植入世界观图示。支持多图层、形状工具、画板持久化。',
  author: 'WorldSea',
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerEntityV2({
    type: 'drawing',
    label: '画板',
    icon: 'drawing',
    traits: [
      { traitId: 'identifiable' },
      { traitId: 'visual' },
    ],
    ownFields: [
      { key: 'canvasData', label: '画布数据', fieldType: 'text' },
      { key: 'width', label: '宽度', fieldType: 'number' },
      { key: 'height', label: '高度', fieldType: 'number' },
      { key: 'backgroundColor', label: '背景色', fieldType: 'text' },
      { key: 'layers', label: '图层', fieldType: 'text' },
      { key: 'activeLayerIndex', label: '活跃图层', fieldType: 'number' },
      { key: 'zoom', label: '缩放', fieldType: 'number' },
      { key: 'panX', label: '平移X', fieldType: 'number' },
      { key: 'panY', label: '平移Y', fieldType: 'number' },
      { key: 'thumbnail', label: '缩略图', fieldType: 'text' },
    ],
  })

  api.registerView({
    id: 'drawing',
    label: '画板',
    icon: 'drawing',
    component: DrawingView,
    // 全屏画布：工具条悬浮胶囊，不占 44px，hover 顶部浮现
    toolbar: 'overlay',
  })
}

export default { manifest, apply }
