<!--
  ToolRow：扁平工具行
  - 非交互工具：单行（状态点脉冲/✓/✗ + 工具名 + 状态文案 + 参数摘要 + chevron），点击展开详情（参数+结果）；
  - choice/confirm/display 交互工具：整行内嵌 <InteractiveToolCall> 保留交互。
  取消卡片边框/背景装饰（自带扁平样式，复用 InlineToolCall 的逻辑代码而非其外壳）。
  emits：block-action / tool-confirm / hover / leave。
-->
<template>
  <div
    class="ws-stream-row ws-stream-tool"
    :data-msg-id="item.id"
    :data-animating="animating ? '' : undefined"
    @mouseenter="emit('hover', item.id)"
    @mouseleave="emit('leave')"
  >
    <!-- 交互工具：保留选择/确认交互 -->
    <InteractiveToolCall
      v-if="isInteractive"
      :tc="item.tc"
      @block-action="(e) => emit('block-action', e)"
      @tool-confirm="(e) => emit('tool-confirm', e)"
    />
    <!-- 普通工具：扁平单行 -->
    <template v-else>
      <!-- 2026-09-04 折叠条文字化：整行不再可点/高亮，点击与 hover 高亮收窄到文字主体（main span） -->
      <div
        class="ws-stream-tool-summary"
        :class="[`kind-${rowKind}`, { 'is-failed': isFailed }]"
      >
        <!-- 状态点：running 脉冲点；completed/failed 用 ✓/✗ 图标 -->
        <span class="ws-stream-tool-dot" :class="item.tc.status" v-if="item.tc.status === 'running'"></span>
        <WsIcon v-else-if="item.tc.status === 'completed'" name="check" size="xs" class="ws-stream-tool-icon-success" />
        <WsIcon v-else name="x" size="xs" class="ws-stream-tool-icon-fail" />
        <!-- 操作分类单字角标（弱提示分级，无卡片盒子） -->
        <span class="ws-stream-tool-mark" :class="op">{{ mark }}</span>
        <!-- 文字主体：语义动词 + 操作对象 + 工具名 + 效果/耗时/参数摘要；点击展开详情 -->
        <span
          class="ws-stream-tool-summary-main ws-fold-text"
          :class="{ 'is-failed': isFailed }"
          role="button"
          tabindex="0"
          :aria-expanded="isExpanded"
          @click="toggleExpand"
          @keydown.enter.prevent="toggleExpand"
          @keydown.space.prevent="toggleExpand"
        >
          <span class="ws-stream-tool-verb">{{ verb }}</span>
          <span v-if="subject" class="ws-stream-tool-subject">{{ subject }}</span>
          <span class="ws-stream-tool-name">({{ label }})</span>
          <!-- 失败直显错误摘要（不展开）；成功展示效果标签 -->
          <span v-if="!isFailed && effect" class="ws-stream-tool-effect">{{ effect }}</span>
          <!-- 执行耗时（H7 P0.5 事件权威字段；shell 类 effect 已含时长则不重复显示） -->
          <span v-if="durationText" class="ws-stream-tool-duration">{{ durationText }}</span>
          <span v-if="isFailed" class="ws-stream-tool-error">{{ errorText }}</span>
          <span v-else-if="argsPreview" class="ws-stream-tool-args">{{ argsPreview }}</span>
        </span>
        <!-- 失败直显提示（不可展开）；成功显示可展开 chevron -->
        <span v-if="isFailed" class="ws-stream-tool-failed-hint">已失败</span>
        <WsIcon v-else name="chevron-right" size="xs" class="ws-stream-tool-chevron" :class="{ open: isExpanded }" />
      </div>
      <!-- 展开详情（参数 JSON + 结果；失败直显、不展开）。collapse 动画：摘要行位置不动，
           详情 0fr→1fr 平滑展开，内容 opacity+位移 虚化→凝实（与 ThinkRow 时序一致）。
           2026-09-04 结构化渲染：参数/结果 JSON 走 Prism 语法高亮（v-html，token 配色见 stream.css） -->
      <div v-if="!isFailed" class="ws-stream-tool-collapse" :class="{ open: isExpanded }" :aria-hidden="!isExpanded">
        <div class="ws-stream-tool-detail" @click.stop>
          <div v-if="hasArgs" class="ws-stream-tool-detail-sec">
            <div class="ws-stream-tool-detail-label">参数</div>
            <pre class="ws-stream-tool-detail-code" v-html="argsHtml"></pre>
          </div>
          <div v-if="item.tc.result" class="ws-stream-tool-detail-sec">
            <div class="ws-stream-tool-detail-label">结果</div>
            <pre class="ws-stream-tool-detail-code ws-stream-tool-detail-result" v-html="resultHtml"></pre>
          </div>
        </div>
      </div>
      <!-- 2026-09-02 系统工具流式：bash/powershell 增量输出（实时累积，随流滚动跟随） -->
      <div v-if="streamText" class="ws-stream-tool-stream" :data-follow-end="isStreaming" @click.stop>
        <div class="ws-stream-tool-stream-label">输出</div>
        <pre ref="streamEl" class="ws-stream-tool-stream-body">{{ streamText }}</pre>
        <div v-if="item.streamTruncated" class="ws-stream-tool-stream-trunc">… 输出过长，已保留末尾 {{ streamLimitK }} 字符</div>
      </div>
      <!-- 2026-09-02 系统工具流式：文件变更 diff（绿红对比 + 被操作文件完整路径） -->
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import InteractiveToolCall from '../../blocks/InteractiveToolCall.vue'
import { getToolLabel } from '../../bubbles/toolLabels'
import { highlightCode } from '../../bubbles/codeHighlight'
import { classifyActionRowKind, TOOL_STREAM_LIMIT } from '@worldsmith/shared-composables/agent/turnModel'
import {
  getOpKind,
  OP_VERB,
  OP_MARK,
  extractOperationSubject,
  extractEffectLabel,
  type ToolMeta,
} from './toolSemantics'
import type { ToolCallView, InteractiveToolType } from '@worldsmith/shared-composables/agent/useAgent'

