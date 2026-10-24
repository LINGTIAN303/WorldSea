/** 事件右键菜单：只在事件元素上开菜单，未命中时不拦截浏览器默认菜单。 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import { useTimelineEventMenu } from '../useTimelineEventMenu'

function makeEvent(id: string): Entity {
  return {
    id, type: 'event', name: id, description: '', properties: {}, tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as Entity
}

/** 在指定元素上派发 contextmenu 并取回事件（构造事件的 target 只读，必须走派发） */
function dispatchContextMenu(el: Element, x: number, y: number): MouseEvent {
  let captured: MouseEvent | null = null
  el.addEventListener('contextmenu', event => { captured = event as MouseEvent }, { once: true })
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: x, clientY: y }))
  return captured!
}

afterEach(() => { document.body.innerHTML = '' })

describe('事件右键菜单', () => {
  it('命中 data-event-id 才开菜单，并带上指针坐标', () => {
    const item = document.createElement('span')
    item.dataset.eventId = 'e1'
    document.body.appendChild(item)
    const { menu, openAt, close } = useTimelineEventMenu()
    const target = makeEvent('e1')

    expect(openAt(dispatchContextMenu(item, 12, 34), [target])).toBe(true)
    expect(menu.value).toMatchObject({ x: 12, y: 34 })
    expect(menu.value?.event.id).toBe('e1')

    close()
    expect(menu.value).toBeNull()
  })

  it('未命中事件元素或事件不在列表里时不开菜单', () => {
    const blank = document.createElement('div')
    document.body.appendChild(blank)
    const { menu, openAt } = useTimelineEventMenu()

    expect(openAt(dispatchContextMenu(blank, 0, 0), [makeEvent('e1')])).toBe(false)
    expect(menu.value).toBeNull()

    const item = document.createElement('span')
    item.dataset.eventId = 'ghost'
    document.body.appendChild(item)
    expect(openAt(dispatchContextMenu(item, 0, 0), [makeEvent('e1')])).toBe(false)
    expect(menu.value).toBeNull()
  })
})
