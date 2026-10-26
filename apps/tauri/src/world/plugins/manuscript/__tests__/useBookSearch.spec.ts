/**
 * 全书跨章搜索测试（批3）：块级提取（嵌套去重/裸文本兜底）、命中数与片段边界、
 * 大小写不敏感（与小写化守卫口径一致）、空词/无命中短路。
 */
import { describe, it, expect } from 'vitest'
import type { Entity } from '@worldsea/entity-core'
import { chapterText, searchBookChapters } from '../composables/useBookSearch'

function chapter(id: string, name: string, html: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'manuscript', name, description: '', properties: { content: html }, tags: [], createdAt: now, updatedAt: now }
}

describe('chapterText · 块级提取', () => {
  it('块级元素切行（p 分行，跨块假命中被阻断）', () => {
    const t = chapterText('<p>海风</p><p>海浪</p>')
    expect(t).toBe('海风\n海浪')
    expect(t.includes('海风海浪')).toBe(false)
  })

  it('嵌套去重：blockquote>p 只计一次', () => {
    const t = chapterText('<blockquote><p>引文内容</p></blockquote>')
    expect(t).toBe('引文内容')
  })

  it('无块级结构（裸文本）整体兜底', () => {
    expect(chapterText('裸文本内容')).toBe('裸文本内容')
    expect(chapterText('')).toBe('')
  })
})

describe('searchBookChapters · 跨章扫描', () => {
  const chapters = [
    chapter('c1', '第1章', '<p>深海之中一片黑暗。</p><p>深海之外是光明。</p>'),
    chapter('c2', '第2章', '<p>这里没有关键词。</p>'),
    chapter('c3', '第3章', '<p>DeepSea is the term.</p>'),
  ]

  it('跨章命中：计数与首处片段', () => {
    const hits = searchBookChapters(chapters, '深海')
    expect(hits.length).toBe(1)
    expect(hits[0].chapterId).toBe('c1')
    expect(hits[0].count).toBe(2)
    expect(hits[0].snippet).toContain('深海')
    expect(hits[0].matchLen).toBe(2)
  })

  it('大小写不敏感（英文语境）', () => {
    const hits = searchBookChapters(chapters, 'deepsea')
    expect(hits.length).toBe(1)
    expect(hits[0].chapterId).toBe('c3')
    expect(hits[0].count).toBe(1)
    // 片段保留原始大小写
    expect(hits[0].snippet).toContain('DeepSea')
  })

  it('空词与无命中短路', () => {
    expect(searchBookChapters(chapters, '')).toEqual([])
    expect(searchBookChapters(chapters, '   ')).toEqual([])
    expect(searchBookChapters(chapters, '不存在的词')).toEqual([])
  })

  it('片段边界：命中紧贴开头时无前省略号，全文不足上下文长度则整段呈现', () => {
    const hits = searchBookChapters(chapters, '深海之中')
    expect(hits[0].snippet.startsWith('深海之中')).toBe(true)
    // 全文 18 字 < 24 字上下文 → 无尾部省略号（整段都在片段里）
    expect(hits[0].snippet.endsWith('…')).toBe(false)
    expect(hits[0].snippet).toContain('深海之外是光明。')
    expect(hits[0].matchStart).toBe(0)
  })
})
