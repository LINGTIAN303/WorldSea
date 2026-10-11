/** Formula 自动重算（监听 field:change 找出依赖字段并自动重算），详细见 docs/details/注释/packages/entity-core/core/formula-auto.md */

import { eventBus, type FieldChangeEvent } from './events'
import { evaluateFormula, extractFieldRefs } from './formula'
import { entitySchemaRegistry } from './EntitySchema'
import { useEntityStore } from '../stores/entityStore'

/** 缓存的 formula 字段映射：entityType → { fieldKey → formula 表达式 } */
let formulaCache: Record<string, Record<string, string>> | null = null

/**
 * 重建 formula 缓存：扫描所有 Schema 中类型为 formula 的字段
 */
function buildFormulaCache(): Record<string, Record<string, string>> {
  const cache: Record<string, Record<string, string>> = {}
  const schemas = entitySchemaRegistry.getAll()
  for (const schema of schemas) {
    for (const field of schema.fields) {
      if (field.fieldType === 'formula') {
        // Formula 表达式存储在 custom field 的 formula 属性中
        // 当前 FieldSchema 没有 formula 属性，需要从自定义字段定义里取表达式
        const formulaField = schema.customFields?.find(f => f.key === field.key)
        if (formulaField && 'formula' in formulaField) {
          if (!cache[schema.typeKey]) cache[schema.typeKey] = {}
          cache[schema.typeKey][field.key] = (formulaField as any).formula as string
        }
      }
    }
  }
  return cache
}

/**
 * 获取指定实体类型的 formula 字段映射
 */
function getFormulasForType(entityType: string): Record<string, string> {
  if (!formulaCache) formulaCache = buildFormulaCache()
  return formulaCache[entityType] ?? {}
}

/**
 * 注册 formula 自动重算
 * 在 app 启动时调用
 */
let formulaUnsubscribers: (() => void)[] = []

export function registerFormulaAutoRecalc(): void {
  // 清理旧注册（如有）
  unregisterFormulaAutoRecalc()

  // 监听所有字段变更
  formulaUnsubscribers.push(
    eventBus.on('field:change', async (event: FieldChangeEvent) => {
      const formulas = getFormulasForType(event.entityType)
      if (Object.keys(formulas).length === 0) return

      // 找出哪些 formula 依赖被变更的字段
      const recalcFields: string[] = []
      for (const [fieldKey, formulaExpr] of Object.entries(formulas)) {
        const refs = extractFieldRefs(formulaExpr)
        if (refs.includes(event.field)) {
          recalcFields.push(fieldKey)
        }
      }
      if (recalcFields.length === 0) return

      // 获取当前实体数据，计算新值
      try {
        const entityStore = useEntityStore()
        const entity = await entityStore.getById(event.entityId)
        if (!entity) return

        const allEntities = entityStore.entities.filter(e => e.type === event.entityType)
        const allFieldValues = allEntities.map(e => e.properties ?? {})

        const propUpdates: Record<string, unknown> = {}
        for (const fieldKey of recalcFields) {
          const formulaExpr = formulas[fieldKey]
          const result = evaluateFormula(formulaExpr, entity.properties ?? {}, allFieldValues)
          propUpdates[fieldKey] = result
        }

        // 更新实体 formula 字段（不触发额外事件循环）
        if (Object.keys(propUpdates).length > 0) {
          await entityStore.update(event.entityId, { properties: { ...entity.properties, ...propUpdates } })
        }
      } catch (e) {
        console.warn('[FormulaAuto] 计算失败:', e)
      }
    })
  )

  // 清除缓存以便 Schema 变更后重建
  formulaUnsubscribers.push(
    eventBus.on('entity:update', () => {
      formulaCache = null
    })
  )
}

/**
 * 取消注册 formula 自动重算
 */
export function unregisterFormulaAutoRecalc(): void {
  for (const unsub of formulaUnsubscribers) {
    try { unsub() } catch { /* 忽略 */ }
  }
  formulaUnsubscribers = []
}

/**
 * 获取某实体的所有 formula 字段计算值
 */
export function getComputedFormulas(
  entityType: string,
  properties: Record<string, unknown>,
  allEntities: Record<string, unknown>[],
): Record<string, unknown> {
  const formulas = getFormulasForType(entityType)
  const result: Record<string, unknown> = {}
  for (const [fieldKey, formulaExpr] of Object.entries(formulas)) {
    result[fieldKey] = evaluateFormula(formulaExpr, properties, allEntities)
  }
  return result
}
