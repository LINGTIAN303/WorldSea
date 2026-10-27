// F2 守卫：轨迹级缓动下拉 + 动效模板（覆盖参数、清空关键帧、保留 trigger/id）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import MotionEditorSide from '../MotionEditorSide.vue'
import type { MotionConfig } from '@worldsea/entity-core'

let draft: MotionConfig
let wrapper: VueWrapper | undefined

beforeEach(() => {
  draft = reactive<MotionConfig>({
    regions: [{ id: 'r1', x: 10, y: 10, w: 30, h: 30 }],
    tracks: [{ id: 't1', regionId: 'r1', trigger: 'loop', duration: 2, loop: true, dx: 5 }],
  })
})

afterEach(() => { wrapper?.unmount(); wrapper = undefined })

function mountSide() {
  wrapper = mount(MotionEditorSide, {
    props: { src: 'https://x/p.png', mode: 'region', draft, draftFocus: {}, selectedId: 'r1' },
  })
  return wrapper
}

describe('MotionEditorSide —— 轨迹缓动（F2）', () => {
  it('非 mouse 轨迹有缓动下拉：四档、缺省 linear', () => {
    const w = mountSide()
    const sel = w.find('.me-easing')
    expect(sel.exists()).toBe(true)
    expect((sel.element as HTMLSelectElement).value).toBe('linear')
    expect(sel.findAll('option').map((o) => o.attributes('value'))).toEqual([
      'linear', 'ease-in', 'ease-out', 'ease-in-out',
    ])
  })

  it('选择缓动写入 track.easing 并上报 change；linear 归省缺', async () => {
    const w = mountSide()
    await w.find('.me-easing').setValue('ease-in-out')
    expect(draft.tracks[0].easing).toBe('ease-in-out')
    expect(w.emitted('change')).toBeTruthy()
    await w.find('.me-easing').setValue('linear')
    expect(draft.tracks[0].easing).toBeUndefined()
  })
})

describe('MotionEditorSide —— 动效模板（F2）', () => {
  it('模板下拉含四项预置', () => {
    const w = mountSide()
    const opts = w.find('.me-template').findAll('option').map((o) => o.text())
    expect(opts).toEqual(['模板…', '头部摆动', '呼吸', '漂浮', '眨眼'])
  })

  it('应用「呼吸」：覆盖参数、清空关键帧、保留 trigger/id、上报 change', async () => {
    draft.tracks[0].keyframes = [{ t: 0 }, { t: 1, dx: 3 }]
    const w = mountSide()
    await w.find('.me-template').setValue('breathe')
    const t = draft.tracks[0]
    expect(t).toMatchObject({
      id: 't1', regionId: 'r1', trigger: 'loop',
      duration: 3, loop: true, alternate: true,
      dx: 0, dy: 0, rotate: 0, scale: 1.04, easing: 'ease-in-out',
    })
    expect(t.keyframes).toBeUndefined()
    expect(w.emitted('change')).toBeTruthy()
  })

  it('应用「眨眼」：单次不循环不往返', async () => {
    const w = mountSide()
    await w.find('.me-template').setValue('blink')
    expect(draft.tracks[0]).toMatchObject({ duration: 0.28, loop: false, alternate: false, dy: 2 })
  })

  it('追踪鼠标轨迹不显示模板与时间轴（连续跟随不适用）', () => {
    draft.tracks[0].trigger = 'mouse'
    const w = mountSide()
    expect(w.find('.me-template').exists()).toBe(false)
    expect(w.find('.mtl').exists()).toBe(false)
  })
})
