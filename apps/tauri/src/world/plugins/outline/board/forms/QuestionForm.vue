<template>
  <!--
    问题式（QuestionForm）—— 就地型表现形式（2026-10-19 新增，Q1′ 后补 answer）
    理论取值：问题式（文档 §一 表现形式 9 取值之一）。
    · 一个节点 = 一个「问答」：问句（properties.question）+ 回答正文（properties.answer）+ 状态点
    · 双击问句 / 双击回答，各自就地编辑；回答软上限 500 字（计数提示，不硬截断）
    · 写入纪律与标题式/卡片式一致：400ms 防抖 + {skipUndo} + 白板撤销栈一步
  -->
  <div class="qf">
    <div class="qf-head">
      <span v-if="showStatus" class="qf-dot" :class="dotClass" :title="statusText" />
      <span class="qf-mark" aria-hidden="true">问</span>
      <input
        v-if="editingField === 'question'"
        :ref="setQuestionRef"
        v-model="draft"
        class="qf-input"
        placeholder="这一节要回答什么问题？"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
        @dblclick.stop
      />
      <span
        v-else
        class="qf-text"
        :class="{ 'qf-text--empty': !hasQuestion }"
        :title="displayQuestion"
        @dblclick.stop="startEdit('question')"
      >{{ displayQuestion }}</span>
    </div>

    <template v-if="showAnswer">
      <div class="qf-answer-wrap">
        <span v-if="showAnswerMark" class="qf-mark qf-mark--answer" aria-hidden="true">答</span>
        <div class="qf-answer-body">
        <textarea
          v-if="editingField === 'answer'"
          :ref="setAnswerRef"
          v-model="draft"
          class="qf-input qf-input--multi"
          :rows="answerRows"
          @keydown.enter="onAnswerEnter"
          @keydown.esc.prevent="cancel"
          @blur="commit"
          @dblclick.stop
        />
        <p
          v-else
          class="qf-answer"
          :class="{ 'qf-answer--empty': !hasAnswer }"
          :title="hasAnswer ? fullAnswer : ''"
          @dblclick.stop="startEdit('answer')"
        >{{ displayAnswer }}</p>
        <div v-if="editingField === 'answer'" class="qf-count" :class="{ 'qf-count--over': over }">
          {{ answerChars }} / {{ ANSWER_LIMIT }}
        </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 问题式：问句（`properties.question`）+ 回答正文（`properties.answer`），两处都可就地编辑。
 *
 * 2026-10-19：Q1 边界澄清（A′）后补 `answer`——此前只有问句，形式是残缺的；
 * 回答属于「形式专属内容字段」，满足 声明（ownFields）/ 唯一写入入口（本组件双击）/ 长度语义（500 软上限）。
 */
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { statusOf } from './progressStats'
import { injectBoardUndo } from '../composables/useBoardUndo'

const WRITE_DEBOUNCE = 400
/** 回答软上限（计数提示，不硬截断——硬截断会吞用户输入） */
const ANSWER_LIMIT = 500

type EditField = 'question' | 'answer'

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.entities ?? []).find(e => e.id === props.nodeId))
const cfg = computed(() => resolveFormConfig('question', props.config))
const showStatus = computed(() => cfg.value.showStatus !== false)
const showAnswer = computed(() => cfg.value.showAnswer !== false)
/** 答字标默认不显示（2026-10-19 用户要求：可配置，默认关） */
const showAnswerMark = computed(() => cfg.value.showAnswerMark === true)

const question = computed(() => String(node.value?.properties?.question ?? '').trim())
const fullAnswer = computed(() => String(node.value?.properties?.answer ?? '').trim())
const hasQuestion = computed(() => !!question.value)
const hasAnswer = computed(() => !!fullAnswer.value)
const displayQuestion = computed(() => question.value || '双击写下这一节要回答的问题')
const displayAnswer = computed(() => {
  if (!fullAnswer.value) return '双击写下回答…'
  return fullAnswer.value.length > 120 ? `${fullAnswer.value.slice(0, 120)}…` : fullAnswer.value
})
const statusText = computed(() => statusOf(node.value))
const dotClass = computed(() => {
  if (statusText.value === '完成') return 'qf-dot--done'
  if (statusText.value === '草稿') return 'qf-dot--draft'
  return 'qf-dot--todo'
})

// ── 就地编辑（两字段共用一个编辑态） ──
const editingField = ref<EditField | null>(null)
const draft = ref('')
const questionEl = ref<HTMLInputElement | null>(null)
const answerEl = ref<HTMLTextAreaElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

