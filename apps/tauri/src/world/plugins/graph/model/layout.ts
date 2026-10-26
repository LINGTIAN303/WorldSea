/**
 * 总览布局策略（2026-10-26 重构）。
 *
 * 核心不是「全图力导向」，而是两级预计算：
 * 1) 关系核心：d3-force 小规模布局，节点按度数参与碰撞半径；
 * 2) 类型星座：孤立实体按类型成圆盘（叶序排布），再由环形打包算法摆在核心外围。
 * 位置直接写进 G6 数据，G6 不做二次布局——这保证每次打开世界地图位置稳定。
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force'
import type { GroupLayout, Overview, OverviewLayout, Point } from './types'

export interface OverviewLayoutOptions {
  /** 星座内节点间距（px） */
  spacing?: number
  /** 星座之间 / 星座与核心之间的留白 */
  gap?: number
  /** 核心目标半径；缺省按核心节点数推导 */
  coreTargetRadius?: number
}

interface SimNode extends SimulationNodeDatum {
  id: string
  r: number
  x: number
  y: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string
  target: string
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const DEFAULT_SPACING = 18
const DEFAULT_GAP = 40
/** 星座圆盘外再留一圈：节点尺寸 + 气泡 padding + 标签高度 */
const ISLAND_VISUAL_PAD = 20

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function nodeRadius(degree: number): number {
  return 6 + Math.sqrt(Math.max(0, degree)) * 2
}

/** 星座圆盘半径：保持节点平均间距 ≈ spacing 的叶序圆盘 */
export function islandRadius(count: number, spacing: number = DEFAULT_SPACING): number {
  if (count <= 0) return 0
  return Math.max(24, spacing * Math.sqrt(count / Math.PI))
}

/** 叶序圆盘：第 i 个点落在半径 r_i 的黄金角螺旋上 */
export function phyllotaxis(index: number, count: number, radius: number): Point {
  if (count <= 1) return { x: 0, y: 0 }
  const r = radius * Math.sqrt((index + 0.5) / count)
  const theta = index * GOLDEN_ANGLE
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r }
}

/** 环形打包：给定一圈圆盘的半径，求不重叠的环半径 */
export function solveRingRadius(radii: number[], gap: number = DEFAULT_GAP): number {
  if (radii.length === 0) return 0
  const maxR = Math.max(...radii)
  let ringRadius = maxR * 1.35 + gap
  for (let i = 0; i < 80; i++) {
    const occupied = radii.reduce(
      (sum, r) => sum + 2 * Math.asin(Math.min(1, (r + gap / 2) / ringRadius)),
      0,
    )
    if (occupied <= Math.PI * 2 - 0.04) return ringRadius
    ringRadius *= 1.06
  }
  return ringRadius
}

function layoutCore(overview: Overview, options: OverviewLayoutOptions): {
  positions: Record<string, Point>
  layout: GroupLayout | null
} {
  const core = overview.groups.find(g => g.kind === 'core')
  if (!core || core.count === 0) return { positions: {}, layout: null }

  const coreNodeIds = new Set(core.nodeIds)
  const nodeMap = new Map(overview.nodes.map(n => [n.id, n]))
  const count = core.nodeIds.length
  const simNodes: SimNode[] = core.nodeIds.map((id, index) => {
    const node = nodeMap.get(id)
    const angle = (index / Math.max(1, count)) * Math.PI * 2
    const startRadius = 30 + (index % 7) * 8
    return {
      id,
      r: nodeRadius(node?.degree ?? 0),
      x: Math.cos(angle) * startRadius,
      y: Math.sin(angle) * startRadius,
    }
  })
  const simLinks: SimLink[] = overview.edges
    .filter(e => coreNodeIds.has(e.source) && coreNodeIds.has(e.target))
    .map(e => ({ source: e.source, target: e.target }))

  const simulation = forceSimulation<SimNode>(simNodes)
    .force('link', forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(70).strength(0.75))
    .force('charge', forceManyBody<SimNode>().strength(-180))
    .force('collide', forceCollide<SimNode>(d => d.r + 8))
    .force('center', forceCenter(0, 0))
    .stop()

  for (let i = 0; i < 260; i++) simulation.tick()

  const targetRadius = options.coreTargetRadius ?? clamp(120, 80 + Math.sqrt(count) * 38, 380)
  let extent = 0
  for (const node of simNodes) {
    extent = Math.max(extent, Math.hypot(node.x, node.y) + node.r)
  }
  const scale = targetRadius / Math.max(1, extent)

  const positions: Record<string, Point> = {}
  let maxRadius = 0
  for (const node of simNodes) {
    positions[node.id] = { x: node.x * scale, y: node.y * scale }
    maxRadius = Math.max(maxRadius, node.r * scale)
  }

  let groupRadius = 24
  for (const node of simNodes) {
    const p = positions[node.id]
    groupRadius = Math.max(groupRadius, Math.hypot(p.x, p.y) + maxRadius)
  }
  groupRadius += 36

  return {
    positions,
    layout: {
      id: core.id,
      kind: 'core',
      type: null,
      x: 0,
      y: 0,
      radius: groupRadius,
    },
  }
}

