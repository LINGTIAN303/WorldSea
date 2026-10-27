// F2 守卫：MotionEditor 草稿撤销/重做（快照合并拖动、工具栏按钮、Ctrl+Z/Y）。
// 快照恢复保持 draft 数组引用（splice 重建）；保存语义不变（单独用例在 motionEditor.spec）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import MotionEditor from '../MotionEditor.vue'

const entity = {
  id: 'chr-1', type: 'character', name: '凉', description: '', tags: [],
  properties: {}, createdAt: '', updatedAt: '',
  portrait: 'http://x/p.png', portraitKind: 'static',
  portraitMeta: {
    motion: {
      regions: [{ id: 'r1', x: 25, y: 25, w: 50, h: 50 }],
      tracks: [{ id: 't1', regionId: 'r1', trigger: 'loop', duration: 2, loop: true, dx: 5 }],
    },
  },
} as never

let wrapper: VueWrapper | undefined
let host: HTMLElement

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  host.remove()
  vi.useRealTimers()
})

function mountEditor() {
  wrapper = mount(MotionEditor, { props: { entity }, attachTo: host })
  return wrapper
}

const durationInput = () => document.querySelector('.me-track input[aria-label="时长秒"]') as HTMLInputElement
const btn = (sel: string) => document.querySelector(sel) as HTMLButtonElement

async function changeDuration(w: VueWrapper, value: string) {
  const input = durationInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await w.vm.$nextTick()
  vi.advanceTimersByTime(300)
  await w.vm.$nextTick()
}

describe('MotionEditor —— 草稿撤销/重做（F2）', () => {
  it('初始不可撤销；改动合并成一步后可撤销/重做', async () => {
    const w = mountEditor()
    expect(btn('.me-undo').disabled).toBe(true)
    expect(btn('.me-redo').disabled).toBe(true)

    await changeDuration(w, '5')
    expect(durationInput().value).toBe('5')
    expect(btn('.me-undo').disabled).toBe(false)

    btn('.me-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('2')
    expect(btn('.me-redo').disabled).toBe(false)

    btn('.me-redo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('5')
  })

  it('拖动中的高频变更合并为一次快照（防抖）', async () => {
    const w = mountEditor()
    const input = durationInput()
    input.value = '3'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    vi.advanceTimersByTime(100)
    input.value = '4'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    vi.advanceTimersByTime(100)
    input.value = '5'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    vi.advanceTimersByTime(300)
    await w.vm.$nextTick()

    btn('.me-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('2') // 一次撤销回到初始，而非逐次 5→4→3
  })

  it('Ctrl+Z 撤销、Ctrl+Y 重做（编辑器内）', async () => {
    const w = mountEditor()
    await changeDuration(w, '6')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('2')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('6')
  })

  it('撤销后再编辑会清空重做栈', async () => {
    const w = mountEditor()
    await changeDuration(w, '5')
    btn('.me-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(btn('.me-redo').disabled).toBe(false)
    await changeDuration(w, '7')
    expect(btn('.me-redo').disabled).toBe(true)
  })

  it('改动后立即可撤销（防抖窗口内按钮已可用，撤销前先落当前快照）', async () => {
    const w = mountEditor()
    const input = durationInput()
    input.value = '9'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    expect(btn('.me-undo').disabled).toBe(false)
    btn('.me-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('2')
  })

  it('撤销后立即编辑：重做立刻失效（不等防抖）', async () => {
    const w = mountEditor()
    await changeDuration(w, '5')
    btn('.me-undo').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await w.vm.$nextTick()
    expect(btn('.me-redo').disabled).toBe(false)
    const input = durationInput()
    input.value = '7'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await w.vm.$nextTick()
    expect(btn('.me-redo').disabled).toBe(true)
  })

  it('编辑/模板只改草稿，不污染实体对象', async () => {
    const source = structuredClone(entity) as typeof entity & { portraitMeta: { motion: { tracks: { keyframes?: unknown[] }[] } } }
    source.portraitMeta.motion.tracks[0].keyframes = [{ t: 0 }, { t: 1, dx: 3 }]
    wrapper = mount(MotionEditor, { props: { entity: source }, attachTo: host })
    const tpl = document.querySelector('.me-template') as HTMLSelectElement
    tpl.value = 'breathe'
    tpl.dispatchEvent(new Event('change'))
    await wrapper.vm.$nextTick()
    expect(source.portraitMeta.motion.tracks[0].keyframes).toHaveLength(2)
  })

  it('焦点在编辑器数字输入框内，Ctrl+Z 仍撤销草稿', async () => {
    const w = mountEditor()
    await changeDuration(w, '6')
    const input = durationInput()
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    await w.vm.$nextTick()
    expect(durationInput().value).toBe('2')
  })

  it('Ctrl+Z 由编辑器优先消费，不触发全局撤销监听', async () => {
    const w = mountEditor()
    await changeDuration(w, '6')
    const globalUndo = vi.fn()
    document.addEventListener('keydown', globalUndo)
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    document.removeEventListener('keydown', globalUndo)
    await w.vm.$nextTick()
    expect(globalUndo).not.toHaveBeenCalled()
    expect(durationInput().value).toBe('2')
  })
})
