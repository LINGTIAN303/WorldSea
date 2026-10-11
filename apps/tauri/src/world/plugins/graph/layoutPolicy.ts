/**
 * 图谱布局策略纯函数（2026-10-09 图谱改进批 C）。
 *
 * 病（批 A 探查实录）：`fitToGraph` 不看边界——写死飞相机 (0.5, 0.5)/ratio 1.1；
 * FA2 参数 `scalingRatio: 1`（比库默认 10 弱一个量级）+ 100 迭代 → 散沙观感；
 * 布局缓存只认节点集合（节点不变、边变则复用旧位）。
 * 本件收「边界计算 → 相机拟合」「按规模取 FA2 参数」「缓存键含边数」三件纯函数；
 * 实际相机/worker 接线在 `useGraphLayout`（WebGL 无自动化手段，策略直测 + 变异）。
 */

export interface GraphBounds { minX: number; minY: number; maxX: number; maxY: number }

/** 节点坐标边界（过滤非有限值）；无有效点 → null */
export function computeBounds(points: Array<{ x: number; y: number }>): GraphBounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    any = true
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return any ? { minX, minY, maxX, maxY } : null
}

/**
 * 拟合相机状态（sigma `camera.animate` 入参）。**关键语义（批 C 回归修复，2026-10-09）**：
 * sigma 相机坐标系是**图归一化帧 [0,1]²**——全图恒映射单位方框，故「全图拟合」中心恒 (0.5, 0.5)
 * （旧代码写死 (0.5, 0.5, 1.1) 恒正确即此因）；ratio=1 即全图恰好入画，留白只按屏幕像素算。
 * 病：批 C 误按**原始坐标**计算（bbox 中心如 (32, 35.8) 直接当相机 xy）→ 力导向布局相机
 * 飞出图外数十个箱位 → 空画布（圆圈布局因 bbox 中心恰 ≈(0.5, 0.5) 而侥幸可见）。
 * `bounds` 此处仅作有效性校验（有限值/非退化）；NaN 边界 → null（调用方不动相机）。
 */
export function computeFitCamera(
  bounds: GraphBounds,
  viewport: { w: number; h: number },
  padding: number = 40,
): { x: number; y: number; ratio: number } | null {
  if (viewport.w <= 0 || viewport.h <= 0) return null
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) return null
  const ratio = 1 + (2 * padding) / Math.min(viewport.w, viewport.h)
  return { x: 0.5, y: 0.5, ratio }
}

export interface Fa2Config {
  iterations: number
  settings: {
    gravity: number
    scalingRatio: number
    slowDown: number
    barnesHutOptimize: boolean
    adjustSizes: boolean
  }
}

/** 按规模取 FA2 参数（批 C 重调：scalingRatio 1→10/14 恢复库默认量级，迭代 100→150/250） */
export function fa2ConfigFor(nodeCount: number): Fa2Config {
  const large = nodeCount >= 200
  return {
    iterations: large ? 250 : 150,
    settings: {
      gravity: 1,
      scalingRatio: large ? 14 : 10,
      slowDown: 1.5,
      barnesHutOptimize: nodeCount > 500,
      adjustSizes: false,
    },
  }
}

/** 布局缓存键（批 C：含边数——节点集合不变、边变则旧位失效；TTL 仍在 store 侧 30min） */
export function layoutCacheKey(nodeCount: number, edgeCount: number, layout: string): string {
  return `${layout}:${nodeCount}:${edgeCount}`
}
