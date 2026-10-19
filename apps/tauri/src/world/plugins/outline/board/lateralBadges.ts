import type { Relation } from '@worldsea/entity-core'

/**
 * 白板横向关系徽章（G1.1，2026-10-19）—— 纯函数。
 *
 * Q3-A 落地时定了三条横向关系（并列 / 递进 / 对比），但只在**节点详情**里可见；
 * 本模块把同一事实聚合成卡片上的徽章，让用户不点开详情也能看出「这个节点有哪些横向关系」。
 *
 * 计数口径：**两端任一命中即算**（并列/对比是对称关系；递进有向，但「与谁有递进关系」对两端都成立）。
 */
export const LATERAL_TYPES = {
  parallel: 'outline_parallel',
  progressive: 'outline_progressive',
  contrast: 'outline_contrast',
} as const

export type LateralKey = keyof typeof LATERAL_TYPES

export interface LateralBadge {
  key: LateralKey
  type: string
  count: number
}

const KEYS = Object.keys(LATERAL_TYPES) as LateralKey[]

export function lateralBadges(relations: readonly Relation[], nodeId: string): LateralBadge[] {
  if (!nodeId) return []
  const counts: Record<LateralKey, number> = { parallel: 0, progressive: 0, contrast: 0 }
  for (const r of relations) {
    const key = KEYS.find(k => LATERAL_TYPES[k] === r.type)
    if (!key) continue
    if (r.sourceId !== nodeId && r.targetId !== nodeId) continue
    counts[key] += 1
  }
  return KEYS.filter(k => counts[k] > 0).map(k => ({
    key: k,
    type: LATERAL_TYPES[k],
    count: counts[k],
  }))
}

/** 徽章符号与中文名（UI 用；不放进组件以便单测） */
export const LATERAL_META: Record<LateralKey, { mark: string; label: string }> = {
  parallel: { mark: '∥', label: '并列' },
  progressive: { mark: '→', label: '递进' },
  contrast: { mark: '⇄', label: '对比' },
}
