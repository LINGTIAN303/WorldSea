/** 实体智能填充工具集（Layer A 字段级建议 / Layer B 实体级一键填充）
 *
 * C2 元数据族拆分动因：`entity-crud.ts` 超过 400 行门禁（工具族批补声明后）——
 * 按内聚拆分（填充两件独立成模块）；声明面仍随定义同处（TS 单源不变）。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'

/**
 * entity_suggest_field — 字段级智能建议
 *
 * 根据实体上下文为单个字段生成建议值。支持两种模式：
 * - continue: 用户正在输入时，基于 currentText 生成接续文本（ghost text）
 * - suggest: 用户点击 ✨ 按钮时，基于上下文生成独立建议值
 *
 * Agent 应先调用 entity_get_context 获取上下文，再根据上下文生成建议。
 */
export const entitySuggestFieldTool: ToolDefinition = {
  name: 'entity_suggest_field',
  description:
    '为实体的单个字段生成智能建议值。支持两种模式：' +
    'continue（接续预览：基于用户当前输入内容生成续写）和 ' +
    'suggest（独立建议：基于实体上下文生成完整建议值）。' +
    '用于智能填充的 Layer A（字段级建议）。' +
    '请先调用 entity_get_context 获取上下文后再调用此工具。',
  parameters: {
    entityType: { type: 'string', description: '实体类型', required: true },
    fieldKey: { type: 'string', description: '字段键名（如 "personality"、"background"）', required: true },
    fieldLabel: { type: 'string', description: '字段显示名称（如 "性格"、"背景"），帮助理解语义', required: false },
    currentText: { type: 'string', description: '字段当前已输入的文本（用于 continue 模式）', required: false },
    mode: {
      type: 'string',
      description: '建议模式：continue（接续预览）或 suggest（独立建议），默认 suggest',
      required: false,
      enum: ['continue', 'suggest'],
    },
    context: {
      type: 'object',
      description: '实体上下文（来自 entity_get_context 的结果），包含关联实体、同类型实体、Schema 等',
      required: false,
    },
    entityId: { type: 'string', description: '实体ID（编辑已有实体时提供）', required: false },
  },
  meta: {
    permission: 'safe',
    readOnly: true,
    sideEffectScope: 'workspace',
    concurrentSafe: true,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    alwaysAvailable: true,
    displayName: '建议字段',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityType = String(args.entityType)
    const fieldKey = String(args.fieldKey)
    const fieldLabel = String(args.fieldLabel || fieldKey)
    const currentText = String(args.currentText || '')
    const mode = String(args.mode || 'suggest')
    const entityId = args.entityId ? String(args.entityId) : undefined
    const context = args.context as Record<string, unknown> | undefined

    // 收集实体已有字段值作为上下文
    let existingFields: Record<string, unknown> = {}
    let entityName = ''
    if (entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (entity) {
        existingFields = { ...entity.properties, description: entity.description }
        entityName = entity.name
      }
    }

    // 构建给 LLM 的提示信息（此工具的返回值是结构化数据，由前端 useSmartFill 消费）
    const suggestion = {
      fieldKey,
      fieldLabel,
      mode: mode as 'continue' | 'suggest',
      currentText,
      entityType,
      entityName,
      entityId,
      existingFields,
      context: context || null,
      // 建议值由 Agent 的文本回复生成，此处返回的是请求确认的结构
      _hint: `请为类型 "${entityType}" 的实体的 "${fieldLabel}"(${fieldKey}) 字段生成${
        mode === 'continue' ? '接续文本' : '建议值'
      }。${
        currentText ? `当前已输入："${currentText}"。` : ''
      }${
        entityName ? `实体名称："${entityName}"。` : ''
      }请只输出建议值本身，不要解释。`,
    }

    return JSON.stringify(suggestion)
  },
}

