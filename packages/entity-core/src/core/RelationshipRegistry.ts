/** 全局关系注册中心（集中声明、强制有向 + inverseType、按 source/target 索引），详细见 docs/details/注释/packages/entity-core/core/RelationshipRegistry.md */

import type { RelationTypeSchemaV2 } from '../types/relation'
import { relationSchemaRegistry } from './RelationSchema'
import { inverseRegistry } from './inverseRegistry'

// ─────────────────────────────────────────────
// RelationshipRegistry — 全局关系注册中心
// ─────────────────────────────────────────────

class RelationshipRegistryClass {
  private schemas = new Map<string, RelationTypeSchemaV2>()
  /** 按 sourceType 索引：sourceType → RelationTypeSchemaV2[] */
  private bySource = new Map<string, RelationTypeSchemaV2[]>()
  /** 按 targetType 索引：targetType → RelationTypeSchemaV2[] */
  private byTarget = new Map<string, RelationTypeSchemaV2[]>()
  /** inverseType 映射：type → inverseType */
  private inverseMap = new Map<string, string>()
  /** localStorage 存储键 */
  private static STORAGE_KEY = 'ws_custom_relation_types'

  register(schema: RelationTypeSchemaV2): void {
    if (this.schemas.has(schema.type)) {
      console.warn(`[RelationshipRegistry] 关系类型 "${schema.type}" 已注册，将被覆盖`)
    }

    this.schemas.set(schema.type, schema)
    this.inverseMap.set(schema.type, schema.inverseType)

    // 更新 sourceType 索引
    for (const sourceType of schema.sourceTypes) {
      const list = this.bySource.get(sourceType) || []
      list.push(schema)
      this.bySource.set(sourceType, list)
    }

    // 更新 targetType 索引
    for (const targetType of schema.targetTypes) {
      const list = this.byTarget.get(targetType) || []
      list.push(schema)
      this.byTarget.set(targetType, list)
    }
  }

  get(type: string): RelationTypeSchemaV2 | undefined {
    return this.schemas.get(type)
  }

  getAll(): RelationTypeSchemaV2[] {
    return Array.from(this.schemas.values())
  }

  has(type: string): boolean {
    return this.schemas.has(type)
  }

  /** 获取逆关系类型 */
  getInverseType(type: string): string | undefined {
    return this.inverseMap.get(type)
  }

  /** 获取逆关系 schema */
  getInverseSchema(type: string): RelationTypeSchemaV2 | undefined {
    const inverseType = this.inverseMap.get(type)
    return inverseType ? this.schemas.get(inverseType) : undefined
  }

  /** 按源实体类型查询所有关系 */
  getBySourceType(sourceType: string): RelationTypeSchemaV2[] {
    return this.bySource.get(sourceType) || []
  }

  /** 按目标实体类型查询所有关系 */
  getByTargetType(targetType: string): RelationTypeSchemaV2[] {
    return this.byTarget.get(targetType) || []
  }

  /** 查询两个实体类型之间的所有关系 */
  getBetweenTypes(sourceType: string, targetType: string): RelationTypeSchemaV2[] {
    return this.getBySourceType(sourceType).filter(s =>
      s.targetTypes.includes(targetType)
    )
  }

  /** 按领域分组查询 */
  getByDomain(domain: string): RelationTypeSchemaV2[] {
    return Array.from(this.schemas.values()).filter(s => s.domain === domain)
  }

  /** 查询实体参与的所有关系（作为源或目标） */
  getRelationsForType(entityType: string): RelationTypeSchemaV2[] {
    const asSource = this.getBySourceType(entityType)
    const asTarget = this.getByTargetType(entityType)
    // 合并去重
    const seen = new Set<string>()
    const result: RelationTypeSchemaV2[] = []
    for (const s of [...asSource, ...asTarget]) {
      if (!seen.has(s.type)) {
        seen.add(s.type)
        result.push(s)
      }
    }
    return result
  }

  unregister(type: string): void {
    const schema = this.schemas.get(type)
    if (!schema) return

    this.schemas.delete(type)
    this.inverseMap.delete(type)

    // 清理 sourceType 索引
    for (const sourceType of schema.sourceTypes) {
      const list = this.bySource.get(sourceType)
      if (list) {
        this.bySource.set(sourceType, list.filter(s => s.type !== type))
      }
    }

    // 清理 targetType 索引
    for (const targetType of schema.targetTypes) {
      const list = this.byTarget.get(targetType)
      if (list) {
        this.byTarget.set(targetType, list.filter(s => s.type !== type))
      }
    }
  }

  // ─────────────────────────────────────────────
  // 自定义关系类型
  // ─────────────────────────────────────────────

  /** 注册自定义关系类型，标记 isCustom=true 并持久化 */
  registerCustom(schema: RelationTypeSchemaV2): void {
    const customSchema: RelationTypeSchemaV2 = { ...schema, isCustom: true }
    this.register(customSchema)

    // 如果逆关系尚未注册，自动注册逆关系（也标记 isCustom）
    if (customSchema.inverseType !== customSchema.type && !this.has(customSchema.inverseType)) {
      this.register({
        type: customSchema.inverseType,
        label: customSchema.inverseLabel,
        sourceTypes: customSchema.targetTypes,
        targetTypes: customSchema.sourceTypes,
        inverseType: customSchema.type,
        inverseLabel: customSchema.label,
        symmetric: customSchema.symmetric,
        properties: customSchema.properties,
        domain: customSchema.domain,
        isCustom: true,
      })
    }

    this.saveCustomTypes()
  }

