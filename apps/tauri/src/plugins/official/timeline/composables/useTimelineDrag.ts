import { ref, type Ref } from 'vue'
import type { Entity } from '@worldsmith/entity-core'
import type { ParsedDate } from './useDateParser'

export interface TimelineDragOptions {
  enabled: Ref<boolean>
  entityStore: { update: (id: string, data: Partial<Entity>) => Promise<void> }
  confirm: (opts: { type: string; title: string; description: string }) => Promise<boolean>
  pixelsPerYear: Ref<number>
  timeToTimeValue: (date: ParsedDate) => number
}

export function useTimelineDrag(options: TimelineDragOptions) {
  const { enabled, entityStore, confirm, pixelsPerYear } = options

  const isDragging = ref(false)
  const dragTarget = ref<string | null>(null)
  const dragType = ref<'move' | 'resize'>('move')
  const dragStartX = ref(0)
  const dragDeltaPx = ref(0)

  function onDragStart(eventId: string, type: 'move' | 'resize', startX: number) {
    if (!enabled.value) return
    isDragging.value = true
    dragTarget.value = eventId
    dragType.value = type
    dragStartX.value = startX
    dragDeltaPx.value = 0
  }

  function onDragMove(currentX: number) {
    if (!isDragging.value) return
    dragDeltaPx.value = currentX - dragStartX.value
  }

  async function onDragEnd(entity: Entity | null): Promise<boolean> {
    if (!isDragging.value || !entity) {
      isDragging.value = false
      dragTarget.value = null
      return false
    }

    const deltaYears = Math.round(dragDeltaPx.value / pixelsPerYear.value)
    if (deltaYears === 0) {
      isDragging.value = false
      dragTarget.value = null
      return false
    }

    const dateText = (entity.properties.date as string) || ''
    const dateEndText = (entity.properties.dateEnd as string) || ''

    const newDate = shiftDate(dateText, deltaYears)
    const newDateEnd = (dragType.value === 'resize' && dateEndText)
      ? shiftDate(dateEndText, deltaYears)
      : (dragType.value === 'move' && dateEndText)
        ? shiftDate(dateEndText, deltaYears)
        : dateEndText

    const actionLabel = dragType.value === 'resize' ? '调整持续时间' : '移动事件'
    const confirmed = await confirm({
      type: 'warning',
      title: `确认${actionLabel}`,
      description: `将「${entity.name}」的日期从 ${dateText} 改为 ${newDate}${newDateEnd !== dateEndText ? `，结束日期从 ${dateEndText} 改为 ${newDateEnd}` : ''}`,
    })

    if (confirmed) {
      const updates: Partial<Entity> = {
        properties: {
          ...entity.properties,
          date: newDate,
          ...(newDateEnd !== dateEndText ? { dateEnd: newDateEnd } : {}),
        },
      }
      await entityStore.update(entity.id, updates)
    }

    isDragging.value = false
    dragTarget.value = null
    dragDeltaPx.value = 0
    return confirmed
  }

  function shiftDate(dateText: string, deltaYears: number): string {
    const yearMatch = dateText.match(/(\d+)\s*年/)
    if (!yearMatch) return dateText
    const oldYear = parseInt(yearMatch[1])
    const newYear = oldYear + deltaYears
    return dateText.replace(/\d+(\s*年)/, newYear + '$1')
  }

  return {
    isDragging,
    dragTarget,
    dragType,
    dragDeltaPx,
    onDragStart,
    onDragMove,
    onDragEnd,
  }
}
