/**
 * 实体 Schema 项目级覆盖（批 7）：合并器 + 校验器（纯函数）。
 * 文件形态 = `worlddata/.worldsea/schemas/<type>.json`，与内置芽代码内默认 schema 逐键深合并。
 * 口径详见 docs/plans/2026-10-14-批7-实体Schema声明化.md §二。
 */
import type { FieldSchema } from '../types/entity'
import type { TraitRef } from '../types/trait'

/** 覆盖文件合法顶层键（未知键校验拒绝） */
const OVERLAY_KEYS = ['type', 'label', 'icon', 'traits', 'ownFields', 'fieldOverrides', 'detailLayout'] as const

/** 已校验的覆盖文件形态 */
export interface EntitySchemaOverlay {
  type: string
  label?: string
  icon?: string
  traits?: TraitRef[]
  ownFields?: FieldSchema[]
  /** 便捷写法：traitId → fieldKey → 覆盖（合并时折进对应 TraitRef.fieldOverrides） */
  fieldOverrides?: Record<string, Record<string, Partial<FieldSchema>>>
  /** 预留（视图布局归一第二批启用），透传不校验结构 */
  detailLayout?: unknown
}

/** 可被覆盖的内置 schema 基座（= registerEntityV2 参数形态） */
export interface SchemaOverlayBase {
  type: string
  label: string
  icon?: string
  traits: TraitRef[]
  ownFields: FieldSchema[]
  facets?: string[]
}

export type SchemaOverlayResult =
  | { ok: true; value: EntitySchemaOverlay }
  | { ok: false; errors: string[] }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** 校验覆盖文件（raw 为 JSON.parse 产物）；expectedType 来自文件名，做 type 一致性守卫 */
export function validateSchemaOverlay(raw: unknown, expectedType: string): SchemaOverlayResult {
  const errors: string[] = []
  if (!isPlainObject(raw)) return { ok: false, errors: ['顶层必须是 JSON 对象'] }
  for (const key of Object.keys(raw)) {
    if (!(OVERLAY_KEYS as readonly string[]).includes(key)) errors.push(`未知顶层键 "${key}"（合法：${OVERLAY_KEYS.join('/')}）`)
  }
  const o = raw as Record<string, unknown>
  if (typeof o.type !== 'string' || !o.type) errors.push('"type" 必填且为非空字符串')
  else if (o.type !== expectedType) errors.push(`"type"（${o.type}）与文件名 "${expectedType}" 不一致`)
  if (o.label !== undefined && typeof o.label !== 'string') errors.push('"label" 必须是字符串')
  if (o.icon !== undefined && typeof o.icon !== 'string') errors.push('"icon" 必须是字符串')
  if (o.traits !== undefined) {
    if (!Array.isArray(o.traits)) errors.push('"traits" 必须是数组')
    else {
      o.traits.forEach((t, i) => {
        if (!isPlainObject(t) || typeof t.traitId !== 'string' || !t.traitId) errors.push(`traits[${i}].traitId 必填且为非空字符串`)
        else if (t.fieldOverrides !== undefined && !isPlainObject(t.fieldOverrides)) errors.push(`traits[${i}].fieldOverrides 必须是对象`)
      })
    }
  }
  if (o.ownFields !== undefined) {
    if (!Array.isArray(o.ownFields)) errors.push('"ownFields" 必须是数组')
    else {
      o.ownFields.forEach((f, i) => {
        if (!isPlainObject(f) || typeof f.key !== 'string' || !f.key) errors.push(`ownFields[${i}].key 必填且为非空字符串`)
      })
    }
  }
  if (o.fieldOverrides !== undefined) {
    if (!isPlainObject(o.fieldOverrides)) errors.push('"fieldOverrides" 必须是对象（traitId → fieldKey → 覆盖）')
    else {
      for (const [traitId, perField] of Object.entries(o.fieldOverrides)) {
        if (!isPlainObject(perField)) errors.push(`fieldOverrides.${traitId} 必须是对象`)
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: o as unknown as EntitySchemaOverlay }
}

/** traits 按 traitId 合并：同 id 浅合并 fieldOverrides（按 fieldKey），新 id 追加 */
function mergeTraits(base: TraitRef[], patches: TraitRef[]): TraitRef[] {
  const out = base.map(t => ({ ...t, fieldOverrides: t.fieldOverrides ? { ...t.fieldOverrides } : undefined }))
  for (const p of patches) {
    const hit = out.find(t => t.traitId === p.traitId)
    if (hit) {
      if (p.fieldOverrides) {
        hit.fieldOverrides = { ...hit.fieldOverrides }
        for (const [fieldKey, patch] of Object.entries(p.fieldOverrides)) {
          hit.fieldOverrides[fieldKey] = { ...hit.fieldOverrides[fieldKey], ...patch }
        }
      }
    } else {
      out.push({ ...p, fieldOverrides: p.fieldOverrides ? { ...p.fieldOverrides } : undefined })
    }
  }
  return out
}

/** ownFields 按 key 合并：同 key 整字段替换、新 key 追加（保序） */
function mergeOwnFields(base: FieldSchema[], patches: FieldSchema[]): FieldSchema[] {
  const out = base.map(f => ({ ...f }))
  for (const p of patches) {
    const idx = out.findIndex(f => f.key === p.key)
    if (idx !== -1) out[idx] = { ...p }
    else out.push({ ...p })
  }
  return out
}

/** 合并覆盖到内置基座：返回新对象，不修改 base（不可变语义，内置默认可安全复用） */
export function applySchemaOverlay(base: SchemaOverlayBase, overlay: EntitySchemaOverlay): SchemaOverlayBase {
  // 顶层 fieldOverrides（便捷写法）折进 traits 引用
  let traitPatches = overlay.traits ?? []
  if (overlay.fieldOverrides && Object.keys(overlay.fieldOverrides).length) {
    traitPatches = [...traitPatches]
    for (const [traitId, perField] of Object.entries(overlay.fieldOverrides)) {
      const hit = traitPatches.find(t => t.traitId === traitId)
      if (hit) hit.fieldOverrides = { ...hit.fieldOverrides, ...perField }
      else traitPatches.push({ traitId, fieldOverrides: { ...perField } })
    }
  }
  return {
    type: base.type,
    label: overlay.label ?? base.label,
    icon: overlay.icon ?? base.icon,
    traits: mergeTraits(base.traits, traitPatches),
    ownFields: mergeOwnFields(base.ownFields, overlay.ownFields ?? []),
    facets: base.facets,
  }
}

/* ─── 项目级覆盖存储（world 侧 reload 写入；PluginAPI.registerEntityV2 读取合并） ─── */

const overlayStore = new Map<string, EntitySchemaOverlay>()

/** 整体替换项目级覆盖（reload 重对账语义：以本次读盘结果为准） */
export function setSchemaOverlays(entries: Map<string, EntitySchemaOverlay>): void {
  overlayStore.clear()
  for (const [type, overlay] of entries) overlayStore.set(type, overlay)
}

export function getSchemaOverlay(type: string): EntitySchemaOverlay | undefined {
  return overlayStore.get(type)
}

export function schemaOverlayCount(): number {
  return overlayStore.size
}
