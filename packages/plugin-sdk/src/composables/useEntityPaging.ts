import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'

/**
 * 列表分页——通用实体视图与「自有列表」视图（时间线时序表等）共用同一口径。关键约定：
 * **只切「渲染哪一段」，源列表始终全量**（批量删除取名、跨页选中、计数与空态判定都基于全量）；
 * 不适用于树形渲染（子节点落页外丢父链）与拖拽调色板。why 详见 docs/details/注释/packages/plugin-sdk/实体视图分页.md
 */
export function useEntityPaging<T>(
  source: Ref<T[]> | ComputedRef<T[]>,
  pageSize: MaybeRefOrGetter<number> = 100,
) {
  const page = ref(1)
  const perPage = computed(() => Math.max(1, toValue(pageSize)))

  const totalPages = computed(() => Math.max(1, Math.ceil(source.value.length / perPage.value)))
  const pagedList = computed(() => {
    const start = (page.value - 1) * perPage.value
    return source.value.slice(start, start + perPage.value)
  })

  function pagePrev() { if (page.value > 1) page.value -= 1 }
  function pageNext() { if (page.value < totalPages.value) page.value += 1 }
  /** 过滤/搜索条件变化时回到第 1 页（否则条件收窄后可能停在空页） */
  function resetPage() { page.value = 1 }
  /** 翻到第 index 项所在页（跨页选中/跳转）；-1 或越界索引不动 */
  function revealIndex(index: number) {
    if (index >= 0) page.value = Math.floor(index / perPage.value) + 1
  }

  // 源列表缩短（过滤收窄、批量删除）可能把当前页挤出范围 → 收敛到末页
  watch(totalPages, tp => { if (page.value > tp) page.value = tp })

  return { page, totalPages, pagedList, pagePrev, pageNext, resetPage, revealIndex }
}
