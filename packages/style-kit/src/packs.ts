/** 风格注册表：四维默认值决定预设的初始手感，用户覆盖见 useStyle。 */
export type StyleId = 'mist' | 'soft-glass' | 'neu'

export interface StyleAxes {
  material: number
  depth: number
  morph: number
  tactile: number
}

export interface StylePack {
  id: StyleId
  label: string
  description: string
  axes: StyleAxes
}

export const STYLE_PACKS: Record<StyleId, StylePack> = {
  mist: {
    id: 'mist',
    label: '雾面',
    description: '扁与液态之间：实边框定界、单级阴影、形变克制',
    axes: { material: 50, depth: 2, morph: 30, tactile: 30 },
  },
  'soft-glass': {
    id: 'soft-glass',
    label: '柔和液体玻璃',
    description: '半透明表面 + 背景模糊 + 高光边界',
    axes: { material: 100, depth: 2, morph: 60, tactile: 50 },
  },
  neu: {
    id: 'neu',
    label: '新拟态',
    description: '同色系表面 + 双向柔和阴影 + 按压内陷',
    axes: { material: 80, depth: 2, morph: 70, tactile: 80 },
  },
}

export const DEFAULT_STYLE_ID: StyleId = 'mist'

export const AXIS_META = {
  material: { label: '材质强度', min: 0, max: 100, step: 5 },
  depth: { label: '实体深度', min: 0, max: 3, step: 1 },
  morph: { label: '形变弹性', min: 0, max: 100, step: 5 },
  tactile: { label: '触感反馈', min: 0, max: 100, step: 5 },
} as const

export type AxisKey = keyof StyleAxes

export const STYLE_LIST: StylePack[] = Object.values(STYLE_PACKS)
