<template>
  <!--
    问题式（QuestionForm）—— 就地型表现形式（2026-10-19 新增）
    理论取值：问题式（文档 §一 表现形式 9 取值之一）。
    · 一个节点 = 一个「要回答的问题」：问句（properties.question）+ 状态点
    · 双击问句就地编辑；可选显示答案摘要（node.description）
    · 写入纪律与标题式/卡片式一致：400ms 防抖 + {skipUndo} + 白板撤销栈一步
  -->
  <div class="qf">
    <div class="qf-head">
      <span v-if="showStatus" class="qf-dot" :class="dotClass" :title="statusText" />
      <span class="qf-mark" aria-hidden="true">问</span>
      <input
        v-if="editing"
        ref="inputEl"
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
        @dblclick.stop="startEdit"
      >{{ displayQuestion }}</span>
    </div>
    <p v-if="showAnswer && hasAnswer" class="qf-answer">{{ answer }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 问题式：问句是主内容（写 `properties.question`），答案摘要只读（`description`）。
 * 与句子式的区别：句子式陈述事实，问题式以**未回答的问题**驱动结构。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveFormConfig } from './registry'
import { statusOf } from './progressStats'
import { injectBoardUndo } from '../composables/useBoardUndo'

const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.entities ?? []).find(e => e.id === props.nodeId))
const cfg = computed(() => resolveFormConfig('question', props.config))
const showStatus = computed(() => cfg.value.showStatus !== false)
const showAnswer = computed(() => cfg.value.showAnswer === true)

const question = computed(() => String(node.value?.properties?.question ?? '').trim())
const hasQuestion = computed(() => !!question.value)
const displayQuestion = computed(() => question.value || '双击写下这一节要回答的问题')
const answer = computed(() => (node.value?.description ?? '').trim())
const hasAnswer = computed(() => !!answer.value)
const statusText = computed(() => statusOf(node.value))
const dotClass = computed(() => {
  if (statusText.value === '完成') return 'qf-dot--done'
  if (statusText.value === '草稿') return 'qf-dot--draft'
  return 'qf-dot--todo'
})

const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

/** 写 properties.question：实体更新对 properties 是整体替换，必须先合并 */
function writeQuestion(value: string): void {
  const next = value.trim()
  if (next === String(node.value?.properties?.question ?? '')) return
  const nextProps = { ...(node.value?.properties ?? {}), question: next }
  void es.update(props.nodeId, { properties: nextProps }, 'user', { skipUndo: true })
}

async function startEdit(): Promise<void> {
  if (!node.value || editing.value) return
  sessionPrev = String(node.value.properties?.question ?? '')
  draft.value = sessionPrev
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function commit(): void {
  if (!editing.value) return
  if (timer) { clearTimeout(timer); timer = null }
  writeQuestion(draft.value)
  const prev = sessionPrev
  const next = (draft.value ?? '').trim()
  if (prev !== next) {
    const prevProps = { ...(node.value?.properties ?? {}), question: prev }
    const nextProps = { ...(node.value?.properties ?? {}), question: next }
    boardUndo?.recordContentEdit(props.nodeId, { properties: prevProps }, { properties: nextProps }, '改问题')
  }
  editing.value = false
}

function cancel(): void {
  if (timer) { clearTimeout(timer); timer = null }
  if (String(node.value?.properties?.question ?? '') !== sessionPrev) writeQuestion(sessionPrev)
  editing.value = false
}

watch(draft, v => {
  if (!editing.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => writeQuestion(v), WRITE_DEBOUNCE)
})

watch(() => props.nodeId, () => {
  if (timer) { clearTimeout(timer); timer = null }
  editing.value = false
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
.qf-answer {
  margin: 0 0 0 22px;
  font-size: var(--font-size-2xs);
  line-height: 1.55;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
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
</style>
