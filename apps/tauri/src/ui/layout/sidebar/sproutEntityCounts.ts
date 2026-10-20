import { entitySchemaRegistry } from '@worldsea/entity-core'

/** schema 未声明 pluginId 时的内置芽类型兜底（与侧边栏历史口径一致）。 */
const FALLBACK_TYPE_MAP: Record<string, string[]> = {
  'official.characters': ['character'],
  'official.regions': ['region'],
  'official.timeline': ['event'],
  'official.organizations': ['organization'],
  'official.concepts': ['concept'],
  'official.items': ['item'],
  'official.buildings': ['building'],
  'official.species': ['species'],
  'official.magic': ['magic'],
  'official.outline': ['outline_node'],
  'official.languages': ['language'],
  'official.culture': ['culture'],
  'official.conflict': ['conflict'],
  'official.inspiration': ['inspiration'],
  'official.plants': ['plant'],
  'official.combat_stats': ['combat_stat'],
  'official.weapons': ['weapon'],
  'official.apparel': ['apparel'],
  'official.tactical-board': ['tactical-board'],
  'official.notebook': ['notebook'],
  'official.manuscript': ['manuscript'],
  'official.orchestration': ['pipeline'],
}

/** pluginId → 实体类型列表；schema 已声明 pluginId 的优先，缺省用兜底表。 */
export function pluginEntityTypes(): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const schema of entitySchemaRegistry.getAll()) {
    if (schema.pluginId) {
      const list = map.get(schema.pluginId) || []
      list.push(schema.typeKey)
      map.set(schema.pluginId, list)
    }
  }
  for (const [pluginId, types] of Object.entries(FALLBACK_TYPE_MAP)) {
    if (!map.has(pluginId)) map.set(pluginId, types)
  }
  return map
}

/** 每个芽的实体总数（跨类型求和）；实体增删由调用方传入的计数表决定。 */
export function countEntitiesByPlugin(allTypeCounts: ReadonlyMap<string, number>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [pluginId, types] of pluginEntityTypes()) {
    let total = 0
    for (const type of types) total += allTypeCounts.get(type) || 0
    counts.set(pluginId, total)
  }
  return counts
}
