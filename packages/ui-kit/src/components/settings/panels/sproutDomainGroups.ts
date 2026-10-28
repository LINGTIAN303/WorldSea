import { SPROUT_DOMAINS, domainIconSlot, getEffectiveIconOverride } from '@worldsea/entity-core'

export const UNCLASSIFIED_DOMAIN = 'unclassified'

export interface SproutDomainGroup<T> {
  id: string
  label: string
  icon: string
  items: T[]
}

/** 27 芽按 manifest.domain 分组；未声明/未知域归「未分类」，空域不渲染。 */
export function groupSproutsByDomain<T extends { id: string }>(
  sprouts: T[],
  domainOf: (pluginId: string) => string,
): SproutDomainGroup<T>[] {
  const byDomain = new Map<string, T[]>()
  for (const sprout of sprouts) {
    const domain = domainOf(sprout.id)
    const list = byDomain.get(domain) ?? []
    list.push(sprout)
    byDomain.set(domain, list)
  }

  const groups: SproutDomainGroup<T>[] = SPROUT_DOMAINS.map(domain => ({
    id: domain.id,
    label: domain.label,
    icon: getEffectiveIconOverride(domainIconSlot(domain.id)) ?? domain.icon,
    items: byDomain.get(domain.id) ?? [],
  }))
  const known = new Set<string>(SPROUT_DOMAINS.map(domain => domain.id))
  const unclassified: T[] = []
  for (const [domain, items] of byDomain) {
    if (!known.has(domain)) unclassified.push(...items)
  }
  const visible = groups.filter(group => group.items.length > 0)
  if (unclassified.length > 0) {
    visible.push({ id: UNCLASSIFIED_DOMAIN, label: '未分类', icon: 'puzzle', items: unclassified })
  }
  return visible
}

/**
 * 域内拖拽写回全局顺序：只替换该域芽在原 order 中的相对位置；
 * 跨域芽的位置保持不动，组内新顺序按 orderedIds 落位。
 */
export function mergeDomainOrder(order: string[], orderedIds: string[]): string[] {
  const present = orderedIds.filter(id => order.includes(id))
  const result = [...order]
  let cursor = 0
  for (let i = 0; i < result.length && cursor < present.length; i++) {
    if (present.includes(result[i])) result[i] = present[cursor++]
  }
  for (const id of orderedIds) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}
