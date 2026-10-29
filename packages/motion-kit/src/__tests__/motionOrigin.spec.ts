import { describe, it, expect } from 'vitest'
import { motionOrigin } from '../motionOrigin'

describe('motionOrigin', () => {
  it('把触发点换算为面板内坐标', () => {
    expect(motionOrigin({ x: 100, y: 50 }, { left: 80, top: 30 })).toBe('20px 20px')
  })

  it('四舍五入到整像素', () => {
    expect(motionOrigin({ x: 100.4, y: 50.6 }, { left: 80, top: 30 })).toBe('20px 21px')
  })
})
