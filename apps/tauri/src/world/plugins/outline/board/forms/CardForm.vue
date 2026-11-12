<template>
  <!--
    卡片式（CardForm）—— 就地型表现形式（2026-10-19 新增）
    规格：docs/plans/2026-10-19-表现形式写入交互规格.md（三档模型 · 就地编辑档）
    · 一个节点 = 一张卡：标题 + 摘要 + 状态点 + 标签 + 字数
    · 双击标题改 node.name、双击摘要改 node.description（软上限 120 字）
    · 写入纪律与标题式/句子式一致：400ms 防抖 + {skipUndo} + 白板撤销栈一步
  -->
  <div class="cf">
    <div class="cf-head">
      <span v-if="showStatus" class="cf-dot" :class="dotClass" :title="statusText" />
      <input
        v-if="editingName"
        ref="nameInput"
        v-model="nameDraft"
        class="cf-input cf-input--title"
        @keydown.enter="guardEnter($event, commitName)"
        @keydown.esc="guardEsc($event, cancelName)"
        @blur="commitName"
        @dblclick.stop
      />
      <span
        v-else
        class="cf-title"
        :class="{ 'cf-title--empty': !hasName }"
        :title="displayName"
        @dblclick.stop="startEditName"
      >{{ displayName }}</span>
      <span v-if="showWordCount" class="cf-meta">{{ wordCount }} 字</span>
    </div>

    <input
      v-if="editingDesc"
      ref="descInput"
      v-model="descDraft"
      class="cf-input"
      @keydown.enter="guardEnter($event, commitDesc)"
      @keydown.esc="guardEsc($event, cancelDesc)"
      @blur="commitDesc"
      @dblclick.stop
    />
    <p
      v-else
      class="cf-desc"
      :class="{ 'cf-desc--empty': !hasDesc }"
      :style="{ WebkitLineClamp: summaryLines }"
      @dblclick.stop="startEditDesc"
    >{{ displayDesc }}</p>

    <div v-if="showTags && tags.length" class="cf-tags">
      <span v-for="t in tags" :key="t" class="cf-tag">{{ t }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 卡片式：就地编辑档（标题 / 摘要），其余为派生只读（状态点 / 标签 / 字数）。
 * 与标题式的区别：标题式是「一行」，卡片式是「一块」——多行摘要 + 标签 + 内边距。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { resolveFormConfig } from './registry'
import { statusOf } from './progressStats'
import { injectBoardUndo } from '../composables/useBoardUndo'
import { guardEnter, guardEsc } from './enterGuard'
import { entitiesSvc } from '../../serviceAccess'

const WRITE_DEBOUNCE = 400
/** 摘要软上限（与句子式对齐） */
const DESC_LIMIT = 120

const props = defineProps<{
  nodeId: string
  config?: Record<string, unknown>
}>()

const es = entitiesSvc()
const boardUndo = injectBoardUndo()

const node = computed(() => (es.list() ?? []).find(e => e.id === props.nodeId))
const cfg = computed(() => resolveFormConfig('card', props.config))
const showStatus = computed(() => cfg.value.showStatus !== false)
const showTags = computed(() => cfg.value.showTags !== false)
const showWordCount = computed(() => cfg.value.showWordCount === true)
const summaryLines = computed(() => {
  const n = Number(cfg.value.summaryLines)
  return Number.isFinite(n) && n > 0 ? Math.min(6, Math.round(n)) : 2
})

const hasName = computed(() => !!((node.value?.name ?? '').trim()))
const hasDesc = computed(() => !!((node.value?.description ?? '').trim()))
const displayName = computed(() => (node.value?.name ?? '').trim() || '未命名节点')
const displayDesc = computed(() => (node.value?.description ?? '').trim() || '双击添加摘要…')
const tags = computed(() => (node.value?.tags ?? []).filter(Boolean))
const wordCount = computed(() => Number(node.value?.properties?.wordCount ?? 0) || 0)
const statusText = computed(() => statusOf(node.value))
const dotClass = computed(() => {
  if (statusText.value === '完成') return 'cf-dot--done'
  if (statusText.value === '草稿') return 'cf-dot--draft'
  return 'cf-dot--todo'
})

// ── 就地编辑（标题 / 摘要各一个会话） ──
const editingName = ref(false)
const editingDesc = ref(false)
const nameDraft = ref('')
const descDraft = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const descInput = ref<HTMLInputElement | null>(null)
let nameTimer: ReturnType<typeof setTimeout> | null = null
let descTimer: ReturnType<typeof setTimeout> | null = null
let namePrev = ''
let descPrev = ''

function writeField(field: 'name' | 'description', value: string): void {
  const next = value.trim()
  const cur = field === 'name' ? (node.value?.name ?? '') : (node.value?.description ?? '')
  if (next === cur) return
  void es.update(props.nodeId, { [field]: next }, 'user', { skipUndo: true })
}

function clearTimers(): void {
  if (nameTimer) { clearTimeout(nameTimer); nameTimer = null }
  if (descTimer) { clearTimeout(descTimer); descTimer = null }
}

async function startEditName(): Promise<void> {
  if (!node.value || editingName.value) return
  namePrev = node.value.name ?? ''
  nameDraft.value = namePrev
  editingName.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

function commitName(): void {
  if (!editingName.value) return
  if (nameTimer) { clearTimeout(nameTimer); nameTimer = null }
  writeField('name', nameDraft.value)
  const next = (nameDraft.value ?? '').trim()
  if (namePrev !== next) boardUndo?.recordContentEdit(props.nodeId, { name: namePrev }, { name: next }, '卡片改标题')
  editingName.value = false
}

function cancelName(): void {
  if (nameTimer) { clearTimeout(nameTimer); nameTimer = null }
  if ((node.value?.name ?? '') !== namePrev) writeField('name', namePrev)
  editingName.value = false
}

async function startEditDesc(): Promise<void> {
  if (!node.value || editingDesc.value) return
  descPrev = node.value.description ?? ''
  descDraft.value = descPrev
  editingDesc.value = true
  await nextTick()
  descInput.value?.focus()
  descInput.value?.select()
}

function commitDesc(): void {
  if (!editingDesc.value) return
  if (descTimer) { clearTimeout(descTimer); descTimer = null }
  writeField('description', descDraft.value)
  const next = (descDraft.value ?? '').trim()
  if (descPrev !== next) {
    boardUndo?.recordContentEdit(props.nodeId, { description: descPrev }, { description: next }, '卡片改摘要')
  }
  editingDesc.value = false
}

function cancelDesc(): void {
  if (descTimer) { clearTimeout(descTimer); descTimer = null }
  if ((node.value?.description ?? '') !== descPrev) writeField('description', descPrev)
  editingDesc.value = false
}

// 输入过程防抖落库（暂停即保存）
watch(nameDraft, v => {
  if (!editingName.value) return
  if (nameTimer) clearTimeout(nameTimer)
  nameTimer = setTimeout(() => writeField('name', v), WRITE_DEBOUNCE)
})
watch(descDraft, v => {
  if (!editingDesc.value) return
  if (descTimer) clearTimeout(descTimer)
  descTimer = setTimeout(() => writeField('description', v.slice(0, DESC_LIMIT)), WRITE_DEBOUNCE)
})

// 换节点时退出编辑，避免把 A 的草稿写到 B
watch(() => props.nodeId, () => {
  clearTimers()
  editingName.value = false
  editingDesc.value = false
})

defineExpose({ startEditName, startEditDesc, commitName, commitDesc })
</script>

<style scoped>
.cf {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-mid);
  background: var(--bg-tertiary);
}
.cf-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cf-dot { flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%; }
.cf-dot--todo { background: var(--text-tertiary); }
.cf-dot--draft { background: var(--warning, #d97706); }
.cf-dot--done { background: var(--success, #059669); }
.cf-title {
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
.cf-title--empty { font-style: italic; color: var(--text-tertiary); }
.cf-meta { flex-shrink: 0; font-size: var(--font-size-2xs); color: var(--text-tertiary); }
.cf-desc {
  margin: 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: var(--font-size-2xs);
  line-height: 1.55;
  color: var(--text-secondary);
  cursor: text;
  white-space: pre-wrap;
  word-break: break-word;
}
.cf-desc--empty { font-style: italic; color: var(--text-tertiary); }
.cf-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.cf-tag {
  padding: 0 4px;
  border-radius: var(--radius-xs);
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-size: var(--font-size-2xs);
}
.cf-input {
  width: 100%;
  min-width: 40px;
  border: 1px solid var(--primary);
  border-radius: var(--radius-xs);
  background: var(--input-bg);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--font-size-xs);
  padding: 1px 4px;
  outline: none;
}
.cf-input--title { font-weight: var(--font-weight-semibold, 600); }
</style>
