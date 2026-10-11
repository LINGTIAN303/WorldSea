/**
 * 字段类型归一（详情/表单控件的唯一入口）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */

/** 归一后的字段类型全集（`unknown` 是显式成员，不是兜底） */
export type NormalizedFieldType =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'tags'
  | 'color'
  | 'image'
  | 'entityRef'
  | 'formula'
  | 'url'
  | 'email'
  | 'unknown'

/** 控件层按此表取键，守卫测试据此校验「映射表覆盖 === 类型全集」 */
export const NORMALIZED_FIELD_TYPES = [
  'text',
  'textarea',
  'richtext',
  'number',
  'boolean',
  'date',
  'select',
  'multiSelect',
  'tags',
  'color',
  'image',
  'entityRef',
  'formula',
  'url',
  'email',
  'unknown',
] as const satisfies readonly NormalizedFieldType[]

/** 各来源的历史写法 → 归一名（漂移的唯一定义处） */
const FIELD_TYPE_ALIASES: Record<string, NormalizedFieldType> = {
  // 规范名（Rust schema/types.rs camelCase）自映射
  text: 'text',
  textarea: 'textarea',
  richtext: 'richtext',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  select: 'select',
  multiselect: 'multiSelect',
  tags: 'tags',
  color: 'color',
  image: 'image',
  entityref: 'entityRef',
  formula: 'formula',
  url: 'url',
  email: 'email',
  // 漂移别名（大小写不敏感匹配，故键一律小写）
  'multi-select': 'multiSelect',
  'multi_select': 'multiSelect',
  'entity-ref': 'entityRef',
  'entity-refs': 'entityRef',
  'text-long': 'textarea',
}

/** 缺省类型：空值/未声明按 text 走，与 Rust 侧默认一致 */
const DEFAULT_FIELD_TYPE: NormalizedFieldType = 'text'

/**
 * 归一任意来源的 fieldType。空 → `text`；无法识别 → `unknown`（显式，交控件层出可见提示，
 * 不得静默转 text —— 静默转正是「实体 ID 当文本显示」这类缺陷的成因）。
 */
export function normalizeFieldType(raw?: string | null): NormalizedFieldType {
  const key = String(raw ?? '').trim().toLowerCase()
  if (!key) return DEFAULT_FIELD_TYPE
  return FIELD_TYPE_ALIASES[key] ?? 'unknown'
}

/** 该归一类型的值是否以数组形态存放（裁定 ⑪） */
export function isArrayValueField(type: NormalizedFieldType): boolean {
  return type === 'multiSelect'
}
