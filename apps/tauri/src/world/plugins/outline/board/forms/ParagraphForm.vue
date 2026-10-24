<template>
  <!--
    段落式（ParagraphForm）—— 就地型表现形式（2026-10-19 Q1′ 后复活）
    理论取值：段落式（文档 §一 表现形式 9 取值之一；2026-09-18 曾随 Q1 取消，2026-10-19 复活）
    · 一个节点 = 一段正文：`properties.content`（软上限 2000 字）
    · 双击正文就地编辑；Enter 换行、Ctrl+Enter 提交、Esc 回滚
    · 显示按 maxLines 截断（悬停看全文），完整内容在编辑态可见
  -->
  <div class="pf" :class="{ 'pf--center': align === 'center' }">
    <textarea
      v-if="editing"
      :ref="setInputRef"
      v-model="draft"
      class="pf-input"
      :rows="inputRows"
      :style="inputStyle"
        @keydown.enter="guardEnter($event, commit, { ctrl: true })"
        @keydown.esc="guardEsc($event, cancel)"
      @blur="commit"
      @dblclick.stop
    />
    <template v-else>
      <p
        class="pf-text"
        :class="{ 'pf-text--empty': !hasContent }"
        :style="textStyle"
        :title="clamped ? fullContent : ''"
        @dblclick.stop="startEdit"
      >{{ displayText }}</p>
    </template>
    <div v-if="editing" class="pf-count" :class="{ 'pf-count--over': over }">
      {{ draftChars }} / {{ CONTENT_LIMIT }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 段落式：正文（`properties.content`）就地编辑。
 *
 * Q1′ 依据（2026-10-19）：内容是「形式专属内容字段」，满足三条——
 * ① `ownFields` 声明；② 唯一写入入口（本组件双击）；③ 长度语义（2000 软上限，计数提示不硬截断）。
 * 与句子式的区别：句子式一行一句（子节点描述），段落式一段正文（多行）。
 */
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { injectBoardUndo } from '../composables/useBoardUndo'
import { guardEnter, guardEsc } from './enterGuard'

const WRITE_DEBOUNCE = 400
/** 正文软上限（计数提示，不硬截断） */
const CONTENT_LIMIT = 2000

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.entities ?? []).find(e => e.id === props.nodeId))
const cfg = computed(() => resolveFormConfig('paragraph', props.config))
const align = computed(() => (cfg.value.align === 'center' ? 'center' : 'left'))
const maxLines = computed(() => {
  const n = Number(cfg.value.maxLines)
  return Number.isFinite(n) && n > 0 ? Math.min(40, Math.round(n)) : 6
})
const fontScale = computed(() => {
  const n = Number(cfg.value.fontScale)
  return Number.isFinite(n) && n > 0 ? Math.min(1.5, Math.max(0.8, n)) : 1
})

const fullContent = computed(() => String(node.value?.properties?.content ?? ''))
const hasContent = computed(() => !!fullContent.value.trim())
const displayText = computed(() => {
  const text = fullContent.value.trim()
  if (!text) return '双击写下这一段'
  const lines = text.split(/\r?\n/)
  return lines.length > maxLines.value ? lines.slice(0, maxLines.value).join('\n') : text
})
const clamped = computed(() => fullContent.value.trim().split(/\r?\n/).length > maxLines.value)

const textStyle = computed(() => ({
  fontSize: `${(12.5 * fontScale.value).toFixed(1)}px`,
}))

// ── 就地编辑 ──
const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

function setInputRef(el: Element | ComponentPublicInstance | null): void {
  inputEl.value = (el as HTMLTextAreaElement | null) ?? null
}

const draftChars = computed(() => (draft.value ?? '').length)
const over = computed(() => draftChars.value > CONTENT_LIMIT)
const inputRows = computed(() => {
  const lines = String(draft.value ?? '').split(/\r?\n/).length
  return Math.min(Math.max(lines, 4), 20)
})
const inputStyle = computed(() => ({ fontSize: `${(12.5 * fontScale.value).toFixed(1)}px` }))

/** 写 properties.content：实体更新对 properties 是整体替换，必须先合并 */
function writeContent(value: string): void {
  const next = value.trim()
  if (next === fullContent.value.trim()) return
  const nextProps = { ...(node.value?.properties ?? {}), content: next }
  void es.update(props.nodeId, { properties: nextProps }, 'user', { skipUndo: true })
}

async function startEdit(): Promise<void> {
  if (!node.value || editing.value) return
  sessionPrev = fullContent.value
  draft.value = sessionPrev
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
}

function commit(): void {
  if (!editing.value) return
  if (timer) { clearTimeout(timer); timer = null }
  writeContent(draft.value)
  const next = (draft.value ?? '').trim()
  if (sessionPrev.trim() !== next) {
    const prevProps = { ...(node.value?.properties ?? {}), content: sessionPrev }
    const nextProps = { ...(node.value?.properties ?? {}), content: next }
    boardUndo?.recordContentEdit(props.nodeId, { properties: prevProps }, { properties: nextProps }, '改正文')
  }
  editing.value = false
  sessionPrev = ''
}

function cancel(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (fullContent.value !== sessionPrev) writeContent(sessionPrev)
  editing.value = false
  sessionPrev = ''
}

watch(draft, v => {
  if (!editing.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (editing.value) writeContent(v) }, WRITE_DEBOUNCE)
})

watch(() => props.nodeId, () => {
  if (timer) { clearTimeout(timer); timer = null }
  editing.value = false
  sessionPrev = ''
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.pf { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pf--center { align-items: center; text-align: center; }
.pf-text {
  margin: 0;
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  color: var(--text-color);
  cursor: text;
}
.pf-text--empty { font-style: italic; color: var(--text-tertiary); }
.pf-input {
  width: 100%;
  min-width: 80px;
  padding: 2px 4px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  line-height: 1.7;
  resize: vertical;
  outline: none;
}
.pf-count { align-self: flex-end; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.pf-count--over { color: var(--warning, #d97706); }
</style>
