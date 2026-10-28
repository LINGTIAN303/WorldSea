import { detailTabIconSlot, getEffectiveIconOverride, type DetailTabOverride } from '@worldsea/entity-core'
import type { DetailTab } from './useDetailChrome'

/**
 * 详情 Tab 组装单点（2026-10-08 Tab 优化）。详细见 docs/plans/2026-10-08-实体详情Tab优化立项.md §3.1
 * 组装序固定 `info → cover(有) → customTabs(芽) → extras → relations`；GEV 与 TimelineView 都经此
 * （此前后者手写全量数组——两套组织方式）；用户覆写（排序/隐藏）在**同一处**应用，不散到消费方。
 */

/** 钉底不可隐藏的 tab：信息（默认落点）与关联（兜底入口） */
export const PINNED_TAB_IDS: readonly string[] = ['info', 'relations']

/** 跨实体类型共享的通用页；图标覆盖走 `detailTab:*:<tabId>` 通配键。 */
export const SHARED_DETAIL_TABS = [
  { id: 'info', label: '信息', icon: 'outline' },
  { id: 'cover', label: '形象', icon: 'image' },
  { id: 'video', label: '视频', icon: 'video' },
  { id: 'relations', label: '关联', icon: 'link' },
] as const satisfies readonly DetailTab[]

export interface ResolveDetailTabsInput {
  /** schema 含 coverImage（读的一方算好传入，保持本函数纯函数、不碰注册表） */
  hasCover: boolean
  /** 实体类型；传了才解析页签图标覆盖 */
  entityType?: string
  /** 芽声明的自定义 tab */
  customTabs?: DetailTab[]
  /** 插在 customTabs 之后、relations 之前的附加页（如 TimelineView 的「因果链」） */
  extras?: DetailTab[]
  /** 用户覆写（来自 detailLayoutStore.tabOverrides[entityType]） */
  override?: DetailTabOverride
}

/** 通用页先读精确键、再读通配键；芽自定义页只读精确键。 */
function resolveTabIcon(entityType: string | undefined, tab: DetailTab, shared: boolean): DetailTab {
  if (!entityType) return tab
  const icon = getEffectiveIconOverride(detailTabIconSlot(entityType, tab.id))
    ?? (shared ? getEffectiveIconOverride(detailTabIconSlot('*', tab.id)) : undefined)
  return icon && icon !== tab.icon ? { ...tab, icon } : tab
}

/**
 * 组装并应用覆写。
 * - hidden：剔除（钉底两项除外——消费侧即使用户存了也压不掉兜底入口）；
 * - order：列出者按序前置，未列出者保持默认序尾随（稳定排序）。
 */
export function resolveDetailTabs(input: ResolveDetailTabsInput): DetailTab[] {
  const shared = (id: string): DetailTab => {
    const tab = SHARED_DETAIL_TABS.find(item => item.id === id)
    return tab ? resolveTabIcon(input.entityType, tab, true) : { id, label: id }
  }
  const base: DetailTab[] = [
    shared('info'),
    ...(input.hasCover ? [shared('cover')] : []),
    shared('video'),
    ...(input.customTabs ?? []).map(tab => resolveTabIcon(input.entityType, tab, false)),
    ...(input.extras ?? []).map(tab => resolveTabIcon(input.entityType, tab, false)),
    shared('relations'),
  ]

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

/**
 * 相邻 tab 的 id（ALT+←/→ 切页的算法单点，回绕）。
 * 单 tab / 空 / 当前 id 不在列 → null（调用方据此 no-op）。
 */
export function adjacentTabId(tabs: DetailTab[], currentId: string | undefined, delta: number): string | null {
  if (tabs.length < 2) return null
  const idx = tabs.findIndex(t => t.id === currentId)
  if (idx < 0) return null
  return tabs[(idx + delta + tabs.length) % tabs.length]?.id ?? null
}
