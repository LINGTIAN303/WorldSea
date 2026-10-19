<!--
  DataTable —— 通用数据表格（只读展示 + 可选单元格内联编辑），由 A2UIComponent 内联的 EditableTable
  分支抽出（A2UI 分支与芽视图 xlsx 渲染共用，单一来源）。与 A2UI 解耦：①不认识绑定表达式——值由
  `resolveCell` 传入，默认原样取 `row[col.key]`、不做字符串强转；②样式令牌走 `var(--agent-x, var(--color-y))` 回退链。
-->
<template>
  <div class="ws-dt-wrap">
    <div v-if="title" class="ws-dt-title">{{ title }}</div>
    <div class="ws-dt-scroll">
      <table class="ws-dt">
        <thead>
          <tr>
            <th v-for="col in cols" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in dataRows"
            :key="ri"
            :class="{ 'ws-dt-row--clickable': !!rowKey }"
            @click="onRowClick(row, ri)"
          >
            <td v-for="col in cols" :key="col.key">
              <input
                v-if="col.editable"
                class="ws-dt-input"
                :value="cellValue(row, col, ri)"
                @change="onEdit(ri, col.key, ($event.target as HTMLInputElement).value)"
              />
              <span v-else>{{ cellValue(row, col, ri) ?? '' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/** 列定义：`editable` 为真时该列单元格渲染为可编辑输入框 */
export interface DataTableColumn {
  key: string
  label: string
  editable?: boolean
}

/** 编辑事件负载（与 A2UI `table_edit` 动作的 data 同形） */
export interface DataTableEditPayload {
  rowIndex: number
  key: string
  value: string
}

const props = defineProps<{
  columns?: DataTableColumn[]
  rows?: Record<string, unknown>[]
  title?: string
  /**
   * 取值钩子。缺省直接取 `row[col.key]`。
   * A2UI 传入 `(v) => resolveBinding(v, dataModel)` 以支持绑定表达式。
   */
  resolveCell?: (value: unknown, row: Record<string, unknown>, rowIndex: number) => unknown
  /**
   * 行主键字段名（2026-10-19）。给了才启用行点击——
   * 未给时行为与以前完全一致（无 cursor、不发事件），不干扰既有消费者。
   */
  rowKey?: string
}>()

const emit = defineEmits<{
  edit: [payload: DataTableEditPayload]
  /** 行点击（仅当传了 `rowKey` 时发出；`rowKey` 取不到值时为 null） */
  'row-click': [payload: { rowKey: string | null; rowIndex: number }]
}>()

// 与 A2UI 原实现同样做防御性检查：非数组一律视为空
const cols = computed<DataTableColumn[]>(() => (Array.isArray(props.columns) ? props.columns : []))
const dataRows = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.rows) ? props.rows : [],
)

/** 取单元格值（不转字符串，保留原值交由模板按 Vue 语义显示） */
function cellValue(
  row: Record<string, unknown>,
  col: DataTableColumn,
  rowIndex: number,
): unknown {
  const raw = row?.[col.key]
  return props.resolveCell ? props.resolveCell(raw, row, rowIndex) : raw
}

function onEdit(rowIndex: number, key: string, value: string): void {
  emit('edit', { rowIndex, key, value })
}

/** 行点击：只在传了 rowKey 时上报（保持既有消费者零影响） */
function onRowClick(row: Record<string, unknown>, rowIndex: number): void {
  if (!props.rowKey) return
  const key = String(row?.[props.rowKey] ?? '').trim()
  emit('row-click', { rowKey: key || null, rowIndex })
}
</script>

<style scoped>
.ws-dt-wrap {
  background: var(--agent-bg-tertiary, var(--color-bg-elevated));
  border: 1px solid var(--agent-border, var(--color-border));
  border-radius: var(--radius-md, 8px);
  padding: 10px;
}
.ws-dt-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text, var(--color-text-primary));
  margin-bottom: 8px;
}
.ws-dt-scroll { overflow-x: auto; }
.ws-dt {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}
.ws-dt th {
  padding: 6px 10px;
  text-align: left;
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text-secondary, var(--color-text-tertiary));
  border-bottom: 1px solid var(--agent-border, var(--color-border));
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.ws-dt td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--agent-border, var(--color-border));
  color: var(--agent-text, var(--color-text-primary));
}
.ws-dt-row--clickable { cursor: pointer; }
.ws-dt-row--clickable:hover td { background: var(--agent-bg-secondary, var(--color-bg-hover)); }
.ws-dt-input {
  background: transparent;
  border: 1px solid transparent;
  color: var(--agent-text, var(--color-text-primary));
  font-size: var(--font-size-sm);
  padding: 2px 4px;
  border-radius: 3px;
  width: 100%;
  outline: none;
}
.ws-dt-input:hover { border-color: var(--agent-border, var(--color-border)); }
.ws-dt-input:focus {
  border-color: var(--agent-accent, var(--color-primary));
  background: var(--color-bg-elevated);
}
</style>