/** 2026-09-02 系统工具流式：文件变更 diff 结构（对齐后端 fs_tools.rs hunks 载荷） */
interface FileChangeInfo {
  path: string
  kind: string
  hunks: Array<{ removed?: string[]; added?: string[]; truncated_at?: boolean }>
}

/** Tool 行的最小形参：tc + 流式增量（stream/fileChange） */
interface ToolItem {
  id: string
  tc: ToolCallView
  stream?: string
  streamTruncated?: boolean
  fileChange?: FileChangeInfo
}

const props = defineProps<{
  item: ToolItem
}>()

const emit = defineEmits<{
  (e: 'block-action', event: { blockId: string; action: string; data?: Record<string, unknown> }): void
  (e: 'tool-confirm', event: { toolId: string; approved: boolean }): void
  (e: 'hover', id: string): void
  (e: 'leave'): void
  /** 用户展开详情：置该轮次的 userEverExpanded latch（折叠三条件分派用） */
  (e: 'expand'): void
}>()

// ===== 交互类型：choice/confirm/display 走 InteractiveToolCall =====
const interactiveType = computed<InteractiveToolType>(() => props.item.tc.interactiveType || 'none')
const isInteractive = computed(() =>
  interactiveType.value === 'choice' || interactiveType.value === 'confirm' || interactiveType.value === 'display',
)

// ===== 工具名（复用 getToolLabel 作工具名显示） =====
const label = computed(() => getToolLabel(props.item.tc.name))

// ===== 行段种类（行段模型 v2）：归约层推导随流透传；旧路径按工具名回退分类 =====
const rowKind = computed(() => props.item.tc.rowKind ?? classifyActionRowKind(props.item.tc.name))

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

// ===== 执行耗时（H7 P0.5 事件权威字段）；shell 类已由 __meta duration_ms 进 effect，避免重复 =====
const durationText = computed(() => {
  const ms = props.item.tc.durationMs
  if (ms === undefined || ms <= 0) return ''
  if (meta.value?.duration_ms !== undefined) return ''
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`
})

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
/**
 * 展开/收起动画进行中标记：详情 0fr→1fr 高度渐变期间，窗口化 ResizeObserver 每帧测中间高度
 * → 前缀和每帧重建 → 切片可能卸载重挂 → 动画重跑 = 疯狂闪烁反馈环。动画期置 data-animating 跳过测高。
 */
const animating = ref(false)
let animTimer: number | null = null
function markAnimating(): void {
  animating.value = true
  if (animTimer !== null) window.clearTimeout(animTimer)
  animTimer = window.setTimeout(() => {
    animating.value = false
    animTimer = null
  }, 320)
}
function toggleExpand() {
  if (isFailed.value) return
  isExpanded.value = !isExpanded.value
  markAnimating() // 折叠/展开都有高度动画，标记防窗口化测高反馈环
  if (isExpanded.value) emit('expand')
}

// ===== 参数/结果 JSON 结构化渲染（2026-09-04）：Prism 语法高亮，失败回退转义文本 =====
const hasArgs = computed(() => Object.keys(props.item.tc.args).length > 0)

/** 代码块文本转义回退（高亮器返回 null 时用；Prism 输出已自行转义） */
function escapeHtmlForCode(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 参数 JSON 高亮（保留原无截断展示语义） */
const argsHtml = computed(() => {
  const args = props.item.tc.args
  if (Object.keys(args).length === 0) return ''
  const json = JSON.stringify(args, null, 2)
  return highlightCode(json, 'json') ?? escapeHtmlForCode(json)
})

/** 结果区：JSON 可解析 → prettify + 高亮；纯文本 → 转义原文（沿用原 2000 字符截断） */
const resultHtml = computed(() => {
  const r = props.item.tc.result
  if (!r) return ''
  let parsed: unknown = null
  try {
    parsed = JSON.parse(r)
  } catch {
    parsed = null
  }
  const text = parsed !== null ? JSON.stringify(parsed, null, 2) : r
  const short = text.length > 2000 ? text.slice(0, 1997) + '...' : text
  if (parsed !== null) return highlightCode(short, 'json') ?? escapeHtmlForCode(short)
  return escapeHtmlForCode(short)
})

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

// ===== 2026-09-02 系统工具流式：增量输出（stream）+ 文件变更（fileChange） =====

/** bash/powershell 增量输出累积文本（tool_delta 事件按 refId=toolCallId 归约进段） */
const streamText = computed(() => props.item.stream?.trim() ?? '')

/** 截断提示：上限折算为 K 展示（20000 → 20K） */
const streamLimitK = computed(() => `${Math.round(TOOL_STREAM_LIMIT / 1000)}K`)

/** tool 调用是否仍在执行（running → 输出区滚动跟随末尾） */
const isStreaming = computed(() => props.item.tc.status === 'running')

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

/** 输出区 DOM 引用：流式期间持续跟随末尾（sticky bottom） */
const streamEl = ref<HTMLPreElement | null>(null)
watch(streamText, async () => {
  if (!isStreaming.value || !streamEl.value) return
  await nextTick()
  streamEl.value.scrollTop = streamEl.value.scrollHeight
})

onBeforeUnmount(() => {
  if (animTimer !== null) {
    window.clearTimeout(animTimer)
    animTimer = null
  }
})
</script>