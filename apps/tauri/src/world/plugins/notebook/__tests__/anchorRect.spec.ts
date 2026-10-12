/**
 * makeCharAnchorRect — 弹层锚点契约（走查修复轮 4，2026-10-12）。
 *
 * 锁定：以「指令符文档位置」构造实时锚点矩形——每次调用重新取坐标（滚动跟随）、
 * 位置失效时返回 null（调用方保持原位，不乱跳）。
 * 背景：suggestion 的 props.clientRect 在真机退化为「光标锚」导致弹层横向偏移
 * （出现在光标行右侧），故本模块自建锚点（见 editorExtensions.makeCharAnchorRect 头注释）。
 */
import { describe, it, expect } from 'vitest'
import { makeCharAnchorRect } from '../composables/editorExtensions'

function fakeEditor(
  coordsAtPos: (pos: number) => { left: number; top: number; bottom: number },
): Parameters<typeof makeCharAnchorRect>[0] {
  return { view: { coordsAtPos } } as unknown as Parameters<typeof makeCharAnchorRect>[0]
}

describe('makeCharAnchorRect · 指令符锚点', () => {
  it('按指定文档位置取坐标构造矩形（x=左缘、高=字符行高、宽=0）', () => {
    const calls: number[] = []
    const rectFn = makeCharAnchorRect(
      fakeEditor((pos) => {
        calls.push(pos)
        return { left: 120, top: 50, bottom: 70 }
      }),
      42,
    )
    const r = rectFn()
    expect(r).not.toBeNull()
    expect(r!.left).toBe(120)
    expect(r!.top).toBe(50)
    expect(r!.bottom).toBe(70)
    expect(r!.width).toBe(0)
    expect(r!.height).toBe(20)
    expect(calls).toEqual([42])
  })

  it('实时函数：每次调用重新取坐标（滚动/布局变化自然跟随）', () => {
    let left = 100
    const rectFn = makeCharAnchorRect(fakeEditor(() => ({ left, top: 10, bottom: 30 })), 7)
    expect(rectFn()!.left).toBe(100)
    left = 40 // 模拟滚动/布局变化
    expect(rectFn()!.left).toBe(40)
  })

  it('位置失效（coordsAtPos 抛错）→ null（调用方保持原位）', () => {
    const rectFn = makeCharAnchorRect(
      fakeEditor(() => {
        throw new Error('position gone')
      }),
      3,
    )
    expect(rectFn()).toBeNull()
  })
})
