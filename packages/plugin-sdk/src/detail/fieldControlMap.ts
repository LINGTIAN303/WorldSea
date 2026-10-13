import type { NormalizedFieldType } from './fieldType'

/**
 * 控件映射表：归一类型 → 该用哪种控件。表是**数据**，`FieldControl.vue` 按 `kind` 渲染——
 * 新增一种类型只需在此加一行 + 需要时加一个件，不必再往字段行里追加 `v-else-if` 分支
 * （那正是抽屉/弹窗/批量编辑各自长出一套的原因）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 */
export type ControlKind =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'tags'
  | 'color'
  | 'image'
  | 'entityRef'
  | 'static'
  | 'unsupported'

export interface ControlSpec {
  kind: ControlKind
  /** 是否独占整行（取代 DetailField.vue 本地 FULL_WIDTH_TYPES） */
  fullWidth: boolean
  /** 编辑态是否可写（formula 由引擎算，unsupported 无控件可写） */
  editable: boolean
}

const SPEC = {
  text: { kind: 'text', fullWidth: false, editable: true },
  textarea: { kind: 'textarea', fullWidth: true, editable: true },
  richtext: { kind: 'richtext', fullWidth: true, editable: true },
  number: { kind: 'number', fullWidth: false, editable: true },
  boolean: { kind: 'checkbox', fullWidth: false, editable: true },
  date: { kind: 'date', fullWidth: false, editable: true },
  select: { kind: 'select', fullWidth: false, editable: true },
  multiSelect: { kind: 'multiSelect', fullWidth: true, editable: true },
  tags: { kind: 'tags', fullWidth: true, editable: true },
  color: { kind: 'color', fullWidth: false, editable: true },
  image: { kind: 'image', fullWidth: true, editable: true },
  entityRef: { kind: 'entityRef', fullWidth: true, editable: true },
  formula: { kind: 'static', fullWidth: true, editable: false },
  url: { kind: 'text', fullWidth: true, editable: true },
  email: { kind: 'text', fullWidth: true, editable: true },
  unknown: { kind: 'unsupported', fullWidth: true, editable: false },
} satisfies Record<NormalizedFieldType, ControlSpec>

export const CONTROL_SPEC: Record<NormalizedFieldType, ControlSpec> = SPEC

/** 取某归一类型的控件规格（非全集类型回落 unsupported） */
export function controlSpecFor(type: NormalizedFieldType): ControlSpec {
  return CONTROL_SPEC[type] ?? SPEC.unknown
}

/** 原生 input 的 type 属性（url/email 走原生校验形态） */
export function nativeInputType(type: NormalizedFieldType): 'number' | 'url' | 'email' | 'text' {
  if (type === 'number') return 'number'
  if (type === 'url') return 'url'
  if (type === 'email') return 'email'
  return 'text'
}
