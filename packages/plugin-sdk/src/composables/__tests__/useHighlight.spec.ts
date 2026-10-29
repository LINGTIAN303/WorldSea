import { describe, it, expect, vi, beforeEach } from 'vitest'

const settings = vi.hoisted(() => ({
  highlight_spreadHops: 1,
  highlight_dimmingEnabled: true,
  highlight_dimmingMode: 'spread' as 'simple' | 'spread',
  highlight_dimOpacity: 0.25,
  highlight_pulseEnabled: true,
}))

vi.mock('@worldsea/entity-core', () => ({
  getSettingsApi: () => settings,
}))

import { useHighlight } from '../useHighlight'

const relations = [
  { sourceId: 'a', targetId: 'b' },
  { sourceId: 'b', targetId: 'c' },
] as never

beforeEach(() => {
  settings.highlight_dimmingMode = 'spread'
  settings.highlight_dimmingEnabled = true
  settings.highlight_spreadHops = 1
})

describe('useHighlight 淡化模式', () => {
  it('spread：只淡化扩散跳数外的实体', () => {
    const h = useHighlight({ getRelations: () => relations })
    h.select('a')
    expect(h.applyToList([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map(r => r.dimmed))
      .toEqual([false, false, true])
  })

  it('simple：除焦点外全部淡化', () => {
    settings.highlight_dimmingMode = 'simple'
    const h = useHighlight({ getRelations: () => relations })
    h.select('a')
    expect(h.applyToList([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map(r => r.dimmed))
      .toEqual([false, true, true])
  })

  it('关闭淡化后不变暗', () => {
    settings.highlight_dimmingEnabled = false
    const h = useHighlight({ getRelations: () => relations })
    h.select('a')
    expect(h.applyToList([{ id: 'b' }])[0].dimmed).toBe(false)
  })
})
