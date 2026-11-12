<template>
  <!--
    句子式（SentenceForm）—— **列表型**表现形式（2026-10-19 修正为列表语义）
    规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §二 + 2026-10-19 用户修正
    · 一行 = 一个**子节点**的一句话（`description`）；一个句子式可列多句
    · 双击某行 → 就地改**该子节点**的 description
    · 文本规则（行钳制 / 字数 / 引号）仍走 sentenceText.ts 的纯函数
    · 无子节点时显示空态
  -->
  <div
    class="sf"
    :class="{ 'sf--center': align === 'center', 'sf--italic': emphasis === 'italic', 'sf--muted': emphasis === 'muted' }"
  >
    <div v-if="!rows.length" class="sf-empty">暂无子节点</div>
    <div
      v-for="row in rows"
      :key="row.id"
      class="sf-row"
      :class="{ 'sf-row--center': align === 'center' }"
    >
      <template v-if="editingId === row.id">
        <textarea
          :ref="setInputRef"
          v-model="draft"
          class="sf-input"
          :rows="inputRows"
          :style="inputStyle"
        @keydown.enter="onEnter"
        @keydown.esc="guardEsc($event, cancel)"
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
        :class="{ 'sf-text--empty': !row.description }"
        :style="textStyle"
        :title="displayOf(row).clamped ? (row.description ?? '') : ''"
        @dblclick.stop="startEdit(row)"
      >{{ displayOf(row).text || '（暂无摘要）' }}</span>
    </div>
    <button class="sf-add" type="button" @click="addRow">＋ 添加一句</button>
  </div>
</template>

<script setup lang="ts">
/**
 * 句子式：列表型（行 = 直接子节点，每行取该子节点的 `description`）。
 *
 * 2026-10-19 修正：此前实现为「显示当前节点的一句描述」，写完一句就结束；
 * 按负责人定义，句子式应是**多句列表**——一个句子式可列多句，每句一个子节点。
 * 写入：双击某行改该行 `description`，400ms 防抖 + `{ skipUndo }` + 白板栈会话级单步。
 */
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { type Entity } from '@worldsea/entity-core'
import { entitiesSvc } from '../../serviceAccess'
import { resolveChildNodes } from '../outlineDerive'
import { createChildNode } from './childNodeCreate'
import { resolveFormConfig } from './registry'
import { injectBoardUndo } from '../composables/useBoardUndo'
import { guardEnter, guardEsc } from './enterGuard'
import {
  countChars,
  exceedsLimit,
  normalizeCharLimit,
  normalizeMaxLines,
  toDisplayText,
} from './sentenceText'

const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()
const boardUndo = injectBoardUndo()

const allNodes = computed(() => (es.list() ?? []).filter(e => e.type === 'outline_node'))
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

/** 行 = 直接子节点（按 order） */
const rows = computed<Entity[]>(() =>
  resolveChildNodes(props.nodeId, allNodes.value) as Entity[],
)

function displayOf(row: Entity) {
  return toDisplayText(row.description ?? '', {
    maxLines: maxLines.value,
    quoteMark: quoteMark.value,
  })
}

const textStyle = computed(() => ({
  fontSize: `${(13 * fontScale.value).toFixed(1)}px`,
  WebkitLineClamp: String(maxLines.value),
}))
const inputStyle = computed(() => ({ fontSize: `${(13 * fontScale.value).toFixed(1)}px` }))
const inputRows = computed(() => {
  const lines = String(draft.value ?? '').split(/\r?\n/).length
  return Math.min(Math.max(lines, 2), maxLines.value + 2)
})

// ── 行内就地编辑 ──
const editingId = ref<string | null>(null)
const draft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
/** v-for 内必须用函数 ref：字符串 ref 会被收集成数组 */
function setInputRef(el: Element | ComponentPublicInstance | null): void {
  inputEl.value = (el as HTMLTextAreaElement | null) ?? null
}
let writeTimer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

const draftChars = computed(() => countChars(draft.value))
const over = computed(() => exceedsLimit(draft.value, charLimit.value))

function clearWriteTimer(): void {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null }
}

function writeDescription(targetId: string, value: string): void {
  clearWriteTimer()
  const target = allNodes.value.find(n => n.id === targetId)
  if (!target || value === (target.description ?? '')) return
  void es.update(targetId, { description: value }, 'user', { skipUndo: true })
}

function scheduleWrite(value: string): void {
  clearWriteTimer()
  writeTimer = setTimeout(() => {
    if (editingId.value) writeDescription(editingId.value, value)
  }, WRITE_DEBOUNCE)
}

async function startEdit(row: Entity): Promise<void> {
  if (editingId.value === row.id) return
  editingId.value = row.id
  sessionPrev = row.description ?? ''
  draft.value = sessionPrev
  await nextTick()
  inputEl.value?.focus()
}

/** Enter 提交、Shift+Enter 换行（规格 §2.2-③）；组合期放行给 IME */
function onEnter(ev: KeyboardEvent): void {
  guardEnter(ev, commit, { noShift: true })
}

function commit(): void {
  const id = editingId.value
  if (!id) return
  writeDescription(id, draft.value)
  const next = draft.value ?? ''
  if (sessionPrev !== next) {
    boardUndo?.recordContentEdit(id, { description: sessionPrev }, { description: next }, '句子式改摘要')
  }
  editingId.value = null
  sessionPrev = ''
}

function cancel(): void {
  const id = editingId.value
  clearWriteTimer()
  const target = id ? allNodes.value.find(n => n.id === id) : null
  if (id && target && (target.description ?? '') !== sessionPrev) {
    void es.update(id, { description: sessionPrev }, 'user', { skipUndo: true })
  }
  editingId.value = null
  sessionPrev = ''
}

/** 直接在此处新建一句（子节点），并立即进入编辑 */
async function addRow(): Promise<void> {
  const id = await createChildNode(es, props.nodeId, '新一句')
  await nextTick()
  const created = allNodes.value.find(n => n.id === id)
  if (created) await startEdit(created)
}

watch(draft, v => {
  if (editingId.value) scheduleWrite(v)
})

watch(() => props.nodeId, () => {
  clearWriteTimer()
  editingId.value = null
  sessionPrev = ''
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.sf { display: flex; flex-direction: column; gap: 2px; min-width: 0; color: var(--text-secondary); }
.sf--center { align-items: center; text-align: center; }
.sf--italic .sf-text { font-style: italic; }
.sf--muted .sf-text { color: var(--text-tertiary); }
.sf-empty { font-size: var(--font-size-2xs); font-style: italic; color: var(--text-tertiary); }
.sf-row { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.sf-row--center { align-items: center; }
.sf-text {
  min-width: 0;
  overflow: hidden;
  white-space: pre-wrap;
  line-height: 1.55;
  word-break: break-word;
  cursor: text;
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
.sf-add {
  align-self: flex-start;
  margin-top: 2px;
  padding: 0 6px;
  height: 20px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
  font-family: inherit;
  cursor: pointer;
}
.sf-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
