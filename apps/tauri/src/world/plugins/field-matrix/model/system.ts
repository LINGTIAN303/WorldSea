import type { MatrixField } from './types'

function systemField(key: string, label: string, description: string): MatrixField {
  return {
    key,
    label,
    fieldType: 'text',
    required: false,
    sourceKind: 'system',
    sourceLabel: '系统',
    notes: [description],
    search: `${key} ${label} ${description} 系统 system`.toLowerCase(),
  }
}

export const SYSTEM_FIELDS: MatrixField[] = [
  systemField('id', '实体 ID', '系统生成，主键'),
  systemField('type', '实体类型', '如 character / manuscript'),
  systemField('name', '名称', '对应 schema 的 title；V2 方言中 title 与 name 同义'),
  systemField('description', '描述', '对应 identifiable.description'),
  systemField('tags', '标签', '对应 taggable.tags'),
  systemField('avatar', '头像', '实体头像'),
  systemField('coverImage', '封面图', '对应 visual.coverImage'),
  systemField('coverPosition', '封面位置', '封面裁切位置'),
  systemField('coverZoom', '封面缩放', '封面缩放比例'),
  systemField('properties', '扩展属性', '芽自有字段的实际存储容器'),
  systemField('facets', 'Facet 数据', 'Item 的 weapon / apparel 数据块'),
  systemField('createdAt', '创建时间', '系统维护'),
  systemField('updatedAt', '更新时间', '系统维护'),
]

export const SYSTEM_CONTEXT = {
  label: '系统字段',
  type: 'system',
  pluginId: 'entity-core',
}
