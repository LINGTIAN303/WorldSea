import { describe, it, expect } from 'vitest'
import {
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  createDefaultViewport,
  parseViewport,
  serializeViewport,
  worldToScreen,
  screenToWorld,
  zoomAt,
  zoomStepFromWheel,
  guideLinesOf,
  snapToGuides,
  snapToGrid,
  rectsOverlap,
  pointInRect,
  contentBounds,
  fitViewport,
  type Rect,
  type Viewport,
} from '../board/boardGeometry'

function rect(x: number, y: number, w = 100, h = 40): Rect {
  return { x, y, w, h }
}

describe('boardGeometry / 坐标换算', () => {
  const vps: Viewport[] = [
    { zoom: 1, panX: 0, panY: 0 },
    { zoom: 1.5, panX: -120, panY: 64 },
    { zoom: 0.4, panX: 33, panY: -19 },
  ]

  it('world → screen → world 互逆', () => {
    for (const vp of vps) {
      const p = { x: 137, y: -42 }
      const back = screenToWorld(worldToScreen(p, vp), vp)
      expect(back.x).toBeCloseTo(p.x, 6)
      expect(back.y).toBeCloseTo(p.y, 6)
    }
  })

  it('zoom 为 0 时不产生 NaN（防御）', () => {
    const out = screenToWorld({ x: 10, y: 10 }, { zoom: 0, panX: 0, panY: 0 })
    expect(Number.isFinite(out.x)).toBe(true)
    expect(Number.isFinite(out.y)).toBe(true)
  })
})

