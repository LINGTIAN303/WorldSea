/**
 * 芽洞察派生（R5）：声明（domain / entityTypes）+ 运行态（装载 / 视图）+ 关系注册表
 * → 可供设置面展示的状态与入/出依赖。
 * 详细说明见 ../../../../docs/details/注释/apps/tauri/world/sproutInsights.md
 */
import {
  entitySchemaRegistryV2,
  pluginAPI,
  relationshipRegistry,
  SPROUT_DOMAINS,
  sproutIconSlot,
  useIconOverrideStore,
} from '@worldsea/entity-core'
import { availablePlugins, externalPluginStates, worldTreeState } from './tree'
import type { WorldPluginManifest } from './manifest'

export type SproutRuntimeStatus = 'loaded' | 'skipped' | 'rejected'

export interface SproutInsightSprout {
  id: string
  label: string
  icon?: string
  active: boolean
  source?: string
}

export interface SproutInsightPlugin {
  manifest: WorldPluginManifest
}

export interface SproutInsightRelation {
  type: string
  label: string
  sourceTypes: string[]
  targetTypes: string[]
  inverseType: string
}

export interface SproutDependency {
  pluginId: string
  label: string
  relations: string[]
}

export interface SproutInsight {
  id: string
  label: string
  icon: string
  domain: string
  secondaryDomains: string[]
  source: 'builtin' | 'external'
  active: boolean
  runtime: SproutRuntimeStatus
  reason?: string
  viewCount: number
  entityTypes: string[]
  requires: string[]
  outgoing: SproutDependency[]
  incoming: SproutDependency[]
  dependencyLimited: boolean
}

export interface SproutInsightInput {
  sprouts: ReadonlyArray<SproutInsightSprout>
  plugins: ReadonlyArray<SproutInsightPlugin>
  relations: ReadonlyArray<SproutInsightRelation>
  runtime: {
    plugins: ReadonlyArray<string>
    skipped: ReadonlyArray<string>
    rejected: ReadonlyArray<{ id: string; reason: string }>
  }
  external: ReadonlyArray<{
    id: string
    status: SproutRuntimeStatus
    reason?: string
    domain?: string
    secondaryDomains?: string[]
  }>
  views: ReadonlyArray<{ pluginId?: string; icon?: string }>
  /** 运行时 schema 归属（外部插件未声明 entityTypes 时的回退） */
  runtimeTypeOwners?: Readonly<Record<string, string>>
}

/**
 * defineRelation 幂等冲突的展示层补丁：`owned_by` 的显式声明
 * （item/building → character/organization）被 `owns` 自动生成的逆关系挡住，
 * 注册表里只剩 item→character 的自动版。R5 依赖图按声明意图展示，补回显式类型；
 * 不修改关系注册表。新增同类冲突时必须同步此表与为什么测试。
 */
const DECLARED_RELATION_OVERRIDES: ReadonlyArray<SproutInsightRelation> = [
  {
    type: 'owned_by',
    label: '拥有者',
    sourceTypes: ['item', 'building'],
    targetTypes: ['character', 'organization'],
    inverseType: 'owns',
  },
]

export function sproutDomainLabel(id: string | undefined): string {
  if (!id || id === 'unclassified') return '未分类'
  return SPROUT_DOMAINS.find(domain => domain.id === id)?.label ?? id
}

export function externalDomainText(domain?: string, secondaryDomains?: string[]): string {
  const primary = sproutDomainLabel(domain)
  const secondary = (secondaryDomains ?? [])
    .map(sproutDomainLabel)
    .filter(label => label && label !== primary)
  return secondary.length
    ? `域：${primary} · 副域：${secondary.join(' / ')}`
    : `域：${primary}`
}

