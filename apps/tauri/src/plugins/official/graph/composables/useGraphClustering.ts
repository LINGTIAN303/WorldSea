import { ref } from 'vue'
import Graph from 'graphology'
import { algoCommunityDetection } from '@/core/coreBackend'
import { graphToWeightedGraph } from '@worldsmith/ui-kit'
import type { CommunityDetectionResult } from '@worldsmith/canvas-engine/core'

export interface ClusterInfo {
  id: string
  label: string
  color: string
  nodeIds: string[]
  size: number
}

export function useGraphClustering() {
  const clusters = ref<ClusterInfo[]>([])
  const isClustering = ref(false)
  const clusteringEnabled = ref(false)

  async function detectCommunities(graph: Graph): Promise<ClusterInfo[]> {
    if (graph.order === 0) return []
    isClustering.value = true
    try {
      const wg = graphToWeightedGraph(graph)
      let result: CommunityDetectionResult | null = null
      try {
        result = await algoCommunityDetection(JSON.stringify(wg))
      } catch (err) {
        console.warn('[useGraphClustering] wasm backend unavailable, falling back to JS:', err)
        result = null
      }
      if (!result || !result.communities || result.communities.length === 0) {
        const fallback = labelPropagationFallback(graph)
        clusters.value = fallback
        return fallback
      }

      const clusterColors = ['#4fc3f7', '#26c6da', '#7c4dff', '#536dfe', '#00e5ff', '#69f0ae', '#b388ff', '#84ffff']
      const resultClusters: ClusterInfo[] = []
      let colorIdx = 0

      for (const comm of result.communities) {
        const nodeIds = comm.members
        const types = nodeIds.map((id: string) => graph.getNodeAttribute(id, 'entityType') || 'unknown')
        const dominantType = getMostFrequent(types)
        resultClusters.push({
          id: `cluster-${comm.id}`,
          label: `${dominantType} (${nodeIds.length})`,
          color: clusterColors[colorIdx % clusterColors.length],
          nodeIds,
          size: nodeIds.length,
        })
        colorIdx++
      }
      clusters.value = resultClusters
      return resultClusters
    } catch (err) {
      console.warn('[useGraphClustering]', err)
      clusters.value = []
      return []
    } finally {
      isClustering.value = false
    }
  }

  function labelPropagationFallback(graph: Graph): ClusterInfo[] {
    const clusterColors = ['#4fc3f7', '#26c6da', '#7c4dff', '#536dfe', '#00e5ff', '#69f0ae', '#b388ff', '#84ffff']
    const nodes = graph.nodes()
    if (nodes.length === 0) return []
    const labels = new Map<string, string>()
    for (const n of nodes) labels.set(n, n)
    const getNeighbors = (n: string): string[] => {
      try { return graph.neighbors(n) } catch { return [] }
    }
    for (let iter = 0; iter < 20; iter++) {
      const shuffled = [...nodes].sort(() => Math.random() - 0.5)
      let changed = false
      for (const n of shuffled) {
        const neighbors = getNeighbors(n).filter(m => labels.has(m))
        if (neighbors.length === 0) continue
        const counts = new Map<string, number>()
        for (const m of neighbors) {
          const lbl = labels.get(m)!
          counts.set(lbl, (counts.get(lbl) || 0) + 1)
        }
        let best = labels.get(n)!
        let bestCount = -1
        for (const [lbl, c] of counts) {
          if (c > bestCount || (c === bestCount && Math.random() < 0.5)) {
            best = lbl
            bestCount = c
          }
        }
        if (best !== labels.get(n)) {
          labels.set(n, best)
          changed = true
        }
      }
      if (!changed) break
    }
    const groups = new Map<string, string[]>()
    for (const [n, lbl] of labels) {
      if (!groups.has(lbl)) groups.set(lbl, [])
      groups.get(lbl)!.push(n)
    }
    const result: ClusterInfo[] = []
    let colorIdx = 0
    for (const [lbl, members] of groups) {
      const types = members.map(id => graph.getNodeAttribute(id, 'entityType') || 'unknown')
      const dominantType = getMostFrequent(types)
      result.push({
        id: `cluster-${lbl}`,
        label: `${dominantType} (${members.length})`,
        color: clusterColors[colorIdx % clusterColors.length],
        nodeIds: members,
        size: members.length,
      })
      colorIdx++
    }
    result.sort((a, b) => b.size - a.size)
    return result
  }

  function getMostFrequent(arr: string[]): string {
    const counts = new Map<string, number>()
    for (const item of arr) counts.set(item, (counts.get(item) || 0) + 1)
    let max = 0, result = arr[0] || 'unknown'
    for (const [item, count] of counts) {
      if (count > max) { max = count; result = item }
    }
    return result
  }

  function toggleClustering(): void {
    clusteringEnabled.value = !clusteringEnabled.value
  }

  return {
    clusters,
    isClustering,
    clusteringEnabled,
    detectCommunities,
    toggleClustering,
  }
}
