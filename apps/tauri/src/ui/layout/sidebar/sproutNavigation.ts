import { SPROUT_DOMAINS, isSproutDomain, type SproutDomainFilter, type SproutDomainId } from '@worldsea/entity-core'
import type { PluginView } from '@worldsea/entity-core/types'

/** 域归视图：manifest 的 domain；缺省/未声明 → unclassified（只在「全部」出现）。 */
export type DomainOfPlugin = (pluginId: string | undefined) => string

export interface SproutDomainGroup {
  id: 'all' | SproutDomainId
  label: string
  icon: string
  count: number
}

export interface SproutNavigation {
  domains: SproutDomainGroup[]
  views: PluginView[]
  filter: SproutDomainFilter
}

/** 由 manifest 列表构建 pluginId → domain 映射（未声明的留给调用方回落 unclassified）。 */
export function buildDomainMap(plugins: Array<{ manifest: { id: string; domain?: string } }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const plugin of plugins) {
    if (plugin.manifest.domain) map.set(plugin.manifest.id, plugin.manifest.domain)
  }
  return map
}

export function makeDomainOfPlugin(map: ReadonlyMap<string, string>): DomainOfPlugin {
  return pluginId => (pluginId ? map.get(pluginId) ?? 'unclassified' : 'unclassified')
}

/**
 * 侧栏域导航唯一口径：
 * - views 由 `visibleViewsInSidebarOrder()` 提供（已按 sidebarOrder 排序）；
 * - 「全部」永远第一项；8 域只保留有可见芽的域（研究 5.4 规则 1）；
 * - unclassified 不进入 8 域列表，只在「全部」出现。
 */
export function filterViewsByDomain(
  views: PluginView[],
  filter: SproutDomainFilter,
  domainOf: DomainOfPlugin,
): PluginView[] {
  return filter === 'all' ? views : views.filter(view => domainOf(view.pluginId) === filter)
}

export function buildSproutNavigation(
  views: PluginView[],
  domainOf: DomainOfPlugin,
  filter: SproutDomainFilter,
): SproutNavigation {
  const counts = new Map<string, number>()
  for (const view of views) {
    const domain = domainOf(view.pluginId)
    if (isSproutDomain(domain)) counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }

  const domains: SproutDomainGroup[] = [
    { id: 'all', label: '全部', icon: 'menu', count: views.length },
    ...SPROUT_DOMAINS
      .filter(domain => (counts.get(domain.id) ?? 0) > 0)
      .map(domain => ({ id: domain.id, label: domain.label, icon: domain.icon, count: counts.get(domain.id) ?? 0 })),
  ]

  return {
    domains,
    views: filterViewsByDomain(views, filter, domainOf),
    filter,
  }
}

/** 当前视图的域；unclassified 返回 all（让视图在「全部」可见）。 */
export function filterForView(view: PluginView | null | undefined, domainOf: DomainOfPlugin): SproutDomainFilter {
  if (!view) return 'all'
  const domain = domainOf(view.pluginId)
  return isSproutDomain(domain) ? domain as SproutDomainId : 'all'
}
