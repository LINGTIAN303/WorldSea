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
        :class="{ 'is-failed': isFailed }"
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
        <!-- 操作分类单字角标（弱提示分级，无卡片盒子） -->
        <span class="ws-stream-tool-mark" :class="op">{{ mark }}</span>
        <!-- 语义动词 + 操作对象名（操作行段主体） -->
        <span class="ws-stream-tool-verb">{{ verb }}</span>
        <span v-if="subject" class="ws-stream-tool-subject">{{ subject }}</span>
        <span class="ws-stream-tool-name">({{ label }})</span>
        <!-- 失败直显错误摘要（不展开）；成功展示效果标签 -->
        <span v-if="!isFailed && effect" class="ws-stream-tool-effect">{{ effect }}</span>
        <span v-if="isFailed" class="ws-stream-tool-error">{{ errorText }}</span>
        <span v-else-if="argsPreview" class="ws-stream-tool-args">{{ argsPreview }}</span>
        <!-- 成功才渲染可展开的 chevron；失败显示提示（不可展开） -->
        <span v-if="isFailed" class="ws-stream-tool-failed-hint">已失败</span>
        <WsIcon v-else name="chevron-right" size="xs" class="ws-stream-tool-chevron" :class="{ open: isExpanded }" />
      </div>
      <!-- 展开详情（参数 JSON + 结果；失败直显、不展开） -->
      <div v-if="isExpanded && !isFailed" class="ws-stream-tool-detail" @click.stop>
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
import {
  getOpKind,
  OP_VERB,
  OP_MARK,
  extractOperationSubject,
  extractEffectLabel,
  type ToolMeta,
} from './toolSemantics'
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

// ===== 工具名（复用 getToolLabel 作工具名显示） =====
const label = computed(() => getToolLabel(props.item.tc.name))

// ===== 操作语义（按工具名分类 + args 提取对象名） =====
const op = computed(() => getOpKind(props.item.tc.name))
const verb = computed(() => OP_VERB[op.value])
const mark = computed(() => OP_MARK[op.value])
const subject = computed(() =>
  extractOperationSubject(op.value, props.item.tc.name, props.item.tc.args),
)

// ===== 结果 __meta 解析（JSON 容错；旧工具无 __meta → 回退 args 摘要） =====
const parsedResult = computed<Record<string, unknown> | null>(() => {
  const r = props.item.tc.result
  if (!r) return null
  try {
    const parsed = JSON.parse(r)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
})
const meta = computed<ToolMeta | null>(() => {
  const m = parsedResult.value?.__meta
  return m && typeof m === 'object' ? (m as ToolMeta) : null
})
const effect = computed(() => extractEffectLabel(meta.value))

// ===== 失败态：直显错误摘要，不可展开 =====
const isFailed = computed(() => props.item.tc.status === 'failed')
const errorText = computed(() => {
  const r = props.item.tc.result
  if (r) {
    // 优先解码 result 中的 error 字段（Rust/桥错误约定 { error: "..." }）
    const m = parsedResult.value
    if (m && typeof m.error === 'string') return m.error
    // 纯字符串结果直接展示
    if (typeof r === 'string') {
      const t = r.trim()
      if (t && t !== '执行失败') return t.length > 80 ? t.slice(0, 77) + '...' : t
    }
  }
  return '执行失败'
})

// ===== 展开态（失败不展开） =====
const isExpanded = ref(false)
function toggleExpand() {
  if (isFailed.value) return
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