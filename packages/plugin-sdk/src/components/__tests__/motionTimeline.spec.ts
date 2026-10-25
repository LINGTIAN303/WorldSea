// 形象图 E 批守卫（2026-10-26）：trackToKeyframes 统一换算（单段/多帧/防御）+
// MotionTimeline 交互（双击加帧转多帧、删帧）与兼容（旧单段数据不触碰不变）。
// 帧点拖拽的指针流属真机走查。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { trackToKeyframes } from '@worldsea/entity-core/core'
import MotionTimeline from '../MotionTimeline.vue'
import type { MotionTrack } from '@worldsea/entity-core'

const single: MotionTrack = { id: 't1', regionId: 'r1', trigger: 'loop', duration: 2, loop: true, dx: 0, dy: 10, rotate: 0, scale: 1 }

describe('trackToKeyframes —— 单段/多关键帧统一换算（E 批）', () => {
  it('单段（无 keyframes）→ 两帧：0 恒等 → 1 终值（D3 数据等价路径）', () => {
    const out = trackToKeyframes(single)
    expect(out).toEqual([
      { offset: 0, transform: 'translate(0%, 0%)' },
      { offset: 1, transform: 'translate(0%, 10%)' },
    ])
  })

  it('多帧：按 t 升序 + 自动补 t=0 恒等帧 + offset=t/duration', () => {
    const out = trackToKeyframes({
      ...single,
      keyframes: [
        { t: 1.0, dy: -8, rotate: 10 },
        { t: 0.4, dy: 6 },
        { t: 2.0, dy: 0, scale: 1.1 },
      ],
    })
    expect(out.map(o => o.offset)).toEqual([0, 0.2, 0.5, 1])
    expect(out[1].transform).toBe('translate(0%, 6%)')
    expect(out[2].transform).toContain('rotate(10deg)')
    expect(out[3].transform).toContain('scale(1.1)')
  })

  it('首帧恰在 t=0 不重复补；帧 t 超时长被钳 1', () => {
    const out = trackToKeyframes({
      ...single,
      keyframes: [{ t: 0, dy: 2 }, { t: 99, dy: 4 }],
    })
    expect(out.length).toBe(2)
    expect(out[1].offset).toBe(1)
  })
})

let wrapper: VueWrapper | undefined
const track = (): MotionTrack => ({ ...single })

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('MotionTimeline —— 时间轴交互', () => {
  it('未触碰：track 保持单段（无 keyframes，兼容旧数据）', () => {
    setActivePinia(createPinia())
    const t = track()
    wrapper = mount(MotionTimeline, { props: { track: t } })
    expect(t.keyframes).toBeUndefined()
    // 合成一帧显示（单段终值）
    expect(wrapper.text()).toContain('当前 1 帧')
  })

  it('双击轨道 → 初始化 keyframes 并加帧；删帧清空选择', async () => {
    setActivePinia(createPinia())
    const t = track()
    const el = document.createElement('div')
    document.body.appendChild(el)
    wrapper = mount(MotionTimeline, { props: { track: t }, attachTo: el })
    const rail = document.querySelector('.mtl-rail') as HTMLElement
    Object.defineProperty(rail, 'getBoundingClientRect', { value: () => ({ left: 0, width: 100, top: 0, height: 30 }) })
    rail.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 50, clientY: 15 }))
    await wrapper.vm.$nextTick()
    expect(t.keyframes).toBeTruthy()
    expect(t.keyframes!.length).toBe(2) // 单段终值帧 + 双击新帧(1.0s)
    expect(t.keyframes!.some(k => k.t === 1)).toBe(true)
    // 删帧
    const del = document.querySelector('.mtl-del') as HTMLButtonElement
    del?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(t.keyframes!.length).toBe(1)
    el.remove()
  })
})
