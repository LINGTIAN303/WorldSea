import { ref, computed, type Ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'
import { detectEras, parseDateRange } from './useDateParser'

/**
 * 时间轴筛选管线（2026-10-07 自 TimelineView 抽出——文件顶在 443 行尺寸基线，守卫"拆分为宜"）。
 * 输入排序后的事件流（useTimelineSort 的 sortedEvents），输出筛选态与筛选结果：
 * 搜索（名称/描述/日期）+ 纪元 + 重要度三级过滤，与纪元探测/下拉选项。
 */
export function useTimelineFilters(sortedEvents: Ref<Entity[]>) {
  const searchQuery = ref('')
  const eraFilter = ref('')
  const importanceFilter = ref('')

  const detectedEras = computed(() => {
    const dates = sortedEvents.value.map(e => {
      const dateText = (e.properties.date as string) || ''
      const dateEndText = (e.properties.dateEnd as string) || ''
      return parseDateRange(dateText, dateEndText)
    })
    return detectEras(dates)
  })

  const eras = computed(() => {
    const set = new Set<string>()
    for (const e of sortedEvents.value) {
      const era = e.properties.era as string
      if (era) set.add(era)
    }
    return Array.from(set).sort()
  })

  const eraFilterOptions = computed(() => [
    { value: '', label: '全部纪元' },
    ...eras.value.map(era => ({ value: era, label: era }))
  ])

  const importanceFilterOptions = [
    { value: '', label: '全部重要度' },
    { value: '关键', label: '★ 关键' },
    { value: '重要', label: '★★ 重要' },
    { value: '普通', label: '★★★ 普通' },
    { value: '细微', label: '★★★★ 细微' },
  ]

  const filteredEvents = computed(() => {
    let list = sortedEvents.value
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.properties.date as string)?.toLowerCase().includes(q)
      )
    }
    if (eraFilter.value) {
      list = list.filter(e => (e.properties.era as string) === eraFilter.value)
    }
    if (importanceFilter.value) {
      list = list.filter(e => (e.properties.importance as string) === importanceFilter.value)
    }
    return list
  })

  return {
    searchQuery, eraFilter, importanceFilter,
    detectedEras, eras, eraFilterOptions, importanceFilterOptions,
    filteredEvents,
  }
}
