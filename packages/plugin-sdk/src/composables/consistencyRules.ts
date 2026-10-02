/**
 * consistencyRules — 一致性检查纯函数规则集（2026-10-02 自 entity-core 迁入并增强）。
 *
 * 迁入原因：引用/选项类检查需要 `normalizeFieldType` 做字段类型归一（漂移唯一定义处），
 * 而它在 plugin-sdk——依赖方向（plugin-sdk → entity-core）决定了 schema 派生逻辑只能住这边。
 * 详见 docs/details/注释/packages/plugin-sdk/一致性检查.md
 *
 * 纯函数 + 纯数据入参（stores 在 useConsistencyChecker 里解包），便于单测与未来复用。
 */

import { normalizeFieldType, isArrayValueField } from '../detail/fieldType'
import type { Entity, FieldSchema } from '@worldsea/entity-core'
import type { Relation } from '@worldsea/entity-core'

export type ConsistencySeverity = 'error' | 'warning' | 'info'

export type ConsistencyCategory =
  // ── 原有四类 ──
  | 'dangling_relation' // 关系端点实体不存在
  | 'missing_required' // 缺少必填字段
  | 'type_mismatch' // 关系两端类型不在允许集
  | 'orphan_entity' // 无任何关系的孤立实体
  // ── 2026-10-02 新增 ──
  | 'duplicate_name' // 同类型下名称重复
  | 'empty_name' // 空白名称
  | 'dangling_ref' // entityRef 字段引用的实体不存在
  | 'invalid_select' // select/multiSelect 值不在选项列表
  | 'unregistered_type' // 关系类型未注册
  | 'self_loop' // 关系两端为同一实体

export interface ConsistencyIssue {
  id: string
  severity: ConsistencySeverity
  category: ConsistencyCategory
  message: string
  entityId?: string
  relationId?: string
  suggestion?: string
}

/** 已合并 customFields 的字段集（按实体类型） */
export interface ConsistencySchemaEntry {
  fields: FieldSchema[]
}

export interface ConsistencyRelationTypeEntry {
  label?: string
  sourceTypes: string[]
  targetTypes: string[]
}

export interface ConsistencyCheckInput {
  entities: Entity[]
  relations: Relation[]
  schemas: Map<string, ConsistencySchemaEntry>
  relationTypes: Map<string, ConsistencyRelationTypeEntry>
}

/** 「必填缺失」的判定：仅真空值算缺——0 / false 是合法值，不得误报（旧实现 !value 会误报） */
function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/** 选项值集合（select/multiSelect 的 options：{value,label}[]） */
function optionValues(field: FieldSchema): Set<string> | null {
  const opts = field.options
  if (!opts || opts.length === 0) return null
  return new Set(opts.map(o => String(o.value)))
}

