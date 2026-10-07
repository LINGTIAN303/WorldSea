/**
 * SemanticHint 系统 + AutoLink 策略引擎
 *
 * 设计决策：
 * - Trait 只提供语义标签（SemanticHint），不包含执行逻辑
 * - AutoLink 策略引擎独立执行，维护 hint → matchTargets → matchFields 映射
 * - 只实现"被动索引"和"建议确认"两种模式，暂缓"自动创建"
 * - 三层解耦：Trait（数据形状）→ 语义标签（意图）→ 策略引擎（执行逻辑）
 */

import type { SemanticHintName, AutoLinkStrategy } from '../types/trait'
import { entitySchemaRegistryV2, traitRegistry } from './TraitRuntime'
import { storage } from './StorageBackend'
import { potentialLinkIndex, type PotentialLink } from './PotentialLinkIndex'
import { autoLinkDecisionStore } from './AutoLinkDecisions'

export { potentialLinkIndex } from './PotentialLinkIndex'
export type { PotentialLink } from './PotentialLinkIndex'

// ─────────────────────────────────────────────
// SemanticHint Registry — 语义标签注册表
// ─────────────────────────────────────────────

interface SemanticHintEntry {
  hint: SemanticHintName
  description: string
  /** 哪些 Trait 使用了此标签 */
  usedInTraits: string[]
}

class SemanticHintRegistryClass {
  private hints = new Map<SemanticHintName, SemanticHintEntry>()

  register(hint: SemanticHintName, description: string, traitId: string): void {
    const existing = this.hints.get(hint)
    if (existing) {
      if (!existing.usedInTraits.includes(traitId)) {
        existing.usedInTraits.push(traitId)
      }
    } else {
      this.hints.set(hint, { hint, description, usedInTraits: [traitId] })
    }
  }

  get(hint: SemanticHintName): SemanticHintEntry | undefined {
    return this.hints.get(hint)
  }

  getAll(): SemanticHintEntry[] {
    return Array.from(this.hints.values())
  }
}

export const semanticHintRegistry = new SemanticHintRegistryClass()

// ─────────────────────────────────────────────
// AutoLink Strategy Registry — 策略注册表
// ─────────────────────────────────────────────

class AutoLinkStrategyRegistryClass {
  private strategies = new Map<SemanticHintName, AutoLinkStrategy[]>()

  register(strategy: AutoLinkStrategy): void {
    const list = this.strategies.get(strategy.hint) || []
    list.push(strategy)
    this.strategies.set(strategy.hint, list)
  }

  getByHint(hint: SemanticHintName): AutoLinkStrategy[] {
    return this.strategies.get(hint) || []
  }

  getAll(): AutoLinkStrategy[] {
    return Array.from(this.strategies.values()).flat()
  }

  /** 获取所有唯一的语义标签 */
  getRegisteredHints(): SemanticHintName[] {
    return Array.from(this.strategies.keys())
  }
}

export const autoLinkStrategyRegistry = new AutoLinkStrategyRegistryClass()

// ─────────────────────────────────────────────
// 默认 AutoLink 策略集
// ─────────────────────────────────────────────