export function buildSproutInsights(input: SproutInsightInput): SproutInsight[] {
  const pluginMap = new Map(input.plugins.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const externalMap = new Map(input.external.map(item => [item.id, item]))
  const rejectedMap = new Map(input.runtime.rejected.map(item => [item.id, item.reason]))
  const loaded = new Set(input.runtime.plugins)
  const runtimeOwners = input.runtimeTypeOwners ?? {}

  const typeOwner = new Map<string, string>()
  for (const [type, pluginId] of Object.entries(runtimeOwners)) typeOwner.set(type, pluginId)
  for (const plugin of input.plugins) {
    for (const type of plugin.manifest.entityTypes ?? []) typeOwner.set(type, plugin.manifest.id)
  }

  const relationLabels = new Map(
    [...input.relations, ...DECLARED_RELATION_OVERRIDES].map(item => [item.type, item.label]),
  )
  const edges = new Map<string, Map<string, Set<string>>>()
  const seenRelations = new Set<string>()

  const addEdges = (relation: SproutInsightRelation) => {
    for (const sourceType of relation.sourceTypes) {
      const from = typeOwner.get(sourceType)
      if (!from) continue
      for (const targetType of relation.targetTypes) {
        const to = typeOwner.get(targetType)
        if (!to || to === from) continue
        const byTarget = edges.get(from) ?? new Map<string, Set<string>>()
        edges.set(from, byTarget)
        const labels = byTarget.get(to) ?? new Set<string>()
        byTarget.set(to, labels)
        labels.add(relation.type)
      }
    }
  }

  for (const relation of input.relations) {
    // 自动逆关系与正向声明构成镜像对：保留先出现者，避免双向重复计数
    if (relation.inverseType !== relation.type && seenRelations.has(relation.inverseType)) continue
    seenRelations.add(relation.type)
    addEdges(relation)
  }
  if (input.relations.some(relation => relation.type === 'owns')) {
    for (const relation of DECLARED_RELATION_OVERRIDES) addEdges(relation)
  }

  const labelOf = (id: string) =>
    pluginMap.get(id)?.name ?? input.sprouts.find(sprout => sprout.id === id)?.label ?? id

  const dependencies = (id: string, direction: 'out' | 'in'): SproutDependency[] => {
    const result: SproutDependency[] = []
    if (direction === 'out') {
      for (const [to, types] of edges.get(id) ?? []) {
        result.push({
          pluginId: to,
          label: labelOf(to),
          relations: [...types].map(type => relationLabels.get(type) ?? type),
        })
      }
    } else {
      for (const [from, byTarget] of edges) {
        const types = byTarget.get(id)
        if (types) {
          result.push({
            pluginId: from,
            label: labelOf(from),
            relations: [...types].map(type => relationLabels.get(type) ?? type),
          })
        }
      }
    }
    return result.sort(
      (a, b) => b.relations.length - a.relations.length || a.label.localeCompare(b.label, 'zh-CN'),
    )
  }

  return input.sprouts.map(sprout => {
    const manifest = pluginMap.get(sprout.id)
    const external = externalMap.get(sprout.id)
    const declaredTypes = manifest?.entityTypes
    const entityTypes = declaredTypes ?? Object.entries(runtimeOwners)
      .filter(([, pluginId]) => pluginId === sprout.id)
      .map(([type]) => type)

    let runtime: SproutRuntimeStatus = 'skipped'
    let reason: string | undefined
    if (!sprout.active) {
      reason = '未启用'
    } else if (external?.status === 'rejected' || rejectedMap.has(sprout.id)) {
      runtime = 'rejected'
      reason = external?.reason ?? rejectedMap.get(sprout.id)
    } else if (external) {
      runtime = external.status
      reason = external.reason
    } else if (loaded.has(sprout.id)) {
      runtime = 'loaded'
    }

    const view = input.views.find(item => item.pluginId === sprout.id)
    return {
      id: sprout.id,
      label: manifest?.name ?? sprout.label,
      icon: view?.icon ?? sprout.icon ?? 'puzzle',
      domain: manifest?.domain ?? external?.domain ?? 'unclassified',
      secondaryDomains: manifest?.secondaryDomains ?? external?.secondaryDomains ?? [],
      source: sprout.source === 'external' ? 'external' : 'builtin',
      active: sprout.active,
      runtime,
      reason,
      viewCount: input.views.filter(view => view.pluginId === sprout.id).length,
      entityTypes: [...entityTypes].sort(),
      requires: manifest?.requires ?? [],
      outgoing: dependencies(sprout.id, 'out'),
      incoming: dependencies(sprout.id, 'in'),
      dependencyLimited: sprout.source === 'external' && declaredTypes === undefined,
    }
  })
}

/** 应用侧采集口：只读快照；调用方在芽开关/视图变更/外部重载后重新调用。 */
export function collectSproutInsights(
  sprouts: ReadonlyArray<SproutInsightSprout>,
): SproutInsight[] {
  const runtimeTypeOwners: Record<string, string> = {}
  for (const schema of entitySchemaRegistryV2.getAll()) {
    if (schema.pluginId) runtimeTypeOwners[schema.type] = schema.pluginId
  }
  const iconStore = useIconOverrideStore()
  const views = pluginAPI.getViews().map(view => view.pluginId
    ? { ...view, icon: iconStore.resolve(sproutIconSlot(view.pluginId), view.icon) }
    : view)
  return buildSproutInsights({
    sprouts,
    plugins: availablePlugins(),
    relations: relationshipRegistry.getAll(),
    runtime: worldTreeState(),
    external: externalPluginStates().map(state => ({
      id: state.id,
      status: state.status,
      reason: state.reason,
      domain: state.domain,
      secondaryDomains: state.secondaryDomains,
    })),
    views,
    runtimeTypeOwners,
  })
}
