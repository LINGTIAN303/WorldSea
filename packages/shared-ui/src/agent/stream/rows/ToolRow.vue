<!--
  ToolRow：扁平工具行
  - 非交互工具：单行（状态点脉冲/✓/✗ + 工具名 + 状态文案 + 参数摘要 + chevron），点击展开详情（参数+结果）；
  - choice/confirm/display 交互工具：整行内嵌 <InteractiveToolCall> 保留交互。
  取消卡片边框/背景装饰（自带扁平样式，复用 InlineToolCall 的逻辑代码而非其外壳）。
  emits：block-action / tool-confirm / hover / leave。
-->
<template>
  <div class="ws-stream-row ws-stream-tool" @mouseenter="emit('hover', item.id)" @mouseleave="emit('leave')">
    <!-- 交互工具：保留选择/确认交互 -->
    <InteractiveToolCall
      v-if="isInteractive"
      :tc="item.tc"
      @block-action="(e) => emit('block-action', e)"
      @tool-confirm="(e) => emit('tool-confirm', e)"
    />
    <!-- 普通工具：扁平单行 -->
    <template v-else>
      <div
        class="ws-stream-tool-summary"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded"
        @click="toggleExpand"
        @keydown.enter.prevent="toggleExpand"
        @keydown.space.prevent="toggleExpand"
      >
        <!-- 状态点：running 脉冲点；completed/failed 用 ✓/✗ 图标 -->
        <span class="ws-stream-tool-dot" :class="item.tc.status" v-if="item.tc.status === 'running'"></span>
        <WsIcon v-else-if="item.tc.status === 'completed'" name="check" size="xs" class="ws-stream-tool-icon-success" />
        <WsIcon v-else name="x" size="xs" class="ws-stream-tool-icon-fail" />
        <span class="ws-stream-tool-name">{{ label }}</span>
        <span class="ws-stream-tool-status" :class="item.tc.status">
          {{ statusText }}
        </span>
        <span v-if="argsPreview" class="ws-stream-tool-args">{{ argsPreview }}</span>
        <WsIcon name="chevron-right" size="xs" class="ws-stream-tool-chevron" :class="{ open: isExpanded }" />
      </div>
      <!-- 展开详情（参数 JSON + 结果） -->
      <div v-if="isExpanded" class="ws-stream-tool-detail" @click.stop>
        <div v-if="hasArgs" class="ws-stream-tool-detail-sec">
          <div class="ws-stream-tool-detail-label">参数</div>
          <pre class="ws-stream-tool-detail-code">{{ formatJson(item.tc.args) }}</pre>
        </div>
        <div v-if="item.tc.result" class="ws-stream-tool-detail-sec">
          <div class="ws-stream-tool-detail-label">结果</div>
          <pre class="ws-stream-tool-detail-code ws-stream-tool-detail-result">{{ formatResult(item.tc.result) }}</pre>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import InteractiveToolCall from '../../blocks/InteractiveToolCall.vue'
import { getToolLabel } from '../../bubbles/toolLabels'
import type { ToolCallView, InteractiveToolType } from '@worldsmith/shared-composables/agent/useAgent'

/** Tool 行的最小形参：只需 tc 字段 */
interface ToolItem {
  id: string
  tc: ToolCallView
}

const props = defineProps<{
  item: ToolItem
}>()

const emit = defineEmits<{
  (e: 'block-action', event: { blockId: string; action: string; data?: Record<string, unknown> }): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  (e: 'hover', id: string): void
  (e: 'leave'): void
}>()

// ===== 交互类型：choice/confirm/display 走 InteractiveToolCall =====
const interactiveType = computed<InteractiveToolType>(() => props.item.tc.interactiveType || 'none')
const isInteractive = computed(() =>
  interactiveType.value === 'choice' || interactiveType.value === 'confirm' || interactiveType.value === 'display',
)

// ===== 工具名 + 状态文案 =====
const label = computed(() => getToolLabel(props.item.tc.name))
const statusText = computed(() => {
  switch (props.item.tc.status) {
    case 'running': return '执行中'
    case 'completed': return '完成'
    default: return '失败'
  }
})

// ===== 展开态 =====
const isExpanded = ref(false)
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// ===== 参数/结果格式化（复用 InlineToolCall 逻辑代码） =====
const hasArgs = computed(() => Object.keys(props.item.tc.args).length > 0)

/** 参数摘要：优先关键参数的一行预览 */
const argsPreview = computed(() => {
  const args = props.item.tc.args
  const keys = Object.keys(args)
  if (keys.length === 0) return ''
  const priorityKeys = ['name', 'query', 'keyword', 'type', 'entityType', 'id', 'path', 'url', 'prompt', 'content']
  for (const pk of priorityKeys) {
    if (args[pk] && typeof args[pk] === 'string') {
      const val = String(args[pk])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  for (const k of keys) {
    if (typeof args[k] === 'string') {
      const val = String(args[k])
      return val.length > 60 ? val.slice(0, 57) + '...' : val
    }
  }
  return keys.slice(0, 3).map(k => `${k}=${JSON.stringify(args[k])}`).join(', ')
})

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}

function formatResult(result: string): string {
  if (!result) return ''
  try {
    const parsed = JSON.parse(result)
    const str = JSON.stringify(parsed, null, 2)
    return str.length > 2000 ? str.slice(0, 1997) + '...' : str
  } catch {
    return result.length > 2000 ? result.slice(0, 1997) + '...' : result
  }
}
</script>