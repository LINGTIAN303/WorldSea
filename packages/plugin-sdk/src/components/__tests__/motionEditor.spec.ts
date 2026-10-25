// 形象图批 D4 守卫（2026-10-25）：motionMath 坐标数学（letterbox 补偿——编辑器画布与
// 渲染容器比例不同仍像素对齐的根基）+ MotionEditor 基础链路（挂载/保存写库/鼠标触发项）。
// 画布拖拽交互属真机走查。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { computeDisplayBox, regionToClip, boxPointToRegion } from '@worldsea/entity-core/core'
import MotionEditor from '../MotionEditor.vue'

const region = { id: 'r1', x: 25, y: 25, w: 50, h: 50 }

describe('motionMath —— 图面显示区坐标（letterbox 补偿）', () => {
  it('宽扁容器放竖长图：上下留白，显示区高度压缩', () => {
    // 容器 200×100，图 100×100 → contain 后显示区 100×100（盒 50% 高、垂直居中）
    const box = computeDisplayBox(100, 100, 200, 100)
    expect(box).toEqual({ oX: 25, oY: 0, dW: 50, dH: 100 })
  })

  it('同一图面区域在不同比例容器上换算出不同 clip（像素对齐同一图面位置）', () => {
    const wide = computeDisplayBox(100, 100, 200, 100) // 左右留白：oX=25,dW=50
    const tall = computeDisplayBox(100, 100, 100, 200) // 上下留白：oY=25,dH=50
    // 宽容器：left=25+25*0.5=37.5%；高容器：top=25+25*0.5=37.5%（对称场景对称值）
    expect(regionToClip(region, wide)).toBe('inset(25% 37.5% 25% 37.5%)')
    expect(regionToClip(region, tall)).toBe('inset(37.5% 25% 37.5% 25%)')
  })

  it('盒内点 → 图面坐标（含留白偏移扣除）与出界钳制（函数内钳 0-100）', () => {
    const box = { oX: 25, oY: 0, dW: 50, dH: 100 }
    expect(boxPointToRegion(50, 50, box)).toEqual({ x: 50, y: 50 }) // 盒中心=图面中心
    expect(boxPointToRegion(25, 0, box)).toEqual({ x: 0, y: 0 }) // 显示区左上角
    expect(boxPointToRegion(0, 0, box)).toEqual({ x: 0, y: 0 }) // 留白处出负→钳 0
    expect(boxPointToRegion(120, 120, box)).toEqual({ x: 100, y: 100 }) // 越界钳 100
  })
})

const entity = {
  id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'http://x/p.png', portraitKind: 'static',
  portraitMeta: {
    motion: {
      regions: [region],
      tracks: [{ id: 't1', regionId: 'r1', trigger: 'mouse', duration: 2, loop: true, dx: 4, dy: 4 }],
    },
  },
} as never

let wrapper: VueWrapper | undefined

beforeEach(() => { localStorage.clear() })
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

describe('MotionEditor —— 画布编辑器（D4）', () => {
  it('挂载：画布/区域矩形/侧栏轨迹（含「追踪鼠标」选项）/实时预览齐备', () => {
    setActivePinia(createPinia())
    const el = document.createElement('div')
    document.body.appendChild(el)
    wrapper = mount(MotionEditor, { props: { entity }, attachTo: el })
    expect(document.querySelector('.me-dialog')).toBeTruthy()
    expect(document.querySelector('.me-region')).toBeTruthy()
    expect(document.querySelector('.me-preview')).toBeTruthy()
    const triggers = [...document.querySelectorAll('.me-track select option')].map(o => o.textContent)
    expect(triggers).toContain('追踪鼠标')
    el.remove()
  })

  it('保存改动：一次性写 portraitMeta（草稿 commit 模式）', async () => {
    setActivePinia(createPinia())
    const store = (await import('@worldsea/entity-core')).useEntityStore()
    const spy = vi.spyOn(store, 'update').mockResolvedValue(undefined)
    const el = document.createElement('div')
    document.body.appendChild(el)
    wrapper = mount(MotionEditor, { props: { entity }, attachTo: el })
    const save = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('保存'))
    // 草稿未变时无保存按钮（dirty=false）；改动后出现——直接验证写路径：改 draft 后保存
    await wrapper.vm.$nextTick()
    // 触发 dirty：焦点模式点击画布
    const modeBtn = [...document.querySelectorAll('.me-modes button')].find(b => b.textContent?.includes('焦点'))
    modeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    const canvas = document.querySelector('.me-canvas') as HTMLElement
    canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }))
    await wrapper.vm.$nextTick()
    const saveBtn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('保存'))
    saveBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(spy).toHaveBeenCalled()
    const call = spy.mock.calls.at(-1)
    expect(call?.[0]).toBe('chr-1')
    expect(call?.[1]).toMatchObject({ portraitMeta: { motion: entity.portraitMeta.motion } })
    el.remove()
  })
})
