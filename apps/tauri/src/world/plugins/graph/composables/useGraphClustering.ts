import { ref } from 'vue'
import Graph from 'graphology'
import { algoCommunityDetection } from '@/core/coreBackend'
import { graphToWeightedGraph } from '@worldsea/ui-kit'
import type { CommunityDetectionResult } from '@worldsea/canvas-engine/core'
import { clusterLabel, nodeClusterColorMap } from '../clusterPolicy'

export interface ClusterInfo {
  id: string
  label: string
  color: string
  nodeIds: string[]
  size: number
}

/** 聚类簇色板（类别色：多色相区分社区，刻意不随强调色）——主检测与降级检测共用一份 */
const CLUSTER_COLORS = ['#4fc3f7', '#26c6da', '#7c4dff', '#536dfe', '#00e5ff', '#69f0ae', '#b388ff', '#84ffff']

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

      const resultClusters: ClusterInfo[] = []
      let colorIdx = 0

      for (const comm of result.communities) {
        const nodeIds = comm.members
        const types = nodeIds.map((id: string) => graph.getNodeAttribute(id, 'entityType') || 'unknown')
        const dominantType = getMostFrequent(types)
        resultClusters.push({
          id: `cluster-${comm.id}`,
          label: clusterLabel(graph, nodeIds, dominantType),
          color: CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length],
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
        label: clusterLabel(graph, members, dominantType),
        color: CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length],
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

  /** 「按社区着色」开关（批 E）：与类型色互切。开启后 originalColor 基准随簇色，
   *  高亮淡化/复位自动兼容；类型色备份进 typeColor 属性 */
  const colorByCluster = ref(false)

  function toggleColorByCluster(): boolean {
    colorByCluster.value = !colorByCluster.value
    return colorByCluster.value
  }

  /** 簇色上画布（批 E）：开→成员节点写簇色并同步 originalColor 基准（类型色备份 typeColor）；
   *  关→从 typeColor 恢复，无簇节点不动。数据增量更新会重写 originalColor，簇色不重放
   *  （聚类结果随数据过期，重跑聚类即可）。 */
  function applyClusterColors(graph: Graph, on: boolean): void {
    const map = on ? nodeClusterColorMap(clusters.value) : null
    graph.forEachNode((n) => {
      if (map) {
        const clusterColor = map.get(n)
        if (!clusterColor) return
        graph.setNodeAttribute(n, 'typeColor', graph.getNodeAttribute(n, 'originalColor') || graph.getNodeAttribute(n, 'color'))
        graph.setNodeAttribute(n, 'originalColor', clusterColor)
        graph.setNodeAttribute(n, 'color', clusterColor)
      } else {
        const typeColor = graph.getNodeAttribute(n, 'typeColor') as string | undefined
        if (!typeColor) return
        graph.setNodeAttribute(n, 'originalColor', typeColor)
        graph.setNodeAttribute(n, 'color', typeColor)
      }
    })
  }

  return {
    clusters,
    isClustering,
    clusteringEnabled,
    detectCommunities,
    toggleClustering,
    colorByCluster,
    toggleColorByCluster,
    applyClusterColors,
  }
}
