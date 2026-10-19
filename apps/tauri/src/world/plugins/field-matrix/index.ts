import type { WorldPluginApi } from '../../api'
import FieldMatrixView from './FieldMatrixView.vue'

export const manifest = {
  id: 'official.field-matrix',
  domain: 'tool',
  name: '字段矩阵',
  version: '1.0.0',
  description: '以字段字典形式查看全部芽的实体 Schema、关系、视图与 AutoLink 运转',
  author: 'WorldSea',
  kind: 'sprout' as const,
}

export function apply(_ctx: unknown, api: WorldPluginApi) {
  api.registerView({
    id: 'field-matrix',
    label: '字段矩阵',
    icon: 'grid',
    component: FieldMatrixView,
    toolbar: 'bar',
  })
}

export default { manifest, apply }
