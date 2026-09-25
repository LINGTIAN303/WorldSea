/**
 * export/outlineExport —— 大纲导出（按表现形式渲染）
 *
 * 规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md 各节「导出形态」行
 *   · 标题式：depth 0→H1 … 5+→H6；`numbering=none` 或超层 → 降级为列表项（保持缩进）
 *   · 句子式：容器内**同时有**标题式 → 标题下一行斜体摘要；**仅有**句子式 → 普通段落
 *   · 表格式：docx 真表格（**表头恒含**，不受 showHeader 影响）+ markdown 管道表
 *   · 树式：按深度输出嵌套列表（`numbering≠none` 时带编号前缀）
 *
 * 【两条关键语义（实现期确立，可推翻）】
 * 1. **导出范围 = 全部大纲节点**，未入板（无容器）的节点按**默认标题式**渲染。
 *    这样「没有任何白板布局时导出依然完整」——正是规格 §十「白板布局本身不导出、
 *    导出按节点语义顺序」的落地判据：布局只提供**形式偏好**，不提供结构。
 * 2. **容器含树式时，其子树以嵌套列表一次性导出，不再逐节点展开**，否则同一批节点
 *    会在产物中出现两次（树式的 `scope='all'` 在导出中等价于「本节点子树」）。
 *
 * 【实现方式】先构建与格式无关的导出 IR（`ExportBlock[]`），再由两个序列化器分别产出
 * HTML 与 Markdown —— 同源保证两格式不会各自漂移。HTML 可直接喂入既有 docx 链路
 * （`htmlToDocxBlocks` → `blocksToDocx`），故 docx 与 md 的规则天然一致。
 */
import { resolveChildNodes, resolveNodeNumbering, type NodeLike } from '../outlineDerive'
import {
  composeTitleLine,
  depthToHeadingLevel,
  shouldDegradeToListItem,
  type NumberingStyle,
} from '../forms/titleNumbering'
import { buildTableRows, type TableSourceNode } from '../forms/tableRows'
import { resolveFormConfig } from '../forms/registry'
import type { BoardComponent, OutlineBoardLayout } from '../layoutSchema'

/** 导出只依赖 id / name / description / properties（与派生工具同口径） */
export interface ExportSourceNode extends NodeLike {
  name?: string
  description?: string
}

/** 与格式无关的导出 IR */
export type ExportBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string; italic?: boolean }
  /** 嵌套列表（树式 / 超层降级的标题式）：depth 0 起 */
  | { kind: 'list'; items: Array<{ text: string; depth: number }> }
  | { kind: 'table'; header: string[]; rows: string[][] }

export interface OutlineExportResult {
  blocks: ExportBlock[]
  html: string
  markdown: string
}

// ── 转义 ─────────────────────────────────────

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** markdown 表格单元格内的 `|` 会破坏列结构，须转义；换行折成空格 */
function escapeTableCell(text: string): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

// ── 序列化 ───────────────────────────────────

/**
 * 把带 depth 的平铺列表项渲染为**真正嵌套**的 `<ul>`。
 *
 * 为什么要嵌套而不是平铺兄弟：docx 侧 `htmlToDocxBlocks` 靠 `<ul>` 的嵌套层级推导
 * `listItem.level`——若渲染成 `<li>父</li><ul><li>子</li></ul>`（ul 与 li 同级），
 * 层级信息就丢了，docx 里会退化成同一层。故先归成树再递归渲染。
 */
function listItemsToHtml(items: Array<{ text: string; depth: number }>): string {
  interface ListNode { text: string; children: ListNode[] }
  const roots: ListNode[] = []
  /** stack[d] = 当前深度 d 上最近的一个节点（用于挂子项） */
  const stack: ListNode[] = []

  for (const item of items) {
    const depth = Math.max(0, item.depth)
    const listNode: ListNode = { text: item.text, children: [] }
    if (depth === 0 || stack.length === 0) {
      roots.push(listNode)
      stack.length = 0
      stack[0] = listNode
      continue
    }
    // 越层（depth 跳变）时挂到最近的已有父项，保证不丢内容
    const parent = stack[Math.min(depth - 1, stack.length - 1)]
    parent.children.push(listNode)
    stack.length = depth
    stack[depth] = listNode
  }

  const render = (listNodes: ListNode[]): string => {
    if (!listNodes.length) return ''
    const body = listNodes
      .map(n => `<li>${escapeHtml(n.text)}${render(n.children)}</li>`)
      .join('')
    return `<ul>${body}</ul>`
  }

  return render(roots)
}

export function blocksToHtml(blocks: ExportBlock[]): string {
  const parts: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        parts.push(`<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`)
        break
      case 'paragraph':
        parts.push(b.italic ? `<p><em>${escapeHtml(b.text)}</em></p>` : `<p>${escapeHtml(b.text)}</p>`)
        break
      case 'list':
        parts.push(listItemsToHtml(b.items))
        break
      case 'table': {
        // 表头恒含（规格 §3.2-⑤：markdown 表无表头语义不成立，故不受 showHeader 影响）
        const head = `<tr>${b.header.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
        const body = b.rows
          .map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
          .join('')
        parts.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`)
        break
      }
    }
  }
  return parts.join('\n')
}

