import { ref } from 'vue'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import circular from 'graphology-layout/circular'
import random from 'graphology-layout/random'
import type { Sigma } from 'sigma'
import { computeBounds, computeFitCamera, fa2ConfigFor, layoutCacheKey } from '../layoutPolicy'

export type LayoutType = 'forceatlas2' | 'circular' | 'random'

const CACHE_KEY = 'worldsea-graph-layout-cache'
const CACHE_TTL = 30 * 60 * 1000

interface LayoutCacheEntry {
  /** 批 C：键含节点数 + 边数 + 布局——边集变化即失效（旧实现只认节点集合，边变仍复用旧位） */
  key: string
  positions: Record<string, { x: number; y: number }>
  timestamp: number
}

let _worker: Worker | null = null

function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(
      new URL('./layoutWorker.ts', import.meta.url),
      { type: 'module' },
    )
  }
  return _worker
}

function terminateWorker(): void {
  if (_worker) {
    _worker.terminate()
    _worker = null
  }
}

export function useGraphLayout() {
  const isComputing = ref(false)
  const layoutProgress = ref(0)

  function saveLayoutCache(graph: Graph, layout: LayoutType): void {
    const positions: Record<string, { x: number; y: number }> = {}
    graph.forEachNode((node) => {
      positions[node] = {
        x: graph.getNodeAttribute(node, 'x'),
        y: graph.getNodeAttribute(node, 'y'),
      }
    })
    const entry: LayoutCacheEntry = {
      key: layoutCacheKey(graph.order, graph.size, layout),
      positions,
      timestamp: Date.now(),
    }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry)) } catch { /* quota */ }
  }

  function loadLayoutCache(graph: Graph, layout: LayoutType): Record<string, { x: number; y: number }> | null {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const entry: LayoutCacheEntry = JSON.parse(raw)
      if (entry.key !== layoutCacheKey(graph.order, graph.size, layout)) return null
      if (Date.now() - entry.timestamp > CACHE_TTL) {
        sessionStorage.removeItem(CACHE_KEY)
        return null
      }
      return entry.positions
    } catch { return null }
  }

  function applyCachedPositions(
    graph: Graph,
    positions: Record<string, { x: number; y: number }>,
  ): boolean {
    let allFound = true
    graph.forEachNode((node) => {
      if (!positions[node]) { allFound = false; return }
    })
    if (!allFound) return false
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'x', positions[node].x)
      graph.setNodeAttribute(node, 'y', positions[node].y)
    })
    return true
  }

  function applyLayoutSync(
    graph: Graph,
    layout: LayoutType,
    onDone?: () => void,
  ): void {
    if (graph.order === 0) return
    isComputing.value = true

    const cached = loadLayoutCache(graph, layout)
    if (cached && applyCachedPositions(graph, cached)) {
      isComputing.value = false
      layoutProgress.value = 100
      onDone?.()
      return
    }

    try {
      switch (layout) {
        case 'forceatlas2': {
          random.assign(graph, { scale: 100, center: 0.5 })
          const config = fa2ConfigFor(graph.order)
          forceAtlas2.assign(graph, { iterations: config.iterations, settings: config.settings })
          break
        }
        case 'circular':
          circular.assign(graph, { scale: 100, center: 0.5 })
          break
        case 'random':
          random.assign(graph, { scale: 100, center: 0.5 })
          break
      }
    } catch (err) {
      console.warn('[useGraphLayout]', err)
    }

    saveLayoutCache(graph, layout)
    isComputing.value = false
    layoutProgress.value = 100
    onDone?.()
  }

  function applyLayoutAsync(
    graph: Graph,
    layout: LayoutType,
    sigmaInstance: Sigma | null,
    onDone?: () => void,
  ): void {
    if (graph.order === 0) return
    isComputing.value = true
    layoutProgress.value = 0

    const cached = loadLayoutCache(graph, layout)
    if (cached && applyCachedPositions(graph, cached)) {
      isComputing.value = false
      layoutProgress.value = 100
      onDone?.()
      return
    }

    if (layout !== 'forceatlas2') {
      applyLayoutSync(graph, layout, onDone)
      return
    }

    const nodes: { key: string; x: number; y: number }[] = []
    graph.forEachNode((node) => {
      nodes.push({
        key: node,
        x: graph.getNodeAttribute(node, 'x') || Math.random() * 100,
        y: graph.getNodeAttribute(node, 'y') || Math.random() * 100,
      })
    })

    const edges: { key: string; source: string; target: string }[] = []
    graph.forEachEdge((edge) => {
      edges.push({
        key: edge,
        source: graph.source(edge),
        target: graph.target(edge),
      })
    })

    const worker = getWorker()

    const onMessage = (e: MessageEvent) => {
      const data = e.data
      if (data.type === 'progress') {
        layoutProgress.value = Math.round((data.iteration / data.total) * 100)
        const positions: Record<string, { x: number; y: number }> = data.positions
        graph.forEachNode((node) => {
          if (positions[node]) {
            graph.setNodeAttribute(node, 'x', positions[node].x)
            graph.setNodeAttribute(node, 'y', positions[node].y)
          }
        })
        sigmaInstance?.refresh()
      } else if (data.type === 'done') {
        worker.removeEventListener('message', onMessage)
        const positions: Record<string, { x: number; y: number }> = data.positions
        graph.forEachNode((node) => {
          if (positions[node]) {
            graph.setNodeAttribute(node, 'x', positions[node].x)
            graph.setNodeAttribute(node, 'y', positions[node].y)
          }
        })
        saveLayoutCache(graph, layout)
        isComputing.value = false
        layoutProgress.value = 100
        onDone?.()
      }
    }

    worker.addEventListener('message', onMessage)
    const config = fa2ConfigFor(graph.order)
    worker.postMessage({
      type: 'layout',
      layout,
      nodes,
      edges,
      iterations: config.iterations,
      settings: config.settings,
    })
  }

  function applyLayout(
    graph: Graph,
    layout: LayoutType,
    onDone?: () => void,
    sigmaInstance?: Sigma | null,
  ): void {
    if (graph.order < 200 || layout !== 'forceatlas2') {
      applyLayoutSync(graph, layout, onDone)
    } else {
      applyLayoutAsync(graph, layout, sigmaInstance ?? null, onDone)
    }
  }

  /** 真·适应画面（批 C）：节点边界 → 相机（旧实现写死飞 (0.5, 0.5)/1.1，从不看边界） */
  function fitToGraph(sigmaInstance: Sigma | null, padding: number = 40): void {
    if (!sigmaInstance) return
    const graph = sigmaInstance.getGraph()
    if (graph.order === 0) return

    const points: { x: number; y: number }[] = []
    graph.forEachNode((node: string) => {
      points.push({
        x: graph.getNodeAttribute(node, 'x'),
        y: graph.getNodeAttribute(node, 'y'),
      })
    })
    const bounds = computeBounds(points)
    if (!bounds) return

    const { width, height } = sigmaInstance.getDimensions()
    const cam = computeFitCamera(bounds, { w: width, h: height }, padding)
    if (!cam) return
    sigmaInstance.getCamera().animate(cam, { duration: 400, easing: 'cubicInOut' })
  }

  function dispose(): void {
    terminateWorker()
  }

  return {
    isComputing,
    layoutProgress,
    applyLayout,
    fitToGraph,
    dispose,
  }
}
