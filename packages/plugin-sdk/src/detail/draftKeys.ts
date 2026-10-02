/**
 * 草稿键映射（纯函数）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 *
 * `useEntityEdit` 的草稿用 `_` 前缀方言存顶层字段（`_name`/`_description`/…），
 * 而详情渲染与布局层说的是 **schema key 方言**（`title`/`description`/`tags`/…）。
 * 两边都已有外部消费者（时间线自有详情吃 `editForm._name`），故不改方言，只做一次显式映射——
 * 让「顶层字段在详情里恒为 —」这类错位有个唯一的中转点。
 */
import type { Entity } from '@worldsea/entity-core'
import { topLevelOf } from './fieldAccessor'

/** schema key → 草稿键 */
const DRAFT_KEY: Record<string, string> = {
  title: '_name',
  description: '_description',
  tags: '_tags',
  coverImage: '_coverImage',
  coverPosition: '_coverPosition',
  coverZoom: '_coverZoom',
}

/** 草稿键 → 实体顶层字段（保存时回写用） */
const DRAFT_TOP_LEVEL: Record<string, keyof Entity> = {
  _name: 'name',
  _description: 'description',
  _tags: 'tags',
  _coverImage: 'coverImage',
  _coverPosition: 'coverPosition',
  _coverZoom: 'coverZoom',
}

/** 该 schema 字段在草稿里的键（非顶层字段即 properties 同名键） */
export function draftKeyOf(schemaKey: string): string {
  return DRAFT_KEY[schemaKey] ?? schemaKey
}

/** 草稿读值：顶层字段先查草稿键，再回落实体顶层，最后 properties */
export function draftValue(draft: Record<string, unknown>, entity: Entity | null, schemaKey: string): unknown {
  const dk = draftKeyOf(schemaKey)
  if (draft && Object.prototype.hasOwnProperty.call(draft, dk)) return draft[dk]
  const top = topLevelOf(schemaKey)
  if (top) return entity?.[top]
  return entity?.properties?.[schemaKey]
}

/** 从草稿中取出全部顶层回写项（保存时用），`_` 前缀键一律不作为 property 落库 */
export function splitDraft(draft: Record<string, unknown>): { topLevel: Partial<Entity>; properties: Record<string, unknown> } {
  const topLevel: Record<string, unknown> = {}
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    const top = DRAFT_TOP_LEVEL[key]
    if (top) topLevel[top] = value
    else if (!key.startsWith('_')) properties[key] = value
  }
  return { topLevel: topLevel as Partial<Entity>, properties }
}
