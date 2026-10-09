/**
 * 图谱布局策略纯函数（2026-10-09 图谱改进批 C）。
 *
 * 病：`fitToGraph` 写死相机 (0.5,0.5)/1.1 不看边界；FA2 scalingRatio=1（默认量级 10）散沙；
 * 缓存键不含边数。断言锚点：边界过滤/空集、拟合 ratio 取两轴较大者与 clamp、单点最小跨度、
 * 规模阈值（200/500）、缓存键随边数变化。
 */
import { describe, expect, it } from 'vitest'
import { computeBounds, computeFitCamera, fa2ConfigFor, layoutCacheKey } from '../layoutPolicy'

describe('computeBounds', () => {
  it('取坐标极值；单点 min=max', () => {
    expect(computeBounds([{ x: 1, y: 2 }, { x: -3, y: 8 }, { x: 4, y: 0 }]))
      .toEqual({ minX: -3, minY: 0, maxX: 4, maxY: 8 })
    expect(computeBounds([{ x: 5, y: 5 }])).toEqual({ minX: 5, minY: 5, maxX: 5, maxY: 5 })
  })

  it('非有限值被过滤；全无效 → null（空集同）', () => {
    expect(computeBounds([{ x: NaN, y: 1 }, { x: Infinity, y: 2 }, { x: 3, y: 4 }]))
      .toEqual({ minX: 3, minY: 4, maxX: 3, maxY: 4 })
    expect(computeBounds([{ x: NaN, y: NaN }])).toBeNull()
    expect(computeBounds([])).toBeNull()
  })
})

describe('computeFitCamera', () => {
  it('常规：取两轴较大 ratio，center 为边界中点', () => {
    // span 100×100, pad 40, viewport 1000×500 → max(180/1000, 180/500) = 0.36
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { w: 1000, h: 500 }))
      .toEqual({ x: 50, y: 50, ratio: 0.36 })
  })

  it('扁长图：横轴主导', () => {
    // span 1000×50, pad 40, viewport 1000×500 → max(1080/1000=1.08, 130/500=0.26) = 1.08
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: 1000, maxY: 50 }, { w: 1000, h: 500 }))
      .toEqual({ x: 500, y: 25, ratio: 1.08 })
  })

  it('单点：最小跨度 1 → 放大到带留白的档位', () => {
    // span 1×1, pad 40, viewport 1000×500 → max(81/1000=0.081, 81/500=0.162) = 0.162
    expect(computeFitCamera({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 1000, h: 500 }))
      .toEqual({ x: 5, y: 5, ratio: 0.162 })
  })

  it('ratio 收敛在相机档 [0.05, 10]；视口零尺寸 → null', () => {
    const huge = computeFitCamera({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, { w: 1400, h: 800 })
    expect(huge?.ratio).toBe(10)
    const tiny = computeFitCamera({ minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 }, { w: 10000, h: 10000 })
    expect(tiny?.ratio).toBe(0.05)
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { w: 0, h: 500 })).toBeNull()
  })
})

describe('fa2ConfigFor', () => {
  it('小图：150 迭代 / scalingRatio 10，不开 Barnes-Hut', () => {
    const c = fa2ConfigFor(120)
    expect(c.iterations).toBe(150)
    expect(c.settings.scalingRatio).toBe(10)
    expect(c.settings.barnesHutOptimize).toBe(false)
  })

  it('规模阈值 200（迭代/斥力档）与 500（Barnes-Hut）', () => {
    expect(fa2ConfigFor(199).iterations).toBe(150)
    expect(fa2ConfigFor(200).iterations).toBe(250)
    expect(fa2ConfigFor(200).settings.scalingRatio).toBe(14)
    expect(fa2ConfigFor(501).settings.barnesHutOptimize).toBe(true)
    expect(fa2ConfigFor(500).settings.barnesHutOptimize).toBe(false)
  })
})

describe('layoutCacheKey', () => {
  it('同图同布局同键；节点/边/布局任一变化 → 换键', () => {
    expect(layoutCacheKey(10, 20, 'forceatlas2')).toBe(layoutCacheKey(10, 20, 'forceatlas2'))
    expect(layoutCacheKey(10, 20, 'forceatlas2')).not.toBe(layoutCacheKey(10, 21, 'forceatlas2'))
    expect(layoutCacheKey(10, 20, 'forceatlas2')).not.toBe(layoutCacheKey(11, 20, 'forceatlas2'))
    expect(layoutCacheKey(10, 20, 'forceatlas2')).not.toBe(layoutCacheKey(10, 20, 'circular'))
  })
})
