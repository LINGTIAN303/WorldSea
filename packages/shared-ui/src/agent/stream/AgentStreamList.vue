<!--
  AgentStreamList：事件行流纯行渲染容器
  遍历 agentStream（AgentStreamItem[]），按 item.type 分发到对应行组件（user/assistant/think/tool/divider）。
  不负责窗口化（列表层接管）；只做纯行渲染 + 事件透传。
  入场动画治理（止血包⑤）：ws-stream-row-enter 仅挂「真正新追加」的行——
  首屏水合批次与整表替换（切会话/回源重建）不播动画，窗口切片滚动进出的旧行不播，
  消除滚动浏览/切会话时的整屏行闪烁（原实现所有行挂载即播 CSS animation）。
  emits：block-action / manuscript-local-action / hover / leave / copy / retry / tool-confirm / scroll-to-message。
-->
<template>
  <div class="ws-stream-list">
    <template v-for="item in items" :key="item.id">
      <!-- 用户行 -->
      <UserRow
        v-if="item.type === 'user'"
        :class="animatedIds.has(item.id) ? 'ws-stream-row-enter' : undefined"
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
        :class="animatedIds.has(item.id) ? 'ws-stream-row-enter' : undefined"
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
        :class="animatedIds.has(item.id) ? 'ws-stream-row-enter' : undefined"
        :item="item"
        @hover="onHover"
        @leave="onLeave"
      />
      <!-- Tool 行 -->
      <ToolRow
        v-else-if="item.type === 'tool'"
        :class="animatedIds.has(item.id) ? 'ws-stream-row-enter' : undefined"
        :item="item"
        @block-action="(e) => emit('block-action', e)"
        @tool-confirm="(e) => emit('tool-confirm', e)"
      />
      <!-- 分隔线 -->
      <DividerRow
        v-else-if="item.type === 'divider'"
        :class="animatedIds.has(item.id) ? 'ws-stream-row-enter' : undefined"
        :divider-text="item.dividerText"
        :timestamp="item.timestamp"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AgentStreamItem } from '@worldsmith/shared-composables/agent/useAgent'
import UserRow from './rows/UserRow.vue'
import AssistantRow from './rows/AssistantRow.vue'
import ThinkRow from './rows/ThinkRow.vue'
import ToolRow from './rows/ToolRow.vue'
import DividerRow from './rows/DividerRow.vue'
import type { AgentMessage, BlockActionEvent } from '../bubbles/types'
import './stream.css'

/** 事件行流 items */
const props = defineProps<{
  items: AgentStreamItem[]
}>()

// ===== 入场动画治理（止血包⑤）=====
// seenIds：本组件实例生命周期内已渲染过的行 id；animatedIds：本批次新追加、需播动画的行 id。
const seenIds = new Set<string>()
const animatedIds = ref<Set<string>>(new Set())
let hydrated = false

watch(() => props.items, (items) => {
  if (items.length === 0) return
  // 首屏水合：全部静默入场（整屏渐入=闪烁）
  if (!hydrated) {
    for (const it of items) seenIds.add(it.id)
    hydrated = true
    return
  }
  // 整表替换检测（切会话/回源重建）：未见过的行占比过高时按重新水合处理，静默渲染
  let unseen = 0
  for (const it of items) if (!seenIds.has(it.id)) unseen++
  if (unseen > 0 && unseen / items.length > 0.8) {
    seenIds.clear()
    for (const it of items) seenIds.add(it.id)
    animatedIds.value = new Set()
    return
  }
  // 常规追加：仅真正新出现的行播入场动画；窗口切片滚回的旧行（在 seenIds 中）静默
  if (unseen === 0) {
    animatedIds.value = new Set()
    return
  }
  const next = new Set<string>()
  for (const it of items) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id)
      next.add(it.id)
    }
  }
  animatedIds.value = next
}, { immediate: true, deep: false })

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