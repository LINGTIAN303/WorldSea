/** 批量属性补丁：只更新选中事件，合并旧 properties（整体替换语义）。 */
import { describe, expect, it } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import { applyBatchProperties } from '../batchProperties'

function makeEntity(id: string, type: string, properties: Record<string, unknown>): Entity {
  return {
    id, type, name: id, description: '', properties, tags: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  } as Entity
}

describe('批量属性补丁', () => {
  it('只更新选中事件并合并旧属性；「不改动」的空字段不生效', () => {
    const events = [
      makeEntity('a', 'event', { date: '第三纪元147年', importance: '普通' }),
      makeEntity('b', 'event', { date: '第三纪元148年', status: '备选' }),
      makeEntity('c', 'event', { date: '第三纪元149年' }),
    ]
    const updates = applyBatchProperties(events, new Set(['a', 'b']), { importance: '关键', status: '' })
    expect(updates).toEqual([
      { id: 'a', properties: { date: '第三纪元147年', importance: '关键' } },
      { id: 'b', properties: { date: '第三纪元148年', status: '备选', importance: '关键' } },
    ])
  })

  it('空补丁或非事件实体不产生更新', () => {
    const list = [makeEntity('a', 'event', {}), makeEntity('ch', 'character', {})]
    expect(applyBatchProperties(list, ['a', 'ch'], {})).toEqual([])
    expect(applyBatchProperties(list, ['ch'], { importance: '重要' })).toEqual([])
  })
})
