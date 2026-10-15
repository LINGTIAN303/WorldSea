/**
 * contentNormalize · 解析前容错契约（块 1 阶段 3 重写，2026-10-15）
 *
 * 契约：markdown 文本的解析前容错——表格空行修复（围栏安全）；幂等；不改写其它结构。
 * 历史（2026-10-11「装载网关三态归一」）已随 md 真相源转型退役，测试同步重写。
 */
import { describe, it, expect } from 'vitest'
import { repairTableBlankLines, normalizeNoteContent } from '../contentNormalize'

describe('contentNormalize · 表格空行修复（md 容错）', () => {
  it('表头 / 分隔行 / 数据行之间空行全压缩', () => {
    const md = '| 列A | 列B |\n\n| --- | --- |\n\n| 1 | 2 |\n'
    expect(repairTableBlankLines(md)).toBe('| 列A | 列B |\n| --- | --- |\n| 1 | 2 |\n')
  })

  it('仅压缩「管道行 + 空行 + 管道行」——普通段落空行不动', () => {
    const md = '第一段\n\n第二段\n\n| A |\n| --- |\n| 1 |\n\n尾段\n'
    expect(repairTableBlankLines(md)).toBe(md)
  })

  it('管道行后空行 + 非管道行 → 不压缩', () => {
    const md = '| A |\n\n普通段落\n'
    expect(repairTableBlankLines(md)).toBe(md)
  })

  it('围栏（```）内原样保留（含管道形态与空行）', () => {
    const md = '```\n| A |\n\n| B |\n```\n'
    expect(repairTableBlankLines(md)).toBe(md)
  })

  it('「a | b」普通文本不误伤（非首尾管道）', () => {
    const md = 'a | b\n\nc | d\n'
    expect(repairTableBlankLines(md)).toBe(md)
  })

  it('连续多段空行压缩为一个换行', () => {
    const md = '| A |\n\n\n\n| B |\n'
    expect(repairTableBlankLines(md)).toBe('| A |\n| B |\n')
  })

  it('幂等：修复后再次运行无变化', () => {
    const once = repairTableBlankLines('| A |\n\n| --- |\n\n| 1 |\n')
    expect(repairTableBlankLines(once)).toBe(once)
  })

  it('normalizeNoteContent：空输入 → 空输出；无表格 → 原样', () => {
    expect(normalizeNoteContent('')).toBe('')
    const plain = '# 标题\n\n正文\n'
    expect(normalizeNoteContent(plain)).toBe(plain)
  })
})