/** 注册默认的 AutoLink 策略 */
export function registerDefaultStrategies(): void {
  // origin → 匹配 region, building, organization
  autoLinkStrategyRegistry.register({
    hint: 'origin',
    matchTargets: ['region', 'building', 'organization'],
    matchFields: ['title', 'name'],
    confidence: 'fuzzy',
    relationType: 'originates_from',
    relationDirection: 'source',
  })

  // creator → 匹配 character, organization
  autoLinkStrategyRegistry.register({
    hint: 'creator',
    matchTargets: ['character', 'organization'],
    matchFields: ['title', 'name'],
    confidence: 'fuzzy',
    relationType: 'created_by',
    relationDirection: 'source',
  })

  // owner → 匹配 character, organization
  autoLinkStrategyRegistry.register({
    hint: 'owner',
    matchTargets: ['character', 'organization'],
    matchFields: ['title', 'name'],
    confidence: 'fuzzy',
    relationType: 'owned_by',
    relationDirection: 'source',
  })

  // location → 匹配 region, building
  autoLinkStrategyRegistry.register({
    hint: 'location',
    matchTargets: ['region', 'building'],
    matchFields: ['title', 'name'],
    confidence: 'fuzzy',
    relationType: 'located_in',
    relationDirection: 'source',
  })

  // date → 匹配 event
  autoLinkStrategyRegistry.register({
    hint: 'date',
    matchTargets: ['event'],
    matchFields: ['date', 'era'],
    confidence: 'exact',
    relationType: 'happened_in',
    relationDirection: 'source',
  })

  // appearance → 匹配 species, character
  autoLinkStrategyRegistry.register({
    hint: 'appearance',
    matchTargets: ['species', 'character'],
    matchFields: ['title', 'name'],
    confidence: 'fuzzy',
    relationType: 'associated_with',
    relationDirection: 'source',
  })

  // material → 匹配 item, plant
  autoLinkStrategyRegistry.register({
    hint: 'material',
    matchTargets: ['item', 'plant'],
    matchFields: ['title', 'name', 'material'],
    confidence: 'fuzzy',
    relationType: 'related_item',
    relationDirection: 'source',
  })

  // birthDate → 匹配 event（诞生相关事件）
  autoLinkStrategyRegistry.register({
    hint: 'birthDate',
    matchTargets: ['event'],
    matchFields: ['date'],
    confidence: 'exact',
    relationType: 'born_in',
    relationDirection: 'source',
  })

  // deathDate → 匹配 event（消亡相关事件）
  autoLinkStrategyRegistry.register({
    hint: 'deathDate',
    matchTargets: ['event'],
    matchFields: ['date'],
    confidence: 'exact',
    relationType: 'died_in',
    relationDirection: 'source',
  })
}

// ─────────────────────────────────────────────
// 用户自定义字段映射（User Field Mapping）
// 用户手动定义字段 key → 语义的映射，系统持久化记忆
// 优先级高于启发式推断，低于 Schema 声明
// ─────────────────────────────────────────────

const USER_FIELD_MAPPING_KEY = 'worldsea_user_field_mappings'

/** 用户自定义字段映射条目 */
export interface UserFieldMapping {
  /** 字段 key（精确匹配） */
  key: string
  /** 语义标签（走策略引擎），与 directTarget 二选一 */
  hint?: SemanticHintName
  /** 直接目标类型（绕过策略引擎），与 hint 二选一 */
  targetType?: string
  /** 关系类型 */
  relationType: string
}

class UserFieldMappingStoreClass {
  private mappings = new Map<string, UserFieldMapping>()

  constructor() {
    this.load()
  }

  /** 从 localStorage 加载 */
  private load(): void {
    try {
      const raw = localStorage.getItem(USER_FIELD_MAPPING_KEY)
      if (!raw) return
      const arr: UserFieldMapping[] = JSON.parse(raw)
      for (const m of arr) {
        this.mappings.set(m.key, m)
      }
    } catch {
      // 损坏数据静默忽略
    }
  }

  /** 持久化到 localStorage */
  private save(): void {
    const arr = Array.from(this.mappings.values())
    localStorage.setItem(USER_FIELD_MAPPING_KEY, JSON.stringify(arr))
  }

  /** 注册一条用户映射 */
  register(mapping: UserFieldMapping): void {
    this.mappings.set(mapping.key, mapping)
    this.save()
  }

  /** 查询字段 key 的用户映射 */
  get(key: string): UserFieldMapping | undefined {
    return this.mappings.get(key)
  }

  /** 删除一条用户映射 */
  remove(key: string): void {
    this.mappings.delete(key)
    this.save()
  }

  /** 获取所有用户映射 */
  getAll(): UserFieldMapping[] {
    return Array.from(this.mappings.values())
  }

