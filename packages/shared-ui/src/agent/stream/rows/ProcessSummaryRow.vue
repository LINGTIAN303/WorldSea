<!--
  ProcessSummaryRow：过程层折叠摘要行
  过程层折叠时替代全部过程行段（推理 / 过程文本 / 动作），点击展开还原。
  单行扁平样式（与 ThinkRow 折叠态一致），无卡片边框。
  带 data-msg-id 供窗口化实测高度与 scrollIntoView 定位。
  emits：expand（携带 turnId，交由上层解除该轮次的折叠态）。
-->
<template>
  <div
    class="ws-stream-row ws-process-summary"
    :data-msg-id="item.id"
    role="button"
    tabindex="0"
    :aria-expanded="false"
    :aria-label="summary"
    @click="emit('expand', item.turnId)"
    @keydown.enter.prevent="emit('expand', item.turnId)"
    @keydown.space.prevent="emit('expand', item.turnId)"
  >
    <WsIcon name="chevron-right" size="xs" class="ws-process-summary-chevron" />
    <span class="ws-process-summary-text">{{ summary }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

/** 折叠摘要行的最小形参与事件流项一致 */
interface ProcessSummaryItem {
  id: string
  turnId: string
  thinkCount: number
  actionCount: number
}

const props = defineProps<{
  item: ProcessSummaryItem
}>()

const emit = defineEmits<{
  (e: 'expand', turnId: string): void
}>()

/** 摘要文案：优先步骤数（信息量最高），推理段数次之 */
const summary = computed(() => {
  const parts: string[] = []
  if (props.item.actionCount > 0) parts.push(`${props.item.actionCount} 个步骤`)
  if (props.item.thinkCount > 0) parts.push(`${props.item.thinkCount} 段推理`)
  return parts.length > 0 ? `展开${parts.join(' · ')}` : '展开过程'
})
</script>
