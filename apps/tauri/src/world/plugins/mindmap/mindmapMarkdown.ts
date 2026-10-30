/**
 * 思维导图 ↔ Markdown 大纲互转
 *
 * 统一大纲规则（双向对称）：
 * - 根节点 → `# 标题`
 * - 缩进列表按深度成树；兼容「标题树」：# ~ ###### 按级别作为深度（与笔记芽联动导入
 *   场景——笔记文档通常以标题组织）；列表项深度 = 所属标题深度 + 1 + 缩进级
 * - 代码块内容跳过；空行忽略
 *
 * 纯文本行归属规则（深度护栏，修复 STATUS_STACK_OVERFLOW 整页崩溃）：
 * - 连续多行纯文本（如多段描述）统一挂在最近一个结构行（标题/列表）下作兄弟节点；
 *   旧规则（depth = 上一行 + 1）会让连续纯文本行逐行级联下沉，长文档堆出千层链——
 *   mind-elixir 按树深度嵌套 DOM，上千层嵌套直接打爆渲染进程原生栈（STATUS_STACK_OVERFLOW
 *   整页崩溃）；且导入数据在 mind.init 前已落库，崩溃后刷新会在加载时再崩（文档带毒锁死视图）
 * - 规模上限见 findImportViolation / mindElixirStats / MINDMAP_OPEN_MAX_*
 */
import type { MindElixirData, NodeObj } from 'mind-elixir'

/** 导入安全上限（超出即拒绝导入）：mind-elixir 无虚拟化，规模/深度超限会拖垮或打爆渲染进程 */
export const MINDMAP_MAX_NODES = 2000
export const MINDMAP_MAX_DEPTH = 40

/** 打开已存文档的放宽阈值（只挡真正会崩的旧数据，正常导图不受影响） */
export const MINDMAP_OPEN_MAX_NODES = 5000
export const MINDMAP_OPEN_MAX_DEPTH = 200

interface OutlineLine {
  depth: number
  text: string
}

/** 解析 Markdown 大纲为 {depth, text} 线性序列；headingsOnly = 只取标题行（大文件「仅标题」导入模式） */
function parseLines(md: string, headingsOnly = false): OutlineLine[] {
  const lines: OutlineLine[] = []
  let inCodeBlock = false
  let lastHeadingDepth = 0
  // 最近一个结构行（标题/列表）的深度；纯文本行统一挂它下面（深度护栏，防级联下沉）
  let lastStructuralDepth = 0

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd()
    // 代码块围栏：跳过内部内容
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    if (!line.trim()) continue

    // 标题：# ~ ######
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const depth = heading[1].length
      lastHeadingDepth = depth
      lastStructuralDepth = depth
      lines.push({ depth, text: heading[2].trim() })
      continue
    }
    // 仅标题模式：跳过列表与纯文本行（大文件逃生门，见 findImportViolation 消费方）
    if (headingsOnly) continue

    // 无序列表：- / * / +，2 空格缩进 = 一层
    const list = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (list) {
      const indentLevels = Math.floor(list[1].replace(/\t/g, '  ').length / 2)
      const depth = lastHeadingDepth + 1 + indentLevels
      lastStructuralDepth = depth
      lines.push({ depth, text: list[2].trim() })
      continue
    }

    // 有序列表：1. 形式，同无序处理（保序）
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (ordered) {
      const indentLevels = Math.floor(ordered[1].replace(/\t/g, '  ').length / 2)
      const depth = lastHeadingDepth + 1 + indentLevels
      lastStructuralDepth = depth
      lines.push({ depth, text: ordered[2].trim() })
      continue
    }

    // 普通文本行：挂在最近一个结构行下作兄弟节点（深度护栏：旧规则逐行级联下沉会堆出千层链，
    // mind-elixir 按树深度嵌套 DOM，千层嵌套打爆渲染进程原生栈——见文件头说明）；无前置结构行时作为根
    if (lines.length === 0) {
      lines.push({ depth: 1, text: line.trim() })
    } else {
      lines.push({ depth: lastStructuralDepth + 1, text: line.trim() })
    }
  }
  return lines
}

