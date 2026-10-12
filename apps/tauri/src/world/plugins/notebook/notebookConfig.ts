// 类型色（批 4 V5/V6 单源）：侧栏条目图标、看板卡片色条共用。
// 取基础层语义 token（浅深主题双套已覆盖），勿写死色值。
// 批 5 F6：移除 canvas 选项（迁移带入的未实现占位，从未有对应编辑器；三项目实际数据零存量）。
export const NOTE_TYPES = [
  { value: 'markdown', label: 'Markdown', icon: 'edit', color: 'var(--accent)' },
  { value: 'code', label: '代码', icon: 'keyboard', color: 'var(--info)' },
  { value: 'reference', label: '参考', icon: 'manuscript', color: 'var(--success)' },
] as const

export const VIEW_MODES = ['editor', 'board', 'graph'] as const
export type ViewMode = typeof VIEW_MODES[number]
