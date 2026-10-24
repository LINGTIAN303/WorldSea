/**
 * sectionLayout 单测 —— 区排布的纯布局变换（2026-10-24 · 13-D）
 *
 * 重点：vertical 按当前 y 排序后堆叠；free 原样保留；区不存在时返回同一对象。
 */
import { describe, it, expect } from 'vitest'
import { arrangeSectionInLayout } from '../board/sectionLayout'
import { SECTION_GAP, SECTION_HEADER, SECTION_PADDING } from '../board/sectionArrange'
import type { BoardContainer, OutlineBoardLayout } from '../board/layoutSchema'

function container(id: string, x: number, y: number, w = 100, h = 40): BoardContainer {
  return { id, nodeId: `n-${id}`, sectionId: 's1', pos: { x, y }, size: { w, h }, components: [] }
}

function layout(arrange: 'free' | 'vertical', containers: BoardContainer[]): OutlineBoardLayout {
  return {
    version: 1,
    sections: [{ id: 's1', rect: { x: 0, y: 0, w: 400, h: 600 }, arrange, order: 0 }],
    containers,
  }
}

describe('sectionLayout / arrangeSectionInLayout', () => {
  it('vertical：按 y 排序后自上而下堆叠，左对齐到内容原点', () => {
    const out = arrangeSectionInLayout(
      layout('vertical', [container('a', 300, 400), container('b', 50, 100)]),
      's1',
    )
    const a = out.containers.find(c => c.id === 'a')!
    const b = out.containers.find(c => c.id === 'b')!
    expect(b.pos).toEqual({ x: SECTION_PADDING, y: SECTION_HEADER + SECTION_PADDING })
    expect(a.pos).toEqual({
      x: SECTION_PADDING,
      y: SECTION_HEADER + SECTION_PADDING + 40 + SECTION_GAP,
    })
  })

  it('free：位置原样保留', () => {
    const src = layout('free', [container('a', 300, 400)])
    const out = arrangeSectionInLayout(src, 's1')
    expect(out.containers[0].pos).toEqual({ x: 300, y: 400 })
  })

  it('区不存在：原样返回同一个对象', () => {
    const src = layout('vertical', [container('a', 0, 0)])
    expect(arrangeSectionInLayout(src, 'nope')).toBe(src)
  })
})
