/**
 * xlsxToTables —— .xlsx 字节 → 通用 DataTable 输入（纯函数，无 Vue / 无 IO）
 *
 * 从 `XlsxPreview.vue` 抽出，目的是让这段「解析 + 形状转换 + 截断」逻辑可被单测覆盖
 * （apps/tauri 原先不参与 vitest，见 vitest.config.ts 的 include）。
 *
 * 三条硬约束（都来自实测取证，改动前请先读）：
 * 1. **必须校验文件头**：SheetJS 对无法识别的内容会**静默回落为 CSV/文本解析且不抛错**
 *    （实测垃圾字节 / 纯文本 / 空字节 / HTML 表格都返回一张名为 Sheet1 的「表」，
 *    只有 zip 结构损坏才抛 `Unsupported ZIP file`）。不校验则损坏文件会被渲染成一张
 *    看起来正常的表 —— 静默误导。OOXML 按规范必为 ZIP，故 `PK\x03\x04` 是确定性判据。
 * 2. **行/列数封顶**：超大表直接铺 DOM 会冻界面，截断必须**如实标注**（不静默截断）。
 * 3. **不读 .xls**：该扩展名现实中常是「HTML 表格改名」，与第 1 条同源、无法用文件头
 *    确定性区分，故调用方（FilePreview）把 .xls 留在「不可预览」列表。
 */
import * as XLSX from 'xlsx'
import type { DataTableColumn } from '@worldsea/ui-kit'

/** 单表渲染上限：超过则在标题上如实标注 */
export const MAX_ROWS = 2000
export const MAX_COLS = 100

export interface SheetTable {
  title: string
  columns: DataTableColumn[]
  rows: Record<string, unknown>[]
}

export type XlsxParseResult =
  | { ok: true; sheets: SheetTable[] }
  | { ok: false; error: string }

/** 列序号 → Excel 列名（0→A，25→Z，26→AA…）；首行无表头时作为兜底列名 */
export function columnLabel(index: number): string {
  let label = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** XLSX 文件头校验（ZIP：`PK\x03\x04`）—— 见文件头注释第 1 条 */
export function hasXlsxSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/**
 * 解析 .xlsx 字节为各工作表的表格数据。
 *
 * @param data 文件原始字节。**内部按副本读取**，不修改也不转移调用方的 buffer
 *             （与 pdfjs 不同，SheetJS 不 transfer，但保持一致习惯）。
 * @returns 成功为各表数据；失败为可直接展示的中文文案（调用方不需要理解错误类型）。
 */
export function xlsxToTables(data: ArrayBuffer): XlsxParseResult {
  const bytes = new Uint8Array(data.slice(0))
  if (!hasXlsxSignature(bytes)) {
    return {
      ok: false,
      error: '文件头不是 XLSX（ZIP）格式 —— 可能是加密文件、损坏文件，或扩展名与实际内容不符',
    }
  }

  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: 'array' })
  } catch (e: unknown) {
    return { ok: false, error: 'Excel 解析失败：' + (e instanceof Error ? e.message : String(e)) }
  }

  const sheets: SheetTable[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue

    // raw:false 取「格式化后的显示值」（Excel 单元格里看到的文本），符合预览语义；
    // defval:'' 让空单元格占位，避免行内下标错位
    const matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
    }) as unknown[][]

    if (matrix.length === 0) {
      sheets.push({ title: `${name}（空表）`, columns: [], rows: [] })
      continue
    }

    const headerRow = matrix[0].slice(0, MAX_COLS)
    const columns: DataTableColumn[] = headerRow.map((cell, i) => ({
      key: `c${i}`,
      label: cell === '' || cell === null || cell === undefined ? columnLabel(i) : String(cell),
    }))

    const dataRows = matrix.slice(1)
    const rows = dataRows.slice(0, MAX_ROWS).map((r) => {
      const row: Record<string, unknown> = {}
      columns.forEach((col, i) => { row[col.key] = r[i] ?? '' })
      return row
    })

    // 截断如实告知（不静默）
    const notes: string[] = []
    if (dataRows.length > MAX_ROWS) notes.push(`共 ${dataRows.length} 行，已显示前 ${MAX_ROWS} 行`)
    if ((matrix[0]?.length ?? 0) > MAX_COLS) notes.push(`已显示前 ${MAX_COLS} 列`)
    sheets.push({
      title: notes.length > 0 ? `${name}（${notes.join('；')}）` : name,
      columns,
      rows,
    })
  }

  return { ok: true, sheets }
}