  /** 清空所有用户映射 */
  clear(): void {
    this.mappings.clear()
    localStorage.removeItem(USER_FIELD_MAPPING_KEY)
  }
}

export const userFieldMappingStore = new UserFieldMappingStoreClass()

// ─────────────────────────────────────────────
// 启发式字段名推断（Heuristic Key Inference）
// 对无 semanticHint / autoLink / 用户映射 的字段，根据 key 关键词猜测意图
// ─────────────────────────────────────────────

/** 字段名关键词 → 语义标签映射 */
const FIELD_KEY_HINT_PATTERNS: Array<{ patterns: RegExp[]; hint: SemanticHintName }> = [
  // origin/来源
  { patterns: [/origin/i, /来源/, /产地/, /hometown/i, /birthplace/i, /发源地/], hint: 'origin' },
  // creator/制作者
  { patterns: [/creator/i, /maker/i, /smith/i, /作者/, /制作者/, /创作者/, /铸造者/], hint: 'creator' },
  // owner/持有者
  { patterns: [/owner/i, /holder/i, /拥有者/, /持有者/, /所有者/], hint: 'owner' },
  // location/位置
  { patterns: [/location/i, /place/i, /位置/, /地点/, /所在/, /栖息地/, /据点/], hint: 'location' },
  // date/时间
  { patterns: [/date/i, /time/i, /日期/, /时间/, /年代/, /era$/i], hint: 'date' },
  // appearance/外貌
  { patterns: [/appearance/i, /look/i, /外貌/, /外观/, /长相/], hint: 'appearance' },
  // material/材质
  { patterns: [/material/i, /材质/, /材料/, /原料/], hint: 'material' },
  // birthDate/诞生
  { patterns: [/birth/i, /born/i, /诞生/, /出生/, /降生/], hint: 'birthDate' },
  // deathDate/消亡
  { patterns: [/death/i, /died/i, /消亡/, /死亡/, /陨落/, /灭绝/], hint: 'deathDate' },
]

/**
 * 根据字段 key 推断语义标签。
 * 返回 null 表示无法推断，需走盲匹配。
 */
export function inferSemanticHintFromKey(key: string): SemanticHintName | null {
  for (const { patterns, hint } of FIELD_KEY_HINT_PATTERNS) {
    for (const pat of patterns) {
      if (pat.test(key)) return hint
    }
  }
  return null
}

/** 字段名关键词 → 目标实体类型直接映射（绕过策略引擎） */
const FIELD_KEY_TARGET_MAP: Array<{ patterns: RegExp[]; targetType: string; relationType: string }> = [
  { patterns: [/race/i, /种族/, /物种/], targetType: 'species', relationType: 'belongs_to' },
  { patterns: [/faction/i, /势力/, /组织/, /affiliation/i, /所属/], targetType: 'organization', relationType: 'belongs_to' },
  { patterns: [/weapon/i, /武器/, /兵器/], targetType: 'item', relationType: 'wields' },
  // mount→creature 条目已删（2026-10-07）：仓内无 creature 实体类型，待生物类型立项后再加
]

/**
 * 根据字段 key 推断直接匹配目标。
 * 返回 null 表示无法推断。
 */
export function inferDirectTargetFromKey(key: string): { targetType: string; relationType: string } | null {
  for (const { patterns, targetType, relationType } of FIELD_KEY_TARGET_MAP) {
    for (const pat of patterns) {
      if (pat.test(key)) return { targetType, relationType }
    }
  }
  return null
}

// ─────────────────────────────────────────────
// AutoLink 执行器
// ─────────────────────────────────────────────

/**
 * 执行被动索引：分析实体字段文本，查找潜在链接。
 * 不创建关系，只建立索引。
 */
