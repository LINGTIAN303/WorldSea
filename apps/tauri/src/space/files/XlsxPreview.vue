<!--
  XlsxPreview —— Excel（.xlsx）只读预览

  本组件只做「渲染」；解析 / 形状转换 / 截断判定全在 `xlsxToTables.ts`（纯函数，已单测覆盖：
  `__tests__/xlsxToTables.spec.ts`）。其中三条硬约束（文件头校验、行/列封顶、不读 .xls）
  的原因写在那个模块的文件头注释里，改动前请先读。

  之所以把表格交给通用 `DataTable`（@worldsea/ui-kit）而非另起 DOM：二期要让表格可编辑
  （xlsx 回写）时无需再搬一次。
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
import { DataTable } from '@worldsea/ui-kit'
import { xlsxToTables, type SheetTable } from './xlsxToTables'

const props = defineProps<{ data: ArrayBuffer }>()

const error = ref('')
const sheets = ref<SheetTable[]>([])

function build(): void {
  const result = xlsxToTables(props.data)
  if (!result.ok) {
    error.value = result.error
    sheets.value = []
    console.warn('[XlsxPreview]', result.error)
    return
  }
  error.value = ''
  sheets.value = result.sheets
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
