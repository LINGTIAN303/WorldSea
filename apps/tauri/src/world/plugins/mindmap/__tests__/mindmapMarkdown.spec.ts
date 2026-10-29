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
