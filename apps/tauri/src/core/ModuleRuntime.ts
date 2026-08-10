/**
 * ModuleRuntime — 自定义模块运行时
 * 将 CustomModule 定义转化为可用的插件系统注册项和视图组件
 */
import type { CustomModule, ModuleField, EntityTypeSchema, FieldSchema, RelationTypeSchema } from '@worldsmith/entity-core'
import { entitySchemaRegistry, relationSchemaRegistry } from '@worldsmith/entity-core/core'

/**
 * 将 ModuleField 转为 FieldSchema
 */
function toFieldSchema(f: ModuleField): FieldSchema {
  // 全量、语义保留的映射：编辑器可选类型（FieldType）→ 运行时 fieldType。
  // 旧实现把 rich-text/tags/rating/entity-ref 等静默压成 text，导致 schema 语义丢失。
  const typeMap: Record<string, FieldSchema['fieldType']> = {
    'text': 'text',
    'textarea': 'textarea',
    'rich-text': 'rich-text',
    'markdown': 'markdown',
    'number': 'number',
    'boolean': 'boolean',
    'date': 'date',
    'datetime': 'datetime',
    'time': 'time',
    'select': 'select',
    'multi-select': 'multi-select',
    'tags': 'tags',
    'rating': 'rating',
    'slider': 'slider',
    'color': 'color',
    'image': 'image',
    'url': 'url',
    'email': 'email',
    'entity-ref': 'entity-ref',
    'entity-refs': 'entity-refs',
    'formula': 'formula',
    'computed': 'computed',
    'template': 'template',
    'location': 'location',
    'file': 'file',
  }
  return {
    key: f.key,
    label: f.label,
    fieldType: typeMap[f.type] || 'text',
    required: f.required,
    defaultValue: f.defaultValue,
    options: f.options?.map(o => ({ value: o, label: o })),
  }
}

/**
 * 将 CustomModule 中的定义注册到系统
 */
export function unregisterModule(modId: string) {
  // 移除该模块注册的所有实体类型和关系类型
  const prefix = `custom.${modId}.`
  for (const et of entitySchemaRegistry.getAll()) {
    if (et.typeKey.startsWith(prefix)) entitySchemaRegistry.unregister(et.typeKey)
  }
  for (const rt of relationSchemaRegistry.getAll()) {
    if (rt.typeKey.startsWith(prefix)) relationSchemaRegistry.unregister(rt.typeKey)
  }
}

export function registerModule(mod: CustomModule) {
  unregisterModule(mod.id)
  for (const et of mod.entityTypes) {
    const schema: EntityTypeSchema = {
      typeKey: `custom.${mod.id}.${et.name}`,
      label: et.label,
      icon: et.icon,
      fields: et.fields.map(toFieldSchema),
      pluginId: `custom.${mod.id}`,
    }
    entitySchemaRegistry.register(schema)
  }

  for (const rt of mod.relationTypes) {
    const schema: RelationTypeSchema = {
      typeKey: `custom.${mod.id}.${rt.name}`,
      label: rt.label,
      sourceTypes: rt.sourceTypes.map(t => `custom.${mod.id}.${t}`),
      targetTypes: rt.targetTypes.map(t => `custom.${mod.id}.${t}`),
      directed: rt.directed,
      properties: rt.properties.map(toFieldSchema),
      pluginId: `custom.${mod.id}`,
    }
    relationSchemaRegistry.register(schema)
  }
}

/**
 * 为模块生成发布视图元数据。
 * 收敛为单一语义：一律渲染为运行时视图（ModuleRuntimeRenderer），
 * 视图 id 固定为 `custom.{modId}.main`，消除「layoutSchema 渲染 / generateViews」双轨。
 */
export function getCustomModuleViews(mod: CustomModule): { id: string; label: string; icon: string }[] {
  return [{ id: `custom.${mod.id}.main`, label: mod.name || '自定义模块', icon: mod.icon || 'settings' }]
}
