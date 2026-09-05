<!--
  ProcessSummaryRow：过程层折叠摘要行（双态）
  - 折叠态（默认）：替代全部过程行段，点击展开（chevron-right）。
  - 展开态（expanded）：用户手动展开后的常驻折叠头行，位于过程行段上方，
    点击收起（chevron-down）——修复此前展开后摘要行消失、无法再折叠的问题。
  单行扁平样式（与 ThinkRow 折叠态一致），无卡片边框。
  带 data-msg-id 供窗口化实测高度与 scrollIntoView 定位。
  emits：expand（携带 turnId，上层按当前折叠态切换）。
-->
<template>
  <div class="ws-stream-row ws-process-summary" :data-msg-id="item.id">
    <!-- 2026-09-05 样式统一（对齐推理段）：点击/光标仅挂前缀摘要文字，整行不可点、无 hover 背景；
         chevron 移后缀（图标切换表达折叠态） -->
    <span
      class="ws-process-summary-text"
      role="button"
      tabindex="0"
      :aria-expanded="item.expanded === true"
      :aria-label="summary"
      @click="emit('expand', item.turnId)"
      @keydown.enter.prevent="emit('expand', item.turnId)"
      @keydown.space.prevent="emit('expand', item.turnId)"
    >{{ summary }}</span>
    <WsIcon
      :name="item.expanded ? 'chevron-down' : 'chevron-right'"
      size="xs"
      class="ws-process-summary-chevron"
    />
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
  /** 展开态的常驻折叠头行（点击收起）；缺省为折叠态（点击展开） */
  expanded?: boolean
}

const props = defineProps<{
  item: ProcessSummaryItem
}>()

const emit = defineEmits<{
  (e: 'expand', turnId: string): void
}>()

/** 摘要文案：优先步骤数（信息量最高），推理段数次之；展开态动词为「收起」 */
const summary = computed(() => {
  const parts: string[] = []
  if (props.item.actionCount > 0) parts.push(`${props.item.actionCount} 个步骤`)
  if (props.item.thinkCount > 0) parts.push(`${props.item.thinkCount} 段推理`)
  const body = parts.length > 0 ? parts.join(' · ') : '过程'
  return props.item.expanded ? `收起${body}` : `展开${body}`
})
</script>
