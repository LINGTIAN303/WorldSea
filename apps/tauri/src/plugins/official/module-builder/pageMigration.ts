import type { Slot, ModuleLayoutSchema } from './types/layoutSchema'
import type { PageSchema } from './types/pageSchema'
import { createEmptyPageSchema, createDefaultToolbarRoot } from './types/pageSchema'
import { migrateLayoutSchema } from './migration'

/**
 * 将现有布局数据迁移为 PageSchema（v3：toolbar + view 两棵槽位树）。
 * - v3：已是最新 PageSchema，直接返回
 * - v2（root 槽位树）：root → view 区，toolbar 用默认坑位
 * - v1（layout+components）或无：经 migrateLayoutSchema 转 v2 后再进 view
 * 旧数据视为可用资源，不丢弃。
 */
export function migrateToPageSchema(old: unknown): PageSchema {
  if (!old) return createEmptyPageSchema()
  const o = old as { version?: number; toolbar?: Slot; view?: Slot; root?: Slot }

  // 已是 PageSchema
  if (o.version === 3 && o.toolbar && o.view) {
    return { version: 3, toolbar: o.toolbar, view: o.view }
  }

  // v2 槽位树：root → view
  if (o.version === 2 && o.root) {
    return { version: 3, toolbar: createDefaultToolbarRoot(), view: o.root }
  }

  // v1 / 其他：先迁到 v2，再取 root 进 view
  const v2 = migrateLayoutSchema(old) as unknown as ModuleLayoutSchema
  return { version: 3, toolbar: createDefaultToolbarRoot(), view: v2.root }
}