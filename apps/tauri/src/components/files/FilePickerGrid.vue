<template>
  <!-- 网格视图：格子行虚拟化，每行 cols 个格子；纯展示，选中/焦点态由 props 驱动 -->
  <div class="fp-list-spacer" :style="{ height: `${totalHeight}px` }">
    <div v-for="(row, ri) in rows" :key="`gr${virtualStart + ri}`" class="fp-grid-row" :style="{ top: `${(virtualStart + ri) * rowHeight}px` }">
      <div
        v-for="cell in row"
        :id="`fp-item-${cell.index}`"
        :key="cell.entry.path"
        class="fp-cell"
        :class="{ dir: cell.entry.isDir, on: selected.has(cell.entry.path), dim: !!cell.limit, focus: focusIndex === cell.index }"
        role="option"
        :aria-selected="selected.has(cell.entry.path)"
        :aria-disabled="cell.limit ? 'true' : undefined"
        :title="cell.limit ? cell.limit : cell.entry.path"
        @click="$emit('row-click', cell, $event)"
        @dblclick="$emit('row-dblclick', cell)"
      >
        <span class="fp-cell-thumb">
          <img
            v-if="canThumbnail(cell.entry)"
            class="fp-cell-img"
            :src="thumbUrl(cell.entry.path)"
            :alt="''"
            loading="lazy"
            decoding="async"
          />
          <WsIcon v-else-if="cell.entry.isDir" name="folder" size="md" />
          <FileIcon v-else :name="cell.entry.name" class="fp-cell-fileicon" />
        </span>
        <span class="fp-cell-name">{{ cell.entry.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * FilePickerGrid —— 网格视图子组件（从 FilePickerHost 抽出，控制单文件规模）。
 * 只负责渲染：行分组数据由父级按虚拟窗口算好传入，选中/焦点态单向 props 下行。
 */
import { computed } from 'vue'
import { convertFileSrc } from '@tauri-apps/api/core'
import { FileIcon, WsIcon } from '@worldsea/ui-kit'
import { canThumbnail, normalizePath, type FsEntry } from './filePickerModel'

/** 一格数据（与列表行同构：条目 + 下标 + 超限原因） */
export interface GridCell {
  entry: FsEntry
  index: number
  limit: string | null
}

const props = defineProps<{
  /** 按行分组的格子（仅虚拟窗口内的行） */
  rows: GridCell[][]
  /** 虚拟窗口的起始行号（top 定位用） */
  virtualStart: number
  /** 格子行高（px） */
  rowHeight: number
  /** 网格总行数（spacer 高度用） */
  totalRows: number
  /** 选中路径集合 */
  selected: Set<string>
  /** 焦点条目下标 */
  focusIndex: number
}>()

defineEmits<{
  'row-click': [cell: GridCell, e: MouseEvent]
  'row-dblclick': [cell: GridCell]
}>()

const totalHeight = computed(() => props.totalRows * props.rowHeight)

/** 缩略图 URL（asset 协议；lazy + async 由 img 属性兜住快速滚动） */
function thumbUrl(path: string): string {
  return convertFileSrc(normalizePath(path))
}
</script>

<style scoped src="./file-picker-grid.css"></style>