function layoutIslands(
  overview: Overview,
  options: OverviewLayoutOptions,
  coreRadius: number,
): {
  positions: Record<string, Point>
  layouts: GroupLayout[]
} {
  const islands = overview.groups.filter(g => g.kind === 'island')
  if (islands.length === 0) return { positions: {}, layouts: [] }

  const spacing = options.spacing ?? DEFAULT_SPACING
  const gap = options.gap ?? DEFAULT_GAP
  const discRadii = islands.map(g => islandRadius(g.count, spacing))
  // 打包用「视觉半径」而不是纯圆盘半径：节点尺寸、气泡 padding、标签都要算进去，
  // 否则大星座会与核心/邻座相互压边。
  const radii = discRadii.map(radius => radius + ISLAND_VISUAL_PAD)
  const ringCount = islands.length <= 4 ? 1 : islands.length <= 9 ? 2 : 3

  // 轮转分环：大星座与小星座均匀混排，避免某一环被超大圆盘撑爆
  const ringBuckets: number[][] = Array.from({ length: ringCount }, () => [])
  islands.forEach((_, index) => ringBuckets[index % ringCount].push(index))

  const ringRadii: number[] = []
  const ringMaxRadius: number[] = []
  for (let ring = 0; ring < ringCount; ring++) {
    const bucket = ringBuckets[ring]
    if (bucket.length === 0) {
      ringRadii.push(0)
      ringMaxRadius.push(0)
      continue
    }
    const bucketRadii = bucket.map(i => radii[i])
    ringMaxRadius.push(Math.max(...bucketRadii))
    const solved = solveRingRadius(bucketRadii, gap)
    const minRadius = ring === 0
      ? coreRadius + ringMaxRadius[0] + gap
      : ringRadii[ring - 1] + ringMaxRadius[ring - 1] + ringMaxRadius[ring] + gap
    ringRadii.push(Math.max(solved, minRadius))
  }

  const positions: Record<string, Point> = {}
  const layouts: GroupLayout[] = []

  for (let ring = 0; ring < ringCount; ring++) {
    const bucket = ringBuckets[ring]
    if (bucket.length === 0) continue
    const R = ringRadii[ring]
    const widths = bucket.map(i => 2 * Math.asin(Math.min(1, (radii[i] + gap / 2) / R)))
    const total = widths.reduce((sum, width) => sum + width, 0)
    const extraPerSlot = Math.max(0, Math.PI * 2 - total) / bucket.length
    const startAngle = -Math.PI / 2 + ring * 0.42

    let cursor = 0
    for (let slot = 0; slot < bucket.length; slot++) {
      const islandIndex = bucket[slot]
      const island = islands[islandIndex]
      const width = widths[slot]
      const angle = startAngle + cursor + width / 2 + extraPerSlot * slot
      cursor += width
      const cx = Math.cos(angle) * R
      const cy = Math.sin(angle) * R
      const discRadius = discRadii[islandIndex]

      island.nodeIds.forEach((nodeId, nodeIndex) => {
        const point = phyllotaxis(nodeIndex, island.count, discRadius)
        positions[nodeId] = { x: cx + point.x, y: cy + point.y }
      })

      layouts.push({
        id: island.id,
        kind: 'island',
        type: island.type,
        x: cx,
        y: cy,
        radius: radii[islandIndex],
      })
    }
  }

  return { positions, layouts }
}

export function layoutOverview(
  overview: Overview,
  options: OverviewLayoutOptions = {},
): OverviewLayout {
  const core = layoutCore(overview, options)
  const islands = layoutIslands(overview, options, core.layout?.radius ?? 0)

  const positions = { ...core.positions, ...islands.positions }
  const groups: Record<string, GroupLayout> = {}
  if (core.layout) groups[core.layout.id] = core.layout
  for (const layout of islands.layouts) groups[layout.id] = layout

  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  let hasPoint = false
  for (const node of overview.nodes) {
    const point = positions[node.id]
    if (!point) continue
    const r = nodeRadius(node.degree)
    if (!hasPoint) {
      minX = point.x - r
      minY = point.y - r
      maxX = point.x + r
      maxY = point.y + r
      hasPoint = true
    } else {
      minX = Math.min(minX, point.x - r)
      minY = Math.min(minY, point.y - r)
      maxX = Math.max(maxX, point.x + r)
      maxY = Math.max(maxY, point.y + r)
    }
  }
  for (const group of Object.values(groups)) {
    minX = Math.min(minX, group.x - group.radius)
    minY = Math.min(minY, group.y - group.radius)
    maxX = Math.max(maxX, group.x + group.radius)
    maxY = Math.max(maxY, group.y + group.radius)
  }

  return {
    positions,
    groups,
    bounds: hasPoint ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  }
}
