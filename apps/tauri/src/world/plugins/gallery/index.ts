import type { WorldPluginApi } from '../../api'
import GalleryView from './GalleryView.vue'

export const manifest = {
  id: 'official.gallery',
  domain: 'tool',
  entityTypes: [],
  name: '图库',
  version: '1.0.0',
  description: '汇总浏览世界中的视觉资产：实体封面、形象图与画板作品',
  author: 'WorldSea',
  kind: 'sprout' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({
    id: 'gallery', label: '图库', icon: 'image',
    component: GalleryView,
  })
}

export default { manifest, apply }
