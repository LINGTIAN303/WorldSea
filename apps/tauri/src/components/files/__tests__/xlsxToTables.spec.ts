/**
 * xlsxToTables 单测
 *
 * 覆盖三组：
 * ① 形状转换 —— 表头取首行、数据对齐、多表、仅表头、无表头时兜底列名；
 * ② 截断 —— 行/列封顶，且标题**如实标注**（不静默截断）；
 * ③ 文件头门槛 —— 垃圾字节 / 纯文本 / 空字节 / HTML 改名文件**必须被拦下**。
 *    第 ③ 组是这组测试的主要动机：SheetJS 对无法识别的内容**不抛错**而是静默回落为
 *    CSV/文本解析并返回一张名为 Sheet1 的「表」（实测），若没有门槛就会把损坏文件
 *    渲染成一张看起来正常的表。
 */
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { columnLabel, hasXlsxSignature, xlsxToTables, MAX_COLS, MAX_ROWS } from '../xlsxToTables'

/** 用 SheetJS 自身生成真实 ZIP 结构的 xlsx 字节 */
function makeXlsx(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

/** 文本 → ArrayBuffer（模拟「改名文件」） */
function textBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer
}

describe('columnLabel', () => {
  it('单字母与进位边界', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(27)).toBe('AB')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(52)).toBe('BA')
    expect(columnLabel(99)).toBe('CV')
  })
})

describe('hasXlsxSignature', () => {
  it('ZIP 头通过，其余拒绝', () => {
    expect(hasXlsxSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true)
    // 长度不足
    expect(hasXlsxSignature(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false)
    // CFB（OLE/加密容器）不通过
    expect(hasXlsxSignature(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).toBe(false)
    expect(hasXlsxSignature(new TextEncoder().encode('hello'))).toBe(false)
  })
})

describe('xlsxToTables · 形状转换', () => {
  it('列定义取自首行，数据按列对齐', () => {
    const data = makeXlsx({
      设定表: [['物品名', '类别', '数量'], ['灰烬之刃', '武器', 3], ['星辉石', '材料', 12]],
    })
    const result = xlsxToTables(data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheets).toHaveLength(1)
    expect(result.sheets[0].title).toBe('设定表')
    expect(result.sheets[0].columns.map((c) => c.label)).toEqual(['物品名', '类别', '数量'])
    expect(result.sheets[0].rows[0]).toEqual({ c0: '灰烬之刃', c1: '武器', c2: '3' })
    expect(result.sheets[0].rows).toHaveLength(2)
  })

  it('首行为空时回落为 A/B/C 列名', () => {
    const data = makeXlsx({ 无表头: [['', '', ''], ['甲', '乙', '丙']] })
    const result = xlsxToTables(data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheets[0].columns.map((c) => c.label)).toEqual(['A', 'B', 'C'])
    expect(result.sheets[0].rows[0]).toEqual({ c0: '甲', c1: '乙', c2: '丙' })
  })

  it('多工作表逐个成表；仅表头者 rows 为空', () => {
    const data = makeXlsx({
      只有表头: [['仅表头']],
      第二表: [['甲', '乙'], [1, 2], [3, 4]],
    })
    const result = xlsxToTables(data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheets.map((s) => s.title)).toEqual(['只有表头', '第二表'])
    expect(result.sheets[0].rows).toHaveLength(0)
    expect(result.sheets[1].rows).toHaveLength(2)
  })

  it('不修改调用方的 buffer（内部按副本读取）', () => {
    const data = makeXlsx({ S: [['A'], [1]] })
    const before = new Uint8Array(data.slice(0))
    xlsxToTables(data)
    expect(new Uint8Array(data)).toEqual(before)
    expect(data.byteLength).toBeGreaterThan(0)
  })
})

describe('xlsxToTables · 截断如实标注', () => {
  it('超宽表截到 MAX_COLS 并在标题标注', () => {
    const width = MAX_COLS + 5
    const data = makeXlsx({
      超宽表: [
        Array.from({ length: width }, (_, i) => `列${i + 1}`),
        Array.from({ length: width }, (_, i) => i),
      ],
    })
    const result = xlsxToTables(data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheets[0].columns).toHaveLength(MAX_COLS)
    expect(result.sheets[0].title).toContain(`已显示前 ${MAX_COLS} 列`)
  })

  it('超长表截到 MAX_ROWS 并在标题标注实际行数', () => {
    const total = MAX_ROWS + 5
    const rows: unknown[][] = [['值']]
    for (let i = 0; i < total; i++) rows.push([i])
    const data = makeXlsx({ 长表: rows })
    const result = xlsxToTables(data)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheets[0].rows).toHaveLength(MAX_ROWS)
    expect(result.sheets[0].title).toContain(`共 ${total} 行`)
    expect(result.sheets[0].title).toContain(`已显示前 ${MAX_ROWS} 行`)
  })
})

describe('xlsxToTables · 文件头门槛（SheetJS 静默回落防线）', () => {
  it('垃圾字节被拦下', () => {
    const result = xlsxToTables(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer as ArrayBuffer)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('文件头不是 XLSX')
  })

  it('纯文本被拦下', () => {
    const result = xlsxToTables(textBytes('这不是一个表格文件，只是一段普通中文文本。'))
    expect(result.ok).toBe(false)
  })

  it('空字节被拦下', () => {
    const result = xlsxToTables(new Uint8Array([]).buffer as ArrayBuffer)
    expect(result.ok).toBe(false)
  })

  it('HTML 表格改名文件被拦下', () => {
    const result = xlsxToTables(textBytes('<table><tr><td>a</td></tr></table>'))
    expect(result.ok).toBe(false)
  })

  it('有 ZIP 头但结构损坏 → 走解析失败分支（而非静默空表）', () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]).buffer as ArrayBuffer
    const result = xlsxToTables(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Excel 解析失败')
  })

  it('合法 xlsx 不被门槛误伤（对照组）', () => {
    const result = xlsxToTables(makeXlsx({ S: [['A'], [1]] }))
    expect(result.ok).toBe(true)
  })
})
