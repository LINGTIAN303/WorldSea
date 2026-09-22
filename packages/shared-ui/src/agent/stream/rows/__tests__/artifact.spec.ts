/**
 * artifact 解析单测（UX-c）：信封识别 / 截断标注提取 / 坐标校验。
 * 解析口径与 Rust 侧逐字对齐（`artifactize_result` 信封 / `EXTERNALIZED_MARKER`）。
 */
import { describe, it, expect } from 'vitest'

import {
  extractExternalizedHashes,
  isValidArtifactHash,
  parseArtifactEnvelope,
} from '../artifact'

const HASH = 'ab12cd34ef567890'

function envelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    artifact: `raw/${HASH}`,
    bytes: 45678,
    note: `结果过大（45678 字节 > 阈值 32768 字节），已落 artifact，仅保留摘要与引用；全文可按坐标取回。原文已外置：raw/${HASH}`,
    preview: '前 400 字符摘要…',
    ...over,
  })
}

describe('parseArtifactEnvelope', () => {
  it('识别合法信封（hash / bytes / note / preview）', () => {
    const env = parseArtifactEnvelope(envelope())
    expect(env).not.toBeNull()
    expect(env?.hash).toBe(HASH)
    expect(env?.bytes).toBe(45678)
    expect(env?.preview).toBe('前 400 字符摘要…')
    expect(env?.note).toContain('原文已外置')
  })

  it('非信封一律 null（普通 JSON / 数组 / 坏 JSON / 坐标格式不符）', () => {
    expect(parseArtifactEnvelope(undefined)).toBeNull()
    expect(parseArtifactEnvelope('')).toBeNull()
    expect(parseArtifactEnvelope('不是 JSON')).toBeNull()
    expect(parseArtifactEnvelope('null')).toBeNull()
    expect(parseArtifactEnvelope('[]')).toBeNull()
    expect(parseArtifactEnvelope(JSON.stringify({ ok: true }))).toBeNull()
    // 缺 raw/ 前缀 / hash 位数不对 / 非十六进制 → 全部拒绝（宁可当普通结果，不发错误坐标）
    expect(parseArtifactEnvelope(envelope({ artifact: HASH }))).toBeNull()
    expect(parseArtifactEnvelope(envelope({ artifact: 'raw/abcd' }))).toBeNull()
    expect(parseArtifactEnvelope(envelope({ artifact: 'raw/ZZZZZZZZZZZZZZZZ' }))).toBeNull()
  })

  it('bytes 非数字 → 回落 0（预览与引用仍可读）', () => {
    const env = parseArtifactEnvelope(envelope({ bytes: 'big' }))
    expect(env?.bytes).toBe(0)
  })
})

describe('extractExternalizedHashes', () => {
  it('提取截断标注坐标（去重保序）', () => {
    const text = `前半段\n…[已截断，省略 12345 字节；原文已外置：raw/${HASH}]…\n` +
      `后半段\n…[已截断，省略 999 字节；原文已外置：raw/0011223344556677]…\n` +
      `重复标注：原文已外置：raw/${HASH}`
    expect(extractExternalizedHashes(text)).toEqual([HASH, '0011223344556677'])
  })

  it('无标注 / 坐标不合法 → 空数组（不猜）', () => {
    expect(extractExternalizedHashes(undefined)).toEqual([])
    expect(extractExternalizedHashes('普通文本')).toEqual([])
    expect(extractExternalizedHashes('原文已外置：raw/短hash')).toEqual([])
    // 位数不足的十六进制串同样拒绝（防止把截断/异形的坐标当有效引用）
    expect(extractExternalizedHashes('原文已外置：raw/abcd1234')).toEqual([])
    expect(extractExternalizedHashes(`原文已外置：raw/${HASH}0`)).toEqual([HASH]) // 超长则截 16 位
  })
})

describe('isValidArtifactHash', () => {
  it('16 位十六进制通过；其余拒绝', () => {
    expect(isValidArtifactHash(HASH)).toBe(true)
    expect(isValidArtifactHash('')).toBe(false)
    expect(isValidArtifactHash('ABCDEF0123456789')).toBe(false) // 大写不收（口径小写）
    expect(isValidArtifactHash('ab12cd34ef56789')).toBe(false) // 15 位
    expect(isValidArtifactHash('../etc/passwd')).toBe(false)
  })
})