/** 线性序列 → 树（栈法：depth 大于栈顶为子，否则弹栈找父） */
function buildTree(lines: OutlineLine[]): NodeObj | null {
  if (lines.length === 0) return null
  // 全局深度归一（最小 depth = 0，即根）
  const minDepth = Math.min(...lines.map(l => l.depth))
  const root: NodeObj = { id: genNodeId(), topic: lines[0].text, children: [] }
  const stack: { depth: number; node: NodeObj }[] = [{ depth: minDepth, node: root }]

  for (let i = 1; i < lines.length; i++) {
    const { depth, text } = lines[i]
    const node: NodeObj = { id: genNodeId(), topic: text, children: [] }
    while (stack.length > 1 && depth <= stack[stack.length - 1].depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].node
    parent.children = parent.children ?? []
    parent.children.push(node)
    stack.push({ depth, node })
  }
  return root
}

/** Markdown 大纲 → mind-elixir 数据（空/无效输入返回 null）；headingsOnly = 只取标题行 */
export function markdownToMindElixir(md: string, options?: { headingsOnly?: boolean }): MindElixirData | null {
  const root = buildTree(parseLines(md, options?.headingsOnly === true))
  if (!root) return null
  return { nodeData: root }
}

/** mind-elixir 数据 → Markdown 大纲（根为 #，其余按深度缩进列表） */
export function mindElixirToMarkdown(data: MindElixirData): string {
  const out: string[] = []
  const walk = (node: NodeObj, depth: number) => {
    const topic = (node.topic ?? '').replace(/\s*\r?\n\s*/g, ' ')
    if (depth === 0) {
      out.push(`# ${topic}`)
    } else {
      out.push(`${'  '.repeat(depth - 1)}- ${topic}`)
    }
    for (const child of node.children ?? []) walk(child, depth + 1)
  }
  walk(data.nodeData, 0)
  return out.join('\n')
}

function genNodeId(): string {
  return 'me' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

/** mind-elixir 数据规模统计（节点数 / 最大深度） */
export interface MindmapStats {
  nodeCount: number
  maxDepth: number
}

/** 统计已存 mind-elixir 数据规模——迭代栈遍历不递归（数据本身可能是千层链，递归会自己先爆栈） */
export function mindElixirStats(data: MindElixirData): MindmapStats {
  let nodeCount = 0
  let maxDepth = 0
  const root = data?.nodeData
  if (!root) return { nodeCount: 0, maxDepth: 0 }
  const stack: Array<{ node: NodeObj; depth: number }> = [{ node: root, depth: 1 }]
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    nodeCount++
    if (depth > maxDepth) maxDepth = depth
    for (const child of node.children ?? []) stack.push({ node: child, depth: depth + 1 })
  }
  return { nodeCount, maxDepth }
}

/** 导入前守卫：返回违规消息（null = 可导入）。md 按「行数即节点数、相对深度 = 最大 - 最小 + 1」估算 */
export function findImportViolation(md: string): string | null {
  const lines = parseLines(md)
  if (lines.length === 0) return null
  const minDepth = Math.min(...lines.map(l => l.depth))
  const maxDepth = Math.max(...lines.map(l => l.depth)) - minDepth + 1
  const problems: string[] = []
  if (maxDepth > MINDMAP_MAX_DEPTH) problems.push(`层级 ${maxDepth} 超上限 ${MINDMAP_MAX_DEPTH}`)
  if (lines.length > MINDMAP_MAX_NODES) problems.push(`节点 ${lines.length} 超上限 ${MINDMAP_MAX_NODES}`)
  if (problems.length === 0) return null
  return `导入取消：${problems.join('、')}。mind-elixir 无虚拟化，超限会拖垮或打爆渲染进程；建议拆分导入或精简大纲`
}
