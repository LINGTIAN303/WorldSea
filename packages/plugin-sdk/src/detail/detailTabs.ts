import type { DetailTab } from './useDetailChrome'
import type { DetailTabOverride } from '@worldsea/entity-core'

/**
 * 详情 Tab 组装单点（2026-10-08 Tab 优化批）。详细见
 * docs/plans/2026-10-08-实体详情Tab优化立项.md §3.1
 *
 * 组装序固定为 `info → cover(有) → customTabs(芽) → extras → relations`；
 * GEV 与 TimelineView 都经此函数（此前后者手写全量数组——两套组织方式），
 * 用户覆写（排序/隐藏）在**同一处**应用，不散到消费方。
 */

/** 钉底不可隐藏的 tab：信息（默认落点）与关联（兜底入口） */
export const PINNED_TAB_IDS: readonly string[] = ['info', 'relations']

export interface ResolveDetailTabsInput {
  /** schema 含 coverImage（读的一方算好传入，保持本函数纯函数、不碰注册表） */
  hasCover: boolean
  /** 芽声明的自定义 tab */
  customTabs?: DetailTab[]
  /** 插在 customTabs 之后、relations 之前的附加页（如 TimelineView 的「因果链」） */
  extras?: DetailTab[]
  /** 用户覆写（来自 detailLayoutStore.tabOverrides[entityType]） */
  override?: DetailTabOverride
}

/**
 * 组装并应用覆写。
 * - hidden：剔除（钉底两项除外——消费侧即使用户存了也压不掉兜底入口）；
 * - order：列出者按序前置，未列出者保持默认序尾随（稳定排序）。
 */
export function resolveDetailTabs(input: ResolveDetailTabsInput): DetailTab[] {
  const base: DetailTab[] = [{ id: 'info', label: '信息', icon: 'outline' }]
  if (input.hasCover) base.push({ id: 'cover', label: '封面', icon: 'image' })
  base.push(...(input.customTabs ?? []))
  base.push(...(input.extras ?? []))
  base.push({ id: 'relations', label: '关联', icon: 'link' })

  const hidden = new Set((input.override?.hidden ?? []).filter(id => !PINNED_TAB_IDS.includes(id)))
  const visible = base.filter(t => !hidden.has(t.id))

  const order = input.override?.order ?? []
  if (!order.length) return visible
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...visible].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}
