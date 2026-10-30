import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { flipDeltas, useBoardFlip } from '../composables/useBoardFlip'

function fakeAnimation() {
  return { cancel: vi.fn(), addEventListener: vi.fn() }
}

function attachAnimate(el: HTMLElement, anim = fakeAnimation()) {
  const animate = vi.fn((..._args: unknown[]) => anim)
  Object.defineProperty(el, 'animate', { value: animate, configurable: true })
  return { animate, anim }
}

afterEach(() => {
  delete document.documentElement.dataset.animContent
  delete document.documentElement.dataset.reduceMotion
})

describe('flipDeltas', () => {
  it('只返回前后都存在且位移非零的容器', () => {
    const before = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 10, y: 10 }],
      ['c', { x: 0, y: 0 }],
    ])
    const after = new Map([
      ['a', { x: 0, y: 0 }],
      ['b', { x: 20, y: 10 }],
      ['d', { x: 0, y: 0 }],
    ])
    expect(flipDeltas(before, after)).toEqual([{ id: 'b', dx: 10, dy: 0 }])
  })
})

describe('useBoardFlip', () => {
  it('对位移容器播放 translate 动画', () => {
    const rootEl = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute('data-board-container-id', 'a')
    rootEl.appendChild(el)
    const { animate } = attachAnimate(el)

    const flip = useBoardFlip(ref<HTMLElement | null>(rootEl))
    flip.play(
      new Map([['a', { x: 0, y: 0 }]]),
      { containers: [{ id: 'a', pos: { x: 10, y: 0 } }] },
    )

    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0][0]).toEqual([
      { transform: 'translate(10px, 0px)' },
      { transform: 'none' },
    ])
  })

  it('内容动效关闭 / 减弱动效时不播放', () => {
    const rootEl = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute('data-board-container-id', 'a')
    rootEl.appendChild(el)
    const { animate } = attachAnimate(el)
    const flip = useBoardFlip(ref<HTMLElement | null>(rootEl))
    const before = new Map([['a', { x: 0, y: 0 }]])

    document.documentElement.dataset.animContent = 'off'
    flip.play(before, { containers: [{ id: 'a', pos: { x: 10, y: 0 } }] })
    expect(animate).not.toHaveBeenCalled()

    delete document.documentElement.dataset.animContent
    document.documentElement.dataset.reduceMotion = 'on'
    flip.play(before, { containers: [{ id: 'a', pos: { x: 10, y: 0 } }] })
    expect(animate).not.toHaveBeenCalled()
  })

  it('cancel 取消当前动画', () => {
    const rootEl = document.createElement('div')
    const el = document.createElement('div')
    el.setAttribute('data-board-container-id', 'a')
    rootEl.appendChild(el)
    const { anim } = attachAnimate(el)
    const flip = useBoardFlip(ref<HTMLElement | null>(rootEl))
    flip.play(
      new Map([['a', { x: 0, y: 0 }]]),
      { containers: [{ id: 'a', pos: { x: 10, y: 0 } }] },
    )
    flip.cancel()
    expect(anim.cancel).toHaveBeenCalled()
  })
})
