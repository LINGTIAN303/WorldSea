import type { WorldPluginApi } from '../../api'
import DrawingView from './DrawingView.vue'

export const manifest = {
  id: 'official.drawing',
  name: '画板',
  version: '2.0.0',
  description: '自由绘画、植入世界观图示。支持多图层、形状工具、画板持久化。',
  author: 'WorldSea',
  agentSkills: ['image-generation'],
  agentCapabilities: [
    { action: 'create_drawing', description: '创建画板', params: ['name', 'width', 'height'] },
    { action: 'update_drawing', description: '更新画板', params: ['drawingId', 'changes'] },
    { action: 'export_drawing', description: '导出画板为图片', params: ['drawingId', 'format'] },
    { action: 'render_to_drawing', description: '将 AI 生成图像渲染到画板', params: ['drawingId', 'imageUrl'] },
  ],
  permissions: [
    { name: 'storage:read', description: '读取实体数据' },
    { name: 'entities:write', description: '创建和编辑画板' },
    { name: 'schema:register', description: '注册实体类型和关系类型' },
    { name: 'views:register', description: '注册视图' },
  ],
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
