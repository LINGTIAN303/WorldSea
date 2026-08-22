<!--
  AgentStreamList：事件行流纯行渲染容器
  遍历 agentStream（AgentStreamItem[]），按 item.type 分发到对应行组件（user/assistant/think/tool/divider）。
  不负责窗口化（列表层接管）；只做纯行渲染 + 事件透传。
  emits：block-action / manuscript-local-action / hover / leave / copy / retry / tool-confirm / scroll-to-message。
-->
<template>
  <div class="ws-stream-list">
    <template v-for="item in items" :key="item.id">
      <!-- 用户行 -->
      <UserRow
        v-if="item.type === 'user'"
        class="ws-stream-row-enter"
        :msg="item.msg"
        :is-hovered="hoveredId === item.id"
        @hover="onHover"
        @leave="onLeave"
        @copy="(m) => emit('copy', m)"
        @retry="(m) => emit('retry', m)"
      />
      <!-- 正文行 -->
      <AssistantRow
        v-else-if="item.type === 'assistant'"
        class="ws-stream-row-enter"
        :msg="item.msg"
        :is-hovered="hoveredId === item.id"
        @hover="onHover"
        @leave="onLeave"
        @copy="(m) => emit('copy', m)"
        @block-action="(e) => emit('block-action', e)"
        @manuscript-local-action="(e) => emit('manuscript-local-action', e)"
      />
      <!-- Think 行 -->
      <ThinkRow
        v-else-if="item.type === 'think'"
        class="ws-stream-row-enter"
        :item="item"
        @hover="onHover"
        @leave="onLeave"
      />
      <!-- Tool 行 -->
      <ToolRow
        v-else-if="item.type === 'tool'"
        class="ws-stream-row-enter"
        :item="item"
        @block-action="(e) => emit('block-action', e)"
        @tool-confirm="(e) => emit('tool-confirm', e)"
      />
      <!-- 分隔线 -->
      <DividerRow
        v-else-if="item.type === 'divider'"
        class="ws-stream-row-enter"
        :divider-text="item.dividerText"
        :timestamp="item.timestamp"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import UserRow from './rows/UserRow.vue'
import AssistantRow from './rows/AssistantRow.vue'
import ThinkRow from './rows/ThinkRow.vue'
import ToolRow from './rows/ToolRow.vue'
import DividerRow from './rows/DividerRow.vue'
import type { AgentMessage, BlockActionEvent } from '../bubbles/types'
import './stream.css'

/** 事件行流 items */
defineProps<{
  items: AgentStreamItem[]
}>()

/** 当前 hover 的行 id（驱动 User/Assistant 操作栏显隐；hover 事件透传给父层） */
const hoveredId = ref<string | null>(null)
function onHover(id: string) {
  hoveredId.value = id
  emit('hover', id)
}
function onLeave() {
  hoveredId.value = null
  emit('leave')
}

const emit = defineEmits<{
  (e: 'block-action', event: BlockActionEvent): void
  (e: 'manuscript-local-action', event: BlockActionEvent): void
  (e: 'hover', msgId: string): void
  (e: 'leave'): void
  (e: 'copy', msg: AgentMessage): void
  (e: 'retry', msg: AgentMessage): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  (e: 'scroll-to-message', msgId: string): void
}>()
</script>