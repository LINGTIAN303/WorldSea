/**
 * 思维导图 ↔ Markdown 大纲互转
 *
 * 统一大纲规则（双向对称）：
 * - 根节点 → `# 标题`
 * - 其余节点 → 无序列表 `- `，按深度缩进（2 空格/层）
 * - 解析端兼容「标题树」：# ~ ###### 按级别作为深度（与笔记芽联动导入
 *   场景——笔记文档通常以标题组织）；列表项深度 = 所属标题深度 + 1 + 缩进级
 * - 代码块内容跳过；空行忽略
 */
import type { MindElixirData, NodeObj } from 'mind-elixir'

interface OutlineLine {
  depth: number
  text: string
}

/** 解析 Markdown 大纲为 {depth, text} 线性序列 */
function parseLines(md: string): OutlineLine[] {
  const lines: OutlineLine[] = []
  let inCodeBlock = false
  let lastHeadingDepth = 0

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
      lines.push({ depth, text: heading[2].trim() })
      continue
    }

    // 无序列表：- / * / +，2 空格缩进 = 一层
    const list = line.match(/^(\s*)[-*+]\s+(.+)$/)
    if (list) {
      const indentLevels = Math.floor(list[1].replace(/\t/g, '  ').length / 2)
      lines.push({ depth: lastHeadingDepth + 1 + indentLevels, text: list[2].trim() })
      continue
    }

    // 有序列表：1. 形式，同无序处理（保序）
    const ordered = line.match(/^(\s*)\d+[.)]\s+(.+)$/)
    if (ordered) {
      const indentLevels = Math.floor(ordered[1].replace(/\t/g, '  ').length / 2)
      lines.push({ depth: lastHeadingDepth + 1 + indentLevels, text: ordered[2].trim() })
      continue
    }

    // 普通文本行：挂在最近一个标题下（追加为其子节点）；无前置标题时作为根
    if (lines.length === 0) {
      lines.push({ depth: 1, text: line.trim() })
    } else {
      const prev = lines[lines.length - 1]
      lines.push({ depth: prev.depth + 1, text: line.trim() })
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

/** Markdown 大纲 → mind-elixir 数据（空/无效输入返回 null） */
export function markdownToMindElixir(md: string): MindElixirData | null {
  const root = buildTree(parseLines(md))
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
