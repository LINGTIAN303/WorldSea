import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { useResizable } from '../useResizable'

/**
 * 拖宽的帧合并守卫。背景见 docs/plans/2026-10-02-实体详情表单地基与形态批计划.md §七之六
 * jsdom 的 `requestAnimationFrame` 由内部计时器驱动，等不到也数不清——换成手动队列：
 * **登记**与**落地**分离，才能断言「N 次 move 只落 1 次宽度」。
 */

type Cb = FrameRequestCallback
let queue: Map<number, Cb>
let seq = 0

function flushRaf() {
  const pending = [...queue.entries()]
  queue.clear()
  for (const [, cb] of pending) cb(performance.now())
}

function move(x: number) {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x }))
}

// 松手走真实链路：监听器挂在 document 上，spec 不该绕过它直接调内部函数
function endDrag() {
  document.dispatchEvent(new MouseEvent('mouseup'))
}

let api: ReturnType<typeof useResizable>

const Host = defineComponent({
  setup() {
    api = useResizable({ panelId: 'probe-panel', defaultWidth: 400, minWidth: 200 })
    return () => h('div')
  },
})

let wrapper: VueWrapper | undefined

function startDrag(clientX = 500) {
  wrapper = mount(Host)
  api.onResizeStart({ clientX, preventDefault: () => {} } as unknown as MouseEvent)
  return wrapper
}

beforeEach(() => {
  // 宽度落 localStorage：不清的话上一例存的值会左右本例的初始宽度
  localStorage.clear()
  queue = new Map()
  seq = 0
  vi.stubGlobal('requestAnimationFrame', (cb: Cb) => {
    const id = ++seq
    queue.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id) })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  vi.unstubAllGlobals()
})

describe('useResizable 帧合并', () => {
  it('一帧内多次 move 只落一次宽度（多次写入＝多次重排）', () => {
    startDrag()
    move(520)
    move(560)
    move(600)
    // 未 flush：宽度仍是拖动起点，说明 move 本身不写
    expect(api.width.value).toBe(400)
    flushRaf()
    expect(api.width.value).toBe(500)
  })

  it('松手时把压在帧队列里的末次移动先落地再存档', () => {
    startDrag()
    move(640)
    expect(queue.size, '末次移动应还压在队列里').toBe(1)
    endDrag()
    expect(api.width.value).toBe(540)
    expect(localStorage.getItem('worldsea_panel_width_probe-panel')).toBe('540')
  })

  it('上界在拖动开始时锁定：拖动途中窗口变窄不该改变夹紧结果', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    startDrag()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 })
    move(4000)
    flushRaf()
    // 起点 400 + dx 3500 → 不锁就撞到新上界 240，锁住才是旧上界 800
    expect(api.width.value).toBe(800)
  })

  it('下界仍生效，且松手后不再响应移动', () => {
    startDrag()
    move(-5000)
    flushRaf()
    expect(api.width.value).toBe(200)
    endDrag()
    move(900)
    flushRaf()
    expect(api.width.value).toBe(200)
  })

  it('卸载时取消未落地的帧，销毁后不再有写入', () => {
    startDrag()
    move(520)
    wrapper?.unmount()
    expect(queue.size).toBe(0)
    flushRaf()
    expect(api.width.value).toBe(400)
  })
})
