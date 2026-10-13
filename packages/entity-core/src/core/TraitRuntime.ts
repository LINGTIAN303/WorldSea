/**
 * Trait 运行时系统
 * 提供 defineTrait / defineEntity / defineFacet 工厂函数，
 * compileEntitySchema 编译器，以及 traitRegistry / facetRegistry 注册表。
 */

import type { FieldSchema } from '../types'
import type {
  TraitDefinition,
  TraitRef,
  FacetDefinition,
  EntitySchemaV2,
} from '../types/trait'

// ─────────────────────────────────────────────
// Trait Registry — Trait 注册表
// ─────────────────────────────────────────────

class TraitRegistryClass {
  private traits = new Map<string, TraitDefinition>()

  register(trait: TraitDefinition): void {
    if (this.traits.has(trait.id)) {
      console.warn(`[TraitRegistry] Trait "${trait.id}" 已注册，将被覆盖`)
    }
    this.traits.set(trait.id, trait)
  }

  get(id: string): TraitDefinition | undefined {
    return this.traits.get(id)
  }

  getAll(): TraitDefinition[] {
    return Array.from(this.traits.values())
  }

  has(id: string): boolean {
    return this.traits.has(id)
  }

  /** 查询拥有指定 Trait 的所有实体类型（需配合 entitySchemaRegistryV2） */
  getTraitIds(): string[] {
    return Array.from(this.traits.keys())
  }
}

export const traitRegistry = new TraitRegistryClass()

// ─────────────────────────────────────────────
// Facet Registry — Facet 注册表
// ─────────────────────────────────────────────

class FacetRegistryClass {
  private facets = new Map<string, FacetDefinition>()

  register(facet: FacetDefinition): void {
    // 幂等：已存在则静默跳过（Facet 定义是静态的，重复注册无副作用）
    if (this.facets.has(facet.id)) return
    this.facets.set(facet.id, facet)
  }

  get(id: string): FacetDefinition | undefined {
    return this.facets.get(id)
  }

  getAll(): FacetDefinition[] {
    return Array.from(this.facets.values())
  }

  has(id: string): boolean {
    return this.facets.has(id)
  }

  /** 获取适用于指定宿主类型的所有 Facet */
  getByHostType(hostType: string): FacetDefinition[] {
    return Array.from(this.facets.values()).filter(f =>
      f.hostTypes.includes(hostType)
    )
  }
}

export const facetRegistry = new FacetRegistryClass()

// ─────────────────────────────────────────────
// Entity Schema V2 Registry — V2 实体注册表
// ─────────────────────────────────────────────

class EntitySchemaV2RegistryClass {
  private schemas = new Map<string, EntitySchemaV2>()

  register(schema: EntitySchemaV2): void {
    this.schemas.set(schema.type, schema)
  }

  get(type: string): EntitySchemaV2 | undefined {
    return this.schemas.get(type)
  }

  getAll(): EntitySchemaV2[] {
    return Array.from(this.schemas.values())
  }

  /** 查询拥有指定 Trait 的所有实体类型 */
  getByTraitId(traitId: string): EntitySchemaV2[] {
    return Array.from(this.schemas.values()).filter(s =>
      s._traitIds.includes(traitId)
    )
  }

  /** 查询拥有指定 Facet 的所有实体类型 */
  getByFacetId(facetId: string): EntitySchemaV2[] {
    return Array.from(this.schemas.values()).filter(s =>
      s.facets?.includes(facetId)
    )
  }

  unregister(type: string): void {
    this.schemas.delete(type)
  }

  /** 清空所有已注册的 V2 schema（项目切换时使用；芽/模块重新激活时经 registerEntityV2 重填） */
  clear(): void {
    this.schemas.clear()
  }
}

export const entitySchemaRegistryV2 = new EntitySchemaV2RegistryClass()

// ─────────────────────────────────────────────
// defineTrait — 原子 Trait 工厂函数
// ─────────────────────────────────────────────

/**
 * 定义一个原子 Trait 并注册到 traitRegistry。
 * 原子 Trait 不可变、零参数。
 */
export function defineTrait(trait: TraitDefinition): TraitDefinition {
  traitRegistry.register(trait)
  return trait
}

// ─────────────────────────────────────────────
// defineFacet — Facet 工厂函数
// ─────────────────────────────────────────────

/**
 * 定义一个 Facet 并注册到 facetRegistry。
 * Facet 是结构化数据块，非独立实体。
 */
export function defineFacet(facet: FacetDefinition): FacetDefinition {
  facetRegistry.register(facet)
  return facet
}

// ─────────────────────────────────────────────
// compileEntitySchema — 编译器
// ─────────────────────────────────────────────

/** 编译 EntitySchemaV2（traits 字段 + ownFields 合并为 _compiledFields，处理 fieldOverrides），详细见 docs/details/注释/packages/entity-core/core/TraitRuntime.md */
export function compileEntitySchema(params: {
  type: string
  label: string
  icon?: string
  pluginId?: string
  traits: TraitRef[]
  ownFields: FieldSchema[]
  facets?: string[]
}): EntitySchemaV2 {
  const compiledFields: FieldSchema[] = []
  const traitIds: string[] = []
  const seenKeys = new Set<string>()

  // 1. 展开 Trait 字段
  for (const traitRef of params.traits) {
    const traitDef = traitRegistry.get(traitRef.traitId)
    if (!traitDef) {
      console.warn(`[compileEntitySchema] Trait "${traitRef.traitId}" 未注册，跳过`)
      continue
    }

    traitIds.push(traitRef.traitId)

    for (const field of traitDef.fields) {
      // 应用 fieldOverrides
      const overrides = traitRef.fieldOverrides?.[field.key]
      const compiledField: FieldSchema = overrides
        ? { ...field, ...overrides }
        : { ...field }

      // 标记字段来源（内部元数据，不进入 FieldSchema 类型）
      if (!seenKeys.has(compiledField.key)) {
        compiledFields.push(compiledField)
        seenKeys.add(compiledField.key)
      }
    }
  }

  // 2. 追加 ownFields（ownFields 优先级高于 Trait 字段）
  for (const ownField of params.ownFields) {
    if (seenKeys.has(ownField.key)) {
      // ownFields 覆盖同 key 的 Trait 字段
      const idx = compiledFields.findIndex(f => f.key === ownField.key)
      if (idx !== -1) {
        compiledFields[idx] = { ...ownField }
      }
    } else {
      compiledFields.push({ ...ownField })
      seenKeys.add(ownField.key)
    }
  }

  return {
    type: params.type,
    label: params.label,
    icon: params.icon,
    pluginId: params.pluginId,
    traits: params.traits,
    ownFields: params.ownFields,
    facets: params.facets,
    _compiledFields: compiledFields,
    _traitIds: traitIds,
  }
}

// ─────────────────────────────────────────────
// defineEntity — V2 实体工厂函数
// ─────────────────────────────────────────────

/**
 * 定义一个 V2 实体 Schema，编译并注册到 entitySchemaRegistryV2。
 * 同时兼容旧版 entitySchemaRegistry（注册 _compiledFields）。
 */
export function defineEntity(params: {
  type: string
  label: string
  icon?: string
  pluginId?: string
  traits: TraitRef[]
  ownFields: FieldSchema[]
  facets?: string[]
}): EntitySchemaV2 {
  const schema = compileEntitySchema(params)
  entitySchemaRegistryV2.register(schema)
  return schema
}
