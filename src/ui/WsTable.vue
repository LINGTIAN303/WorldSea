<template>
  <div class="ws-table-wrapper">
    <!-- 非虚拟模式：原行为完全保留 -->
    <table v-if="!virtual" :class="['ws-table', { 'ws-table--striped': striped, 'ws-table--bordered': bordered, 'ws-table--compact': compact }]" :aria-label="ariaLabel">
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key" :style="{ width: col.width, textAlign: col.align ?? 'left' }">
            <slot :name="`header-${col.key}`" :column="col">{{ col.title }}</slot>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="data.length === 0">
          <td :colspan="columns.length" class="ws-table__empty">
            <slot name="empty">暂无数据</slot>
          </td>
        </tr>
        <tr v-for="(row, idx) in data" :key="rowKey ? row[rowKey] : idx" :class="{ 'ws-table__row--clickable': $attrs.onClick }">
          <td v-for="col in columns" :key="col.key" :style="{ textAlign: col.align ?? 'left' }">
            <slot :name="col.key" :row="row" :index="idx">{{ row[col.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 虚拟滚动模式：固定行高 + 可见区域切片 + sticky 表头 -->
    <div
      v-else
      ref="scrollContainerRef"
      class="ws-table-virtual"
      :style="{ maxHeight: maxHeight + 'px', overflowY: 'auto' }"
      @scroll="onScroll"
    >
      <table :class="['ws-table', { 'ws-table--striped': striped, 'ws-table--bordered': bordered, 'ws-table--compact': compact }]" :aria-label="ariaLabel">
        <thead class="ws-table-virtual__thead">
          <tr>
            <th v-for="col in columns" :key="col.key" :style="{ width: col.width, textAlign: col.align ?? 'left' }">
              <slot :name="`header-${col.key}`" :column="col">{{ col.title }}</slot>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="data.length === 0">
            <td :colspan="columns.length" class="ws-table__empty">
              <slot name="empty">暂无数据</slot>
            </td>
          </tr>
          <!-- 顶部撑高：用空行占位，避免影响 table 布局 -->
          <tr v-if="topPadding > 0" :style="{ height: topPadding + 'px' }" aria-hidden="true">
            <td :colspan="columns.length" :style="{ padding: 0, border: 'none' }"></td>
          </tr>
          <tr
            v-for="(row, visibleIdx) in visibleData"
            :key="rowKey ? row[rowKey] : startIndex + visibleIdx"
            :class="{ 'ws-table__row--clickable': $attrs.onClick }"
            :style="{ height: rowHeight + 'px' }"
          >
            <td v-for="col in columns" :key="col.key" :style="{ textAlign: col.align ?? 'left' }">
              <slot :name="col.key" :row="row" :index="startIndex + visibleIdx">{{ row[col.key] }}</slot>
            </td>
          </tr>
          <!-- 底部撑高 -->
          <tr v-if="bottomPadding > 0" :style="{ height: bottomPadding + 'px' }" aria-hidden="true">
            <td :colspan="columns.length" :style="{ padding: 0, border: 'none' }"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, shallowRef, onMounted, onBeforeUnmount } from 'vue'

export interface TableColumn {
  key: string
  title: string
  width?: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
}

const props = withDefaults(defineProps<{
  columns: TableColumn[]
  data: Record<string, any>[]
  rowKey?: string
  striped?: boolean
  bordered?: boolean
  compact?: boolean
  ariaLabel?: string
  /** 启用虚拟滚动（大数据量场景，行高需固定） */
  virtual?: boolean
  /** 虚拟模式下固定行高（px），默认 44 */
  rowHeight?: number
  /** 虚拟模式容器最大高度（px），默认 400 */
  maxHeight?: number
  /** 可视区域上下缓冲行数，默认 5 */
  bufferCount?: number
}>(), {
  striped: false,
  bordered: false,
  compact: false,
  virtual: false,
  rowHeight: 44,
  maxHeight: 400,
  bufferCount: 5,
})

const scrollContainerRef = shallowRef<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

const totalHeight = computed(() => props.data.length * props.rowHeight)

const startIndex = computed(() => {
  const idx = Math.floor(scrollTop.value / props.rowHeight) - props.bufferCount
  return Math.max(0, idx)
})

const endIndex = computed(() => {
  const visibleCount = Math.ceil(viewportHeight.value / props.rowHeight) + props.bufferCount * 2
  const idx = startIndex.value + visibleCount
  return Math.min(props.data.length, idx)
})

const visibleData = computed(() => {
  if (!props.virtual) return props.data
  return props.data.slice(startIndex.value, endIndex.value)
})

const topPadding = computed(() => startIndex.value * props.rowHeight)
const bottomPadding = computed(() => {
  const rendered = (endIndex.value - startIndex.value) * props.rowHeight
  return Math.max(0, totalHeight.value - topPadding.value - rendered)
})

function onScroll(e: Event): void {
  const el = e.target as HTMLDivElement
  scrollTop.value = el.scrollTop
}

let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (!props.virtual || !scrollContainerRef.value) return
  viewportHeight.value = scrollContainerRef.value.clientHeight
  // 监听容器尺寸变化（响应式布局）
  resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      viewportHeight.value = entry.contentRect.height
    }
  })
  resizeObserver.observe(scrollContainerRef.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.ws-table-wrapper { overflow-x: auto; border-radius: var(--radius-lg); border: 1px solid var(--color-border-subtle); }
.ws-table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
.ws-table th, .ws-table td { padding: var(--space-3) var(--space-4); text-align: left; }
.ws-table--compact th, .ws-table--compact td { padding: var(--space-2) var(--space-3); }

.ws-table thead { background: var(--color-bg-elevated); }
.ws-table th { font-weight: var(--font-weight-semibold); color: var(--color-text-secondary); font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid var(--color-border-subtle); white-space: nowrap; }

.ws-table tbody tr { border-bottom: 1px solid var(--color-border-subtle); transition: background var(--duration-fast) var(--ease-default); }
.ws-table tbody tr:last-child { border-bottom: none; }
.ws-table tbody tr:hover { background: var(--color-bg-hover); }
.ws-table--striped tbody tr:nth-child(even) { background: var(--color-bg-elevated); }
.ws-table--striped tbody tr:nth-child(even):hover { background: var(--color-bg-hover); }
.ws-table--bordered td { border-right: 1px solid var(--color-border-subtle); }
.ws-table--bordered td:last-child { border-right: none; }

.ws-table__row--clickable { cursor: pointer; }
.ws-table__empty { text-align: center; color: var(--color-text-tertiary); padding: var(--space-8) !important; }

/* 虚拟滚动模式：表头 sticky 固定 */
.ws-table-virtual { position: relative; }
.ws-table-virtual__thead { position: sticky; top: 0; z-index: 1; background: var(--color-bg-elevated); }
.ws-table-virtual__thead th { border-bottom: 2px solid var(--color-border-default); }
</style>
