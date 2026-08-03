/**
 * Block 组件注册与工具函数
 *
 * 统一导出所有 Block Vue 组件，以及 Block 图标和摘要的工具函数。
 * 每个 Block 类型对应一个 Vue 组件，由 Agent 消息渲染器按 type 分发。
 */

export { default as BlockTable } from './BlockTable.vue'
export { default as BlockChoice } from './BlockChoice.vue'
export { default as BlockCode } from './BlockCode.vue'
export { default as BlockEntityCard } from './BlockEntityCard.vue'
export { default as BlockAlert } from './BlockAlert.vue'
export { default as BlockStat } from './BlockStat.vue'
export { default as BlockList } from './BlockList.vue'
export { default as BlockProgress } from './BlockProgress.vue'
export { default as BlockComparison } from './BlockComparison.vue'
export { default as BlockTimeline } from './BlockTimeline.vue'
export { default as BlockImage } from './BlockImage.vue'
export { default as BlockAccordion } from './BlockAccordion.vue'
export { default as BlockManuscript } from './BlockManuscript.vue'

/** Block 交互事件（如表格操作、选择器响应等） */
export interface BlockActionEvent {
  blockId: string
  action: string
  data?: Record<string, unknown>
}

/** 各 Block 类型的 Emoji 图标映射 */
const BLOCK_ICONS: Record<string, string> = {
  'table': 'chart',
  'choice': 'target',
  'code': 'code',
  'entity-card': 'user',
  'alert': 'bell',
  'stat': 'chart',
  'list': 'clipboard-list',
  'progress': 'hourglass',
  'comparison': 'share',
  'timeline': 'calendar',
  'image': 'image',
  'accordion': 'document',
  'manuscript': 'scroll-text',
}

export function getBlockIcon(type: string): string {
  return BLOCK_ICONS[type] || 'package'
}

/**
 * 生成 Block 的摘要文本（用于折叠状态的预览）
 * 不同 Block 类型有不同的摘要格式：
 * - 表格: "标题 (行数×列数)"
 * - 列表: "标题 (项数)"
 * - 图片: "标题/alt"
 * - 其他: 根据各自结构生成
 */
export function getBlockSummary(block: import('@agent/index').MessageBlock): string {
  switch (block.type) {
    case 'table':
      return `${block.title || '表格'} (${block.rows.length}行 × ${block.columns.length}列)`
    case 'choice':
      return block.title || '请选择'
    case 'code':
      return `${block.language} (${block.code.split('\n').length}行)`
    case 'entity-card':
      return `${block.name} (${block.entityType})`
    case 'alert':
      return `${block.level}${block.title ? ': ' + block.title : ''}`
    case 'stat':
      return `${block.title || '概览'} (${block.items.length}项)`
    case 'list':
      return `${block.title || '列表'} (${block.items.length}项)`
    case 'progress':
      return `${block.label} ${block.progress}%`
    case 'comparison':
      return `${block.left.label} vs ${block.right.label}`
    case 'timeline':
      return `${block.title || '时间线'} (${block.events.length}事件)`
    case 'image':
      return block.caption || '图片'
    case 'accordion':
      return `${block.title || '详情'} (${block.sections.length}段)`
    case 'manuscript':
      return `${block.title || '文境'} (${block.layout === 'vertical' ? '竖式' : '横式'})`
    default:
      return '未知块'
  }
}
