/**
 * blockHandle — 块级拖拽手柄逻辑层（批 5 V4，2026-10-12）。
 *
 * TipTap 无官方 drag handle（社区实现为付费 Pro 扩展）——本模块自研：
 * ① findTopBlock：从文档位置定位「顶层块」（doc 直接子级，手柄的作用对象）；
 * ② moveBlockBy / duplicateBlock / deleteBlock：快捷菜单的文档变换（纯 transaction）；
 * ③ blockSlice：构造块的拖拽 slice —— 拖拽重排走 ProseMirror「外部拖拽源」模式
 *    （view.dragging = { slice, move:true }），drop 由 PM 内置处理；
 *    落点指示线由 StarterKit 自带 Dropcursor 提供（其 dragover 无条件响应 + 读
 *    view.dragging.slice 精确定位，源码 prosemirror-dropcursor@1.8.3 实证——无需
 *    dragstart 发生在编辑器内）。
 *
 * 视图层（鼠标追踪 / 手柄定位 / 菜单）在 components/BlockHandleLayer.vue。
 */
import { Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'

export interface TopBlockRef {
  /** 顶层块在文档中的起点 */
  pos: number
  node: PMNode
}

/** 顶层块索引 → 块起点（前缀和） */
function childStartPos(doc: PMNode, idx: number): number {
  let pos = 0
  for (let i = 0; i < idx; i++) pos += doc.child(i).nodeSize
  return pos
}

/** 块起点 → 顶层子节点索引；不在任何块区间内 → -1 */
export function indexOfBlock(doc: PMNode, blockPos: number): number {
  let pos = 0
  for (let i = 0; i < doc.childCount; i++) {
    const size = doc.child(i).nodeSize
    if (blockPos >= pos && blockPos < pos + size) return i
    pos += size
  }
  return -1
}

/**
 * 从文档位置找顶层块。pos 落在块内任意处皆可（用 resolve 上溯）；
 * 越界 / 落在文档层间隙 → null。
 */
export function findTopBlock(doc: PMNode, pos: number): TopBlockRef | null {
  if (pos < 0 || pos > doc.content.size) return null
  let $pos
  try {
    $pos = doc.resolve(pos)
  } catch {
    return null
  }
  if ($pos.depth < 1) return null
  const blockPos = $pos.before(1)
  const idx = indexOfBlock(doc, blockPos)
  if (idx < 0) return null
  return { pos: blockPos, node: doc.child(idx) }
}

/**
 * 上移 / 下移块（与相邻兄弟交换）。到头 / 到尾 → 无操作返回 false。
 * 实现：一次 replaceWith 重排两兄弟（比 delete+insert 的坐标心算稳）。
 */
export function moveBlockBy(editor: Editor, blockPos: number, dir: -1 | 1): boolean {
  const { state, view } = editor
  const { doc } = state
  const idx = indexOfBlock(doc, blockPos)
  if (idx < 0) return false
  const targetIdx = idx + dir
  if (targetIdx < 0 || targetIdx >= doc.childCount) return false

  const cur = doc.child(idx)
  const sibling = doc.child(targetIdx)
  const start = childStartPos(doc, Math.min(idx, targetIdx))
  const end = childStartPos(doc, Math.max(idx, targetIdx)) + doc.child(Math.max(idx, targetIdx)).nodeSize
  // 交换两兄弟：下移（与后兄弟换）→ [后, 前]；上移（与前兄弟换）→ [前, 后]
  const seq = dir === 1 ? [sibling, cur] : [cur, sibling]
  view.dispatch(state.tr.replaceWith(start, end, seq))
  return true
}

/** 复制块（原块正下方插入一份副本） */
export function duplicateBlock(editor: Editor, blockPos: number): boolean {
  const { state, view } = editor
  const idx = indexOfBlock(state.doc, blockPos)
  if (idx < 0) return false
  const node = state.doc.child(idx)
  view.dispatch(state.tr.insert(blockPos + node.nodeSize, node))
  return true
}

/** 删除块 */
export function deleteBlock(editor: Editor, blockPos: number): boolean {
  const { state, view } = editor
  const idx = indexOfBlock(state.doc, blockPos)
  if (idx < 0) return false
  const node = state.doc.child(idx)
  view.dispatch(state.tr.delete(blockPos, blockPos + node.nodeSize))
  return true
}

/** 构造块的拖拽 slice（开区间——完整节点 move 语义，见模块头注释③） */
export function blockSlice(doc: PMNode, blockPos: number): Slice | null {
  const idx = indexOfBlock(doc, blockPos)
  if (idx < 0) return null
  return new Slice(Fragment.from(doc.child(idx)), 0, 0)
}

// ── 事件面解析（2026-10-13 修复）─────────────────────────────

export interface HandleSurface {
  /** 定位锚层（手柄坐标参照系，position:relative） */
  wrap: HTMLElement | null
  /** 鼠标追踪面（编辑器事件面 .nb-tt-body） */
  area: HTMLElement | null
}

/**
 * 解析手柄层的定位锚与鼠标追踪面。
 *
 * 关键（真机零表现缺陷的根因）：手柄层挂载点是 .nb-tt-body 的【兄弟】节点
 * （与 TOC 同层，见 NotebookTipTapEditor 模板）——closest('.nb-tt-body') 只查
 * 祖先链，必落空 → mousemove 监听从未挂上。area 一律从 wrap 内 querySelector
 * 向下找，与挂载位置解耦；layer 在 body 内的挂法也兼容。
 */
export function resolveHandleSurface(layerEl: Element | null): HandleSurface {
  const wrap = (layerEl?.closest('.nb-tt-wrap') ?? null) as HTMLElement | null
  const area = (wrap?.querySelector('.nb-tt-body') ?? null) as HTMLElement | null
  return { wrap, area }
}
