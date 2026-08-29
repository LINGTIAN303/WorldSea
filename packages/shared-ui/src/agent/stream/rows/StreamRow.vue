<!--
  StreamRow：事件行的类型分发组件（薄分发层）
  按 item.type 分发到对应行组件，并统一透传事件与入场动画 class。
  存在意义：三层渲染（① 用户层 / ② 过程层 / ③ 结果层）与尾部行都要渲染事件行，
  抽出发发层避免三处重复的 v-if 链与事件透传。
  不负责窗口化与分组（列表层接管）。
  emits：原样上抛各行的 hover / leave / copy / retry / block-action /
        manuscript-local-action / tool-confirm / expand / expandProcess。
-->
<template>
  <UserRow
    v-if="item.type === 'user'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :msg="item.msg"
    :is-hovered="isHovered"
    @hover="emit('hover', item.id)"
    @leave="emit('leave')"
    @copy="(m) => emit('copy', m)"
    @retry="(m) => emit('retry', m)"
  />
  <!-- 正文行：isResult 决定操作栏与结果层样式（过程文本段无操作栏） -->
  <AssistantRow
    v-else-if="item.type === 'assistant'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :msg="item.msg"
    :is-hovered="isHovered"
    :is-result="item.isResult !== false"
    @hover="emit('hover', item.id)"
    @leave="emit('leave')"
    @copy="(m) => emit('copy', m)"
    @block-action="(e) => emit('block-action', e)"
    @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
  />
  <ThinkRow
    v-else-if="item.type === 'think'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :item="item"
    @hover="emit('hover', item.id)"
    @leave="emit('leave')"
    @expand="emit('expand')"
  />
  <ToolRow
    v-else-if="item.type === 'tool'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :item="item"
    @block-action="(e) => emit('block-action', e)"
    @tool-confirm="(e) => emit('tool-confirm', e)"
    @expand="emit('expand')"
  />
  <ProcessSummaryRow
    v-else-if="item.type === 'process_summary'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :item="item"
    @expand="emit('expandProcess')"
  />
  <DividerRow
    v-else-if="item.type === 'divider'"
    :class="animated ? 'ws-stream-row-enter' : undefined"
    :divider-text="item.dividerText"
    :timestamp="item.timestamp"
  />
</template>

<script setup lang="ts">
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import type { AgentMessage, BlockActionEvent } from '../../bubbles/types'
import UserRow from './UserRow.vue'
import AssistantRow from './AssistantRow.vue'
import ThinkRow from './ThinkRow.vue'
import ToolRow from './ToolRow.vue'
import ProcessSummaryRow from './ProcessSummaryRow.vue'
import DividerRow from './DividerRow.vue'

defineProps<{
  item: AgentStreamItem
  /** 本行是否为新追加（驱动入场动画；首屏水合与窗口切片的旧行为 false） */
  animated?: boolean
  /** 本行是否处于 hover（驱动 User/Assistant 操作栏显隐） */
  isHovered?: boolean
}>()

const emit = defineEmits<{
  (e: 'hover', id: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'block-action', event: BlockActionEvent): void
  (e: 'manuscript-local-action', event: BlockActionEvent): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  /** 用户展开了某个行段（Think/Tool 详情）→ 置该轮次的 userEverExpanded latch */
  (e: 'expand'): void
  /** 用户点击过程层折叠摘要行 → 解除该轮次的过程层折叠 */
  (e: 'expandProcess'): void
}>()
</script>
