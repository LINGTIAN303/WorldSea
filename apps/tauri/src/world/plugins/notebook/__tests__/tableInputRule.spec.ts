/**
 * tableInputRule 纯函数解析器契约（批 1 I3，2026-10-12）。
 *
 * 锁定 parseTableRow / isDividerRow / parseMdTable 的边界：
 * 管道形态 / `\|` 转义 / 分隔行字符集 / 列数一致性 / 表头+分隔即转 / 混排文本拒绝。
 */
import { describe, it, expect } from 'vitest'
import { parseTableRow, isDividerRow, parseMdTable } from '../composables/tableInputRule'

describe('parseTableRow · 单行解析', () => {
  it('标准双竖线形态', () => {
    expect(parseTableRow('| 名称 | 值 |')).toEqual(['名称', '值'])
  })
  it('省略首尾竖线', () => {
    expect(parseTableRow('名称 | 值')).toEqual(['名称', '值'])
  })
  it('单元格内空白裁剪', () => {
    expect(parseTableRow('|  a  |  b  |')).toEqual(['a', 'b'])
  })
  it('单元格内转义管道不切列', () => {
    expect(parseTableRow('| a\\|b | c |')).toEqual(['a|b', 'c'])
  })
  it('无竖线返回 null', () => {
    expect(parseTableRow('普通文本')).toBeNull()
  })
  it('纯分隔线不是数据行', () => {
    expect(parseTableRow('| --- | --- |')).toBeNull()
  })
})

describe('isDividerRow · 分隔行判定', () => {
  it('标准分隔行', () => {
    expect(isDividerRow('| --- | --- |')).toBe(true)
    expect(isDividerRow('| :--- | :---: |')).toBe(true)
    expect(isDividerRow('---|---')).toBe(true)
  })
  it('无 - 不算分隔行', () => {
    expect(isDividerRow('| a | b |')).toBe(false)
  })
  it('混入字母不算分隔行', () => {
    expect(isDividerRow('| -a- | --- |')).toBe(false)
  })
})

describe('parseMdTable · 整表解析', () => {
  it('表头 + 分隔 + 数据行', () => {
    expect(parseMdTable('| a | b |\n| --- | --- |\n| 1 | 2 |')).toEqual({
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })
  it('表头 + 分隔即转（0 数据行）', () => {
    expect(parseMdTable('| a | b |\n| --- | --- |')).toEqual({ header: ['a', 'b'], rows: [] })
  })
  it('允许表格间空行', () => {
    expect(parseMdTable('| a | b |\n| --- | --- |\n\n| 1 | 2 |')).toEqual({
      header: ['a', 'b'],
      rows: [['1', '2']],
    })
  })
  it('列数不等拒绝', () => {
    expect(parseMdTable('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |')).toBeNull()
  })
  it('分隔行列数与表头不等拒绝', () => {
    expect(parseMdTable('| a | b |\n| --- |')).toBeNull()
  })
  it('缺分隔行拒绝', () => {
    expect(parseMdTable('| a | b |\n| 1 | 2 |')).toBeNull()
  })
  it('列数 < 2 拒绝（单列竖线不构成表格）', () => {
    expect(parseMdTable('| a |\n| --- |')).toBeNull()
  })
  it('纯文本拒绝', () => {
    expect(parseMdTable('普通段落\n第二行')).toBeNull()
  })
})
