// F2 守卫：轨迹级 easing 透传到 WAAPI 关键帧（单段/多帧同口径；linear 不输出保持旧产物）。
import { describe, it, expect } from 'vitest'
import { trackToKeyframes } from '../motionMath'
import type { MotionTrack } from '../../types/entity'

const base: MotionTrack = { id: 't1', regionId: 'r1', trigger: 'loop', duration: 2, loop: true, dx: 5 }

describe('trackToKeyframes —— 轨迹级 easing（F2）', () => {
  it('单段轨迹：easing 透传到两帧（首帧起每段生效）', () => {
    const frames = trackToKeyframes({ ...base, easing: 'ease-in-out' })
    expect(frames.map((f) => f.easing)).toEqual(['ease-in-out', 'ease-in-out'])
  })

  it('多关键帧：每帧都带同一 easing', () => {
    const frames = trackToKeyframes({
      ...base,
      easing: 'ease-out',
      keyframes: [
        { t: 0 },
        { t: 1, dx: 6 },
        { t: 2, dx: 0 },
      ],
    })
    expect(frames.map((f) => f.easing)).toEqual(['ease-out', 'ease-out', 'ease-out'])
  })

  it('缺省 / linear：不输出 easing（默认行为与旧产物一致）', () => {
    expect(trackToKeyframes(base).every((f) => f.easing === undefined)).toBe(true)
    expect(trackToKeyframes({ ...base, easing: 'linear' }).every((f) => f.easing === undefined)).toBe(true)
  })
})
