/** 详情邻接导航：时序内步进；大纲树折叠后只在可见子集内步进（风险点 1）。 */
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import { useEventTree } from '../useEventTree'
import { useTimelineNeighbors } from '../useTimelineNeighbors'
import type { SortMode } from '../useTimelineSort'

function makeEvent(id: string, name: string, properties: Record<string, unknown> = {}): Entity {
  return {
    id, type: 'event', name, description: '', properties, tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as Entity
}

describe('详情邻接导航', () => {
  it('按传入顺序取上一个/下一个，越过两端不再步进', () => {
    const list = [makeEvent('a', '甲'), makeEvent('b', '乙'), makeEvent('c', '丙')]
    const selected = ref<Entity | null>(list[1])
    const picked: string[] = []
    const { nav, step } = useTimelineNeighbors(selected, computed(() => list), event => picked.push(event.id))

    expect(nav.value).toEqual({ index: 1, total: 3, hasPrev: true, hasNext: true })
    step(1)
    expect(picked).toEqual(['c'])

    selected.value = list[2]
    expect(nav.value.hasNext).toBe(false)
    step(1)
    expect(picked).toEqual(['c'])
    step(-1)
    expect(picked).toEqual(['c', 'b'])

    selected.value = list[0]
    expect(nav.value.hasPrev).toBe(false)
    step(-1)
    expect(picked).toEqual(['c', 'b'])
  })

  it('大纲树折叠父节点后跳过隐藏子事件，只按可见顺序步进', () => {
    const root = makeEvent('root', '父')
    const child = makeEvent('child', '子', { parentId: 'root' })
    const tree = useEventTree(computed(() => [root, child]))
    tree.collapseAll()

    const selected = ref<Entity | null>(root)
    const picked: string[] = []
    const { nav, step } = useTimelineNeighbors(
      selected, computed(() => tree.flatOrder.value), event => picked.push(event.id),
      { mode: ref<SortMode>('tree'), treeOrder: tree.visibleFlatOrder },
    )

    // 全量顺序里 root 后面还有 child，但 child 已折叠 → 无下一个
    expect(tree.flatOrder.value.map(event => event.id)).toEqual(['root', 'child'])
    expect(tree.visibleFlatOrder.value.map(event => event.id)).toEqual(['root'])
    expect(nav.value).toEqual({ index: 0, total: 1, hasPrev: false, hasNext: false })
    step(1)
    expect(picked).toEqual([])
  })

  it('时序形态不受折叠影响；选中的是隐藏事件时索引为 -1', () => {
    const root = makeEvent('root', '父')
    const child = makeEvent('child', '子', { parentId: 'root' })
    const tree = useEventTree(computed(() => [root, child]))
    tree.collapseAll()
    const order = computed(() => tree.flatOrder.value)

    const chrono = useTimelineNeighbors(ref<Entity | null>(root), order, () => {}, {
      mode: ref<SortMode>('chrono'), treeOrder: tree.visibleFlatOrder,
    })
    expect(chrono.nav.value).toMatchObject({ index: 0, total: 2, hasNext: true })

    const hiddenSelected = useTimelineNeighbors(ref<Entity | null>(child), order, () => {}, {
      mode: ref<SortMode>('tree'), treeOrder: tree.visibleFlatOrder,
    })
    expect(hiddenSelected.nav.value).toEqual({ index: -1, total: 1, hasPrev: false, hasNext: false })
  })
})
