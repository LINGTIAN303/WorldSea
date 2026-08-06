/** Trait 类型系统 v1.0（原子 Trait 字段最小语义集 + 设计决策），详细见 docs/details/注释/packages/entity-core/types/trait.md */

import type { FieldSchema } from './entity'

// ─────────────────────────────────────────────
// SemanticHint — 语义标签，供 AutoLink 策略引擎消费
// ─────────────────────────────────────────────

/** 语义标签，标注字段的意图，不包含执行逻辑 */
export type SemanticHintName =
  | 'date'
  | 'dateEnd'
  | 'material'
  | 'color'
  | 'origin'
  | 'creator'
  | 'owner'
  | 'location'
  | 'birthDate'
  | 'deathDate'
  | 'appearance'

/** 字段上的语义注解 */
export interface SemanticHint {
  /** 语义标签名 */
  hint: SemanticHintName
  /** 可选的补充描述 */
  description?: string
}

// ─────────────────────────────────────────────
// TraitDefinition — 原子 Trait 定义
// ─────────────────────────────────────────────

/** 原子 Trait 定义，不可变、零参数 */
export interface TraitDefinition {
  /** Trait 唯一标识，如 'identifiable', 'taggable' */
  id: string
  /** 人类可读名称 */
  label: string
  /** 描述 */
  description?: string
  /** Trait 包含的字段列表 */
  fields: TraitField[]
  /** 是否为强制 Trait（所有实体必须拥有） */
  required?: boolean
}

/** Trait 内的字段定义，扩展 FieldSchema 增加语义注解 */
export interface TraitField extends FieldSchema {
  /** 语义标签，供 AutoLink 策略引擎消费 */
  semanticHint?: SemanticHintName
}

// ─────────────────────────────────────────────
// TraitRef — 实体对 Trait 的引用（含覆盖）
// ─────────────────────────────────────────────

/** 实体声明 Trait 时的引用，可携带字段覆盖 */
export interface TraitRef {
  /** 引用的 Trait ID */
  traitId: string
  /** 字段覆盖：key 为字段 key，value 为要覆盖的属性 */
  fieldOverrides?: Record<string, Partial<FieldSchema>>
}

// ─────────────────────────────────────────────
// FacetDefinition — Facet 定义（数据块，非实体）
// ─────────────────────────────────────────────

/**
 * Facet 定义——挂载在实体上的结构化数据块。
 * Facet 不是独立实体，无独立 ID，不可独立搜索。
 * Facet 的字段由 Trait 系统提供类型安全。
 */
export interface FacetDefinition {
  /** Facet 唯一标识，如 'weapon', 'apparel' */
  id: string
  /** 人类可读名称 */
  label: string
  /** 描述 */
  description?: string
  /** Facet 包含的字段列表 */
  fields: TraitField[]
  /** 适用的宿主实体类型，如 ['item'] */
  hostTypes: string[]
}

// ─────────────────────────────────────────────
// EntitySchemaV2 — 基于 Trait 的新实体 Schema
// ─────────────────────────────────────────────

/**
 * V2 实体 Schema——Trait 作为一等公民保留在运行时。
 * 编译后生成 _compiledFields 兼容旧系统。
 */
export interface EntitySchemaV2 {
  /** 实体类型标识，如 'character', 'item' */
  type: string
  /** 人类可读名称 */
  label: string
  /** 图标 */
  icon?: string
  /** 所属插件 ID */
  pluginId?: string

  // ── Trait 引用（一等公民） ──
  /** 实体引用的 Trait 列表 */
  traits: TraitRef[]

  // ── 实体自有字段 ──
  /** 实体特有的字段（非 Trait 提供） */
  ownFields: FieldSchema[]

  // ── Facet 定义 ──
  /** 实体可挂载的 Facet（如 item 的 weapon/apparel） */
  facets?: string[]

  // ── 编译产物（兼容层） ──
  /** 编译后的完整字段列表 = traits 字段 + ownFields，合并 fieldOverrides */
  _compiledFields: FieldSchema[]
  /** 编译后的 Trait ID 列表（运行时查询用） */
  _traitIds: string[]
}

// ─────────────────────────────────────────────
// Entity V2 — 增加 facets 顶级属性
// ─────────────────────────────────────────────

/**
 * Entity V2——在现有 Entity 基础上增加 facets 顶级属性。
 * facets 是结构化数据块，直接挂载在实体上，不分配独立 ID。
 */
export interface EntityV2 {
  id: string
  type: string
  /** 统一标识符，替代原 name */
  title: string
  description: string
  properties: Record<string, unknown>
  tags: string[]
  avatar?: string
  coverImage?: string
  coverPosition?: string
  coverZoom?: number
  /** Facet 数据块，key 为 facet ID，value 为 facet 字段数据 */
  facets?: Record<string, Record<string, unknown>>
  createdAt: string
  updatedAt: string
}

// ─────────────────────────────────────────────
// 预置组合（Preset）— 语法糖，不进数据模型
// ─────────────────────────────────────────────

/**
 * 预置组合——开发者体验层的语法糖。
 * 预设组合在 defineEntity 时展开为 TraitRef[]，不保留在运行时。
 */
export interface TraitPreset {
  /** 预置组合 ID */
  id: string
  /** 人类可读名称 */
  label: string
  /** 包含的 Trait ID 列表 */
  traitIds: string[]
  /** 可选的默认 fieldOverrides */
  defaultOverrides?: Record<string, Partial<FieldSchema>>
}

// ─────────────────────────────────────────────
// AutoLink 策略配置（Phase 4 前置类型）
// ─────────────────────────────────────────────

/**
 * AutoLink 策略——定义语义标签到匹配逻辑的映射。
 * Trait 只提供语义标签，策略引擎独立执行。
 */
export interface AutoLinkStrategy {
  /** 关联的语义标签 */
  hint: SemanticHintName
  /** 匹配目标实体类型 */
  matchTargets: string[]
  /** 匹配目标字段 */
  matchFields: string[]
  /** 匹配置信度模式 */
  confidence: 'exact' | 'fuzzy'
  /** 匹配成功后创建的关系类型 */
  relationType: string
  /** 关系方向：'source' 表示此实体为关系源，'target' 表示此实体为关系目标 */
  relationDirection: 'source' | 'target'
}
