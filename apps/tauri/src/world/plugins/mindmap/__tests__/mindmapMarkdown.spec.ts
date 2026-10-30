/**
 * 思维导图 Markdown 解析守卫测试
 * 缘起：worldsea-codex.md（306KB / 6901 行）导入崩溃——纯文本行逐行级联下沉堆出 1097 层链，
 * mind-elixir 按树深度嵌套 DOM，千层嵌套打爆渲染进程原生栈（STATUS_STACK_OVERFLOW 整页崩溃）。
 */
import { describe, expect, it } from 'vitest'
import {
  markdownToMindElixir,
  mindElixirToMarkdown,
  mindElixirStats,
  findImportViolation,
  MINDMAP_MAX_NODES,
  MINDMAP_MAX_DEPTH,
  MINDMAP_OPEN_MAX_NODES,
  MINDMAP_OPEN_MAX_DEPTH,
} from '../mindmapMarkdown'
import type { MindElixirData } from 'mind-elixir'

/** 造 N 层链状数据（复刻崩溃形态：连续纯文本行级联） */
function makeChainData(depth: number): MindElixirData {
  let node: any = { id: 'leaf', topic: '叶子' }
  for (let i = 0; i < depth - 1; i++) {
    node = { id: `n${i}`, topic: `层${i}`, children: [node] }
  }
  return { nodeData: node }
}

describe('纯文本行级联修复', () => {
  it('连续多行纯文本挂最近结构行下作兄弟节点，深度有界', () => {
    const md = ['# 根', '描述第一段', '描述第二段', '描述第三段'].join('\n')
    const data = markdownToMindElixir(md)!
    // 三行描述是根的三个兄弟子节点，而不是链
    expect(data.nodeData.children?.length).toBe(3)
    expect(data.nodeData.children?.map(c => c.topic)).toEqual(['描述第一段', '描述第二段', '描述第三段'])
    expect(mindElixirStats(data).maxDepth).toBe(2)
  })

  it('崩溃形态回归：标题 + 多段描述 + 字段列表，深度有界不级联', () => {
    const md = [
      '# 设定集',
      '## 地理与场所',
      '### 建筑（2）',
      '#### 纯真主堂',
      '描述段一',
      '描述段二',
      '- **位置**：纯真教派建筑群内',
      '- **类型**：其他',
    ].join('\n')
    const data = markdownToMindElixir(md)!
    const stats = mindElixirStats(data)
    // 纯真主堂下：描述两行成兄弟，字段列表同层（h1-h4 各占一层 → 最深 5）
    expect(stats.maxDepth).toBe(5)
    expect(stats.nodeCount).toBe(8)
  })

  it('导出再导入往返：级联修复不破坏对称性', () => {
    const md = ['# 根', '描述一', '描述二'].join('\n')
    const data = markdownToMindElixir(md)!
    const md2 = mindElixirToMarkdown(data)
    const data2 = markdownToMindElixir(md2)!
    expect(mindElixirStats(data2)).toEqual(mindElixirStats(data))
  })
})

describe('导入护栏', () => {
  it('上限常量合理', () => {
    expect(MINDMAP_MAX_NODES).toBe(2000)
    expect(MINDMAP_MAX_DEPTH).toBe(40)
    expect(MINDMAP_OPEN_MAX_NODES).toBeGreaterThan(MINDMAP_MAX_NODES)
    expect(MINDMAP_OPEN_MAX_DEPTH).toBeGreaterThan(MINDMAP_MAX_DEPTH)
  })

  it('节点数超限拒绝（复刻 6901 行大文件形态）', () => {
    const lines = ['# 根', ...Array.from({ length: MINDMAP_MAX_NODES + 1 }, () => '内容行')]
    const violation = findImportViolation(lines.join('\n'))
    expect(violation).toContain(`节点 ${MINDMAP_MAX_NODES + 2} 超上限 ${MINDMAP_MAX_NODES}`)
  })

  it('层级超限拒绝（深缩进列表）', () => {
    const lines = ['# 根', ...Array.from({ length: MINDMAP_MAX_DEPTH + 1 }, (_, i) => `${'  '.repeat(i)}- 第${i}层`)]
    const violation = findImportViolation(lines.join('\n'))
    expect(violation).toContain(`层级 ${MINDMAP_MAX_DEPTH + 2} 超上限 ${MINDMAP_MAX_DEPTH}`)
  })

  it('正常文件不触发守卫', () => {
    const md = ['# 设定集', '## 域', '### 类型（1）', '#### 条目', '描述', '- 字段一', '- 字段二'].join('\n')
    expect(findImportViolation(md)).toBeNull()
  })
})

describe('mindElixirStats（迭代遍历，不递归）', () => {
  it('千层链数据统计正确且不爆栈', () => {
    const stats = mindElixirStats(makeChainData(3000))
    expect(stats.nodeCount).toBe(3000)
    expect(stats.maxDepth).toBe(3000)
  })

  it('空数据返回零值', () => {
    expect(mindElixirStats({} as MindElixirData)).toEqual({ nodeCount: 0, maxDepth: 0 })
  })
})

describe('仅标题模式', () => {
  it('只取标题行：列表与纯文本跳过，标题嵌套成树', () => {
    const md = [
      '# 设定集',
      '## 域',
      '正文段落（应跳过）',
      '### 类型',
      '- 字段一（应跳过）',
      '1. 有序项（应跳过）',
      '#### 条目',
      '描述（应跳过）',
    ].join('\n')
    const data = markdownToMindElixir(md, { headingsOnly: true })!
    const stats = mindElixirStats(data)
    expect(stats.nodeCount).toBe(4)
    expect(stats.maxDepth).toBe(4)
    expect(data.nodeData.children?.[0]?.topic).toBe('域')
  })

  it('代码块内的 # 行不误判为标题', () => {
    const md = ['# 根', '```bash', '# 这是注释', '```'].join('\n')
    const data = markdownToMindElixir(md, { headingsOnly: true })!
    expect(mindElixirStats(data).nodeCount).toBe(1)
  })

  it('大文件逃生门形态：完整解析超限、仅标题后可导入', () => {
    // 复刻 worldsea-codex.md 形态：h1-h4 骨架 + 每条目多行描述与字段列表
    const lines: string[] = ['# 设定集']
    for (let i = 0; i < 800; i++) {
      lines.push('#### 条目' + i, '描述段一', '描述段二', '- 字段一', '- 字段二', '- 字段三')
    }
    const md = lines.join('\n')
    expect(findImportViolation(md)).toContain('超上限')
    const fallback = markdownToMindElixir(md, { headingsOnly: true })!
    const stats = mindElixirStats(fallback)
    expect(stats.nodeCount).toBe(801)
    expect(findImportViolation !== null).toBe(true)
    // 仅标题结果本身应可通过护栏（相对深度 4 ≤ 40、节点 801 ≤ 2000）
    expect(stats.nodeCount).toBeLessThanOrEqual(MINDMAP_MAX_NODES)
    expect(stats.maxDepth).toBeLessThanOrEqual(MINDMAP_MAX_DEPTH)
  })

  it('无标题纯文本文件：仅标题模式解析为空', () => {
    const md = ['普通行一', '普通行二'].join('\n')
    expect(markdownToMindElixir(md, { headingsOnly: true })).toBeNull()
  })
})