describe('boardGeometry / 缩放', () => {
  it('clampZoom 夹在 0.2–2.5，并对非法值回退 1', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it('zoomAt 保持锚点处的世界坐标映射到同一屏幕点', () => {
    const vp: Viewport = { zoom: 1, panX: 40, panY: 20 }
    const anchor = { x: 300, y: 180 }
    const worldBefore = screenToWorld(anchor, vp)
    const next = zoomAt(vp, 1.8, anchor)
    const screenAfter = worldToScreen(worldBefore, next)
    expect(screenAfter.x).toBeCloseTo(anchor.x, 6)
    expect(screenAfter.y).toBeCloseTo(anchor.y, 6)
  })

  it('zoomStepFromWheel：上滚放大、下滚缩小，且受范围夹取', () => {
    expect(zoomStepFromWheel(1, -1)).toBeCloseTo(1.1, 6)
    expect(zoomStepFromWheel(1, 1)).toBeCloseTo(0.9, 6)
    expect(zoomStepFromWheel(MAX_ZOOM, -1)).toBe(MAX_ZOOM)
    expect(zoomStepFromWheel(MIN_ZOOM, 1)).toBe(MIN_ZOOM)
  })
})

describe('boardGeometry / 辅助线吸附', () => {
  it('guideLinesOf 给出左中右 / 上中下', () => {
    const g = guideLinesOf(rect(10, 20, 100, 40))
    expect(g.vertical).toEqual([10, 60, 110])
    expect(g.horizontal).toEqual([20, 40, 60])
  })

  it('阈值内吸附到最近的对齐线并给出辅助线', () => {
    const moving = rect(103, 0, 100, 40) // 左边线 103，与 others 的 100 差 3 < 6
    const others = [rect(100, 200, 100, 40)]
    const res = snapToGuides(moving, others)
    expect(res.dx).toBeCloseTo(-3, 6)
    expect(res.verticalGuides).toEqual([100])
  })

  it('超出阈值不吸附', () => {
    const res = snapToGuides(rect(140, 0, 100, 40), [rect(100, 200, 100, 40)])
    expect(res.dx).toBe(0)
    expect(res.verticalGuides).toEqual([])
  })

  it('横向同理（上边线吸附）', () => {
    const res = snapToGuides(rect(0, 204, 100, 40), [rect(300, 200, 100, 40)])
    expect(res.dy).toBeCloseTo(-4, 6)
    expect(res.horizontalGuides).toEqual([200])
  })

  it('阈值按 zoom 换算：放大后世界阈值变小（屏幕手感一致）', () => {
    const moving = rect(104, 0, 100, 40)
    const others = [rect(100, 200, 100, 40)]
    // zoom = 2 时，世界阈值 = 6 / 2 = 3，差值 4 超出 → 不吸附
    expect(snapToGuides(moving, others, 2).dx).toBe(0)
    // zoom = 1 时差值 4 在阈值内 → 吸附
    expect(snapToGuides(moving, others, 1).dx).toBeCloseTo(-4, 6)
  })

  it('无其他容器时不吸附', () => {
    expect(snapToGuides(rect(0, 0), [])).toEqual({
      dx: 0, dy: 0, verticalGuides: [], horizontalGuides: [],
    })
  })

  it('多候选时取最近的一条', () => {
    const res = snapToGuides(rect(103, 0, 100, 40), [rect(100, 0, 100, 40), rect(101, 300, 100, 40)])
    expect(res.dx).toBeCloseTo(-2, 6)
    expect(res.verticalGuides).toEqual([101])
  })
})

describe('boardGeometry / 网格与命中', () => {
  it('snapToGrid 就近取整', () => {
    expect(snapToGrid({ x: 18, y: 22 }, 20)).toEqual({ x: 20, y: 20 })
    expect(snapToGrid({ x: 18, y: 22 }, 0)).toEqual({ x: 18, y: 22 })
  })

  it('rectsOverlap 与 pointInRect', () => {
    expect(rectsOverlap(rect(0, 0), rect(50, 20))).toBe(true)
    expect(rectsOverlap(rect(0, 0), rect(200, 200))).toBe(false)
    expect(pointInRect({ x: 10, y: 10 }, rect(0, 0))).toBe(true)
    expect(pointInRect({ x: -1, y: 10 }, rect(0, 0))).toBe(false)
  })
})

describe('boardGeometry / 适配全部', () => {
  it('contentBounds 聚合包围盒，空输入返回 null', () => {
    expect(contentBounds([])).toBeNull()
    expect(contentBounds([rect(10, 10, 100, 40), rect(200, 60, 50, 50)]))
      .toEqual({ x: 10, y: 10, w: 240, h: 100 })
  })

  it('fitViewport 居中且受缩放范围夹取', () => {
    const vp = fitViewport(rect(0, 0, 200, 100), { w: 800, h: 600 }, 40)
    // 可用区 720x520 → 最小比例 3.6 / 5.2 → 3.6，但被夹到 MAX_ZOOM
    expect(vp.zoom).toBe(MAX_ZOOM)
    // 中心（100,50）映射到视口中心（400,300）
    const screen = worldToScreen({ x: 100, y: 50 }, vp)
    expect(screen.x).toBeCloseTo(400, 6)
    expect(screen.y).toBeCloseTo(300, 6)
  })

  it('fitViewport 内容为空时回到初始视口', () => {
    expect(fitViewport(null, { w: 800, h: 600 })).toEqual({ zoom: 1, panX: 0, panY: 0 })
  })

  it('fitViewport 对极扁内容不放大超过上限，也不低于下限', () => {
    const wide = fitViewport(rect(0, 0, 10000, 10), { w: 800, h: 600 }, 40)
    expect(wide.zoom).toBeGreaterThanOrEqual(MIN_ZOOM)
    expect(wide.zoom).toBeLessThanOrEqual(MAX_ZOOM)
  })
})

describe('boardGeometry / 视口解析与序列化', () => {
  it('坏输入一律回退默认视口且不抛错', () => {
    for (const bad of ['', '   ', '{oops', 'null', 42, [], null, undefined]) {
      expect(parseViewport(bad)).toEqual(createDefaultViewport())
    }
  })

  it('字段缺失/非法时逐项回退（zoom 夹取，pan 归 0）', () => {
    expect(parseViewport('{"zoom":99,"panX":"x"}')).toEqual({ zoom: MAX_ZOOM, panX: 0, panY: 0 })
    expect(parseViewport('{"zoom":0.01}')).toEqual({ zoom: MIN_ZOOM, panX: 0, panY: 0 })
    expect(parseViewport({ zoom: 1.5, panX: -20, panY: 30 })).toEqual({ zoom: 1.5, panX: -20, panY: 30 })
  })

  it('序列化后解析可无损往返（zoom 被夹取后再往返稳定）', () => {
    const vp: Viewport = { zoom: 1.25, panX: -33.5, panY: 12 }
    const round = parseViewport(serializeViewport(vp))
    expect(round.zoom).toBeCloseTo(vp.zoom, 6)
    expect(round.panX).toBeCloseTo(vp.panX, 6)
    expect(round.panY).toBeCloseTo(vp.panY, 6)
  })

  it('超范围 zoom 在序列化时即被夹取', () => {
    expect(JSON.parse(serializeViewport({ zoom: 99, panX: 0, panY: 0 })).zoom).toBe(MAX_ZOOM)
  })
})
