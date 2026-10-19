export const TYPE_ZH: Record<string, string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  select: '单选',
  'multi-select': '多选',
  multiSelect: '多选',
  tags: '标签',
  image: '图片',
  color: '颜色',
  boolean: '开关',
  entityRef: '实体引用',
  date: '日期',
  formula: '公式',
  richtext: '富文本',
  url: '链接',
  email: '邮箱',
}

export const TYPE_CLASS: Record<string, string> = {
  text: 'text',
  textarea: 'textarea',
  number: 'number',
  select: 'select',
  'multi-select': 'multi',
  multiSelect: 'multi',
  tags: 'tags',
  image: 'image',
  color: 'color',
  boolean: 'boolean',
  entityRef: 'ref',
  date: 'date',
}

export const TYPE_ORDER = [
  'text', 'textarea', 'number', 'select', 'multi-select', 'tags', 'image',
  'color', 'boolean', 'entityRef', 'date', 'formula', 'richtext', 'url', 'email',
]

export const FIELD_MATRIX_GROUPS = [
  {
    title: '世界观实体芽',
    lede: '人物、地理、组织、物产、事件等世界观基础实体。',
    types: ['character', 'species', 'organization', 'region', 'building', 'item', 'plant', 'concept', 'language', 'magic', 'combat_stat', 'conflict', 'culture', 'event', 'inspiration'],
  },
  {
    title: '创作与工具芽',
    lede: '正文、笔记、大纲、画板、编排、战术棋盘等创作过程实体。',
    types: ['book', 'manuscript', 'notebook', 'outline_node', 'outline_board', 'drawing', 'pipeline', 'tactical-board'],
  },
]

export function typeZh(type: string): string {
  return TYPE_ZH[type] ?? type
}

export function typeClass(type: string): string {
  return TYPE_CLASS[type] ?? 'unknown'
}
