import { ref, computed, type Ref } from 'vue'
import { type ParsedDate } from './useDateParser'

export interface Tick {
  position: number
  label: string
  type: 'major' | 'minor' | 'micro'
}

export type ZoomLevel = 0 | 1 | 2

export interface TimelineScaleOptions {
  containerWidth: Ref<number>
  events: Ref<{ id: string; parsedDate: ParsedDate | null }[]>
}

export function useTimelineScale(options: TimelineScaleOptions) {
  const { containerWidth, events } = options

  const zoomLevel = ref<ZoomLevel>(1)
  const scrollOffset = ref(0)

  const pixelsPerYear = computed(() => {
    const base: Record<ZoomLevel, number> = { 0: 2, 1: 30, 2: 300 }
    return base[zoomLevel.value]
  })

  const timeRange = computed(() => {
    let min = Infinity
    let max = -Infinity
    for (const e of events.value) {
      if (!e.parsedDate) continue
      const start = e.parsedDate.era * 10000 + e.parsedDate.year
      const end = e.parsedDate.isRange && e.parsedDate.yearEnd != null
        ? (e.parsedDate.eraEnd ?? e.parsedDate.era) * 10000 + e.parsedDate.yearEnd
        : start
      min = Math.min(min, start)
      max = Math.max(max, end)
    }
    if (min === Infinity) { min = 0; max = 100 }
    const padding = Math.max((max - min) * 0.1, 1)
    return { min: min - padding, max: max + padding }
  })

  const totalWidth = computed(() => {
    const range = timeRange.value
    return (range.max - range.min) * pixelsPerYear.value
  })

  const viewportStart = computed(() => {
    const range = timeRange.value
    return range.min + scrollOffset.value / pixelsPerYear.value
  })

  const viewportEnd = computed(() => {
    const range = timeRange.value
    return range.min + (scrollOffset.value + containerWidth.value) / pixelsPerYear.value
  })

  function timeToPixel(date: ParsedDate): number {
    const timeValue = date.era * 10000 + date.year
    const range = timeRange.value
    return (timeValue - range.min) * pixelsPerYear.value - scrollOffset.value
  }

  function timeToPixelFromValue(timeValue: number): number {
    const range = timeRange.value
    return (timeValue - range.min) * pixelsPerYear.value - scrollOffset.value
  }

  function pixelToTime(px: number): number {
    const range = timeRange.value
    return range.min + (px + scrollOffset.value) / pixelsPerYear.value
  }

  function timeToTimeValue(date: ParsedDate): number {
    return date.era * 10000 + date.year
  }

  const majorTicks = computed<Tick[]>(() => {
    const ticks: Tick[] = []
    const range = timeRange.value
    const start = range.min
    const end = range.max

    if (zoomLevel.value === 0) {
      for (let era = Math.floor(start / 10000); era <= Math.ceil(end / 10000); era++) {
        const px = timeToPixelFromValue(era * 10000)
        if (px >= -100 && px <= containerWidth.value + 100) {
          ticks.push({ position: px, label: `第${era}纪元`, type: 'major' })
        }
      }
    } else if (zoomLevel.value === 1) {
      const eraStart = Math.floor(start / 10000)
      const eraEnd = Math.ceil(end / 10000)
      for (let era = eraStart; era <= eraEnd; era++) {
        const yearStart = era === eraStart ? (start - era * 10000) : -50
        const yearEnd = era === eraEnd ? (end - era * 10000) : 200
        for (let y = Math.floor(yearStart / 10) * 10; y <= yearEnd; y += 10) {
          const px = timeToPixelFromValue(era * 10000 + y)
          if (px >= -100 && px <= containerWidth.value + 100) {
            ticks.push({ position: px, label: `${y}年`, type: 'major' })
          }
        }
      }
    } else {
      const eraStart = Math.floor(start / 10000)
      const eraEnd = Math.ceil(end / 10000)
      for (let era = eraStart; era <= eraEnd; era++) {
        const yearStart = era === eraStart ? Math.floor(start - era * 10000) : 0
        const yearEnd = era === eraEnd ? Math.ceil(end - era * 10000) : 200
        for (let y = yearStart; y <= yearEnd; y++) {
          const px = timeToPixelFromValue(era * 10000 + y)
          if (px >= -100 && px <= containerWidth.value + 100) {
            ticks.push({ position: px, label: `${y}年`, type: 'major' })
          }
        }
      }
    }
    return ticks
  })

  const minorTicks = computed<Tick[]>(() => {
    const ticks: Tick[] = []
    if (zoomLevel.value < 2) return ticks
    const range = timeRange.value
    const start = range.min
    const end = range.max
    const eraStart = Math.floor(start / 10000)
    const eraEnd = Math.ceil(end / 10000)
    for (let era = eraStart; era <= eraEnd; era++) {
      const yearStart = era === eraStart ? Math.floor(start - era * 10000) : 0
      const yearEnd = era === eraEnd ? Math.ceil(end - era * 10000) : 200
      for (let y = yearStart; y <= yearEnd; y++) {
        for (let m = 1; m <= 12; m++) {
          const timeVal = era * 10000 + y + m / 12
          const px = timeToPixelFromValue(timeVal)
          if (px >= -100 && px <= containerWidth.value + 100) {
            ticks.push({ position: px, label: `${m}月`, type: 'minor' })
          }
        }
      }
    }
    return ticks
  })

  function zoomIn() {
    if (zoomLevel.value < 2) {
      const centerTime = viewportStart.value + (viewportEnd.value - viewportStart.value) / 2
      zoomLevel.value = (zoomLevel.value + 1) as ZoomLevel
      const newPxPerYear = pixelsPerYear.value
      const newCenterPx = (centerTime - timeRange.value.min) * newPxPerYear
      scrollOffset.value = Math.max(0, newCenterPx - containerWidth.value / 2)
    }
  }

  function zoomOut() {
    if (zoomLevel.value > 0) {
      const centerTime = viewportStart.value + (viewportEnd.value - viewportStart.value) / 2
      zoomLevel.value = (zoomLevel.value - 1) as ZoomLevel
      const newPxPerYear = pixelsPerYear.value
      const newCenterPx = (centerTime - timeRange.value.min) * newPxPerYear
      scrollOffset.value = Math.max(0, newCenterPx - containerWidth.value / 2)
    }
  }

  function zoomTo(level: ZoomLevel) {
    zoomLevel.value = level
    scrollOffset.value = 0
  }

  function panBy(deltaPx: number) {
    const maxOffset = Math.max(0, totalWidth.value - containerWidth.value)
    scrollOffset.value = Math.max(0, Math.min(maxOffset, scrollOffset.value + deltaPx))
  }

  function panTo(timeValue: number) {
    const range = timeRange.value
    const px = (timeValue - range.min) * pixelsPerYear.value - containerWidth.value / 2
    const maxOffset = Math.max(0, totalWidth.value - containerWidth.value)
    scrollOffset.value = Math.max(0, Math.min(maxOffset, px))
  }

  function fitAll() {
    scrollOffset.value = 0
  }

  return {
    zoomLevel,
    scrollOffset,
    pixelsPerYear,
    totalWidth,
    timeRange,
    viewportStart,
    viewportEnd,
    majorTicks,
    minorTicks,
    timeToPixel,
    timeToPixelFromValue,
    pixelToTime,
    timeToTimeValue,
    zoomIn,
    zoomOut,
    zoomTo,
    panBy,
    panTo,
    fitAll,
  }
}