export function blocksToMarkdown(blocks: ExportBlock[]): string {
  const lines: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'heading':
        lines.push(`${'#'.repeat(Math.min(6, Math.max(1, b.level)))} ${b.text}`, '')
        break
      case 'paragraph':
        lines.push(b.italic ? `*${b.text}*` : b.text, '')
        break
      case 'list':
        for (const item of b.items) {
          lines.push(`${'  '.repeat(Math.max(0, item.depth))}- ${item.text}`)
        }
        lines.push('')
        break
      case 'table': {
        lines.push(`| ${b.header.map(escapeTableCell).join(' | ')} |`)
        lines.push(`| ${b.header.map(() => '---').join(' | ')} |`)
        for (const row of b.rows) {
          const cells = b.header.map((_, i) => escapeTableCell(row[i] ?? ''))
          lines.push(`| ${cells.join(' | ')} |`)
        }
        lines.push('')
        break
      }
    }
  }
  // 折叠连续空行，保证产物稳定（便于比对与快照式断言）
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

// ── IR 构建 ──────────────────────────────────

function componentsOf(layout: OutlineBoardLayout | undefined, nodeId: string): BoardComponent[] {
  const container = layout?.containers.find(c => c.nodeId === nodeId)
  if (!container) return []
  return [...container.components].sort((a, b) => a.order - b.order)
}

function componentsByForm(components: BoardComponent[], form: string): BoardComponent[] {
  return components.filter(c => c.form === form)
}

function nodeTitle(node: ExportSourceNode): string {
  return (node.name ?? '').trim() || '未命名节点'
}

/** 树式导出：本节点子树 → 嵌套列表项（不含自身） */
function buildSubtreeListItems(
  rootId: string,
  nodes: ExportSourceNode[],
  numbering: NumberingStyle,
): Array<{ text: string; depth: number }> {
  const items: Array<{ text: string; depth: number }> = []
  const walk = (parentId: string, depth: number): void => {
    for (const child of resolveChildNodes(parentId, nodes)) {
      const chain = numbering === 'none' ? [] : resolveNodeNumbering(child.id, nodes)
      items.push({ text: composeTitleLine(nodeTitle(child), chain, numbering), depth })
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 0)
  return items
}

/**
 * 构建导出 IR。
 * @param nodes 全部大纲节点（顺序无关，内部按 parentId + order 归树）
 * @param layout 白板布局体（**只读其中的表现形式配置**；位置/尺寸/区一概不用）
 */
export function buildOutlineExportBlocks(opts: {
  nodes: ExportSourceNode[]
  layout?: OutlineBoardLayout
}): ExportBlock[] {
  const nodes = Array.isArray(opts.nodes) ? opts.nodes : []
  const blocks: ExportBlock[] = []

  const walk = (parentId: string, depth: number): void => {
    for (const node of resolveChildNodes(parentId, nodes)) {
      const components = componentsOf(opts.layout, node.id)
      const titleComp = componentsByForm(components, 'title')[0]
      const sentenceComp = componentsByForm(components, 'sentence')[0]
      const tableComp = componentsByForm(components, 'table')[0]
      const treeComp = componentsByForm(components, 'tree')[0]

      // ① 主干：标题（未入板 / 容器无标题式 → 默认标题式渲染，保证产物完整）
      const titleCfg = titleComp
        ? resolveFormConfig('title', titleComp.config)
        : resolveFormConfig('title')
      const numberingStyle = (titleCfg.numbering ?? 'numeric') as NumberingStyle
      const chain = numberingStyle === 'none' ? [] : resolveNodeNumbering(node.id, nodes)
      const line = composeTitleLine(nodeTitle(node), chain, numberingStyle)

      if (numberingStyle === 'none' || shouldDegradeToListItem(depth)) {
        // 无编号 / 超层：降级为列表项（保留缩进层级，与规格 §1.2-⑤ 一致）
        blocks.push({ kind: 'list', items: [{ text: line, depth }] })
      } else {
        blocks.push({ kind: 'heading', level: depthToHeadingLevel(depth), text: line })
      }

      // ② 句子式：同容器有标题式 → 标题下斜体摘要；否则普通段落（规格 §2.2-⑤）
      if (sentenceComp) {
        const text = (node.description ?? '').trim()
        // 字号 / 行数 / 引号等为**呈现项**，导出不适用（规格只约定「斜体摘要」与「普通段落」两形态）
        // 仅在有标题式时才带 italic 键，保持 IR 干净（序列化层对 undefined 与 false 同处理）
        if (text) blocks.push({ kind: 'paragraph', text, ...(titleComp ? { italic: true } : {}) })
      }

      // ③ 表格式：直接子节点表（表头恒含）
      if (tableComp) {
        const cfg = resolveFormConfig('table', tableComp.config)
        const built = buildTableRows({
          nodes: nodes as TableSourceNode[],
          nodeId: node.id,
          columns: cfg.columns,
          includeSelf: cfg.includeSelf === true,
        })
        if (built.rows.length) {
          blocks.push({
            kind: 'table',
            header: built.columns.map(c => c.label),
            rows: built.rows.map(r => built.columns.map(c => String(r[c.key] ?? ''))),
          })
        }
      }

      // ④ 树式：子树嵌套列表（**一次展开后即停止递归**，避免重复导出同一批节点）
      if (treeComp) {
        const cfg = resolveFormConfig('tree', treeComp.config)
        const style = (cfg.numbering ?? 'none') as NumberingStyle
        const items = buildSubtreeListItems(node.id, nodes, style)
        if (items.length) blocks.push({ kind: 'list', items })
        continue
      }

      walk(node.id, depth + 1)
    }
  }

  walk('', 0)
  return blocks
}

/** 一次性得到 IR 与两种序列化产物（UI 层按格式取用） */
export function buildOutlineExport(opts: {
  nodes: ExportSourceNode[]
  layout?: OutlineBoardLayout
}): OutlineExportResult {
  const blocks = buildOutlineExportBlocks(opts)
  return { blocks, html: blocksToHtml(blocks), markdown: blocksToMarkdown(blocks) }
}
