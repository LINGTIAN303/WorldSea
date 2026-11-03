<template>
  <!-- 列表视图：绝对定位行，spacer 撑出总高（虚拟滚动只渲染可视行） -->
  <div class="fp-list-spacer" :style="{ height: `${totalHeight}px` }">
    <div
      v-for="row in rows"
      :key="row.entry.path"
      :id="`fp-item-${row.index}`"
      class="fp-row"
      :class="{ dir: row.entry.isDir, on: selected.has(row.entry.path), dim: !!row.limit, focus: focusIndex === row.index }"
      :style="{ top: `${row.index * rowHeight}px` }"
      role="option"
      :aria-selected="selected.has(row.entry.path)"
      :aria-disabled="row.limit ? 'true' : undefined"
      :title="row.limit ? row.limit : row.entry.path"
      @click="emit('rowClick', row, $event)"
      @dblclick="emit('rowDblclick', row)"
      @mouseenter="emit('rowHover', row, $event)"
      @mouseleave="emit('rowLeave')"
    >
      <span class="fp-row-icon">
        <WsIcon v-if="row.entry.isDir" name="folder" size="xs" />
        <img
          v-else-if="canThumbnail(row.entry)"
          class="fp-thumb"
          :src="thumbUrl(row.entry.path)"
          :alt="''"
          loading="lazy"
          decoding="async"
        />
        <FileIcon v-else :name="row.entry.name" />
      </span>
      <span class="fp-row-name">{{ row.entry.name }}</span>
      <span class="fp-row-time">{{ formatModified(row.entry.modified) }}</span>
      <span class="fp-row-type">{{ typeLabelOf(row.entry) }}</span>
      <span class="fp-row-size">{{ row.entry.isDir ? '' : formatBytes(row.entry.size) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { convertFileSrc } from '@tauri-apps/api/core'
import { FileIcon, WsIcon } from '@worldsea/ui-kit'
import { canThumbnail, formatModified, normalizePath, typeLabelOf } from './filePickerModel'
import type { PickerRow } from '@/composables/useFilePickerBrowse'

defineProps<{
  rows: PickerRow[]
  selected: Set<string>
  focusIndex: number
  rowHeight: number
  /** spacer 总高（可视行数 × 行高），由宿主按可见条目算好传入 */
  totalHeight: number
  formatBytes: (bytes: number) => string
}>()

const emit = defineEmits<{
  rowClick: [row: PickerRow, event: MouseEvent]
  rowDblclick: [row: PickerRow]
  rowHover: [row: PickerRow, event: MouseEvent]
  rowLeave: []
}>()

/**
 * 缩略图 URL（asset 协议）。只在渲染可见行时调用，虚拟滚动已把范围收窄到可视区；
 * 浏览器侧再叠加 loading="lazy" 与 decoding="async" 兜住快速滚动。
 */
function thumbUrl(path: string): string {
  return convertFileSrc(normalizePath(path))
}
</script>
