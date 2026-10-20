import { describe, expect, it } from 'vitest'
import { countEntitiesByPlugin } from '../sproutEntityCounts'

describe('sproutEntityCounts', () => {
  it('按 pluginId 的实体类型汇总 allTypeCounts', () => {
    const counts = countEntitiesByPlugin(new Map([
      ['character', 3],
      ['region', 2],
      ['pipeline', 1],
    ]))
    expect(counts.get('official.characters')).toBe(3)
    expect(counts.get('official.regions')).toBe(2)
    expect(counts.get('official.orchestration')).toBe(1)
  })

  it('无实体时各芽为 0', () => {
    const counts = countEntitiesByPlugin(new Map())
    expect(counts.get('official.characters')).toBe(0)
    expect(counts.get('official.field-matrix')).toBeUndefined()
  })
})
