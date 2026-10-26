/**
 * 标签与搜索策略（2026-10-26 重构）。
 *
 * G6 的 `auto-adapt-label` 负责避让；本件只管「谁更重要」与「搜索怎么命中」。
 */
import type { OverviewNode } from '../model/types'

/** 标签优先级：度数为主，标签与描述参与加权；用于 auto-adapt-label 的 sortNode */
export function labelPriority(node: OverviewNode): number {
  const tags = Array.isArray(node.tags) ? node.tags.length : 0
  const description = node.description ? Math.min(12, node.description.length / 20) : 0
  return node.degree * 10 + tags * 2 + description
}

/** 名称匹配：大小写不敏感包含；空串返回空集 */
export function matchNodeIds(nodes: Array<{ id: string; name: string }>, query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return nodes.filter(node => node.name.toLowerCase().includes(q)).map(node => node.id)
}

/** 名称过长时截断（画布标签用，完整名称留给检查器/提示） */
export function shortLabel(name: string, max = 16): string {
  const text = (name || '').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}
