<!--
  DataTable —— 通用数据表格（只读展示 + 可选单元格内联编辑），由 A2UIComponent 内联的 EditableTable
  分支抽出（A2UI 分支与芽视图 xlsx 渲染共用，单一来源）。与 A2UI 解耦：①不认识绑定表达式——值由
  `resolveCell` 传入，默认原样取 `row[col.key]`、不做字符串强转；②样式令牌走 `var(--agent-x, var(--color-y))` 回退链。
-->
<template>
  <div class="ws-dt-wrap">
    <div v-if="title" class="ws-dt-title">{{ title }}</div>
    <div
      class="ws-dt-scroll"
      :class="{ 'ws-dt-scroll--virtual': virtual }"
      :style="scrollStyle"
      @scroll="onScroll"
    >
      <table class="ws-dt" :class="{ 'ws-dt--virtual': virtual }">
        <!-- 虚拟模式：固定列宽，避免滚动时列宽随可见行内容跳动 -->
        <colgroup v-if="virtual">
          <col v-for="col in cols" :key="col.key" :style="col.width ? { width: col.width } : undefined" />
        </colgroup>
        <thead>
          <tr>
            <th v-for="col in cols" :key="col.key">{{ col.label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="virtual && topPad > 0" class="ws-dt-spacer" aria-hidden="true">
            <td :colspan="cols.length" :style="{ height: `${topPad}px` }" />
          </tr>
          <tr
            v-for="item in visibleRows"
            :key="item.ri"
            :class="{ 'ws-dt-row--clickable': !!rowKey }"
            :style="rowStyle"
            @click="onRowClick(item.row, item.ri)"
          >
            <td v-for="col in cols" :key="col.key">
              <input
                v-if="col.editable"
                class="ws-dt-input"
                :value="cellValue(item.row, col, item.ri)"
                @change="onEdit(item.ri, col.key, ($event.target as HTMLInputElement).value)"
              />
              <span v-else>{{ cellValue(item.row, col, item.ri) ?? '' }}</span>
            </td>
          </tr>
          <tr v-if="virtual && bottomPad > 0" class="ws-dt-spacer" aria-hidden="true">
            <td :colspan="cols.length" :style="{ height: `${bottomPad}px` }" />
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { computeVirtualWindow } from './virtualWindow'

/** 列定义：`editable` 为真时该列单元格渲染为可编辑输入框 */
export interface DataTableColumn {
  key: string
  label: string
  editable?: boolean
  /** 虚拟模式的列宽（如 `60px` / `26%`）；非虚拟模式忽略 */
  width?: string
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
  /**
   * 虚拟滚动（2026-10-25）：默认关，既有消费者零影响。
   * 开启后只渲染视口内的行 + overscan；要求行高固定。
   */
  virtual?: boolean
  /** 虚拟视口高度（px，默认 360） */
  maxHeight?: number
  /** 固定行高（px，默认 30），须与实际行高一致 */
  rowHeight?: number
  /** 视口上下额外渲染行数（默认 4） */
  overscan?: number
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

// ── 虚拟滚动（2026-10-25）：只有 virtual=true 时生效，默认路径与旧实现完全一致 ──
function positive(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

const scrollTop = ref(0)
const viewportHeight = computed(() => positive(props.maxHeight, 360))
const rowHeightPx = computed(() => positive(props.rowHeight, 30))
const overscanRows = computed(() => {
  const v = props.overscan
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 4
})
const virtualWindow = computed(() =>
  computeVirtualWindow(
    dataRows.value.length,
    scrollTop.value,
    viewportHeight.value,
    rowHeightPx.value,
    overscanRows.value,
  ),
)
const topPad = computed(() => (props.virtual ? virtualWindow.value.start * rowHeightPx.value : 0))
const bottomPad = computed(() =>
  props.virtual
    ? Math.max(0, (dataRows.value.length - virtualWindow.value.end) * rowHeightPx.value)
    : 0,
)

/** 可见行保留原始行号：`resolveCell` / `edit` / `row-click` 的 rowIndex 语义不变 */
const visibleRows = computed<Array<{ row: Record<string, unknown>; ri: number }>>(() => {
  if (!props.virtual) return dataRows.value.map((row, ri) => ({ row, ri }))
  const { start, end } = virtualWindow.value
  return dataRows.value.slice(start, end).map((row, i) => ({ row, ri: start + i }))
})

const scrollStyle = computed(() =>
  props.virtual ? { maxHeight: `${viewportHeight.value}px` } : undefined,
)
const rowStyle = computed(() =>
  props.virtual ? { height: `${rowHeightPx.value}px` } : undefined,
)

function onScroll(e: Event): void {
  if (!props.virtual) return
  scrollTop.value = (e.target as HTMLElement).scrollTop
}

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
  background: var(--sf-panel-bg-muted);
  border: 1px solid var(--sf-panel-edge);
  border-radius: calc(var(--radius-md, 8px) * var(--sf-radius-scale));
  padding: 10px;
}
.ws-dt-title {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--agent-text, var(--color-text-primary));
  margin-bottom: 8px;
}
.ws-dt-scroll { overflow-x: auto; }
/* 虚拟模式：纵向视口 + 固定表头；spacer 行只占高度、不画边框 */
.ws-dt-scroll--virtual { overflow: auto; }
.ws-dt--virtual { table-layout: fixed; }
.ws-dt--virtual thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--sf-panel-bg-muted);
}
.ws-dt--virtual td {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  vertical-align: middle;
}
.ws-dt--virtual td > span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ws-dt-spacer td { padding: 0; border: 0; }
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
  border-bottom: 1px solid var(--sf-panel-edge);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.ws-dt td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--sf-panel-edge);
  color: var(--agent-text, var(--color-text-primary));
}
.ws-dt-row--clickable { cursor: pointer; }
.ws-dt-row--clickable:hover td { background: var(--sf-panel-bg-muted); }
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
