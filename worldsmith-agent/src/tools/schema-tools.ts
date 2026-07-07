/**
 * Schema 管理工具集
 *
 * 通过 Tauri 后端管理实体类型的 Schema 定义，包括：
 * - 实体类型注册/注销/查询/更新
 * - 验证规则注册
 * - 视图声明注册
 * - Schema 验证（调用 Rust 核心库的验证引擎）
 * - Schema 导出
 *
 * 注意：这些工具依赖 Tauri invoke API，仅在 Tauri 桌面模式下可用。
 */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsmith/agent-core'

/** 封装 Tauri invoke 调用，动态导入避免 Web 模式报错 */
async function invokeTauri(command: string, args?: Record<string, unknown>): Promise<unknown> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}

/** schema_register_entity_type — 注册新的实体类型，定义字段/关系/图标 */
export const schemaRegisterEntityType: ToolDefinition = {
  name: 'schema_register_entity_type',
  description: '注册新的实体类型 Schema。定义实体类型的字段、关系、图标等元数据，注册后即可使用该类型创建实体。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名（如 "character"、"location"）', required: true },
    label: { type: 'string', description: '实体类型显示名称', required: true },
    icon: { type: 'string', description: '实体类型图标标识', required: true },
    fieldsJson: { type: 'string', description: '字段定义 JSON 数组', required: true },
    relationsJson: { type: 'string', description: '关系定义 JSON 数组（可选）', required: false },
    idPrefix: { type: 'string', description: '实体 ID 前缀（可选，如 "chr"）', required: false },
    iconMapJson: { type: 'string', description: '图标映射 JSON（可选，按字段值映射不同图标）', required: false },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '注册实体类型',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const schema: Record<string, unknown> = {
        typeKey: String(args.typeKey),
        label: String(args.label),
        icon: String(args.icon),
        fields: JSON.parse(String(args.fieldsJson)),
      }
      if (args.relationsJson !== undefined) schema.relations = JSON.parse(String(args.relationsJson))
      if (args.idPrefix !== undefined) schema.idPrefix = String(args.idPrefix)
      if (args.iconMapJson !== undefined) schema.iconMap = JSON.parse(String(args.iconMapJson))
      const result = await invokeTauri('cmd_schema_register_entity_type', { schemaJson: JSON.stringify(schema) })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 注册成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型注册失败' })
    }
  },
}

/** schema_unregister_entity_type — 注销实体类型，已有实体不受影响 */
export const schemaUnregisterEntityType: ToolDefinition = {
  name: 'schema_unregister_entity_type',
  description: '注销实体类型 Schema。移除指定实体类型的元数据定义，已存在的该类型实体不受影响。',
  parameters: {
    typeKey: { type: 'string', description: '要注销的实体类型键名', required: true },
  },
  meta: {
    permission: 'dangerous',
    category: 'schema',
    displayName: '注销实体类型',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_unregister_entity_type', { typeKey: String(args.typeKey) })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 已注销` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型注销失败' })
    }
  },
}

/** schema_get_entity_type — 获取单个类型的完整 Schema 定义 */
export const schemaGetEntityType: ToolDefinition = {
  name: 'schema_get_entity_type',
  description: '获取单个实体类型的 Schema 定义。返回该类型的字段、关系、图标等完整元数据。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'schema',
    displayName: '获取实体类型',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_get_entity_type', { typeKey: String(args.typeKey) })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 查询成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型查询失败' })
    }
  },
}

