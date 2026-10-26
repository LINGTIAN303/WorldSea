/**
 * 关系核心内的社区划分。
 *
 * 连通分量是确定性的第一层结构；单个分量过大时再跑一轮异步标签传播，
 * 把「一个巨型核心」拆成可读的几块（传播后仍只有一块则保留整体）。
 * 类型星座不参与划分——它们本身就是按类型聚合的社区。
 */
import type { Overview, OverviewNode } from './types'

export interface Community {
  id: string
  label: string
  nodeIds: string[]
  size: number
  dominantType: string
}

/** 超过该规模的分量才尝试标签传播，避免小图被过度切碎 */
const SPLIT_THRESHOLD = 24
const MAX_ITERATIONS = 10

export function detectCommunities(overview: Overview): Community[] {
  const core = overview.nodes.filter(node => !node.isolated)
  if (core.length === 0) return []

  const adjacency = new Map<string, Set<string>>()
  const link = (from: string, to: string): void => {
    const set = adjacency.get(from)
    if (set) set.add(to)
    else adjacency.set(from, new Set([to]))
  }
  for (const edge of overview.edges) {
    link(edge.source, edge.target)
    link(edge.target, edge.source)
  }

  const nodeById = new Map(overview.nodes.map(node => [node.id, node]))
  const components = connectedComponents(core.map(node => node.id).sort(), adjacency)
  const groups = components.flatMap(ids => (ids.length > SPLIT_THRESHOLD ? splitComponent(ids, adjacency) : [ids]))

  return groups
    .map(ids => ({ ids, dominantType: dominantTypeOf(ids, nodeById) }))
    .sort((a, b) => b.ids.length - a.ids.length)
    .map(({ ids, dominantType }, index) => ({
      id: `community:${index + 1}`,
      label: `社区 ${index + 1}`,
      nodeIds: ids,
      size: ids.length,
      dominantType,
    }))
}

function connectedComponents(ids: string[], adjacency: Map<string, Set<string>>): string[][] {
  const seen = new Set<string>()
  const components: string[][] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const component: string[] = []
    const queue = [id]
    seen.add(id)
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      component.push(current)
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    components.push(component.sort())
  }
  return components
}

/** 固定哈希：平票裁决用节点自身 id 决定偏好，跨运行可复现且不打散弱连接 */
function hashOf(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 异步标签传播：按 id 顺序原地更新；票数相同时按 id 哈希选一个稳定标签 */
function splitComponent(ids: string[], adjacency: Map<string, Set<string>>): string[][] {
  const labels = new Map(ids.map(id => [id, id]))
  for (let round = 0; round < MAX_ITERATIONS; round++) {
    let changed = false
    for (const id of ids) {
      const counts = new Map<string, number>()
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!labels.has(neighbor)) continue
        const label = labels.get(neighbor)!
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
      if (counts.size === 0) continue
      let bestCount = 0
      for (const count of counts.values()) bestCount = Math.max(bestCount, count)
      const tied = [...counts.entries()]
        .filter(([, count]) => count === bestCount)
        .map(([label]) => label)
        .sort()
      const best = tied[hashOf(id) % tied.length]
      if (best !== labels.get(id)) {
        labels.set(id, best)
        changed = true
      }
    }
    if (!changed) break
  }

  const buckets = new Map<string, string[]>()
  for (const id of ids) {
    const label = labels.get(id)!
    const bucket = buckets.get(label)
    if (bucket) bucket.push(id)
    else buckets.set(label, [id])
  }
  const groups = [...buckets.values()].map(group => group.sort())
  return groups.length > 1 ? groups : [ids]
}

function dominantTypeOf(ids: string[], nodeById: Map<string, OverviewNode>): string {
  const counts = new Map<string, number>()
  for (const id of ids) {
    const type = nodeById.get(id)?.type
    if (!type) continue
    counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  let best = ''
  let bestCount = -1
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type
      bestCount = count
    }
  }
  return best
}
