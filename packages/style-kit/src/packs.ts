/** 风格注册表：四维默认值决定预设的初始手感，用户覆盖见 useStyle。 */
export type StyleId = 'mist' | 'soft-glass' | 'neu' | 'liquid-glass'

/** ready = 可选并已实现；planned = 槽位保留，UI 展示但不可选 */
export type StyleStatus = 'ready' | 'planned'

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
  status: StyleStatus
}

export const STYLE_PACKS: Record<StyleId, StylePack> = {
  mist: {
    id: 'mist',
    label: '雾面',
    description: '扁与液态之间：实边框定界、单级阴影、形变克制',
    axes: { material: 50, depth: 2, morph: 30, tactile: 30 },
    status: 'ready',
  },
  'soft-glass': {
    id: 'soft-glass',
    label: '磨砂巧克',
    description: '磨砂巧克力质感：半透明磨砂表面，支持常规 / 清透变体',
    axes: { material: 100, depth: 2, morph: 60, tactile: 50 },
    status: 'ready',
  },
  neu: {
    id: 'neu',
    label: '新拟态',
    description: '同色系表面 + 双向柔和阴影 + 按压内陷',
    axes: { material: 80, depth: 2, morph: 70, tactile: 80 },
    status: 'ready',
  },
  'liquid-glass': {
    id: 'liquid-glass',
    label: '液化玻璃',
    description: '折射与光学形变（研究中，槽位保留）',
    axes: { material: 100, depth: 2, morph: 80, tactile: 60 },
    status: 'planned',
  },
}

export const DEFAULT_STYLE_ID: StyleId = 'mist'

export const READY_STYLE_IDS = (Object.keys(STYLE_PACKS) as StyleId[]).filter(
  (id) => STYLE_PACKS[id].status === 'ready',
)

export const AXIS_META = {
  material: { label: '材质强度', min: 0, max: 100, step: 5 },
  depth: { label: '实体深度', min: 0, max: 3, step: 1 },
  morph: { label: '形变弹性', min: 0, max: 100, step: 5 },
  tactile: { label: '触感反馈', min: 0, max: 100, step: 5 },
} as const

export type AxisKey = keyof StyleAxes

export const STYLE_LIST: StylePack[] = Object.values(STYLE_PACKS)

