// F4 守卫：模型动作序列状态机——start 播首项、finished 推进、结束停末帧、重复触发从头。
import { describe, it, expect } from 'vitest'
import { createModelSequence } from '../modelSequence'

function setup() {
  const played: string[] = []
  const seq = createModelSequence((name) => played.push(name))
  return { played, seq }
}

describe('createModelSequence —— 模型动作序列（F4）', () => {
  it('start 播首个动作；finished 依次推进；结束后不再播（停在末帧）', () => {
    const { played, seq } = setup()
    seq.start(['Come', 'Idleshow'])
    expect(played).toEqual(['Come'])
    seq.finished()
    expect(played).toEqual(['Come', 'Idleshow'])
    seq.finished()
    expect(played).toEqual(['Come', 'Idleshow'])
    expect(seq.active).toBe(false)
  })

  it('序列播放中再次 start 从头开始（重复触发重播）', () => {
    const { played, seq } = setup()
    seq.start(['Come', 'Idleshow'])
    seq.finished()
    seq.start(['Come', 'Idleshow'])
    expect(played).toEqual(['Come', 'Idleshow', 'Come'])
    expect(seq.active).toBe(true)
  })

  it('cancel 后 finished 不再推进；空序列 start 不播', () => {
    const { played, seq } = setup()
    seq.start(['Come', 'Idleshow'])
    seq.cancel()
    seq.finished()
    expect(played).toEqual(['Come'])
    expect(seq.active).toBe(false)

    seq.start([])
    expect(played).toEqual(['Come'])
  })

  it('过滤空名字（防配置脏值）', () => {
    const { played, seq } = setup()
    seq.start(['', 'Come'])
    expect(played).toEqual(['Come'])
  })
})