export async function indexPotentialLinks(
  entityId: string,
  entityType: string,
  properties: Record<string, unknown>,
): Promise<void> {
  // 获取实体的 V2 Schema
  const schema = entitySchemaRegistryV2?.get(entityType)
  if (!schema) return

  // 清除该实体的旧索引
  potentialLinkIndex.clearBySource(entityId)

  // 1. 遍历 Trait 字段，查找有 semanticHint 的字段
  for (const traitRef of schema.traits) {
    const traitDef = traitRegistry?.get(traitRef.traitId)
    if (!traitDef) continue

    for (const field of traitDef.fields) {
      if (!field.semanticHint) continue

      const value = properties[field.key]
      if (!value || typeof value !== 'string' || value.trim() === '') continue

      // 获取该 hint 的所有策略
      const strategies = autoLinkStrategyRegistry.getByHint(field.semanticHint)
      for (const strategy of strategies) {
        await matchAndIndex(entityId, field.key, value, field.semanticHint, strategy)
      }
    }
  }

  // 2. 遍历 ownFields，查找有 autoLink 配置的字段
  // 同时收集无 autoLink 的文本字段，用于步骤2.5/3/4
  const unmappedFields: Array<{ key: string; value: string }> = []

  for (const field of schema.ownFields) {
    const value = properties[field.key]
    if (!value || typeof value !== 'string' || value.trim() === '') continue

    if (field.autoLink) {
      // autoLink 直接指定了目标类型和关系类型，无需策略匹配
      await matchAndIndexDirect(entityId, field.key, value, field.autoLink.targetType, field.autoLink.relationType, field.autoLink.searchField)
    } else if (field.fieldType === 'text' || field.fieldType === 'textarea') {
      // 收集无 autoLink 的文本字段
      unmappedFields.push({ key: field.key, value })
    }
  }

  // 2.5 + 3 + 4: 对无 autoLink 的字段，依次尝试：用户映射 → 启发式推断 → 盲匹配
  await resolveUnmappedFields(entityId, unmappedFields)

  // 5. 运行时临时字段：扫描 properties 中不在 Schema 定义内的字段
  // 这些是用户手动添加的、不在 traits/ownFields 中的字段
  const knownKeys = new Set<string>()
  for (const traitRef of schema.traits) {
    const traitDef = traitRegistry?.get(traitRef.traitId)
    if (traitDef) {
      for (const f of traitDef.fields) knownKeys.add(f.key)
    }
  }
  for (const f of schema.ownFields) knownKeys.add(f.key)
  // 内置字段也排除
  for (const k of ['name', 'title', 'description', 'tags', 'avatar', 'coverImage']) knownKeys.add(k)

  const adHocFields: Array<{ key: string; value: string }> = []
  for (const [key, raw] of Object.entries(properties)) {
    if (knownKeys.has(key)) continue
    if (typeof raw !== 'string' || raw.trim() === '' || raw.trim().length < 2) continue
    adHocFields.push({ key, value: raw })
  }

  if (adHocFields.length > 0) {
    // 临时字段同样走：用户映射 → 启发式推断 → 盲匹配
    await resolveUnmappedFields(entityId, adHocFields)
  }

  // 持久决策应用：已处理且内容未变的条目保持隐藏（跨会话 / 重建索引均有效）
  applyPersistedDecisions(entityId)
}

/** 应用持久化决策：命中且内容指纹未变的条目保持隐藏 */
function applyPersistedDecisions(sourceEntityId: string): void {
  for (const link of potentialLinkIndex.getAllBySource(sourceEntityId)) {
    if (link.resolved) continue
    const decision = autoLinkDecisionStore.recall(link)
    if (decision) potentialLinkIndex.resolve(link.id, decision)
  }
}

/**
 * 对无 Schema 声明的字段，依次尝试三层推断：
 * 2.5 用户自定义映射 → 3 启发式推断 → 4 盲匹配
 */
