import { computed, type ComputedRef } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import type { FieldSource } from './formValues'

/**
 * 派生形态的取数上下文（唯一碰存储的一处）。详细见 docs/details/注释/packages/plugin-sdk/实体详情内容形态.md
 * `formValues.ts` 保持纯函数，`entityRef` 的 id→名解析在这里注入——否则表格式/摘要式会把
 * 裸 ID 打在界面上（已修缺陷的复活路径）。
 */
export function useFieldSource(props: {
  entity: Entity | null
  draft: Record<string, unknown>
  editing: boolean
}): ComputedRef<FieldSource> {
  const store = useEntityStore()
  const nameOf = (id: string) => store.entityMap.get(id)?.name
  return computed(() => ({
    entity: props.entity,
    draft: props.draft,
    editing: props.editing,
    nameOf,
  }))
}
