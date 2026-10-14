import { describe, it, expect } from 'vitest'
import { kvValueBytes, prettyKvValue, formatKvBytes } from '../kvViewerFormat'

describe('kvValueBytes', () => {
  it('ASCII 按 1 字节计', () => {
    expect(kvValueBytes('abc')).toBe(3)
  })

  it('中文按 UTF-8 3 字节计', () => {
    expect(kvValueBytes('中文')).toBe(6)
  })

  it('空串为 0', () => {
    expect(kvValueBytes('')).toBe(0)
  })
})

describe('prettyKvValue', () => {
  it('对象型 JSON 美化为缩进文本', () => {
    const r = prettyKvValue('{"a":1,"b":[2,3]}')
    expect(r.isJson).toBe(true)
    expect(r.text).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}')
  })

  it('标量 JSON 按原文返回（美化无增益）', () => {
    expect(prettyKvValue('"hello"')).toEqual({ isJson: false, text: '"hello"' })
    expect(prettyKvValue('123')).toEqual({ isJson: false, text: '123' })
  })

  it('非法 JSON 按原文返回', () => {
    expect(prettyKvValue('not json {')).toEqual({ isJson: false, text: 'not json {' })
  })

  it('超大值跳过美化', () => {
    const big = JSON.stringify({ k: 'x'.repeat(300_000) })
    const r = prettyKvValue(big)
    expect(r.isJson).toBe(false)
    expect(r.text).toBe(big)
  })
})

describe('formatKvBytes', () => {
  it('与存储概览同口径分档', () => {
    expect(formatKvBytes(512)).toBe('512 B')
    expect(formatKvBytes(2048)).toBe('2.0 KB')
    expect(formatKvBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