async function resolveUnmappedFields(
  sourceEntityId: string,
  fields: Array<{ key: string; value: string }>,
): Promise<void> {
  const blindMatchFields: Array<{ key: string; value: string }> = []

  for (const { key, value } of fields) {
    // 2.5 优先查用户自定义映射
    const userMapping = userFieldMappingStore.get(key)
    if (userMapping) {
      if (userMapping.targetType) {
        // 用户映射指定了直接目标
        await matchAndIndexDirect(sourceEntityId, key, value, userMapping.targetType, userMapping.relationType)
      } else if (userMapping.hint) {
        // 用户映射指定了语义标签
        const strategies = autoLinkStrategyRegistry.getByHint(userMapping.hint)
        for (const strategy of strategies) {
          await matchAndIndex(sourceEntityId, key, value, userMapping.hint!, strategy)
        }
      }
      continue
    }

    // 3. 启发式推断：字段名关键词匹配
    const directTarget = inferDirectTargetFromKey(key)
    if (directTarget) {
      await matchAndIndexDirect(sourceEntityId, key, value, directTarget.targetType, directTarget.relationType)
      continue
    }

    const hint = inferSemanticHintFromKey(key)
    if (hint) {
      const strategies = autoLinkStrategyRegistry.getByHint(hint)
      for (const strategy of strategies) {
        await matchAndIndex(sourceEntityId, key, value, hint, strategy)
      }
      continue
    }

    // 4. 无法推断，加入盲匹配队列
    blindMatchFields.push({ key, value })
  }

  // 盲匹配：拿字段值碰撞所有实体 title，高置信度(>=0.8)时建议 associated_with 关系
  if (blindMatchFields.length > 0) {
    await blindMatchAllEntities(sourceEntityId, blindMatchFields)
  }
}

/**
 * 增量更新：当目标实体变更时，重新索引所有引用该实体的潜在链接。
 * 遍历所有未解决的潜在链接，若目标实体匹配则更新分数，否则移除过期链接。
 */
export async function refreshLinksForTarget(
  targetEntityId: string,
  _targetEntityType: string,
  _targetProperties: Record<string, unknown>,
): Promise<void> {
  // 收集所有引用该目标实体的未解决链接
  const staleLinks = potentialLinkIndex.getAll()
    .filter((l: PotentialLink) => !l.resolved && l.targetEntityId === targetEntityId)

  if (staleLinks.length === 0) return

  // 移除过期链接
  for (const link of staleLinks) {
    potentialLinkIndex.resolve(link.id, 'dismissed')
  }

  // 重新索引引用该目标的源实体
  const sourceIds = new Set(staleLinks.map((l: PotentialLink) => l.sourceEntityId))
  for (const sourceId of sourceIds) {
    try {
      const sourceEntity = await storage.getEntity(sourceId)
      if (sourceEntity) {
        await indexPotentialLinks(sourceId, sourceEntity.type, sourceEntity.properties ?? {})
      }
    } catch {
      // 源实体已删除则跳过
    }
  }
}

/** 执行匹配并添加到索引 */
async function matchAndIndex(
  sourceEntityId: string,
  sourceFieldKey: string,
  sourceText: string,
  hint: SemanticHintName,
  strategy: AutoLinkStrategy,
): Promise<void> {
  for (const targetType of strategy.matchTargets) {
    try {
      const candidates = await storage.getEntitiesByType(targetType)
      for (const candidate of candidates) {
        // 跳过自身
        if (candidate.id === sourceEntityId) continue

        // 在候选实体的匹配字段中查找
        for (const fieldKey of strategy.matchFields) {
          const targetValue = String(candidate.properties?.[fieldKey] ?? candidate.name ?? '')
          if (!targetValue) continue

          let score = 0
          if (strategy.confidence === 'exact') {
            score = sourceText === targetValue ? 1.0 : 0
          } else {
            score = computeFuzzyScore(sourceText, targetValue)
          }

          // 低于阈值则跳过
          if (score < 0.5) continue

          potentialLinkIndex.add({
            id: `${sourceEntityId}:${sourceFieldKey}:${candidate.id}:${strategy.relationType}`,
            sourceEntityId,
            sourceFieldKey,
            sourceText,
            targetEntityId: candidate.id,
            targetEntityType: candidate.type,
            targetFieldValue: targetValue,
            hint,
            relationType: strategy.relationType,
            confidence: strategy.confidence,
            score,
            resolved: false,
            createdAt: new Date().toISOString(),
          })
        }
      }
    } catch {
      // 存储层不可用时静默跳过（如 IndexedDB 未初始化）
    }
  }
}

