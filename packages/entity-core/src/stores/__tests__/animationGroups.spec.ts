import { describe, it, expect } from 'vitest'
import { ANIMATION_GROUPS } from '../settingsStore'

describe('ANIMATION_GROUPS', () => {
  it('包含导航与内容两组，键顺序稳定', () => {
    expect(Object.keys(ANIMATION_GROUPS)).toEqual([
      'nav',
      'content',
      'panels',
      'overlays',
      'status',
      'messages',
      'splash',
    ])
  })
})
