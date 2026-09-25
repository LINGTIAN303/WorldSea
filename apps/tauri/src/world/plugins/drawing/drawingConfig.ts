import type { DrawingTool, FillMode } from './types'

export const DRAWING_TOOLS: { value: DrawingTool; label: string; icon: string }[] = [
  { value: 'brush', label: '画笔', icon: 'edit' },
  { value: 'eraser', label: '橡皮', icon: 'eraser' },
  { value: 'line', label: '直线', icon: 'minus' },
  { value: 'rect', label: '矩形', icon: 'square' },
  { value: 'circle', label: '圆形', icon: 'circle' },
  { value: 'arrow', label: '箭头', icon: 'arrow-right' },
  { value: 'text', label: '文字', icon: 'type' },
  { value: 'select', label: '选择', icon: 'cursor' },
]

export const FILL_MODES: { value: FillMode; label: string }[] = [
  { value: 'none', label: '仅描边' },
  { value: 'solid', label: '填充' },
  { value: 'stroke', label: '描边+填充' },
]

export const DEFAULT_BRUSH_SIZE = 3
export const DEFAULT_COLOR = '#000000'
export const DEFAULT_BG_COLOR = '#ffffff'
export const DEFAULT_LAYER_NAME = '图层 1'
export const MAX_LAYERS = 20
export const MAX_HISTORY = 50
export const AUTOSAVE_DELAY = 1000
