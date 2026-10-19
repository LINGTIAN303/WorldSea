export const ENTITY_NOTES: Record<string, string> = {
  book: '`book` 的 ownFields 为空；书籍只使用 `identifiable` + `visual` 的 3 个字段。',
  event: '`parentId` 是 `entityRef` + `refType: event`，但刻意不声明 `relationType`：事件树以 `properties.parentId` 为准，不建立关系边。',
  notebook: '`noteType` 的选项值是英文原值（`markdown` / `code` / `reference`），当前没有中文选项标签。',
  pipeline: '已归一到 V2：`title` / `description` / `tags` 走 `identifiable` + `taggable`；`steps` / `connections` / `status` / `currentStepId` 仍在 `properties`。名称/描述/标签原本就在实体顶层，无需数据迁移。',
  'tactical-board': '已归一到 V2：`identifiable` + `taggable` + `visual`；棋盘数据仍在 `properties`，封面使用顶层 `coverImage`。名称/描述/标签原本就在实体顶层，无需数据迁移。',
  item: '`item` 还可挂载 `weapon` / `apparel` Facet；Facet 字段见 Facet 区。',
}
