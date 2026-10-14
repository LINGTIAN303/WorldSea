/**
 * 批8：formFields 派生兜底——GEV `formFields` prop 缺省时从 fieldRegistry 派生 + Entity 基础字段内置声明。
 * 显式传 props.formFields = 覆盖（16 个既有消费方向后兼容）；基础字段 = Entity 顶级结构（name/description/tags），非 ownField。
 */
import { fieldRegistry } from '@worldsea/entity-core'
import type { FormFieldDef } from './types'

/** Entity 基础字段的表单声明（GEV 内置；插件 ownFields 只声明 properties 字段） */
export const BASE_FORM_FIELDS: FormFieldDef[] = [
  { key: 'name', label: '名称', type: 'text', required: true },
  { key: 'description', label: '描述', type: 'textarea' },
  { key: 'tags', label: '标签', type: 'tags' },
]

/**
 * 从 fieldRegistry 派生表单字段：基础字段前置 + 类型级 builtin（去重）。
 * 注意：内部读取 fieldRegistry.version——调用处须在 computed 内以建立响应式依赖。
 */
export function deriveFormFields(entityType: string): FormFieldDef[] {
  void fieldRegistry.version.value
  const baseKeys = new Set(BASE_FORM_FIELDS.map(f => f.key))
  const derived = fieldRegistry
    .getFields(entityType)
    .filter(f => !baseKeys.has(f.key))
    .map(f => ({ ...f, type: f.fieldType }) as FormFieldDef)
  return [...BASE_FORM_FIELDS.map(f => ({ ...f })), ...derived]
}