/**
 * entity_smart_fill — 实体级一键智能填充
 *
 * 为实体的所有空字段批量生成建议值。
 * Agent 应先调用 entity_get_context 获取完整上下文，再根据上下文和 Schema 生成建议。
 * 仅对空字段生成建议，已填字段不覆盖。
 */
export const entitySmartFillTool: ToolDefinition = {
  name: 'entity_smart_fill',
  description:
    '为实体的字段批量生成智能建议值（一键填充）。' +
    '默认仅对空字段生成建议（includeExisting=false）；设置 includeExisting=true 可对所有字段生成建议（含已有内容的优化/改写）。' +
    '用于智能填充的 Layer B（实体级一键填充）。' +
    '请先调用 entity_get_context(scope="full") 获取完整上下文后再调用此工具。',
  parameters: {
    entityId: { type: 'string', description: '实体ID（编辑已有实体时提供）', required: false },
    entityType: { type: 'string', description: '实体类型', required: true },
    currentFields: {
      type: 'object',
      description: '当前已填写的字段键值对（用于判断哪些字段为空）',
      required: false,
    },
    emptyFields: {
      type: 'array',
      description: '空字段键名列表（如 ["personality", "background"]），若不提供则从 currentFields 推断',
      required: false,
      items: { type: 'string', description: '字段键名' },
    },
    context: {
      type: 'object',
      description: '实体上下文（来自 entity_get_context 的结果），包含关联实体、同类型实体、Schema 等',
      required: false,
    },
    includeExisting: {
      type: 'boolean',
      description: '是否对已有内容的字段也生成建议（优化/改写），默认 false 仅对空字段生成',
      required: false,
    },
  },
  meta: {
    permission: 'safe',
    readOnly: true,
    sideEffectScope: 'workspace',
    concurrentSafe: true,
    requiresUserInteraction: false,
    alwaysAsk: false,
    category: 'entity',
    alwaysAvailable: true,
    displayName: '智能填充',
  } satisfies ToolMeta,
  execute: async (args, ctx) => {
    const entityType = String(args.entityType)
    const entityId = args.entityId ? String(args.entityId) : undefined
    const currentFields = (args.currentFields as Record<string, unknown>) || {}
    const emptyFields = (args.emptyFields as string[]) || []
    const context = args.context as Record<string, unknown> | undefined
    const includeExisting = !!args.includeExisting

    // 如果未提供 emptyFields，从 currentFields 推断
    let fieldsToFill = emptyFields
    if (fieldsToFill.length === 0 && Object.keys(currentFields).length > 0) {
      fieldsToFill = Object.entries(currentFields)
        .filter(([, v]) => v == null || v === '')
        .map(([k]) => k)
    }

    // 获取实体名称
    let entityName = ''
    let description = ''
    if (entityId) {
      const entity = await ctx.stores.entity.getById(entityId)
      if (entity) {
        entityName = entity.name
        description = entity.description || ''
      }
    }

    const result = {
      entityType,
      entityId,
      entityName,
      description,
      currentFields,
      emptyFields: fieldsToFill,
      includeExisting,
      context: context || null,
      _hint: includeExisting
        ? `请为类型 "${entityType}"${
            entityName ? ` 名为 "${entityName}"` : ''
          } 的实体生成所有字段的建议值（包括已有内容的优化/改写）。请以 JSON 对象格式输出，键为字段名，值为建议内容。已有内容的字段也请提供优化建议。`
        : `请为类型 "${entityType}"${
            entityName ? ` 名为 "${entityName}"` : ''
          } 的实体生成以下空字段的建议值：${
            fieldsToFill.length > 0 ? fieldsToFill.join('、') : '所有可选字段'
          }。请以 JSON 对象格式输出，键为字段名，值为建议内容。不要包含已填写的字段。`,
    }

    return JSON.stringify(result)
  },
}

export const entitySmartFillTools: ToolDefinition[] = [entitySuggestFieldTool, entitySmartFillTool]
