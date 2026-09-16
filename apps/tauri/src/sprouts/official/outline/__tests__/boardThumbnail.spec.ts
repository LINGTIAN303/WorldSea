/**
 * boardThumbnail 单测 —— 缩略图几何纯函数 + 无 canvas 环境容错。
 *
 * 【为什么这样测】白板缩略图是「按布局体绘制的结构示意图」（board/thumbnail.ts 模块注释），
 * 几何计算是它的全部可验证逻辑；真正的 canvas 绘制在 jsdom 里没有 2d context
 * （除非引入 canvas 包），故只断言「返回空串且不抛错」这一容错契约，绘制效果进真机走查。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  THUMB_PADDING,
  THUMB_SIZE,
  computeThumbnailGeometry,
  renderBoardThumbnail,
} from '../board/thumbnail'
import type { OutlineBoardLayout } from '../board/layoutSchema'

function layout(over: Partial<OutlineBoardLayout> = {}): OutlineBoardLayout {
  return { version: 1, sections: [], containers: [], ...over }
}

function container(id: string, x: number, y: number, w = 200, h = 80) {
  return { id, nodeId: `n-${id}`, pos: { x, y }, size: { w, h }, components: [] }
}

function section(id: string, x: number, y: number, w: number, h: number) {
  return { id, rect: { x, y, w, h }, arrange: 'free' as const, order: 1 }
}

describe('thumbnail / 几何计算', () => {
  it('空板返回两组空数组（调用方画空底色）', () => {
    expect(computeThumbnailGeometry(layout())).toEqual({ sections: [], containers: [] })
  })

  it('单容器：等比缩放并留出内边距', () => {
    const r = computeThumbnailGeometry(layout({ containers: [container('a', 0, 0, 100, 100)] }))
    expect(r.containers).toHaveLength(1)
    const box = r.containers[0]
    // 内容 100×100 放进 120×90（padding 6）→ 可用 108×78 → scale=0.78 → 78×78
    expect(box.w).toBeCloseTo(78, 5)
    expect(box.h).toBeCloseTo(78, 5)
    // 居中：x 左右各留 (108-78)/2 = 15 → 6+15=21
    expect(box.x).toBeCloseTo(21, 5)
    expect(box.y).toBeCloseTo(6, 5)
  })

  it('区与容器共同参与包围盒（与「适配全部」同口径）', () => {
    const r = computeThumbnailGeometry(layout({
      sections: [section('s1', 0, 0, 400, 300)],
      containers: [container('a', 100, 100, 100, 60)],
    }))
    expect(r.sections).toHaveLength(1)
    expect(r.containers).toHaveLength(1)
    // 全部落进画布区（不越界）
    for (const box of [...r.sections, ...r.containers]) {
      expect(box.x).toBeGreaterThanOrEqual(THUMB_PADDING - 0.001)
      expect(box.y).toBeGreaterThanOrEqual(THUMB_PADDING - 0.001)
      expect(box.x + box.w).toBeLessThanOrEqual(THUMB_SIZE.w - THUMB_PADDING + 0.001)
      expect(box.y + box.h).toBeLessThanOrEqual(THUMB_SIZE.h - THUMB_PADDING + 0.001)
    }
  })

  it('极扁内容不拉伸变形（宽高按同一比例缩放）', () => {
    const r = computeThumbnailGeometry(layout({
      containers: [container('a', 0, 0, 1000, 10)],
    }))
    const box = r.containers[0]
    expect(box.w / 1000).toBeCloseTo(box.h / 10, 6)
  })

  it('负坐标内容亦正确投影（内容不全在第一象限）', () => {
    const r = computeThumbnailGeometry(layout({
      containers: [container('a', -500, -500, 100, 100), container('b', 0, 0, 100, 100)],
    }))
    // 包围盒 600×600 → 两个容器应各占一半、且均在画布内
    const [a, b] = r.containers
    expect(a.x).toBeLessThan(b.x)
    expect(a.y).toBeLessThan(b.y)
    expect(b.x + b.w).toBeLessThanOrEqual(THUMB_SIZE.w - THUMB_PADDING + 0.001)
  })

  it('极小容器保底 1px（缩略图尺度下不消失）', () => {
    const r = computeThumbnailGeometry(layout({
      containers: [container('tiny', 0, 0, 1, 1), container('big', 0, 0, 5000, 5000)],
    }))
    expect(r.containers[0].w).toBeGreaterThanOrEqual(1)
    expect(r.containers[0].h).toBeGreaterThanOrEqual(1)
  })

  it('自定义尺寸与内边距生效（可复用于其它展示位）', () => {
    const r = computeThumbnailGeometry(layout({ containers: [container('a', 0, 0)] }), { w: 60, h: 60 }, 0)
    const box = r.containers[0]
    // 200×80 → 可用 60×60 → scale=0.3 → 60×24
    expect(box.w).toBeCloseTo(60, 5)
    expect(box.h).toBeCloseTo(24, 5)
  })
})

describe('thumbnail / 渲染容错与绘制路径', () => {
  /**
   * jsdom 未实现 canvas：直接调 getContext 会走 jsdom 的 not-implemented 分支
   * （抛错并打印告警）。这里用桩替换，既避免噪音，也能验证「无 context → 空串」的容错契约。
   */
  function stubContext(ctx: unknown): void {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('无 2d context（jsdom / 环境受限）→ 返回空串且不抛错', () => {
    stubContext(null)
    expect(renderBoardThumbnail(layout({ containers: [container('a', 0, 0)] }))).toBe('')
  })

  it('有 context 时按结构绘制并返回 dataURL（区虚线 + 容器实心）', () => {
    const calls: string[] = []
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      globalAlpha: 1,
      setLineDash: (d: number[]) => calls.push(`dash:${d.length}`),
      fillRect: () => calls.push('fillRect'),
      strokeRect: () => calls.push('strokeRect'),
    }
    stubContext(ctx)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,STUB')

    const url = renderBoardThumbnail(layout({
      sections: [section('s1', 0, 0, 400, 300)],
      containers: [container('a', 100, 100)],
    }))

    expect(url).toBe('data:image/jpeg;base64,STUB')
    // 底色一次 + 容器一次
    expect(calls.filter(c => c === 'fillRect')).toHaveLength(2)
    expect(calls).toContain('strokeRect') // 区
    expect(calls).toContain('dash:2') // 虚线
  })

  it('toDataURL 抛错（安全策略等）→ 仍返回空串，不影响退出流程', () => {
    stubContext({
      fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
      setLineDash: () => {}, fillRect: () => {}, strokeRect: () => {},
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
      throw new Error('tainted canvas')
    })
    expect(() => renderBoardThumbnail(layout({ containers: [container('a', 0, 0)] }))).not.toThrow()
    expect(renderBoardThumbnail(layout({ containers: [container('a', 0, 0)] }))).toBe('')
  })

  it('空布局同样不抛错（空板缩略图＝纯底色）', () => {
    stubContext(null)
    expect(() => renderBoardThumbnail(layout())).not.toThrow()
  })
})