/** schema_list_entity_types — 列出所有已注册的实体类型摘要 */
export const schemaListEntityTypes: ToolDefinition = {
  name: 'schema_list_entity_types',
  description: '列出所有已注册的实体类型 Schema。返回每个类型的键名、显示名称和图标等摘要信息。',
  parameters: {},
  meta: {
    permission: 'safe',
    category: 'schema',
    alwaysAvailable: true,
    displayName: '列出实体类型',
  } satisfies ToolMeta,
  execute: async () => {
    try {
      const result = await invokeTauri('cmd_schema_list_entity_types')
      return JSON.stringify({ ok: true, result, message: '实体类型列表查询成功' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型列表查询失败' })
    }
  },
}

/** schema_update_entity_type — 更新实体类型 Schema（合并更新） */
export const schemaUpdateEntityType: ToolDefinition = {
  name: 'schema_update_entity_type',
  description: '更新实体类型 Schema。可修改字段定义、关系、图标等元数据，仅更新指定字段，未提及的字段保持不变。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    updatesJson: { type: 'string', description: '要更新的字段 JSON 对象（如 {"label":"新名称","icon":"new-icon"}）', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '更新实体类型',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_update_entity_type', {
        typeKey: String(args.typeKey),
        updatesJson: String(args.updatesJson),
      })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 更新成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型更新失败' })
    }
  },
}

/** schema_register_validation — 为实体类型注册验证规则 */
export const schemaRegisterValidation: ToolDefinition = {
  name: 'schema_register_validation',
  description: '为实体类型注册验证规则。定义字段值的约束条件（如必填、范围、格式等），创建或更新实体时将自动校验。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    ruleJson: { type: 'string', description: '验证规则 JSON 定义', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '注册验证',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_register_validation', {
        typeKey: String(args.typeKey),
        ruleJson: String(args.ruleJson),
      })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 验证规则注册成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '验证规则注册失败' })
    }
  },
}

/** schema_register_view — 为实体类型注册视图声明 */
export const schemaRegisterView: ToolDefinition = {
  name: 'schema_register_view',
  description: '为实体类型注册视图声明。定义实体在界面中的展示方式（如卡片布局、列表列、详情面板等）。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    viewJson: { type: 'string', description: '视图声明 JSON 定义', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '注册视图',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_register_view', {
        typeKey: String(args.typeKey),
        viewJson: String(args.viewJson),
      })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 视图注册成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '视图注册失败' })
    }
  },
}

/** schema_validate — 使用 Rust 验证引擎校验实体/关系数据 */
export const schemaValidate: ToolDefinition = {
  name: 'schema_validate',
  description: '验证实体或关系是否符合其类型的 Schema 定义。底层使用 Rust 核心库的验证引擎，检查：必填字段、类型匹配、值约束。使用场景：创建实体后验证数据完整性、排查数据问题。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    dataJson: { type: 'string', description: '要验证的实体或关系数据 JSON', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'schema',
    alwaysAvailable: true,
    displayName: '验证 Schema',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      const result = await invokeTauri('cmd_schema_validate', {
        typeKey: String(args.typeKey),
        dataJson: String(args.dataJson),
      })
      return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" 验证完成` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'Schema 验证失败' })
    }
  },
}

/** schema_export — 导出指定类型或所有类型的 Schema 定义 */
export const schemaExport: ToolDefinition = {
  name: 'schema_export',
  description: '导出项目的类型 Schema 定义（实体类型和关系类型的结构定义）。使用场景：查看类型定义、与其他工具集成、文档生成。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名（可选，不传则导出所有类型）', required: false },
  },
  meta: {
    permission: 'safe',
    category: 'schema',
    alwaysAvailable: true,
    displayName: '导出模式',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      if (args.typeKey) {
        const result = await invokeTauri('cmd_schema_get_entity_type', { typeKey: String(args.typeKey) })
        return JSON.stringify({ ok: true, result, message: `实体类型 "${args.typeKey}" Schema 导出成功` })
      }
      const result = await invokeTauri('cmd_schema_list_entity_types')
      return JSON.stringify({ ok: true, result, message: '所有 Schema 定义导出成功' })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: 'Schema 导出失败' })
    }
  },
}

export const schemaTools: ToolDefinition[] = [
  schemaValidate,
  schemaExport,
  schemaRegisterEntityType,
  schemaUnregisterEntityType,
  schemaGetEntityType,
  schemaListEntityTypes,
  schemaUpdateEntityType,
  schemaRegisterValidation,
  schemaRegisterView,
]
