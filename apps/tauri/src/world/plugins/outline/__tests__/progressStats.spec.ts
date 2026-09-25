/**
 * progressStats 单测 —— 进度式表现形式的统计纯函数。
 * 口径对齐原「进度总览」页签（OutlineView.vue:106-117 / :314-324）：
 * 完成度 = round(完成节点数 / 总节点数 × 100)，空集为 0。
 */
import { describe, it, expect } from 'vitest'
import { computeProgressStats, formatCount, NODE_STATUSES, statusOf } from '../board/forms/progressStats'

function node(id: string, status?: string, wordCount?: unknown) {
  return { id, name: `节点${id}`, properties: { parentId: '', order: 0, status, wordCount } }
}

describe('progressStats / statusOf', () => {
  it('三态原样返回', () => {
    expect(statusOf(node('a', '完成'))).toBe('完成')
    expect(statusOf(node('a', '草稿'))).toBe('草稿')
    expect(statusOf(node('a', '未写'))).toBe('未写')
  })

  it('缺失 / 未知 / 非法值一律计入「未写」（不新增状态）', () => {
    expect(statusOf(node('a'))).toBe('未写')
    expect(statusOf(node('a', '已完成'))).toBe('未写')
    expect(statusOf(node('a', ''))).toBe('未写')
    expect(statusOf(undefined)).toBe('未写')
  })
})

describe('progressStats / computeProgressStats', () => {
  it('节点数 / 字数 / 三态计数 / 完成度', () => {
    const stats = computeProgressStats([
      node('a', '完成', 100),
      node('b', '完成', 50),
      node('c', '草稿', 25),
      node('d', '未写'),
    ])
    expect(stats.total).toBe(4)
    expect(stats.wordCount).toBe(175)
    expect(stats.done).toBe(2)
    expect(stats.draft).toBe(1)
    expect(stats.todo).toBe(1)
    expect(stats.completionPct).toBe(50)
    expect(stats.statusCounts).toEqual({ 未写: 1, 草稿: 1, 完成: 2 })
  })

  it('完成度取整（round），不是截断', () => {
    expect(computeProgressStats([node('a', '完成'), node('b'), node('c')]).completionPct).toBe(33)
    expect(computeProgressStats([node('a', '完成'), node('b', '完成'), node('c')]).completionPct).toBe(67)
  })

  it('空集：全 0，不出现 NaN', () => {
    const stats = computeProgressStats([])
    expect(stats).toMatchObject({ total: 0, wordCount: 0, done: 0, completionPct: 0 })
    expect(Number.isNaN(stats.completionPct)).toBe(false)
  })

  it('字数的非法值不参与累加（字符串数字 / 负数 / 非数字）', () => {
    const stats = computeProgressStats([
      node('a', '未写', '100'),
      node('b', '未写', -20),
      node('c', '未写', 'abc'),
      node('d', '未写'),
    ])
    expect(stats.wordCount).toBe(100)
  })

  it('全部完成 → 100%', () => {
    expect(computeProgressStats([node('a', '完成'), node('b', '完成')]).completionPct).toBe(100)
  })

  it('NODE_STATUSES 恒为三态、顺序即展示顺序', () => {
    expect([...NODE_STATUSES]).toEqual(['未写', '草稿', '完成'])
  })
})

describe('progressStats / formatCount', () => {
  it('千分位；非数值兜底为 0', () => {
    expect(formatCount(12500)).toBe('12,500')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(Number.NaN)).toBe('0')
  })
})
