import { describe, it, expect } from 'vitest'
import {
  clampLines,
  countChars,
  exceedsLimit,
  normalizeCharLimit,
  normalizeMaxLines,
  toDisplayText,
  withQuoteMark,
} from '../board/forms/sentenceText'

describe('sentenceText / 配置归一化', () => {
  it('maxLines 默认 3，夹在 1–10', () => {
    expect(normalizeMaxLines(undefined)).toBe(3)
    expect(normalizeMaxLines('abc')).toBe(3)
    expect(normalizeMaxLines(0)).toBe(1)
    expect(normalizeMaxLines(-5)).toBe(1)
    expect(normalizeMaxLines(99)).toBe(10)
    expect(normalizeMaxLines(4.6)).toBe(5)
  })

  it('charLimit 默认 120，非正数与非数字一律回退默认', () => {
    expect(normalizeCharLimit(undefined)).toBe(120)
    expect(normalizeCharLimit(0)).toBe(120)
    expect(normalizeCharLimit(-1)).toBe(120)
    expect(normalizeCharLimit(Number.NaN)).toBe(120)
    expect(normalizeCharLimit(50)).toBe(50)
  })
})

describe('sentenceText / 行钳制', () => {
  it('未超行数时原样返回且不标记截断', () => {
    const r = clampLines('第一行\n第二行', 3)
    expect(r.lines).toEqual(['第一行', '第二行'])
    expect(r.clamped).toBe(false)
  })

  it('超出 maxLines 时截断并标记', () => {
    const r = clampLines('a\nb\nc\nd\ne', 3)
    expect(r.lines).toEqual(['a', 'b', 'c'])
    expect(r.clamped).toBe(true)
  })

  it('保留空行（空行是用户的版式意图）', () => {
    const r = clampLines('第一行\n\n第三行', 3)
    expect(r.lines).toEqual(['第一行', '', '第三行'])
  })

  it('兼容 CRLF 换行（Windows 粘贴文本）', () => {
    expect(clampLines('a\r\nb', 3).lines).toEqual(['a', 'b'])
  })

  it('空文本返回单个空行（渲染层据此显示占位）', () => {
    expect(clampLines('', 3).lines).toEqual([''])
  })
})

describe('sentenceText / 字数统计（软上限只提示不截断）', () => {
  it('中文按字计数，忽略首尾空白', () => {
    expect(countChars('  主角夜访旧宅  ')).toBe(6)
  })

  it('代理对（emoji / 生僻字）算一个字符', () => {
    expect(countChars('🌊')).toBe(1)
    expect(countChars('海🌊风')).toBe(3)
  })

  it('空文本为 0', () => {
    expect(countChars('')).toBe(0)
    expect(countChars('   ')).toBe(0)
  })

  it('超限判定只看是否超过，不做截断', () => {
    const long = '字'.repeat(121)
    expect(exceedsLimit(long, 120)).toBe(true)
    expect(long.length).toBe(121) // 原文未被改动
    expect(exceedsLimit('字'.repeat(120), 120)).toBe(false)
  })

  it('未传上限时用默认 120', () => {
    expect(exceedsLimit('字'.repeat(121), Number.NaN)).toBe(true)
  })
})

describe('sentenceText / 引号装饰', () => {
  it('开启且有内容时包中文引号', () => {
    expect(withQuoteMark('主角夜访旧宅', true)).toBe('「主角夜访旧宅」')
  })

  it('关闭时原样返回', () => {
    expect(withQuoteMark('主角夜访旧宅', false)).toBe('主角夜访旧宅')
  })

  it('空文本或纯空白不加引号（避免出现空的引号对）', () => {
    expect(withQuoteMark('', true)).toBe('')
    expect(withQuoteMark('   ', true)).toBe('   ')
  })
})

describe('sentenceText / 展示文本（组合规则）', () => {
  it('钳制 + 引号同时生效', () => {
    const r = toDisplayText('a\nb\nc\nd', { maxLines: 2, quoteMark: true })
    expect(r.text).toBe('「a\nb」')
    expect(r.clamped).toBe(true)
    expect(r.empty).toBe(false)
  })

  it('空文本标记 empty，供渲染层显示占位', () => {
    expect(toDisplayText('   ', { maxLines: 3 }).empty).toBe(true)
    expect(toDisplayText('有内容', { maxLines: 3 }).empty).toBe(false)
  })

  it('不解析 markdown（按纯文本处理）', () => {
    const r = toDisplayText('**粗体**不是粗体', { maxLines: 3 })
    expect(r.text).toBe('**粗体**不是粗体')
  })
})
