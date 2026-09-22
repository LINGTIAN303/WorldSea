<!--
  ToolFileChange：文件变更 diff 区（write / edit / edit_diff 的 file_change 事件载荷）

  R 批 R-0 从 ToolRow 拆出：内容、类名与角标配色零变更。
-->
<template>
  <div v-if="fc" class="ws-stream-tool-filechange" @click.stop>
    <div class="ws-stream-tool-filechange-head">
      <span class="ws-stream-tool-filechange-badge" :class="fcBadgeClass">{{ fcKindLabel }}</span>
      <span class="ws-stream-tool-filechange-path" :title="fc.path">{{ fc.path }}</span>
    </div>
    <div class="ws-stream-tool-filechange-body">
      <template v-for="(hunk, hi) in fc.hunks" :key="hi">
        <div
          v-for="(line, li) in hunk.removed ?? []"
          :key="`r-${hi}-${li}`"
          class="ws-stream-tool-filechange-line del"
        ><span class="ws-stream-tool-filechange-sign">-</span><span class="ws-stream-tool-filechange-code">{{ line || ' ' }}</span></div>
        <div
          v-for="(line, li) in hunk.added ?? []"
          :key="`a-${hi}-${li}`"
          class="ws-stream-tool-filechange-line add"
        ><span class="ws-stream-tool-filechange-sign">+</span><span class="ws-stream-tool-filechange-code">{{ line || ' ' }}</span></div>
        <div v-if="hunk.truncated_at" class="ws-stream-tool-filechange-trunc">… 内容过长，已截断前 500 行</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { ToolItem } from './types'

const props = defineProps<{
  item: ToolItem
}>()

/** 文件变更 diff 载荷 */
const fc = computed(() => props.item.fileChange)

/** 变更类型展示标签（对齐后端 sink.file_change 的 kind：write/edit/edit_diff） */
const fcKindLabel = computed(() => {
  switch (fc.value?.kind) {
    case 'write': return '新增'
    case 'edit': return '修改'
    case 'edit_diff': return '修改'
    default: return '变更'
  }
})

/** 变更类型角标配色 class（新增绿 / 修改橙 / 变更灰） */
const fcBadgeClass = computed(() => {
  switch (fc.value?.kind) {
    case 'write': return 'ws-stream-tool-filechange-badge---new'
    case 'edit':
    case 'edit_diff': return 'ws-stream-tool-filechange-badge---mod'
    default: return 'ws-stream-tool-filechange-badge---change'
  }
})
</script>
