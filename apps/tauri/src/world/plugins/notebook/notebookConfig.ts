export const NOTE_TYPES = [
  { value: 'markdown', label: 'Markdown', icon: 'edit' },
  { value: 'code', label: '代码', icon: 'keyboard' },
  { value: 'canvas', label: '画布', icon: 'palette' },
  { value: 'reference', label: '参考', icon: 'manuscript' },
] as const

export const VIEW_MODES = ['editor', 'board', 'graph'] as const
export type ViewMode = typeof VIEW_MODES[number]
