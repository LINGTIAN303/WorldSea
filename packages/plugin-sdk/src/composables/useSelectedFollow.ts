import { watch, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

/**
 * 选中实体跟随 store（2026-10-05）：实体更新已改为**按引用替换**（useShallowArray.updateById，
 * 浅响应的正确语义），详情面板若继续持有旧对象会与卡片各显示各的。本件让选中态在 store 中
 * 该实体被替换为新引用时自动重指（entityMap.set 带 triggerRef，跟随可靠）。
 * entityMapGetter 由调用方注入（如 `() => entityStore.entityMap`），本件不直接依赖 store。
 * 消费方：GenericEntityView（详情抽屉）；TimelineView 暂未接（其封面 Tab 靠 ImageField
 * 本地态自洽，且文件顶在尺寸基线上，待其拆分后再接）。
 */
export function useSelectedFollow(
  selected: Ref<Entity | null>,
  entityMapGetter: () => Map<string, Entity>,
) {
  watch(() => {
    const id = selected.value?.id
    return id ? entityMapGetter().get(id) : undefined
  }, (fresh) => {
    if (fresh && selected.value && fresh !== selected.value) selected.value = fresh
  })
}
