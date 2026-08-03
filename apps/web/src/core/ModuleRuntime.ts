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
  const typeMap: Record<string, FieldSchema['type']> = {
    'text': 'text',
    'textarea': 'textarea',
    'number': 'text',
    'boolean': 'boolean',
    'date': 'date',
    'datetime': 'text',
    'time': 'text',
    'select': 'select',
    'multi-select': 'text',
    'image': 'image',
    'url': 'text',
    'email': 'text',
    'color': 'text',
    'rich-text': 'textarea',
    'markdown': 'textarea',
    'rating': 'text',
    'slider': 'text',
    'entity-ref': 'text',
    'entity-refs': 'text',
    'formula': 'text',
    'computed': 'text',
    'template': 'textarea',
    'location': 'text',
    'file': 'text',
  }
  return {
    key: f.key,
    label: f.label,
    type: typeMap[f.type] || 'text',
    required: f.required,
    defaultValue: f.defaultValue,
    options: f.options,
  }
}

/**
 * 将 CustomModule 中的定义注册到系统
 */
export function unregisterModule(modId: string) {
  // 移除该模块注册的所有实体类型和关系类型
  const prefix = `custom.${modId}.`
  for (const et of entitySchemaRegistry.getAll()) {
    if (et.type.startsWith(prefix)) entitySchemaRegistry.unregister(et.type)
  }
  for (const rt of relationSchemaRegistry.getAll()) {
    if (rt.type.startsWith(prefix)) relationSchemaRegistry.unregister(rt.type)
  }
}

export function registerModule(mod: CustomModule) {
  unregisterModule(mod.id)
  for (const et of mod.entityTypes) {
    const schema: EntityTypeSchema = {
      type: `custom.${mod.id}.${et.name}`,
      label: et.label,
      icon: et.icon,
      fields: et.fields.map(toFieldSchema),
      pluginId: `custom.${mod.id}`,
    }
    entitySchemaRegistry.register(schema)
  }

  for (const rt of mod.relationTypes) {
    const schema: RelationTypeSchema = {
      type: `custom.${mod.id}.${rt.name}`,
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
 * 为模块生成视图元数据
 */
export function generateViews(mod: CustomModule) {
  return mod.views.map(v => ({
    id: `custom.${mod.id}.${v.id}`,
    label: v.label,
    icon: v.icon,
    // 返回模块信息和视图配置，由 DynamicEntityView 运行时解析
    _moduleId: mod.id,
    _viewConfig: v,
  }))
}
