/**
 * 聚类展示策略纯函数（2026-10-09 图谱改进批 E）。
 *
 * 病：簇名「类型 (n)」无语义锚点（看不出簇里谁最有代表性）；社区色只落列表面板
 * 未上画布；簇项悬停无画布反馈。本件收三个纯策略供 `useGraphClustering` /
 * `GlobalGraph` 消费（WebGL 画布无单测手段：策略直测 + 变异，视觉终审走真机走查）。
 */
import type Graph from 'graphology'
import type { ClusterInfo } from './composables/useGraphClustering'

/**
 * 语义命名「主导类型·Top 成员名 (N)」——Top 成员 = 簇内度数最高者（最有代表性；
 * tie 取序先），节点无名兜底用 id，空簇/无图兜底只显主导类型。
 */
export function clusterLabel(graph: Graph, nodeIds: string[], dominantType: string): string {
  let top = ''
  let topDegree = -1
  for (const id of nodeIds) {
    const d = graph.hasNode(id) ? graph.degree(id) : 0
    if (d > topDegree) {
      topDegree = d
      top = id
    }
  }
  const topName = top ? String(graph.getNodeAttribute(top, 'label') || top) : ''
  const head = dominantType || '未知'
  return topName ? `${head}·${topName} (${nodeIds.length})` : `${head} (${nodeIds.length})`
}

/** nodeId → 簇色映射（着色开关用；同节点多簇取先——WASM 社区互斥，防御性取先） */
export function nodeClusterColorMap(clusters: ClusterInfo[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of clusters) {
    for (const id of c.nodeIds) {
      if (!map.has(id)) map.set(id, c.color)
    }
  }
  return map
}

/** 簇项悬停高亮集：成员节点 id 集合（非成员由 applyHighlightToGraph 淡化；null → 空集） */
export function clusterHighlightIds(cluster: ClusterInfo | null): Set<string> {
  return new Set(cluster ? cluster.nodeIds : [])
}
