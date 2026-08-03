import Graph from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import circular from 'graphology-layout/circular'
import random from 'graphology-layout/random'

interface LayoutRequest {
  type: 'layout'
  layout: 'forceatlas2' | 'circular' | 'random'
  nodes: { key: string; x: number; y: number }[]
  edges: { key: string; source: string; target: string }[]
}

interface LayoutResponse {
  type: 'done'
  positions: Record<string, { x: number; y: number }>
}

interface LayoutProgress {
  type: 'progress'
  iteration: number
  total: number
  positions: Record<string, { x: number; y: number }>
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { layout, nodes, edges } = e.data
  const graph = new Graph()

  for (const n of nodes) {
    graph.addNode(n.key, { x: n.x, y: n.y })
  }
  for (const ed of edges) {
    if (graph.hasNode(ed.source) && graph.hasNode(ed.target)) {
      try {
        graph.addEdge(ed.source, ed.target, { key: ed.key })
      } catch { /* duplicate edge */ }
    }
  }

  if (graph.order === 0) {
    self.postMessage({ type: 'done', positions: {} } as LayoutResponse)
    return
  }

  switch (layout) {
    case 'forceatlas2': {
      random.assign(graph, { scale: 100, center: 0.5 })
      const totalIter = 100
      const batchSize = 20
      for (let done = 0; done < totalIter; done += batchSize) {
        const batch = Math.min(batchSize, totalIter - done)
        forceAtlas2.assign(graph, {
          iterations: batch,
          settings: {
            gravity: 1.3,
            scalingRatio: 1,
            barnesHutOptimize: graph.order > 500,
            slowDown: 1.5,
            adjustSizes: false,
          },
        })
        const positions: Record<string, { x: number; y: number }> = {}
        graph.forEachNode((node) => {
          positions[node] = {
            x: graph.getNodeAttribute(node, 'x'),
            y: graph.getNodeAttribute(node, 'y'),
          }
        })
        self.postMessage({
          type: 'progress',
          iteration: done + batch,
          total: totalIter,
          positions,
        } as LayoutProgress)
      }
      break
    }
    case 'circular': {
      circular.assign(graph, { scale: 100, center: 0.5 })
      break
    }
    case 'random': {
      random.assign(graph, { scale: 100, center: 0.5 })
      break
    }
  }

  const positions: Record<string, { x: number; y: number }> = {}
  graph.forEachNode((node) => {
    positions[node] = {
      x: graph.getNodeAttribute(node, 'x'),
      y: graph.getNodeAttribute(node, 'y'),
    }
  })
  self.postMessage({ type: 'done', positions } as LayoutResponse)
}
