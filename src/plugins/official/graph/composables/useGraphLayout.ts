import { ref } from 'vue'
import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import circular from 'graphology-layout/circular'
import random from 'graphology-layout/random'
import type { Sigma } from 'sigma'

export type LayoutType = 'forceatlas2' | 'circular' | 'random'

const CACHE_KEY = 'worldsmith-graph-layout-cache'
const CACHE_TTL = 30 * 60 * 1000

interface LayoutCacheEntry {
  layout: LayoutType
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
    const entry: LayoutCacheEntry = { layout, positions, timestamp: Date.now() }
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry)) } catch { /* quota */ }
  }

  function loadLayoutCache(layout: LayoutType): Record<string, { x: number; y: number }> | null {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY)
      if (!raw) return null
      const entry: LayoutCacheEntry = JSON.parse(raw)
      if (entry.layout !== layout) return null
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

    const cached = loadLayoutCache(layout)
    if (cached && applyCachedPositions(graph, cached)) {
      isComputing.value = false
      layoutProgress.value = 100
      onDone?.()
      return
    }

    try {
      switch (layout) {
        case 'forceatlas2':
          random.assign(graph, { scale: 100, center: 0.5 })
          forceAtlas2.assign(graph, {
            iterations: 100,
            settings: {
              gravity: 1.3,
              scalingRatio: 1,
              barnesHutOptimize: graph.order > 500,
              slowDown: 1.5,
              adjustSizes: false,
            },
          })
          break
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

    const cached = loadLayoutCache(layout)
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
    worker.postMessage({ type: 'layout', layout, nodes, edges })
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

  function fitToGraph(sigmaInstance: Sigma | null, _padding: number = 50): void {
    if (!sigmaInstance) return
    const camera = sigmaInstance.getCamera()
    const graph = sigmaInstance.getGraph()
    if (graph.order === 0) return

    let hasValid = false
    graph.forEachNode((node: string) => {
      const x = graph.getNodeAttribute(node, 'x')
      const y = graph.getNodeAttribute(node, 'y')
      if (isFinite(x) && isFinite(y)) hasValid = true
    })
    if (!hasValid) return

    camera.animate({ x: 0.5, y: 0.5, ratio: 1.1 }, { duration: 400, easing: 'cubicInOut' })
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
