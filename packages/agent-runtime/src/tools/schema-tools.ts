/** Schema 管理工具集：实体类型 Schema 唯一事实源 = entity-core 旧版 entitySchemaRegistry。
 *  2026-09-09 三套注册表收口：原 invoke cmd_schema_* 在 Rust 侧零实现（全断链必失败），
 *  改走前端内存注册表；validate/registerValidation/registerView 无对应能力，保留定义但标记。
 *  详细见 docs/details/注释/packages/agent-runtime/tools-schema-tools.md */

import type { ToolDefinition } from '../bridge-types'
import type { ToolMeta } from '@worldsea/agent-core'
import { entitySchemaRegistry, type EntityTypeSchema } from '@worldsea/entity-core'

/** 注册表条目缺契约层必填字段，补默认值（与 tauri 前端 completeSchema 同口径，防消费者崩 Object.keys） */
function completeSchema(schema: EntityTypeSchema): EntityTypeSchema {
  return {
    ...schema,
    iconMap: schema.iconMap ?? {},
    relations: schema.relations ?? [],
    validations: schema.validations ?? [],
    views: schema.views ?? [],
    idPrefix: schema.idPrefix ?? '',
  }
}

/** 无对应能力的工具标记文案（保留定义但显式告知，不再静默失败） */
function unimplemented(capability: string, note: string): string {
  return JSON.stringify({
    ok: false,
    error: 'unimplemented',
    capability,
    message: `该能力未接入实体类型注册表：${note}`,
  })
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
      const schema: EntityTypeSchema = {
        typeKey: String(args.typeKey),
        label: String(args.label),
        icon: String(args.icon),
        fields: JSON.parse(String(args.fieldsJson)),
      }
      if (args.relationsJson !== undefined) schema.relations = JSON.parse(String(args.relationsJson))
      if (args.idPrefix !== undefined) schema.idPrefix = String(args.idPrefix)
      if (args.iconMapJson !== undefined) schema.iconMap = JSON.parse(String(args.iconMapJson))
      entitySchemaRegistry.register(schema)
      return JSON.stringify({ ok: true, message: `实体类型 "${args.typeKey}" 注册成功` })
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
      entitySchemaRegistry.unregister(String(args.typeKey))
      return JSON.stringify({ ok: true, message: `实体类型 "${args.typeKey}" 已注销` })
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
      const schema = entitySchemaRegistry.get(String(args.typeKey))
      if (!schema) return JSON.stringify({ ok: false, error: 'not_found', message: `实体类型 "${args.typeKey}" 未注册` })
      return JSON.stringify({ ok: true, result: completeSchema(schema), message: `实体类型 "${args.typeKey}" 查询成功` })
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
    displayName: '列出实体类型',
  } satisfies ToolMeta,
  execute: async () => {
    try {
      const result = entitySchemaRegistry.getAll().map(completeSchema)
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
      const typeKey = String(args.typeKey)
      const current = entitySchemaRegistry.get(typeKey)
      if (!current) return JSON.stringify({ ok: false, error: 'not_found', message: `实体类型 "${typeKey}" 未注册` })
      const updates = JSON.parse(String(args.updatesJson)) as Record<string, unknown>
      // 注册表无 update 方法：get + 合并 + register（register 覆盖同 key）
      entitySchemaRegistry.register({ ...current, ...updates })
      return JSON.stringify({ ok: true, message: `实体类型 "${typeKey}" 更新成功` })
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), message: '实体类型更新失败' })
    }
  },
}

/** schema_register_validation — 标记：验证规则注册能力未接入实体类型注册表 */
export const schemaRegisterValidation: ToolDefinition = {
  name: 'schema_register_validation',
  description: '为实体类型注册验证规则。定义字段值的约束条件（如必填、范围、格式等）。注意：当前未接入——注册表 validations 字段可存，但「创建/更新实体时自动校验」链路从未接线，注册不会生效。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    ruleJson: { type: 'string', description: '验证规则 JSON 定义', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '注册验证',
  } satisfies ToolMeta,
  execute: async () => {
    return unimplemented(
      'register_validation',
      '旧版注册表 validations 字段可存，但「实体写入时自动校验」链路从未接线，注册不生效。如需校验请在业务层自行实现。',
    )
  },
}

/** schema_register_view — 标记：视图声明注册能力未接入实体类型注册表 */
export const schemaRegisterView: ToolDefinition = {
  name: 'schema_register_view',
  description: '为实体类型注册视图声明。定义实体在界面中的展示方式（如卡片布局、列表列、详情面板等）。注意：当前未接入——视图注册正轨是 pluginAPI.registerView，schema 的 views 字段仅为声明性元数据，不驱动 UI。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    viewJson: { type: 'string', description: '视图声明 JSON 定义', required: true },
  },
  meta: {
    permission: 'moderate',
    category: 'schema',
    displayName: '注册视图',
  } satisfies ToolMeta,
  execute: async () => {
    return unimplemented(
      'register_view',
      '视图注册正轨是 pluginAPI.registerView；schema 的 views 字段仅为声明性元数据，不驱动 UI，故本工具不写注册表。',
    )
  },
}

/** schema_validate — 标记：单实体校验能力未接入（Rust 校验引擎零实现） */
export const schemaValidate: ToolDefinition = {
  name: 'schema_validate',
  description: '验证实体或关系是否符合其类型的 Schema 定义。检查：必填字段、类型匹配、值约束。注意：当前未接入——原计划走 Rust 校验引擎（cmd_schema_validate）但零实现，且不可复用 validatePack（那是整个 pack 的批校验），故暂不可用。',
  parameters: {
    typeKey: { type: 'string', description: '实体类型键名', required: true },
    dataJson: { type: 'string', description: '要验证的实体或关系数据 JSON', required: true },
  },
  meta: {
    permission: 'safe',
    category: 'schema',
    displayName: '验证 Schema',
  } satisfies ToolMeta,
  execute: async () => {
    return unimplemented(
      'validate',
      '原计划走 Rust 校验引擎（cmd_schema_validate）但 Rust 侧零实现；validatePack 为 pack 级批校验不可复用。单实体校验暂不可用。',
    )
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
    displayName: '导出模式',
  } satisfies ToolMeta,
  execute: async (args) => {
    try {
      if (args.typeKey) {
        const schema = entitySchemaRegistry.get(String(args.typeKey))
        if (!schema) return JSON.stringify({ ok: false, error: 'not_found', message: `实体类型 "${args.typeKey}" 未注册` })
        return JSON.stringify({ ok: true, result: completeSchema(schema), message: `实体类型 "${args.typeKey}" Schema 导出成功` })
      }
      const result = entitySchemaRegistry.getAll().map(completeSchema)
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
