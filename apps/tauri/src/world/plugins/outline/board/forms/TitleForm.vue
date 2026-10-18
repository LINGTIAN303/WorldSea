<template>
  <!--
    标题式（TitleForm）—— **列表型**表现形式（2026-10-19 修正为列表语义）
    规格：docs/plans/2026-09-15-大纲芽重构-理论基线与现状.md §8.10.4 + 2026-10-19 用户修正
    · 一行 = 一个**子节点**（直接子节点，按 order）；一个标题式可列多行
    · 双击某行 → 就地改**该子节点**的 name（不是当前容器的节点）
    · 与树式的区别：树式递归展开整棵子树并带层级线；标题式只列直接子节点、平铺
    · 无子节点时显示空态（容器头部仍显示当前节点标题）
  -->
  <div class="tf" :class="{ 'tf--center': align === 'center' }">
    <div v-if="!rows.length" class="tf-empty">暂无子节点</div>
    <div
      v-for="(row, i) in rows"
      :key="row.id"
      class="tf-row"
      :class="{ 'tf-row--center': align === 'center' }"
    >
      <span v-if="showStatus" class="tf-dot" :class="dotClassOf(row)" :title="statusOf(row)" />
      <span v-if="numbered" class="tf-num">{{ numberingOf(i) }}</span>
      <input
        v-if="editingId === row.id"
        :ref="setInputRef"
        v-model="draft"
        class="tf-input"
        :style="rowTextStyle"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
        @dblclick.stop
      />
      <span
        v-else
        class="tf-text"
        :class="{ 'tf-text--empty': !row.name }"
        :style="rowTextStyle"
        :title="row.name || '未命名'"
        @dblclick.stop="startEdit(row)"
      >{{ row.name || '未命名' }}</span>
      <span v-if="showBranch && childCountOf(row) > 0" class="tf-branch">{{ childCountOf(row) }}</span>
    </div>
    <button class="tf-add" type="button" @click="addRow">＋ 添加标题</button>
  </div>
</template>

<script setup lang="ts">
/**
 * 标题式：列表型（行 = 直接子节点）。
 *
 * 2026-10-19 修正：此前实现为「显示当前节点的一行标题」，写完一行就结束；
 * 按负责人定义，标题式应是**标题列表**——一个标题式可多行，每行一个子节点。
 * 与树式的分工：树式 = 递归子树 + 层级线；标题式 = 直接子节点平铺（可带编号）。
 *
 * 写入：双击某行改该行 `name`，400ms 防抖 + `{ skipUndo }` + 白板撤销栈一步。
 */
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { useEntityStore, type Entity } from '@worldsea/entity-core'
import { resolveChildNodes } from '../outlineDerive'
import { createChildNode } from './childNodeCreate'
import { formatNumbering, type NumberingStyle } from './titleNumbering'
import { resolveFormConfig } from './registry'
import { statusOf as statusOfNode } from './progressStats'
import { injectBoardUndo } from '../composables/useBoardUndo'

const WRITE_DEBOUNCE = 400

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = useEntityStore()
const boardUndo = injectBoardUndo()

const allNodes = computed(() => (es.entities ?? []).filter(e => e.type === 'outline_node'))
const cfg = computed(() => resolveFormConfig('title', props.config))
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
const numbered = computed(() => numberingStyle.value !== 'none')

/** 行 = 直接子节点（按 order） */
const rows = computed<Entity[]>(() =>
  resolveChildNodes(props.nodeId, allNodes.value) as Entity[],
)

function numberingOf(index: number): string {
  if (!numbered.value) return ''
  // 列表型编号从 1 起（[i+1] 是 formatNumbering 的编号路径数组，一级即一个元素）
  return formatNumbering([index + 1], numberingStyle.value)
}

function statusOf(row: Entity): string {
  return statusOfNode(row)
}

function dotClassOf(row: Entity): string {
  const s = statusOf(row)
  if (s === '完成') return 'tf-dot--done'
  if (s === '草稿') return 'tf-dot--draft'
  return 'tf-dot--todo'
}

function childCountOf(row: Entity): number {
  return resolveChildNodes(row.id, allNodes.value).length
}

const rowTextStyle = computed(() => ({
  fontSize: `${(13 * fontScale.value).toFixed(1)}px`,
}))

// ── 行内就地编辑 ──
const editingId = ref<string | null>(null)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
/** v-for 内必须用函数 ref：字符串 ref 会被收集成数组 */
function setInputRef(el: Element | ComponentPublicInstance | null): void {
  inputEl.value = (el as HTMLInputElement | null) ?? null
}
let timer: ReturnType<typeof setTimeout> | null = null
let sessionPrev = ''

function writeName(targetId: string, value: string): void {
  const target = allNodes.value.find(n => n.id === targetId)
  const next = value.trim()
  if (!target || next === (target.name ?? '')) return
  void es.update(targetId, { name: next }, 'user', { skipUndo: true })
}

async function startEdit(row: Entity): Promise<void> {
  if (editingId.value === row.id) return
  editingId.value = row.id
  sessionPrev = row.name ?? ''
  draft.value = sessionPrev
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

function commit(): void {
  const id = editingId.value
  if (!id) return
  if (timer) { clearTimeout(timer); timer = null }
  writeName(id, draft.value)
  const next = (draft.value ?? '').trim()
  if (sessionPrev !== next) {
    boardUndo?.recordContentEdit(id, { name: sessionPrev }, { name: next }, '标题式改名')
  }
  editingId.value = null
  sessionPrev = ''
}

function cancel(): void {
  const id = editingId.value
  if (timer) { clearTimeout(timer); timer = null }
  if (id && sessionPrev && (allNodes.value.find(n => n.id === id)?.name ?? '') !== sessionPrev) {
    writeName(id, sessionPrev)
  }
  editingId.value = null
  sessionPrev = ''
}

watch(draft, v => {
  if (!editingId.value) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { if (editingId.value) writeName(editingId.value, v) }, WRITE_DEBOUNCE)
})

/** 直接在此处新建一行（子节点），并立即进入编辑 */
async function addRow(): Promise<void> {
  const id = await createChildNode(es, props.nodeId, '新标题')
  await nextTick()
  const created = allNodes.value.find(n => n.id === id)
  if (created) await startEdit(created)
}

// 换容器时退出编辑
watch(() => props.nodeId, () => {
  if (timer) { clearTimeout(timer); timer = null }
  editingId.value = null
})

defineExpose({ startEdit, commit, cancel })
</script>

<style scoped>
.tf { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tf--center { align-items: center; }
.tf-empty { font-size: var(--font-size-2xs); font-style: italic; color: var(--text-tertiary); }
.tf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  min-width: 0;
}
.tf-row--center { justify-content: center; }
.tf-num {
  flex-shrink: 0;
  min-width: 18px;
  font-size: var(--font-size-2xs);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.tf-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.5;
  color: var(--text-color);
  cursor: text;
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
.tf-dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; }
.tf-dot--todo { background: var(--text-tertiary); }
.tf-dot--draft { background: var(--warning, #d97706); }
.tf-dot--done { background: var(--success, #059669); }
.tf-input {
  flex: 1;
  min-width: 60px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  padding: 1px 3px;
  outline: none;
}
.tf-add {
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
.tf-add:hover { border-color: var(--primary); color: var(--primary); }
</style>