function setQuestionRef(el: Element | ComponentPublicInstance | null): void {
  questionEl.value = (el as HTMLInputElement | null) ?? null
}
function setAnswerRef(el: Element | ComponentPublicInstance | null): void {
  answerEl.value = (el as HTMLTextAreaElement | null) ?? null
}

const answerChars = computed(() => (draft.value ?? '').length)
const over = computed(() => answerChars.value > ANSWER_LIMIT)
/** 编辑态行数：内容行数与 6 取小，避免编辑框无限长 */
const answerRows = computed(() => {
  const lines = String(draft.value ?? '').split(/\r?\n/).length
  return Math.min(Math.max(lines, 3), 6)
})

function fieldValue(field: EditField): string {
  return String(node.value?.properties?.[field] ?? '')
}

/** 写 properties.<field>：实体更新对 properties 是整体替换，必须先合并 */
function writeField(field: EditField, value: string): void {
  const next = value.trim()
  if (next === fieldValue(field).trim()) return
  const nextProps = { ...(node.value?.properties ?? {}), [field]: next }
  void es.update(props.nodeId, { properties: nextProps }, 'user', { skipUndo: true })
}

async function startEdit(field: EditField): Promise<void> {
  if (!node.value || editingField.value) return
  editingField.value = field
  sessionPrev = fieldValue(field)
  draft.value = sessionPrev
  await nextTick()
  const el = field === 'question' ? questionEl.value : answerEl.value
  el?.focus()
  if (field === 'question') questionEl.value?.select()
}

function commit(): void {
  const field = editingField.value
  if (!field) return
  if (timer) { clearTimeout(timer); timer = null }
  writeField(field, draft.value)
  const next = (draft.value ?? '').trim()
  if (sessionPrev.trim() !== next) {
    const prevProps = { ...(node.value?.properties ?? {}), [field]: sessionPrev }
    const nextProps = { ...(node.value?.properties ?? {}), [field]: next }
    boardUndo?.recordContentEdit(
      props.nodeId,
      { properties: prevProps },
      { properties: nextProps },
      field === 'question' ? '改问题' : '改回答',
    )
  }
  editingField.value = null
  sessionPrev = ''
}

function cancel(): void {
  const field = editingField.value
  if (timer) { clearTimeout(timer); timer = null }
  if (field && fieldValue(field) !== sessionPrev) writeField(field, sessionPrev)
  editingField.value = null
  sessionPrev = ''
}

/** Enter 提交、Shift+Enter 换行（回答是多行文本） */
function onAnswerEnter(ev: KeyboardEvent): void {
  if (ev.shiftKey) return
  ev.preventDefault()
  commit()
}

watch(draft, v => {
  const field = editingField.value
  if (!field) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (editingField.value === field) writeField(field, v) }, WRITE_DEBOUNCE)
})

watch(() => props.nodeId, () => {
  if (timer) { clearTimeout(timer); timer = null }
  editingField.value = null
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.qf {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 6px;
  border-left: 2px solid var(--primary);
  border-radius: var(--radius-xs);
  background: transparent;
}
.qf-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.qf-dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; }
.qf-dot--todo { background: var(--text-tertiary); }
.qf-dot--draft { background: var(--warning, #d97706); }
.qf-dot--done { background: var(--success, #059669); }
.qf-mark {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--primary);
  color: var(--bg-secondary, #fff);
  font-size: var(--font-size-2xs);
  line-height: 1;
}
.qf-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold, 600);
  color: var(--text-color);
  cursor: text;
}
.qf-text--empty { font-style: italic; font-weight: normal; color: var(--text-tertiary); }
.qf-answer-wrap { display: flex; align-items: flex-start; gap: 6px; margin-left: 12px; min-width: 0; }
.qf-answer-body { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
.qf-mark--answer { background: var(--bg-tertiary); color: var(--text-secondary); }
.qf-answer {
  margin: 0;
  /* 中文排版：首行缩进两字（2026-10-19 用户要求） */
  text-indent: 2em;
  font-size: var(--font-size-2xs);
  line-height: 1.55;
  color: var(--text-secondary);
  cursor: text;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.qf-answer--empty { font-style: italic; color: var(--text-tertiary); }
.qf-input {
  flex: 1;
  min-width: 60px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold, 600);
  padding: 1px 4px;
  outline: none;
}
.qf-input--multi {
  width: 100%;
  text-indent: 2em;
  font-weight: normal;
  font-size: var(--font-size-2xs);
  line-height: 1.55;
  resize: vertical;
}
.qf-count { align-self: flex-end; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.qf-count--over { color: var(--warning, #d97706); }
</style>