export function runConsistencyChecks(input: ConsistencyCheckInput): ConsistencyIssue[] {
  const { entities, relations, schemas, relationTypes } = input
  const found: ConsistencyIssue[] = []

  // ── 预建索引：实体按 id / 关系类型按 type（旧实现对关系×实体做 O(R×E) find）──
  const entityById = new Map(entities.map(e => [e.id, e]))
  const relTypeOf = (type: string) => relationTypes.get(type)
  const relLabel = (rel: Relation) => relTypeOf(rel.type)?.label || rel.type

  // ════ 关系级检查 ════

  for (const rel of relations) {
    // 1. 悬空关系：端点实体不存在（源/目标各报一条，便于逐条修复/跳转）
    if (!entityById.has(rel.sourceId)) {
      found.push({
        id: `dangling_src_${rel.id}`,
        severity: 'error',
        category: 'dangling_relation',
        message: `关系「${relLabel(rel)}」的源实体不存在（${rel.sourceId}）`,
        relationId: rel.id,
        suggestion: '删除此关系或恢复源实体',
      })
    }
    if (!entityById.has(rel.targetId)) {
      found.push({
        id: `dangling_tgt_${rel.id}`,
        severity: 'error',
        category: 'dangling_relation',
        message: `关系「${relLabel(rel)}」的目标实体不存在（${rel.targetId}）`,
        relationId: rel.id,
        suggestion: '删除此关系或恢复目标实体',
      })
    }

    // 2. 关系类型未注册：注册表查不到该类型（旧版残留/导入数据），后续类型校验也会跳过它
    if (!relTypeOf(rel.type)) {
      found.push({
        id: `unreg_type_${rel.id}`,
        severity: 'warning',
        category: 'unregistered_type',
        message: `关系类型「${rel.type}」未注册`,
        relationId: rel.id,
        entityId: entityById.has(rel.sourceId) ? rel.sourceId : undefined,
        suggestion: '在关系管理中补注册该类型，或删除此关系',
      })
    }

    // 3. 自环关系：源与目标是同一实体（世界building场景下几乎总是误操作）
    if (rel.sourceId === rel.targetId && entityById.has(rel.sourceId)) {
      found.push({
        id: `self_loop_${rel.id}`,
        severity: 'warning',
        category: 'self_loop',
        message: `关系「${relLabel(rel)}」的源与目标是同一实体`,
        relationId: rel.id,
        entityId: rel.sourceId,
        suggestion: '确认是否误将实体关联到自身',
      })
    }

    // 4. 类型不匹配：关系两端实体类型不在声明允许集内
    const relSchema = relTypeOf(rel.type)
    if (relSchema) {
      const source = entityById.get(rel.sourceId)
      const target = entityById.get(rel.targetId)
      if (source && relSchema.sourceTypes.length > 0 && !relSchema.sourceTypes.includes(source.type)) {
        found.push({
          id: `mismatch_src_${rel.id}`,
          severity: 'warning',
          category: 'type_mismatch',
          message: `关系「${relSchema.label || rel.type}」的源实体类型「${source.type}」不在允许范围内`,
          relationId: rel.id,
          entityId: source.id,
        })
      }
      if (target && relSchema.targetTypes.length > 0 && !relSchema.targetTypes.includes(target.type)) {
        found.push({
          id: `mismatch_tgt_${rel.id}`,
          severity: 'warning',
          category: 'type_mismatch',
          message: `关系「${relSchema.label || rel.type}」的目标实体类型「${target.type}」不在允许范围内`,
          relationId: rel.id,
          entityId: target.id,
        })
      }
    }
  }

  // ════ 实体级检查 ════

  // 5. 空白名称：名称是列表/搜索/引用的唯一直观身份，空名会让实体不可定位
  for (const entity of entities) {
    if (String(entity.name ?? '').trim() === '') {
      found.push({
        id: `empty_name_${entity.id}`,
        severity: 'error',
        category: 'empty_name',
        message: `实体存在空白名称（类型「${entity.type}」）`,
        entityId: entity.id,
        suggestion: '补充名称，否则无法在列表与搜索中定位此实体',
      })
    }
  }

  // 同类型重名分组（trim + 忽略大小写，与 useDuplicateNameCheck 同口径；空名单独走 empty_name）
  const nameGroups = new Map<string, Entity[]>()
  for (const entity of entities) {
    const key = String(entity.name ?? '').trim().toLowerCase()
    if (!key) continue
    const groupKey = `${entity.type}::${key}`
    const list = nameGroups.get(groupKey)
    if (list) list.push(entity)
    else nameGroups.set(groupKey, [entity])
  }
  for (const group of nameGroups.values()) {
    if (group.length < 2) continue
    for (const entity of group) {
      found.push({
        id: `dup_name_${entity.id}`,
        severity: 'warning',
        category: 'duplicate_name',
        message: `名称「${entity.name}」与同类型另外 ${group.length - 1} 个实体重名`,
        entityId: entity.id,
        suggestion: '考虑改名以便区分（列表与搜索中难以辨认）',
      })
    }
  }

  // 6-8. 字段级检查：必填缺失 / 悬空引用 / 选项越界
  for (const entity of entities) {
    const fields = schemas.get(entity.type)?.fields
    if (!fields) continue
    const props = entity.properties || {}

    for (const field of fields) {
      const value = props[field.key]
      const fieldLabel = field.label || field.key
      const normalized = normalizeFieldType(field.fieldType)

      // 6. 必填缺失
      if (field.required && isEmptyValue(value)) {
        found.push({
          id: `missing_field_${entity.id}_${field.key}`,
          severity: 'warning',
          category: 'missing_required',
          message: `实体「${entity.name}」缺少必填字段「${fieldLabel}」`,
          entityId: entity.id,
          suggestion: `补充${fieldLabel}`,
        })
        continue // 值为空时选项/引用检查无意义
      }

      // 7. 悬空引用：entityRef 字段指向不存在的实体（与 EntityRefControl 的「引用已失效」同口径）
      if (normalized === 'entityRef' && typeof value === 'string' && value && !entityById.has(value)) {
        found.push({
          id: `dangling_ref_${entity.id}_${field.key}_${value}`,
          severity: 'error',
          category: 'dangling_ref',
          message: `实体「${entity.name}」的字段「${fieldLabel}」引用的实体不存在（${value}）`,
          entityId: entity.id,
          suggestion: '重新选择引用，或清空该字段',
        })
      }

      // 8. 选项越界：select/multiSelect 的值不在 options 列表内
      if (normalized === 'select' || normalized === 'multiSelect') {
        const values = optionValues(field)
        if (!values) continue
        const list = isArrayValueField(normalized)
          ? (Array.isArray(value) ? value : [])
          : (isEmptyValue(value) ? [] : [value])
        for (const item of list) {
          const itemStr = String(item)
          if (!values.has(itemStr)) {
            found.push({
              id: `invalid_select_${entity.id}_${field.key}_${itemStr}`,
              severity: 'warning',
              category: 'invalid_select',
              message: `实体「${entity.name}」的字段「${fieldLabel}」的值「${itemStr}」不在选项列表中`,
              entityId: entity.id,
              suggestion: '重新选择有效选项，或在芽 schema 中补充该选项',
            })
          }
        }
      }
    }
  }

  // 9. 孤立实体：无任何关系（提示级，供作者自查）
  const connectedEntityIds = new Set<string>()
  for (const rel of relations) {
    connectedEntityIds.add(rel.sourceId)
    connectedEntityIds.add(rel.targetId)
  }
  for (const entity of entities) {
    if (!connectedEntityIds.has(entity.id)) {
      found.push({
        id: `orphan_${entity.id}`,
        severity: 'info',
        category: 'orphan_entity',
        message: `实体「${entity.name}」没有任何关联关系`,
        entityId: entity.id,
        suggestion: '考虑添加关系或确认是否需要此实体',
      })
    }
  }

  return found
}
