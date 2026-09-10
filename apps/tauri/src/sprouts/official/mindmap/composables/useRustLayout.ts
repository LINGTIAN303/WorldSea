/**
 * Web 端 useRustLayout — 纯 JS fallback 版
 *
 * 根版为 re-export 壳（指向 apps/tauri 的 Tauri invoke 实现，自带 isTauriAvailable + 纯 JS fallback）。
 * Web 端剥离 Tauri invoke 分支，直接使用纯 JS fallback 布局（random/grid/radial）。
 * 后续如需 Rust 算法，可经 apps/web 已有的 CLI serve /api 代理中转。
 */
import type { GraphNode, GraphEdge } from '@worldsea/canvas-engine'

export interface LayoutNodeResult {
  id: string
  x: number
  y: number
}

export interface ForceLayoutConfig {
  repulsion?: number
  attraction?: number
  idealLength?: number
  damping?: number
  maxIterations?: number
  epsilon?: number
  area?: number
  gravity?: number
}

export interface RadialLayoutConfig {
  centerX?: number
  centerY?: number
  radiusStep?: number
  angleOffset?: number
  sortByDegree?: boolean
  maxPerRing?: number
}

export interface TreeLayoutConfig {
  rootId: string
  direction?: 'topToBottom' | 'leftToRight'
  nodeWidth?: number
  nodeHeight?: number
  horizontalGap?: number
  verticalGap?: number
  startX?: number
  startY?: number
}

export interface GridLayoutConfig {
  columns?: number
  cellWidth?: number
  cellHeight?: number
  startX?: number
  startY?: number
  sortBy?: 'name' | 'degree' | 'type' | 'none'
}

export type LayoutType = 'force' | 'radial' | 'tree' | 'grid' | 'mindmapTree'

export function useRustLayout() {
  /** Web 端无 Tauri invoke，恒走纯 JS fallback */
  function isTauriAvailable(): boolean {
    return false
  }

  async function applyLayout(
    type: LayoutType,
    nodes: GraphNode[],
    edges: GraphEdge[],
    config?: Record<string, unknown>,
  ): Promise<LayoutNodeResult[]> {
    return fallbackLayout(type, nodes, edges, config)
  }

  return { applyLayout, isTauriAvailable }
}

// ==========================================================================
// Fallback: 纯 JS 布局（Tauri 不可用时的降级，与原实现一致）
// ==========================================================================

function fallbackLayout(
  type: LayoutType,
  nodes: GraphNode[],
  _edges: GraphEdge[],
  _config?: Record<string, unknown>,
): LayoutNodeResult[] {
  const n = nodes.length
  if (n === 0) return []

  switch (type) {
    case 'grid':
      return gridFallback(nodes)
    case 'radial':
      return radialFallback(nodes)
    case 'tree':
    case 'mindmapTree':
      return radialFallback(nodes) // tree/mindmap fallback = radial
    case 'force':
    default:
      return randomFallback(nodes)
  }
}

function randomFallback(nodes: GraphNode[]): LayoutNodeResult[] {
  return nodes.map(n => ({
    id: n.id,
    x: 400 + (Math.random() - 0.5) * 600,
    y: 300 + (Math.random() - 0.5) * 400,
  }))
}

function gridFallback(nodes: GraphNode[]): LayoutNodeResult[] {
  const cols = Math.ceil(Math.sqrt(nodes.length))
  return nodes.map((n, i) => ({
    id: n.id,
    x: 40 + (i % cols) * 180 + 90,
    y: 40 + Math.floor(i / cols) * 100 + 50,
  }))
}

function radialFallback(nodes: GraphNode[]): LayoutNodeResult[] {
  const perRing = Math.ceil(Math.sqrt(nodes.length))
  return nodes.map((n, i) => {
    const ring = Math.floor(i / perRing)
    const posInRing = i % perRing
    const countInRing = Math.min(perRing, nodes.length - ring * perRing)
    const angle = -Math.PI / 2 + 2 * Math.PI * posInRing / countInRing
    const radius = 120 * (ring + 1)
    return {
      id: n.id,
      x: 400 + Math.cos(angle) * radius,
      y: 300 + Math.sin(angle) * radius,
    }
  })
}
