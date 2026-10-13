import { watch, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

/**
 * 选中实体跟随 store（2026-10-05）：实体更新改为**按引用替换**（useShallowArray.updateById，浅响应
 * 的正确语义）后，详情面板若持有旧对象会与卡片各显示各的——本件让选中态在该实体被替换为新引用时
 * 自动重指（entityMap.set 带 triggerRef）。entityMapGetter 由调用方注入；消费方 GEV，TimelineView 暂未接。
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
