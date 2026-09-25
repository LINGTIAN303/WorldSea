<template>
  <!--
    句子式（SentenceForm）—— 就地型表现形式
    规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §二
    · 映射 node.description（不新增 summary，也不从 content 派生）
    · 1–3 行短文本，纯文本渲染（不解析 markdown），超行省略且悬停显示全文
    · 双击进入编辑：Enter 提交 / Shift+Enter 换行 / Esc 回滚
  -->
  <div
    class="sf"
    :class="{ 'sf--center': align === 'center', 'sf--italic': emphasis === 'italic', 'sf--muted': emphasis === 'muted' }"
    @dblclick.stop="startEdit"
  >
    <template v-if="editing">
      <textarea
        ref="inputEl"
        v-model="draft"
        class="sf-input"
        :rows="inputRows"
        :style="inputStyle"
        @keydown.enter="onEnter"
        @keydown.esc.prevent="cancel"
        @blur="commit"
        @pointerdown.stop
        @dblclick.stop
      />
      <div v-if="charLimit > 0" class="sf-count" :class="{ 'sf-count--over': over }">
        {{ draftChars }} / {{ charLimit }}
      </div>
    </template>
    <span
      v-else
      class="sf-text"
      :class="{ 'sf-text--empty': display.empty }"
      :style="textStyle"
      :title="display.clamped ? rawText : ''"
    >{{ display.text || '（暂无摘要）' }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 句子式组件：内容映射 `node.description`，就地编辑。
 * 写入策略与标题式一致：400ms 防抖 + `{ skipUndo }` + 白板栈**会话级单步**（见 useBoardUndo）。
 * 文本规则（行钳制 / 字数 / 引号）全在 sentenceText.ts 的纯函数里，本组件不做文本判定。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { injectBoardUndo } from '../composables/useBoardUndo'
import {
  countChars,
  exceedsLimit,
  normalizeCharLimit,
  normalizeMaxLines,
  toDisplayText,
} from './sentenceText'

/** 内容写入防抖（与标题式同策略） */
const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.entities ?? []).find(e => e.id === props.nodeId))
const rawText = computed(() => (node.value?.description ?? ''))

const cfg = computed(() => resolveFormConfig('sentence', props.config))
const maxLines = computed(() => normalizeMaxLines(cfg.value.maxLines))
const charLimit = computed(() => normalizeCharLimit(cfg.value.charLimit))
const align = computed(() => (cfg.value.align === 'center' ? 'center' : 'left'))
const emphasis = computed(() => {
  const v = cfg.value.emphasis
  return v === 'italic' || v === 'normal' ? v : 'muted'
})
const fontScale = computed(() => {
  const n = Number(cfg.value.fontScale)
  return Number.isFinite(n) && n > 0 ? Math.min(1.5, Math.max(0.7, n)) : 0.9
})
const quoteMark = computed(() => cfg.value.showQuoteMark === true)

const display = computed(() =>
  toDisplayText(rawText.value, { maxLines: maxLines.value, quoteMark: quoteMark.value }),
)

const textStyle = computed(() => ({
  fontSize: `${(13 * fontScale.value).toFixed(1)}px`,
  WebkitLineClamp: String(maxLines.value),
}))
const inputStyle = computed(() => ({ fontSize: `${(13 * fontScale.value).toFixed(1)}px` }))
/** 编辑态行数：内容行数与 maxLines+2 取小，避免编辑框无限长 */
const inputRows = computed(() => {
  const lines = String(draft.value ?? '').split(/\r?\n/).length
  return Math.min(Math.max(lines, 2), maxLines.value + 2)
})

// ── 就地编辑 ──────────────────────────────
const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
let writeTimer: ReturnType<typeof setTimeout> | null = null
/** 编辑会话起点值：整段会话只登记**一步**撤销（与标题式同策略） */
let sessionPrev: string | null = null

const draftChars = computed(() => countChars(draft.value))
const over = computed(() => exceedsLimit(draft.value, charLimit.value))

function clearWriteTimer(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
}

function writeDescription(value: string): void {
  clearWriteTimer()
  if (value === rawText.value) return
  void es.update(props.nodeId, { description: value }, 'user', { skipUndo: true })
}

function scheduleWrite(value: string): void {
  clearWriteTimer()
  writeTimer = setTimeout(() => writeDescription(value), WRITE_DEBOUNCE)
}

async function startEdit(): Promise<void> {
  if (!node.value || editing.value) return
  sessionPrev = rawText.value
  draft.value = sessionPrev
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
}

/** Enter 提交、Shift+Enter 换行（规格 §2.2-③） */
function onEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) return
  ev.preventDefault()
  commit()
}

function commit(): void {
  if (!editing.value) return
  writeDescription(draft.value)
  const prev = sessionPrev ?? ''
  const next = draft.value ?? ''
  if (prev !== next) {
    boardUndo?.recordContentEdit(props.nodeId, { description: prev }, { description: next }, '改摘要')
  }
  sessionPrev = null
  editing.value = false
}

function cancel(): void {
  clearWriteTimer()
  // Esc 回滚：防抖可能已把中间值落库，这里显式写回会话起点值
  const prev = sessionPrev
  if (prev !== null && rawText.value !== prev) {
    void es.update(props.nodeId, { description: prev }, 'user', { skipUndo: true })
  }
  sessionPrev = null
  editing.value = false
}

// 输入过程防抖落库（等价于「暂停即保存」）
watch(draft, v => {
  if (editing.value) scheduleWrite(v)
})

// 切换节点时退出编辑态，避免把 A 的草稿写到 B
watch(() => props.nodeId, () => {
  clearWriteTimer()
  sessionPrev = null
  editing.value = false
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.sf {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 20px;
  color: var(--text-secondary);
}
.sf--center { align-items: center; text-align: center; }
.sf--italic .sf-text { font-style: italic; }
.sf--muted .sf-text { color: var(--text-tertiary); }
.sf-text {
  min-width: 0;
  overflow: hidden;
  white-space: pre-wrap;
  line-height: 1.55;
  word-break: break-word;
  /* 行钳制依赖 -webkit-line-clamp，需 display:-webkit-box（WebView2 支持） */
  display: -webkit-box;
  -webkit-box-orient: vertical;
}
.sf-text--empty { font-style: italic; color: var(--text-tertiary); }
.sf-input {
  width: 100%;
  min-width: 80px;
  padding: 2px 4px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  line-height: 1.55;
  resize: vertical;
  outline: none;
}
.sf-count {
  align-self: flex-end;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
}
.sf-count--over { color: var(--warning, #d97706); }
</style>
