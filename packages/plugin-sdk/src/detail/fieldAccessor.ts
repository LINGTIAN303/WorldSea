import type { Entity } from '@worldsea/entity-core'

/**
 * 字段读写定位（纯函数）。详细见 docs/details/注释/packages/plugin-sdk/实体详情表单.md
 *
 * trait 编译出的 schema 字段里，有几个的**真值落在实体顶层**而非 `properties`：
 * `identifiable` 给 `title`/`description`、`taggable` 给 `tags`、`visual` 给 `coverImage`，
 * 而 `Entity` 顶层有 `name`/`description`/`tags`/`coverImage`/`coverPosition`/`coverZoom`/`avatar`。
 * 此前详情按 `properties[key]` 一律取值，于是**每个实体都白挂 2-3 条恒为「—」的字段行**
 * （标题、描述、标签各一份，真值其实在标题栏与标签里）。这里做一次收口。
 */
const TOP_LEVEL_FIELD: Record<string, keyof Entity> = {
  title: 'name',
  description: 'description',
  tags: 'tags',
  coverImage: 'coverImage',
  coverPosition: 'coverPosition',
  coverZoom: 'coverZoom',
  avatar: 'avatar',
}

/** 该 schema 字段是否由实体顶层承载 */
export function topLevelOf(key: string): keyof Entity | undefined {
  return TOP_LEVEL_FIELD[key]
}

/** 读字段值：顶层承载的读顶层，其余读 properties */
export function readFieldValue(entity: Entity | null | undefined, key: string): unknown {
  if (!entity) return undefined
  const top = TOP_LEVEL_FIELD[key]
  if (top) return entity[top]
  return entity.properties?.[key]
}

/**
 * 写字段值 → 生成 `entityStore.update` 可直接用的补丁。
 * `properties` 是整体替换语义，必须带上新旧合并后的全量，否则会抹掉未提及的字段。
 */
export function buildFieldPatch(entity: Entity, key: string, value: unknown): Partial<Entity> {
  const top = TOP_LEVEL_FIELD[key]
  if (top) return { [top]: value } as Partial<Entity>
  return { properties: { ...(entity.properties ?? {}), [key]: value } }
}

/** 详情正文要渲染的字段集合：`title` 即标题栏，正文里不再重复一份 */
export function isTitleField(key: string): boolean {
  return key === 'title'
}
