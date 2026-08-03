import { storage } from '@worldsmith/entity-core/core'
import type { Entity } from '@worldsmith/entity-core'

export interface FacetMigrationReport {
  weaponsMigrated: number
  apparelMigrated: number
  relationsUpdated: number
  skipped: boolean
  reason?: string
}

/**
 * 旧版 weapon/apparel 实体中需要移入 facet 的字段
 * 不在此列表中的字段保留在 item.properties 中
 */
const WEAPON_FACET_KEYS = [
  'weaponType', 'rank', 'smith', 'forgedAt', 'specialAbility', 'battles',
]

const APPAREL_FACET_KEYS = [
  'apparelType', 'armorClass', 'style', 'defense', 'weight', 'durability',
]

/**
 * 旧版 weapon/apparel 中与 item ownFields 语义重叠的字段映射
 * 旧字段名 → item ownFields key
 */
const WEAPON_FIELD_MAP: Record<string, string> = {
  'specialAbilities': 'powers',  // 旧版有些用 specialAbilities
  'specialAbility': 'powers',
}

const APPAREL_FIELD_MAP: Record<string, string> = {
  'significance': 'significance', // 保留
}

/**
 * 将旧版 weapon/apparel 类型实体迁移为 item + facet 结构
 *
 * 迁移逻辑：
 * 1. 查找所有 type='weapon' 和 type='apparel' 的实体
 * 2. 将武器特有字段提取到 facets.weapon，服饰特有字段提取到 facets.apparel
 * 3. 通用字段（material, color, origin, era, condition, tags 等）保留在 properties
 * 4. 设置 itemType 字段区分类型
 * 5. 更新实体 type 为 'item'
 * 6. 更新关联关系中的引用
 * 7. 记录迁移完成标记
 */
export async function migrateWeaponApparelToItemFacet(): Promise<FacetMigrationReport> {
  const marker = 'worldsmith_facet_migration_v1'
  const alreadyMigrated = localStorage.getItem(marker)
  if (alreadyMigrated === 'done') {
    return { weaponsMigrated: 0, apparelMigrated: 0, relationsUpdated: 0, skipped: true, reason: '已迁移过' }
  }

  let weaponsMigrated = 0
  let apparelMigrated = 0
  let relationsUpdated = 0

  try {
    // ── 迁移 weapon → item + weapon facet ──
    const weapons = await storage.getEntitiesByType('weapon')
    for (const entity of weapons) {
      const migrated = migrateEntity(entity, 'weapon', WEAPON_FACET_KEYS, WEAPON_FIELD_MAP)
      await storage.putEntity(migrated)
      weaponsMigrated++
    }

    // ── 迁移 apparel → item + apparel facet ──
    const apparels = await storage.getEntitiesByType('apparel')
    for (const entity of apparels) {
      const migrated = migrateEntity(entity, 'apparel', APPAREL_FACET_KEYS, APPAREL_FIELD_MAP)
      await storage.putEntity(migrated)
      apparelMigrated++
    }

    // ── 更新关联关系中的实体引用 ──
    if (weaponsMigrated > 0 || apparelMigrated > 0) {
      const migratedIds = new Set([
        ...weapons.map(e => e.id),
        ...apparels.map(e => e.id),
      ])
      relationsUpdated = await updateRelationReferences(migratedIds)
    }

    localStorage.setItem(marker, 'done')

    return { weaponsMigrated, apparelMigrated, relationsUpdated, skipped: false }
  } catch (e) {
    console.error('[Facet Migration] 迁移失败:', e)
    return {
      weaponsMigrated,
      apparelMigrated,
      relationsUpdated,
      skipped: true,
      reason: `迁移失败: ${(e as Error).message}`,
    }
  }
}

/**
 * 将单个旧版实体迁移为 item + facet 结构
 */
function migrateEntity(
  entity: Entity,
  sourceType: 'weapon' | 'apparel',
  facetKeys: string[],
  fieldMap: Record<string, string>,
): Entity {
  const props = { ...entity.properties }
  const facetData: Record<string, unknown> = {}

  // 提取 facet 字段
  for (const key of facetKeys) {
    if (props[key] !== undefined && props[key] !== null && props[key] !== '') {
      facetData[key] = props[key]
      delete props[key]
    }
  }

  // 字段名映射（旧名→新名）
  for (const [oldKey, newKey] of Object.entries(fieldMap)) {
    if (props[oldKey] !== undefined && oldKey !== newKey) {
      // 如果新key已有值则不覆盖
      if (props[newKey] === undefined) {
        props[newKey] = props[oldKey]
      }
      delete props[oldKey]
    }
  }

  // 设置 itemType
  props.itemType = sourceType === 'weapon' ? '武器' : '防具'

  // 构建 facets
  const facets: Record<string, Record<string, unknown>> = {
    ...(entity.facets || {}),
    [sourceType]: facetData,
  }

  return {
    ...entity,
    type: 'item',
    properties: props,
    facets,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * 更新关联关系中对已迁移实体的引用
 * 关系本身不需要修改（entityId 不变），但关系的 properties 中可能
 * 存储了实体类型信息需要更新
 */
async function updateRelationReferences(migratedEntityIds: Set<string>): Promise<number> {
  let updated = 0
  for (const entityId of migratedEntityIds) {
    const relations = await storage.getRelationsByEntity(entityId)
    for (const rel of relations) {
      // 检查关系的 properties 中是否有需要更新的类型引用
      const props = rel.properties as Record<string, unknown> | undefined
      if (props) {
        let changed = false
        if (props.sourceType === 'weapon' || props.sourceType === 'apparel') {
          props.sourceType = 'item'
          changed = true
        }
        if (props.targetType === 'weapon' || props.targetType === 'apparel') {
          props.targetType = 'item'
          changed = true
        }
        if (changed) {
          await storage.updateRelation(rel.id, { properties: props })
          updated++
        }
      }
    }
  }
  return updated
}

/**
 * 重置迁移标记（仅用于测试/调试）
 */
export function resetFacetMigrationMarker(): void {
  localStorage.removeItem('worldsmith_facet_migration_v1')
}
