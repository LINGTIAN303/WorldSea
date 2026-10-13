import type { Entity } from '@worldsea/entity-core'
import type { DetailFieldMeta } from './fieldMeta'
import type { DetailGroup } from './detailLayout'
import { normalizeFieldType } from './fieldType'
import { readFieldValue } from './fieldAccessor'
import { draftValue } from './draftKeys'
import { toDisplayText, toPlainText } from './fieldValue'

/**
 * 内容形态的取数与归类（纯函数）。各形态只是「同一批字段怎么排」的差别，
 * 所以归类口径放在这里共用，避免每个形态各自判一遍、判出三种结果。
 * 详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 */

/** 长文本族（段落式的主角、摘要式里要被截断的部分） */
const LONG_TYPES = new Set(['textarea', 'richtext'])
/** 时间语义的字段类型 */
const TIME_TYPES = new Set(['date'])
/** 时间语义的字段 key（trait 提供的日期字段是 text + 约定 key，类型说明不了它是时间） */
const TIME_KEYS = new Set(['date', 'dateEnd', 'birthDate', 'deathDate', 'createdAt'])

export type FieldFamily = 'short' | 'long' | 'time'

export function fieldFamily(field: DetailFieldMeta): FieldFamily {
  const type = normalizeFieldType(field.fieldType)
  if (TIME_TYPES.has(type) || TIME_KEYS.has(field.key)) return 'time'
  if (LONG_TYPES.has(type)) return 'long'
  return 'short'
}

/** 按 order 取「可见字段 + 其元信息」，隐藏项、标题字段（标题栏已承载）与封面字段（「封面」Tab 承载）都不出现 */
export function orderedVisibleFields(
  fields: DetailFieldMeta[],
  layout: { order: string[]; hidden: string[] },
): DetailFieldMeta[] {
  const byKey = new Map(fields.map(f => [f.key, f]))
  const out: DetailFieldMeta[] = []
  for (const key of layout.order) {
    if (layout.hidden.includes(key) || key === 'title' || key === 'coverImage') continue
    const f = byKey.get(key)
    if (f) out.push(f)
  }
  // 新增字段还没进 order 时也不能凭空消失
  for (const f of fields) {
    if (!layout.order.includes(f.key) && !layout.hidden.includes(f.key) && f.key !== 'title' && f.key !== 'coverImage') out.push(f)
  }
  return out
}

/**
 * 分组成员按各组自身 `fieldKeys` 顺序展开（组内独立排序的消费口；与 detailLayout 的归一口径一致
 * ——归一时已剔隐藏/失效）；无分组的字段归入「其它」。
 */
export function groupsOf(
  fields: DetailFieldMeta[],
  groups: DetailGroup[],
): { key: string; label: string; fields: DetailFieldMeta[] }[] {
  const byKey = new Map(fields.map(f => [f.key, f]))
  const assigned = new Set<string>()
  const out = groups
    .map(g => ({
      key: g.key,
      label: g.label,
      fields: g.fieldKeys.map(k => byKey.get(k)).filter((f): f is DetailFieldMeta => {
        if (!f || assigned.has(f.key)) return false
        assigned.add(f.key)
        return true
      }),
    }))
    .filter(g => g.fields.length > 0)
  const rest = fields.filter(f => !assigned.has(f.key))
  if (rest.length) out.push({ key: '__other', label: '其它', fields: rest })
  return out
}

/** 取数上下文：值都从这里读，形态件不必各自决定「编辑态看草稿还是看实体」 */
export interface FieldSource {
  entity: Entity | null
  draft: Record<string, unknown>
  editing: boolean
  /** entityRef 的 id → 实体名（由 `useFieldText` 注入；缺省则引用一律显示「引用已失效」） */
  nameOf?: (id: string) => string | undefined
}

/** 值读取：编辑中优先草稿，否则按字段定位读实体 */
export function valueOfField(field: DetailFieldMeta, src: FieldSource): unknown {
  if (src.editing) return draftValue(src.draft, src.entity, field.key)
  return readFieldValue(src.entity, field.key)
}

/**
 * 派生形态共用的展示文本。
 * `entityRef` 的值是 id，必须解成实体名——只读形态把裸 ID 打上表格，
 * 正是 1a 修掉的那个缺陷复活的地方，所以解不出时说实话（「引用已失效」）而不是退回 ID。
 */
export function displayOf(
  field: DetailFieldMeta,
  value: unknown,
  nameOf?: (id: string) => string | undefined,
): string {
  const type = normalizeFieldType(field.fieldType)
  if (type === 'image') return value ? '已配图' : '—'
  if (type === 'entityRef') {
    const id = String(value ?? '')
    if (!id) return '—'
    return nameOf?.(id) ?? '引用已失效'
  }
  return toDisplayText(value, type)
}

/** 一个字段在当前上下文里的展示文本（取值 + 归一显示，形态件只用这一句） */
export function textOfField(field: DetailFieldMeta, src: FieldSource): string {
  return displayOf(field, valueOfField(field, src), src.nameOf)
}

/** 短字段压成 chips（摘要式）：标签取字段名，值取展示文本 */
export function shortChips(fields: DetailFieldMeta[], src: FieldSource) {
  return fields
    .filter(f => fieldFamily(f) === 'short')
    .map(f => {
      const text = textOfField(f, src)
      return { key: f.key, label: f.label, text, empty: text === '—' }
    })
}

/**
 * 段落式的成篇内容：长文本字段按字段顺序，各带小标题。
 * `raw` 给富文本渲染（markdown/HTML 原样），`text` 给纯文本消费（摘要摘录）——
 * 两者都要，是因为「要排版」与「要一行读得清的文本」在两侧各有各的理由，合成一个字段必有一侧出错。
 */
export function narrativeSections(fields: DetailFieldMeta[], src: FieldSource, includeDescription: boolean) {
  return fields
    .filter(f => fieldFamily(f) === 'long')
    .map(f => {
      const raw = String(valueOfField(f, src) ?? '')
      return { key: f.key, label: f.label, fieldType: f.fieldType, raw, text: toPlainText(raw) }
    })
    .filter(s => includeDescription || s.key !== 'description')
}

/** 时间轴式的节点：按时间字段聚合成「标签 — 值」，跳过空值 */
export function timelinePoints(fields: DetailFieldMeta[], src: FieldSource, includeCreatedAt: boolean) {
  return fields
    .filter(f => fieldFamily(f) === 'time')
    .filter(f => includeCreatedAt || f.key !== 'createdAt')
    .map(f => ({ key: f.key, label: f.label, text: textOfField(f, src) }))
    .filter(p => p.text !== '—')
}
