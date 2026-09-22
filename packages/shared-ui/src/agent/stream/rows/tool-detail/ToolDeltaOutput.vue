<!--
  ToolDeltaOutput：系统工具流式增量输出（bash / powershell 的 tool_delta 累积）

  R 批 R-0 从 ToolRow 拆出：内容、类名、滚动跟随行为零变更。
-->
<template>
  <div v-if="streamText" class="ws-stream-tool-stream" :data-follow-end="isStreaming" @click.stop>
    <div class="ws-stream-tool-stream-label">输出</div>
    <pre ref="streamEl" class="ws-stream-tool-stream-body">{{ streamText }}</pre>
    <div v-if="item.streamTruncated" class="ws-stream-tool-stream-trunc">… 输出过长，已保留末尾 {{ streamLimitK }} 字符</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { TOOL_STREAM_LIMIT } from '@worldsea/shared-composables/agent/turnModel'

import type { ToolItem } from './types'

const props = defineProps<{
  item: ToolItem
}>()

/** bash/powershell 增量输出累积文本（tool_delta 事件按 refId=toolCallId 归约进段） */
const streamText = computed(() => props.item.stream?.trim() ?? '')

/** 截断提示：上限折算为 K 展示（20000 → 20K） */
const streamLimitK = computed(() => `${Math.round(TOOL_STREAM_LIMIT / 1000)}K`)

/** tool 调用是否仍在执行（running → 输出区滚动跟随末尾） */
const isStreaming = computed(() => props.item.tc.status === 'running')

/** 输出区 DOM 引用：流式期间持续跟随末尾（sticky bottom） */
const streamEl = ref<HTMLPreElement | null>(null)
watch(streamText, async () => {
  if (!isStreaming.value || !streamEl.value) return
  await nextTick()
  streamEl.value.scrollTop = streamEl.value.scrollHeight
})
</script>
