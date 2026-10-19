export interface ViewOnlyBud {
  id: string
  label: string
  description: string
}

export const VIEW_ONLY: ViewOnlyBud[] = [
  { id: 'official.apparel', label: '服饰/装备', description: 'Item + ApparelFacet 的组合视图，不注册独立实体' },
  { id: 'official.weapons', label: '武器', description: 'Item + WeaponFacet 的组合视图，不注册独立实体' },
  { id: 'official.batch-edit', label: '批量编辑', description: '工具视图，无实体字段' },
  { id: 'official.custom', label: '自定义视窗', description: '工具视图，无实体字段' },
  { id: 'official.data-tools', label: '数据工具', description: '工具视图，无实体字段' },
  { id: 'official.doc-export', label: '文档导出', description: '工具视图，无实体字段' },
  { id: 'official.entity-tools', label: '实体工具', description: '工具视图，无实体字段' },
  { id: 'official.graph', label: '全局图谱', description: '工具视图，无实体字段' },
  { id: 'official.import-export', label: '导入导出', description: '工具视图，无实体字段' },
  { id: 'official.mindmap', label: '思维导图', description: '工具视图，无实体字段' },
  { id: 'official.search', label: '全局搜索', description: '工具视图，无实体字段' },
  { id: 'official.settings', label: '设置', description: '壳级设置视图，无实体字段' },
  { id: 'official.templates', label: '模板管理', description: '工具视图，无实体字段' },
  { id: 'official.theme-editor', label: '主题编辑器', description: '工具视图，无实体字段' },
  { id: 'official.version-history', label: '版本历史', description: '工具视图，无实体字段' },
  { id: 'official.field-matrix', label: '字段矩阵', description: '字段/关系/视图/AutoLink 运行时观测视图，不注册实体类型' },
]