/** 通过 autoLink 配置直接匹配（不走策略引擎） */
async function matchAndIndexDirect(
  sourceEntityId: string,
  sourceFieldKey: string,
  sourceText: string,
  targetType: string,
  relationType: string,
  searchField?: string,
): Promise<void> {
  try {
    const candidates = await storage.getEntitiesByType(targetType)
    for (const candidate of candidates) {
      if (candidate.id === sourceEntityId) continue

      // 优先搜索指定字段，否则搜索 title
      const fieldName = searchField ?? 'title'
      const targetValue = String(candidate.properties?.[fieldName] ?? candidate.name ?? '')
      if (!targetValue) continue

      const score = computeFuzzyScore(sourceText, targetValue)
      if (score < 0.5) continue

      potentialLinkIndex.add({
        id: `${sourceEntityId}:${sourceFieldKey}:${candidate.id}:${relationType}`,
        sourceEntityId,
        sourceFieldKey,
        sourceText,
        targetEntityId: candidate.id,
        targetEntityType: candidate.type,
        targetFieldValue: targetValue,
        hint: 'origin' as SemanticHintName, // autoLink 无 hint，用占位
        relationType,
        confidence: score >= 0.9 ? 'exact' : 'fuzzy',
        score,
        resolved: false,
        createdAt: new Date().toISOString(),
      })
    }
  } catch {
    // 存储层不可用时静默跳过
  }
}

/**
 * 盲匹配：拿字段值碰撞所有实体的 title。
 * 仅在字段名无法推断意图时使用，阈值 0.8 减少噪音。
 * 匹配成功建议通用的 associated_with 关系。
 */
async function blindMatchAllEntities(
  sourceEntityId: string,
  fields: Array<{ key: string; value: string }>,
): Promise<void> {
  try {
    // 获取所有实体类型，逐一搜索
    const allTypes = entitySchemaRegistryV2?.getAll().map(s => s.type) ?? []
    if (allTypes.length === 0) return

    for (const { key, value } of fields) {
      // 跳过过短的值（避免噪音）
      if (value.trim().length < 2) continue

      for (const type of allTypes) {
        const candidates = await storage.getEntitiesByType(type)
        for (const candidate of candidates) {
          if (candidate.id === sourceEntityId) continue

          const targetTitle = candidate.name ?? ''
          if (!targetTitle) continue

          const score = computeFuzzyScore(value, targetTitle)
          if (score < 0.8) continue

          potentialLinkIndex.add({
            id: `${sourceEntityId}:${key}:${candidate.id}:associated_with:blind`,
            sourceEntityId,
            sourceFieldKey: key,
            sourceText: value,
            targetEntityId: candidate.id,
            targetEntityType: candidate.type,
            targetFieldValue: targetTitle,
            hint: 'origin' as SemanticHintName, // 盲匹配无 hint，用占位
            relationType: 'associated_with',
            confidence: score >= 0.9 ? 'exact' : 'fuzzy',
            score,
            resolved: false,
            createdAt: new Date().toISOString(),
          })
        }
      }
    }
  } catch {
    // 存储层不可用时静默跳过
  }
}

/** 简单模糊匹配分数计算 */
function computeFuzzyScore(source: string, target: string): number {
  if (!source || !target) return 0
  const s = source.toLowerCase()
  const t = target.toLowerCase()
  if (s === t) return 1.0
  if (s.includes(t) || t.includes(s)) return 0.8
  // 简单字符重叠率
  let overlap = 0
  for (let i = 0; i < s.length - 1; i++) {
    const bigram = s.substring(i, i + 2)
    if (t.includes(bigram)) overlap++
  }
  const maxBigrams = Math.max(s.length, t.length) - 1
  return maxBigrams > 0 ? overlap / maxBigrams : 0
}
