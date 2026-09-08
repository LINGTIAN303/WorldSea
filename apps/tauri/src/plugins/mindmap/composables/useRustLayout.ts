/**
 * 本文件于 Phase 3 从 src/plugins/official/mindmap/composables/useRustLayout.ts 迁移到 apps/tauri/src/plugins/mindmap/composables/useRustLayout.ts
 * 端分离：Tauri 端专用（依赖 @tauri-apps/api）
 */

/**
 * Rust 布局算法桥接
 *
 * 将前端 GraphNode/GraphEdge 数据序列化为 WeightedGraph JSON，
 * 通过 Tauri invoke 调用 worldsea-core 的布局算法。
 * Web 环境下回退到 d3-force 纯 JS 实现。
 */
import { invoke, isHttpBackend } from '../../../agent/composables/transport'
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

let _tauriAvailable: boolean | null = null

function isTauriAvailable(): boolean {
  if (_tauriAvailable !== null) return _tauriAvailable
  try {
    // 桌面 Tauri 或 HTTP 桥（浏览器 preview）都走真实 Rust 命令
    _tauriAvailable = !!window.__TAURI_INTERNALS__ || !!window.__TAURI__ || isHttpBackend()
  } catch {
    _tauriAvailable = false
  }
  return _tauriAvailable
}

function buildWeightedGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Record<string, unknown> {
  const adjacency: Record<string, Array<{ target: string; weight: number; label?: string }>> = {}

  for (const n of nodes) {
    adjacency[n.id] = []
  }

  for (const e of edges) {
    if (!adjacency[e.source]) adjacency[e.source] = []
    if (!adjacency[e.target]) adjacency[e.target] = []

    adjacency[e.source].push({
      target: e.target,
      weight: 1,
      label: e.relLabel,
    })

    // 双向边转无向
    if (e.bidirectional || e.symmetric) {
      adjacency[e.target].push({
        target: e.source,
        weight: 1,
        label: e.relLabel,
      })
    }
  }

  return { adjacency }
}

export function useRustLayout() {
  async function applyLayout(
    type: LayoutType,
    nodes: GraphNode[],
    edges: GraphEdge[],
    config?: Record<string, unknown>,
  ): Promise<LayoutNodeResult[]> {
    if (!isTauriAvailable()) {
      return fallbackLayout(type, nodes, edges, config)
    }

    const graph = buildWeightedGraph(nodes, edges)
    const graphJson = JSON.stringify(graph)

    try {
      let result: any

      switch (type) {
        case 'force': {
          const cfg = {
            repulsion: 1000, attraction: 0.01, idealLength: 100,
            damping: 0.9, maxIterations: 300, epsilon: 1.0,
            area: 10000, gravity: 0.1, ...config,
          }
          result = await invoke('cmd_algo_force_layout', {
            graphJson,
            configJson: config ? JSON.stringify(cfg) : null,
          })
          return (result as any).nodes.map((n: any) => ({
            id: n.id, x: n.x, y: n.y,
          }))
        }

        case 'radial': {
          const cfg = {
            centerX: 400, centerY: 300, radiusStep: 120,
            angleOffset: -Math.PI / 2, sortByDegree: true,
            maxPerRing: 0, ...config,
          }
          result = await invoke('cmd_algo_radial_layout', {
            graphJson,
            configJson: JSON.stringify(cfg),
          })
          return (result as any).map((n: any) => ({
            id: n.id, x: n.x, y: n.y,
          }))
        }

        case 'tree': {
          if (!config?.rootId) throw new Error('Tree layout requires rootId')
          const cfg = {
            rootId: config.rootId,
            direction: 'topToBottom',
            nodeWidth: 160, nodeHeight: 60,
            horizontalGap: 40, verticalGap: 80,
            startX: 40, startY: 40, ...config,
          }
          result = await invoke('cmd_algo_tree_layout', {
            graphJson,
            configJson: JSON.stringify(cfg),
          })
          return (result as any).map((n: any) => ({
            id: n.id, x: n.x, y: n.y,
          }))
        }

        case 'grid': {
          const cfg = {
            columns: 0, cellWidth: 180, cellHeight: 100,
            startX: 40, startY: 40, sortBy: 'name', ...config,
          }
          result = await invoke('cmd_algo_grid_layout', {
            graphJson,
            configJson: JSON.stringify(cfg),
          })
          return (result as any).map((n: any) => ({
            id: n.id, x: n.x, y: n.y,
          }))
        }

        case 'mindmapTree': {
          const cfg = {
            centerId: config?.centerId || '',
            centerX: 400, centerY: 300, radiusStep: 140,
            minSectorAngle: 0.15, angleOffset: -Math.PI / 2,
            maxDepth: 10, ...config,
          }
          // 使用统一命令，传 MindmapTree variant
          const algorithm = { MindmapTree: cfg }
          result = await invoke('cmd_algo_layout_unified', {
            graphJson,
            algorithmJson: JSON.stringify(algorithm),
          })
          return (result as any).nodes.map((n: any) => ({
            id: n.id, x: n.x, y: n.y,
          }))
        }
      }
    } catch (err) {
      console.warn('[useRustLayout] Tauri invoke failed, using fallback:', err)
      return fallbackLayout(type, nodes, edges, config)
    }

    return []
  }

  return { applyLayout, isTauriAvailable }
}

// ==========================================================================
// Fallback: 纯 JS 布局（当 Tauri 不可用时）
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
