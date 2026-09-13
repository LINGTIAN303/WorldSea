<!--
  XlsxPreview —— Excel（.xlsx）只读预览

  流程：SheetJS 解析工作簿 → 每个工作表转成通用 `DataTable`（@worldsea/ui-kit）。
  之所以复用 DataTable 而非另起表格 DOM：二期要让表格可编辑（xlsx 回写）时无需再搬一次。

  设计取舍：
  - `raw: false` 取「格式化后的显示值」（即 Excel 单元格里看到的文本），符合预览语义；
  - 多工作表**纵向堆叠**（每表一个 title），不引入页签组件 —— 预览场景下滚动即可；
  - 表头取首行；首行为空或缺失时回落为列号 A/B/C…；
  - 合并单元格只在左上格取值（SheetJS `header:1` 的固有行为）；
  - **行/列数设上限**：超大表直接铺 DOM 会冻界面，故截断并在标题上如实标注（不静默截断）；
  - **文件头须为 ZIP**：SheetJS 对无法识别的内容会静默回落为 CSV/文本解析（见 hasXlsxSignature）；
  - **暂不支持 .xls**：该扩展名在实际数据里常为「HTML 表格改名」，而 SheetJS 对它是宽容解析 ——
    与「垃圾内容也会被当成表」是同一个口子，无法用文件头确定性区分。故 .xls 仍走「不可预览」，
    待后续按 HTML/CFB 分支单独接。
-->
<template>
  <div class="xlsx-host">
    <div v-if="error" class="xlsx-msg">{{ error }}</div>
    <div v-else-if="sheets.length === 0" class="xlsx-msg">工作簿中没有工作表</div>
    <div v-else class="xlsx-scroll">
      <DataTable
        v-for="sheet in sheets"
        :key="sheet.title"
        :title="sheet.title"
        :columns="sheet.columns"
        :rows="sheet.rows"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import { DataTable, type DataTableColumn } from '@worldsea/ui-kit'

/** 单表渲染上限：超过则截断并在标题上如实标注 */
const MAX_ROWS = 2000
const MAX_COLS = 100

/**
 * XLSX 文件头校验（ZIP：`PK\x03\x04`）。
 *
 * 为什么必须校验：SheetJS 对**无法识别的内容会回落为 CSV/文本解析且不抛错** ——
 * 实测 8 字节垃圾 / 纯文本 / 空字节都会返回一张名为 `Sheet1` 的「表」（只有 zip 结构
 * 损坏时才抛 `Unsupported ZIP file`）。若不设门槛，损坏文件、加密文件或扩展名与实际
 * 内容不符的文本，会被渲染成一张**看起来正常**的表 —— 属静默误导。
 *
 * OOXML（.xlsx）按规范必为 ZIP，故该判据是确定性的。加密的 xlsx 是 CFB 容器，会被
 * 此门槛拦下并在提示文案里说明（见下方 error 文案）。
 */
function hasXlsxSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

interface SheetTable {
  title: string
  columns: DataTableColumn[]
  rows: Record<string, unknown>[]
}

const props = defineProps<{ data: ArrayBuffer }>()

const error = ref('')
const sheets = ref<SheetTable[]>([])

/** 列序号 → Excel 列名（0→A，25→Z，26→AA…）；首行无表头时作为兜底列名 */
function columnLabel(index: number): string {
  let label = ''
  let n = index + 1
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

function build(): void {
  error.value = ''
  sheets.value = []
  try {
    const bytes = new Uint8Array(props.data.slice(0))
    if (!hasXlsxSignature(bytes)) {
      error.value = '文件头不是 XLSX（ZIP）格式 —— 可能是加密文件、损坏文件，或扩展名与实际内容不符'
      return
    }
    const wb = XLSX.read(bytes, { type: 'array' })
    const out: SheetTable[] = []
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name]
      if (!ws) continue
      const matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: false,
        defval: '',
      }) as unknown[][]

      if (matrix.length === 0) {
        out.push({ title: `${name}（空表）`, columns: [], rows: [] })
        continue
      }

      const headerRow = matrix[0].slice(0, MAX_COLS)
      const columns: DataTableColumn[] = headerRow.map((cell, i) => ({
        key: `c${i}`,
        label: cell === '' || cell === null || cell === undefined
          ? columnLabel(i)
          : String(cell),
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
      out.push({
        title: notes.length > 0 ? `${name}（${notes.join('；')}）` : name,
        columns,
        rows,
      })
    }
    sheets.value = out
  } catch (e: unknown) {
    error.value = 'Excel 解析失败：' + (e instanceof Error ? e.message : String(e))
    console.warn('[XlsxPreview] 解析失败:', e)
  }
}

onMounted(build)
watch(() => props.data, build)
</script>

<style scoped>
.xlsx-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.xlsx-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.xlsx-msg {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>
