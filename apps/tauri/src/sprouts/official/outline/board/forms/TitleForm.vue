<template>
  <!--
    标题式（TitleForm）—— 就地型表现形式
    规格：docs/plans/2026-09-16-大纲白板-表现形式规格.md §一
    · 一行标题 + 可选层级缩进 / 编号 / 状态色点
    · 双击就地编辑，只写 node.name；层级与顺序不在组件内改（归实体侧）
  -->
  <div class="tf" :class="{ 'tf--center': align === 'center' }" @dblclick.stop="startEdit">
    <input
      v-if="editing"
      ref="inputEl"
      v-model="draft"
      class="tf-input"
      :style="inputStyle"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="cancel"
      @blur="commit"
      @dblclick.stop
    />
    <template v-else>
      <span v-if="showStatus" class="tf-dot" :class="dotClass" :title="statusText" />
      <span class="tf-text" :class="{ 'tf-text--empty': !hasName }" :style="textStyle">{{ displayText }}</span>
      <span v-if="showBranch && childCount > 0" class="tf-branch">{{ childCount }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 标题式组件：内容映射 node.name + 深度/序号/状态，全部经纯函数派生（见 outlineDerive / titleNumbering）。
 * 写入策略：输入过程 400ms 防抖落库 + { skipUndo }（撤销由白板栈负责，避免污染实体全局撤销）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useEntityStore } from '@worldsea/entity-core'
import { resolveChildNodes, resolveNodeDepth, resolveNodeNumbering } from '../outlineDerive'
import { formatNumbering, indentForDepth, type NumberingStyle } from './titleNumbering'
import { resolveFormConfig } from './registry'

/** 内容写入防抖（规格 §0.3） */
const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()

const node = computed(() => (es.entities ?? []).find(e => e.id === props.nodeId))
const allNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))

const cfg = computed(() => resolveFormConfig('title', props.config))
const showDepth = computed(() => cfg.value.showDepth !== false)
const showStatus = computed(() => cfg.value.showStatus !== false)
const showBranch = computed(() => cfg.value.showBranch === true)
const align = computed(() => (cfg.value.align === 'center' ? 'center' : 'left'))
const fontScale = computed(() => {
  const n = Number(cfg.value.fontScale)
  return Number.isFinite(n) && n > 0 ? Math.min(1.5, Math.max(0.8, n)) : 1
})
const numberingStyle = computed<NumberingStyle>(() => {
  const v = cfg.value.numbering
  return v === 'none' || v === 'chinese' || v === 'roman' ? v : 'numeric'
})

/** 悬空容器（节点已删）时组件不该崩：显示占位由容器层负责，这里做空值兜底 */
const hasName = computed(() => !!((node.value?.name ?? '').trim()))
const statusText = computed(() => ((node.value?.properties?.status as string) || '未写'))
const dotClass = computed(() => {
  if (statusText.value === '完成') return 'tf-dot--done'
  if (statusText.value === '草稿') return 'tf-dot--draft'
  return 'tf-dot--todo'
})

const depth = computed(() => resolveNodeDepth(props.nodeId, allNodes.value))
const numbering = computed(() => resolveNodeNumbering(props.nodeId, allNodes.value))
const childCount = computed(() => resolveChildNodes(props.nodeId, allNodes.value).length)

const displayText = computed(() => {
  const name = (node.value?.name ?? '').trim() || '未命名节点'
  const prefix = formatNumbering(numbering.value, numberingStyle.value)
  return prefix ? `${prefix} ${name}` : name
})

const textStyle = computed(() => ({
  fontSize: `${(13 * fontScale.value).toFixed(1)}px`,
  paddingLeft: `${showDepth.value ? indentForDepth(depth.value) : 0}px`,
}))
const inputStyle = computed(() => ({
  fontSize: `${(13 * fontScale.value).toFixed(1)}px`,
  paddingLeft: `${(showDepth.value ? indentForDepth(depth.value) : 0) + 2}px`,
}))

// ── 就地编辑 ──────────────────────────────
const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
let writeTimer: ReturnType<typeof setTimeout> | null = null

function clearWriteTimer(): void {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
}

function writeName(value: string): void {
  clearWriteTimer()
  const next = value.trim()
  if (next === (node.value?.name ?? '')) return
  void es.update(props.nodeId, { name: next }, 'user', { skipUndo: true })
}

function scheduleWrite(value: string): void {
  clearWriteTimer()
  writeTimer = setTimeout(() => writeName(value), WRITE_DEBOUNCE)
}

async function startEdit(): Promise<void> {
  if (!node.value) return
  draft.value = node.value.name ?? ''
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function commit(): void {
  if (!editing.value) return
  writeName(draft.value)
  editing.value = false
}

function cancel(): void {
  clearWriteTimer()
  editing.value = false
}

// 输入过程防抖落库（等价于「暂停即保存」）
watch(draft, v => {
  if (editing.value) scheduleWrite(v)
})

// 切换容器时退出编辑态，避免把 A 的草稿写到 B
watch(() => props.nodeId, () => {
  clearWriteTimer()
  editing.value = false
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.tf {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  color: var(--text-color);
}
.tf--center { justify-content: center; }
.tf-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
}
.tf-text--empty { font-style: italic; color: var(--text-tertiary); }
.tf-branch {
  flex-shrink: 0;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-radius: var(--radius-xs);
  padding: 0 4px;
}
.tf-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.tf-dot--todo { background: var(--text-tertiary); }
.tf-dot--draft { background: var(--warning, #d97706); }
.tf-dot--done { background: var(--success, #059669); }
.tf-input {
  width: 100%;
  min-width: 60px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  padding-top: 1px;
  padding-bottom: 1px;
  outline: none;
}
</style>
