/**
 * 图谱布局策略纯函数（2026-10-09 图谱改进批 C；fit 语义于批 C 回归修复后订正）。
 *
 * 病：`fitToGraph` 写死相机 (0.5,0.5)/1.1 不看边界（后证其**方向本就正确**——sigma 相机态在
 * 图归一化帧 [0,1]²，全图拟合中心恒 (0.5, 0.5)）；批 C 误按原始坐标算中心 → 力导向布局
 * 相机飞出图外（空画布回归），本件锚点锁定归一化语义。断言锚点：边界过滤/空集、
 * 拟合中心恒 0.5 与像素留白、NaN 边界 → null、规模阈值（200/500）、缓存键随边数变化。
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
  it('全图拟合：中心恒 (0.5, 0.5)（sigma 相机＝图归一化帧），ratio＝1+屏幕像素留白', () => {
    // viewport 1000×500, padding 40 → ratio = 1 + 80/500 = 1.16
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { w: 1000, h: 500 }))
      .toEqual({ x: 0.5, y: 0.5, ratio: 1.16 })
  })

  it('bounds 形状与位置不影响相机（全图恒映射单位方框）——批 C 回归锚点', () => {
    const flat = computeFitCamera({ minX: 0, minY: 0, maxX: 1000, maxY: 50 }, { w: 1000, h: 500 })
    const shifted = computeFitCamera({ minX: -288, minY: -283, maxX: 352, maxY: 355 }, { w: 1000, h: 500 })
    const single = computeFitCamera({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, { w: 1000, h: 500 })
    expect(flat).toEqual({ x: 0.5, y: 0.5, ratio: 1.16 })
    expect(shifted).toEqual({ x: 0.5, y: 0.5, ratio: 1.16 })
    expect(single).toEqual({ x: 0.5, y: 0.5, ratio: 1.16 })
  })

  it('留白按短边：viewport 800×400 → 1.2', () => {
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, { w: 800, h: 400 })?.ratio).toBe(1.2)
  })

  it('NaN 边界 → null（不动相机）；视口零尺寸 → null', () => {
    expect(computeFitCamera({ minX: NaN, minY: 0, maxX: 1, maxY: 1 }, { w: 1000, h: 500 })).toBeNull()
    expect(computeFitCamera({ minX: 0, minY: 0, maxX: Infinity, maxY: 1 }, { w: 1000, h: 500 })).toBeNull()
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
