import { describe, it, expect } from 'vitest'
import {
  SECTION_GAP,
  SECTION_HEADER,
  SECTION_PADDING,
  arrangeSection,
  clampContainerTop,
  contentOrigin,
  shouldRearrangeOnResize,
  type ArrangeItem,
} from '../board/sectionArrange'
import type { Rect } from '../board/boardGeometry'

function rect(x: number, y: number, w = 400, h = 300): Rect {
  return { x, y, w, h }
}

function item(id: string, x: number, y: number, w = 100, h = 40): ArrangeItem {
  return { id, x, y, w, h }
}

describe('sectionArrange / 内容原点', () => {
  it('contentOrigin = 区左上角 + 内边距 + 标题栏高度', () => {
    expect(contentOrigin(rect(10, 20))).toEqual({
      x: 10 + SECTION_PADDING,
      y: 20 + SECTION_HEADER + SECTION_PADDING,
    })
  })

  it('可覆盖 gap / padding / header（便于不同区样式复用）', () => {
    expect(contentOrigin(rect(0, 0), { padding: 4, header: 0 })).toEqual({ x: 4, y: 4 })
  })
})

describe('sectionArrange / free：保持相对位置', () => {
  it('原样返回容器当前位置（调整尺寸不重排的语义）', () => {
    const items = [item('a', 37, 91), item('b', -12, 5, 80, 30)]
    const out = arrangeSection(items, rect(0, 0), 'free')
    expect(out).toEqual([
      { id: 'a', x: 37, y: 91 },
      { id: 'b', x: -12, y: 5 },
    ])
  })
})

describe('sectionArrange / vertical：自上而下', () => {
  it('按当前 y 排序堆叠，左边界对齐，间距为 gap', () => {
    const items = [item('a', 100, 50, 100, 40), item('b', 0, 10, 100, 60)]
    const out = arrangeSection(items, rect(0, 0), 'vertical')
    const originX = SECTION_PADDING
    const originY = SECTION_HEADER + SECTION_PADDING
    expect(out).toEqual([
      { id: 'b', x: originX, y: originY },
      { id: 'a', x: originX, y: originY + 60 + SECTION_GAP },
    ])
  })

  it('y 相同时用 x 兜底排序（顺序稳定，避免视图抖动）', () => {
    const items = [item('right', 200, 0), item('left', 50, 0)]
    const out = arrangeSection(items, rect(0, 0), 'vertical')
    expect(out.map(o => o.id)).toEqual(['left', 'right'])
  })
})

describe('sectionArrange / horizontal：自左而右', () => {
  it('按当前 x 排序排列，上边界对齐，间距为 gap', () => {
    const items = [item('a', 100, 0, 100, 40), item('b', 0, 0, 120, 40)]
    const out = arrangeSection(items, rect(0, 0), 'horizontal')
    const originY = SECTION_HEADER + SECTION_PADDING
    expect(out).toEqual([
      { id: 'b', x: SECTION_PADDING, y: originY },
      { id: 'a', x: SECTION_PADDING + 120 + SECTION_GAP, y: originY },
    ])
  })
})

describe('sectionArrange / grid：等列宽逐行填充', () => {
  const items = [
    item('a', 0, 0, 100, 40),
    item('b', 0, 0, 100, 40),
    item('c', 0, 0, 100, 40),
  ]

  it('宽度足够时全部排在同一行', () => {
    // 可用宽 400-32=368；(368+12)/(100+12)=3.39 → 3 列
    const out = arrangeSection(items, rect(0, 0, 400, 300), 'grid')
    const originY = SECTION_HEADER + SECTION_PADDING
    expect(out).toEqual([
      { id: 'a', x: SECTION_PADDING, y: originY },
      { id: 'b', x: SECTION_PADDING + 112, y: originY },
      { id: 'c', x: SECTION_PADDING + 224, y: originY },
    ])
  })

  it('宽度不足时换行，行高取该行最高容器', () => {
    const mixed = [item('a', 0, 0, 100, 40), item('b', 0, 0, 100, 90)]
    // 可用宽 200-32=168；(168+12)/112=1.6 → 1 列 → 每行一个
    const out = arrangeSection(mixed, rect(0, 0, 200, 300), 'grid')
    const originY = SECTION_HEADER + SECTION_PADDING
    expect(out).toEqual([
      { id: 'a', x: SECTION_PADDING, y: originY },
      { id: 'b', x: SECTION_PADDING, y: originY + 40 + SECTION_GAP },
    ])
  })

  it('区宽小于一个容器宽时不产生 0 列（防御除零）', () => {
    const out = arrangeSection([item('a', 0, 0, 300, 40)], rect(0, 0, 50, 100), 'grid')
    expect(out).toEqual([{ id: 'a', x: SECTION_PADDING, y: SECTION_HEADER + SECTION_PADDING }])
  })
})

describe('sectionArrange / 边界与判定', () => {
  it('空容器集合返回空数组（四种模式一致）', () => {
    for (const mode of ['free', 'vertical', 'horizontal', 'grid'] as const) {
      expect(arrangeSection([], rect(0, 0), mode)).toEqual([])
    }
  })

  it('只有 free 在调整尺寸时保持相对位置，其余重排', () => {
    expect(shouldRearrangeOnResize('free')).toBe(false)
    expect(shouldRearrangeOnResize('vertical')).toBe(true)
    expect(shouldRearrangeOnResize('horizontal')).toBe(true)
    expect(shouldRearrangeOnResize('grid')).toBe(true)
  })
})

describe('sectionArrange / 区标题栏避让（13-C）', () => {
  it('无归属区：原样返回', () => {
    expect(clampContainerTop(rect(10, 5), null)).toBe(5)
    expect(clampContainerTop(rect(10, 5), undefined)).toBe(5)
  })

  it('容器顶部高于区标题栏：钳到标题栏下沿', () => {
    expect(clampContainerTop(rect(10, 5), rect(0, 100))).toBe(100 + SECTION_HEADER)
  })

  it('容器已在内容区：不改 y', () => {
    expect(clampContainerTop(rect(10, 200), rect(0, 100))).toBe(200)
  })

  it('可覆盖 header（与 contentOrigin 同口径）', () => {
    expect(clampContainerTop(rect(10, 5), rect(0, 100), 0)).toBe(100)
  })
})
