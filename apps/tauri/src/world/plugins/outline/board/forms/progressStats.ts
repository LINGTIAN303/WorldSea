/**
 * forms/progressStats —— 进度式表现形式的统计纯函数
 *
 * 迁移自原独立大纲视图的「进度总览」页签（`OutlineView.vue:106-117` + `:314-324`）：
 * 总节点数 / 总字数 / 完成度 +（线索分布由 `storylineRows.buildStorylineRows` 复用，不重复实现）。
 *
 * 口径与原实现一致：**完成度 = round(完成节点数 / 总节点数 × 100)**，空集为 0。
 * 状态三态取自节点注册的 `deteriorable` trait（未写 / 草稿 / 完成），未知值一律计入「未写」。
 */
import type { NodeLike } from '../outlineDerive'
import { sumWordCount } from './scopeNodes'

export type NodeStatus = '未写' | '草稿' | '完成'

/** 状态三态（顺序即展示顺序） */
export const NODE_STATUSES: readonly NodeStatus[] = ['未写', '草稿', '完成'] as const

export interface ProgressStats {
  total: number
  wordCount: number
  done: number
  draft: number
  todo: number
  /** 完成度百分比（0–100 整数） */
  completionPct: number
  statusCounts: Record<NodeStatus, number>
}

/** 取节点状态（未知/缺失 → 未写） */
export function statusOf(node: NodeLike | undefined): NodeStatus {
  const s = node?.properties?.status
  return s === '完成' || s === '草稿' ? s : '未写'
}

export function computeProgressStats(nodes: NodeLike[]): ProgressStats {
  const statusCounts: Record<NodeStatus, number> = { 未写: 0, 草稿: 0, 完成: 0 }
  for (const n of nodes) statusCounts[statusOf(n)] += 1

  const total = nodes.length
  return {
    total,
    wordCount: sumWordCount(nodes),
    done: statusCounts.完成,
    draft: statusCounts.草稿,
    todo: statusCounts.未写,
    completionPct: total === 0 ? 0 : Math.round((statusCounts.完成 / total) * 100),
    statusCounts,
  }
}

/** 千分位（统计卡里的大数字更好读） */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('zh-Hans-CN') : '0'
}
