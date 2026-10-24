/** 事件右键菜单：指针位置 / 目标事件状态，以及上抛给视图的动作口径。 */
import { ref } from 'vue'
import type { Entity } from '@worldsea/entity-core'

export type TimelineEventAction = 'edit' | 'focus' | 'delete'

export interface EventMenuTarget {
  /** 视口坐标 */
  x: number
  y: number
  event: Entity
}

export function useTimelineEventMenu() {
  const menu = ref<EventMenuTarget | null>(null)

  /** 命中事件元素才开菜单；返回 true 表示调用方应吞掉浏览器默认菜单 */
  function openAt(pointer: MouseEvent, events: Entity[]): boolean {
    const id = (pointer.target as HTMLElement).closest<HTMLElement>('[data-event-id]')?.dataset.eventId
    const event = id ? events.find(item => item.id === id) : undefined
    if (!event) return false
    menu.value = { x: pointer.clientX, y: pointer.clientY, event }
    return true
  }

  function close() { menu.value = null }
  return { menu, openAt, close }
}
