/**
 * forms/scopeNodes —— 派生型表现形式的「统计范围」解析（纯函数）
 *
 * 【口径差异，有意为之】与 `treeRows` 的 `scope` 不是同一件事：
 * - 树式 `scope='this'` 是**列举**语义 → 行从本节点的子节点开始（**不含**自身）；
 * - 统计类形式（线索式 / 进度式）`scope='this'` 是**统计**语义 → **含本节点自身**
 *   （「第一卷」的进度理应把卷自身那一层算进去，否则卷的状态永远不进统计）。
 * 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §七 §八。
 */
import { resolveChildNodes, type NodeLike } from '../outlineDerive'

export type FormScope = 'all' | 'this'

export function normalizeScope(v: unknown): FormScope {
  return v === 'this' ? 'this' : 'all'
}

/**
 * 按**语义顺序**（根 → 子，同级按 order）收集范围内的节点。
 * - `scope='this'`：以 rootId 为根的整棵子树（**含 rootId 自身**）；rootId 缺失或不在集合内 → 退化为全部
 * - `scope='all'`：全部根节点及其后代
 * - 断链节点（父 id 指向集合外的节点）**视为根**，补在末尾——与 `outlineDerive` 的断链口径一致
 * - 成环时靠 `seen` 保证不重复入列、不死循环
 */
export function resolveScopeNodes<T extends NodeLike>(
  nodes: T[],
  scope: FormScope,
  rootId?: string,
): T[] {
  const out: T[] = []
  const seen = new Set<string>()

  const visit = (parentId: string): void => {
    for (const n of resolveChildNodes(parentId, nodes)) {
      if (seen.has(n.id)) continue
      seen.add(n.id)
      out.push(n)
      visit(n.id)
    }
  }

  if (scope === 'this' && rootId) {
    const root = nodes.find(n => n.id === rootId)
    if (root) {
      seen.add(root.id)
      out.push(root)
      visit(root.id)
      return out
    }
  }

  visit('')
  // 断链兜底：父 id 非空但父不在集合内的节点，上面两轮都到不了
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  return out
}

/** 节点字数（`properties.wordCount`，非法值按 0；负数不参与累加） */
export function nodeWordCount(n: NodeLike | undefined): number {
  const v = Number(n?.properties?.wordCount)
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** 范围内节点字数合计 */
export function sumWordCount(nodes: NodeLike[]): number {
  return nodes.reduce((s, n) => s + nodeWordCount(n), 0)
}
