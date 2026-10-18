import type { Entity } from '@worldsea/entity-core'

export interface NodeFieldWriteOptions {
  findNode: (id: string) => Entity | undefined
  recordContentEdit: (
    nodeId: string,
    prev: Record<string, unknown>,
    next: Record<string, unknown>,
    label?: string,
  ) => void
  applyFields: (nodeId: string, values: Record<string, unknown>) => Promise<void>
}

/**
 * 节点字段写入（详情面板 → 白板撤销栈一步）。
 *
 * 2026-10-19：从 BoardView 抽出并**修掉一处层级错误**——原实现把所有 key 都写进 `properties`，
 * 而 `name` 是**实体顶层字段**，于是「改标题」根本落不了库（会写出 `properties.name` 这种野字段）。
 * 现在两类字段分开：
 * - `name`：写实体顶层 + 撤销记录 `{ name }`
 * - 其余（status / nodeType / storylines / wordCount）：写 `properties`（整体替换语义，先合并）+ 撤销记录 `{ properties }`
 *
 * 抽成 composable 的原因：BoardView 处于 1230 行冻结基线，本次修复不允许多占行。
 */
export function useNodeFieldWrite(opts: NodeFieldWriteOptions) {
  function updateNodeField(
    nodeId: string,
    key: string,
    value: unknown,
    label: string,
  ): void {
    const node = opts.findNode(nodeId)
    if (!node) return

    if (key === 'name') {
      const prevName = String(node.name ?? '')
      const nextName = String(value ?? '').trim()
      if (prevName === nextName) return
      opts.recordContentEdit(nodeId, { name: prevName }, { name: nextName }, label)
      void opts.applyFields(nodeId, { name: nextName })
      return
    }

    const prev = { ...(node.properties ?? {}) }
    if (prev[key] === value) return
    const next = { ...prev, [key]: value }
    opts.recordContentEdit(nodeId, { properties: prev }, { properties: next }, label)
    void opts.applyFields(nodeId, { properties: next })
  }

  return { updateNodeField }
}