  /** 获取所有自定义关系类型 */
  getCustomTypes(): RelationTypeSchemaV2[] {
    return Array.from(this.schemas.values()).filter(s => s.isCustom === true)
  }

  /** 删除自定义关系类型（仅限 isCustom 的类型） */
  unregisterCustom(type: string): void {
    const schema = this.schemas.get(type)
    if (!schema || !schema.isCustom) return

    // 同时删除逆关系（如果是自定义的）
    if (schema.inverseType && schema.inverseType !== type) {
      const inverseSchema = this.schemas.get(schema.inverseType)
      if (inverseSchema?.isCustom) {
        this.unregister(schema.inverseType)
      }
    }

    this.unregister(type)
    this.saveCustomTypes()
  }

  /** 将自定义关系类型持久化到 localStorage */
  saveCustomTypes(): void {
    try {
      const customTypes = this.getCustomTypes()
      localStorage.setItem(RelationshipRegistryClass.STORAGE_KEY, JSON.stringify(customTypes))
    } catch (e) {
      console.warn('[RelationshipRegistry] 保存自定义关系类型失败:', e)
    }
  }

  /** 从 localStorage 加载自定义关系类型 */
  loadCustomTypes(): void {
    try {
      const raw = localStorage.getItem(RelationshipRegistryClass.STORAGE_KEY)
      if (!raw) return
      const customTypes: RelationTypeSchemaV2[] = JSON.parse(raw)
      for (const schema of customTypes) {
        if (!this.schemas.has(schema.type)) {
          this.register({ ...schema, isCustom: true })
        }
      }
    } catch (e) {
      console.warn('[RelationshipRegistry] 加载自定义关系类型失败:', e)
    }
  }
}

export const relationshipRegistry = new RelationshipRegistryClass()

// ─────────────────────────────────────────────
// syncToLegacyRegistry — 将 V2 关系同步到旧版 relationSchemaRegistry
// ─────────────────────────────────────────────

/**
 * 将 relationshipRegistry（V2）中的所有关系同步到旧版注册表：
 * ① relationSchemaRegistry（旧版依赖方仍查它，如 canvas-engine 图数据标签）；
 * ② inverseRegistry（useBidirectional / useEdgeDedup 的 inverse 查表——2026-10-15 补：
 *    此前它仅覆盖旧枚举 relationTypes，V2 关系（note_link 等）的 getInverse 恒为 undefined
 *    ⇒ createBidirectional 只建 forward 单记录（「双向」名不副实）。
 *    补同步后 V2 关系与旧枚举行为对齐；「已注册不覆盖」保护旧枚举既有语义。
 * 在全局关系定义加载后调用一次（包入口 side-effect）。
 */
export function syncToLegacyRegistry(): void {
  for (const schema of relationshipRegistry.getAll()) {
    if (!relationSchemaRegistry.get(schema.type)) {
      relationSchemaRegistry.register({
        typeKey: schema.type,
        label: schema.label,
        sourceTypes: schema.sourceTypes,
        targetTypes: schema.targetTypes,
        directed: !schema.symmetric,
        inverseType: schema.inverseType,
        properties: schema.properties,
        pluginId: schema.pluginId,
      })
    }
    // inverse 同步（幂等；旧枚举已注册者不覆盖）
    if (schema.inverseType && !inverseRegistry.hasInverse(schema.type)) {
      inverseRegistry.register(schema.type, schema.inverseType)
    }
  }
}

// ─────────────────────────────────────────────
// defineRelation — 关系定义工厂函数
// ─────────────────────────────────────────────

/**
 * 定义一个全局关系并注册到 relationshipRegistry。
 * 自动校验 inverseType 的一致性。
 */
export function defineRelation(schema: RelationTypeSchemaV2): RelationTypeSchemaV2 {
  // 幂等：已存在则直接返回（避免 HMR 或重复导入触发 warn + 覆盖）
  if (relationshipRegistry.has(schema.type)) {
    return relationshipRegistry.get(schema.type)!
  }

  // 校验：对称关系的 inverseType 必须指向自身
  if (schema.symmetric && schema.inverseType !== schema.type) {
    console.warn(
      `[defineRelation] 对称关系 "${schema.type}" 的 inverseType 应为自身，当前为 "${schema.inverseType}"`
    )
  }

  relationshipRegistry.register(schema)

  // 如果逆关系尚未注册，自动注册
  if (schema.inverseType !== schema.type && !relationshipRegistry.has(schema.inverseType)) {
    relationshipRegistry.register({
      type: schema.inverseType,
      label: schema.inverseLabel,
      sourceTypes: schema.targetTypes,
      targetTypes: schema.sourceTypes,
      inverseType: schema.type,
      inverseLabel: schema.label,
      symmetric: schema.symmetric,
      properties: schema.properties,
      domain: schema.domain,
    })
  }

  return schema
}
