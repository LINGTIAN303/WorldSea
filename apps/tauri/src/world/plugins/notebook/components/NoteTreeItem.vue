<template>
  <div
    class="nti"
    :class="{ active }"
    role="button"
    tabindex="0"
    :aria-current="active ? 'true' : undefined"
    :aria-label="`打开笔记 ${note.name}`"
    @click="$emit('select', note.id)"
    @keydown.enter.prevent="$emit('select', note.id)"
    @keydown.space.prevent="$emit('select', note.id)"
    @contextmenu.stop="$emit('menu', $event)"
  >
    <span class="nti-icon" :style="{ color: typeColor }"><WsIcon :name="typeIcon" size="xs" /></span>
    <span class="nti-main">
      <span class="nti-line">
        <span class="nti-name">{{ note.name }}</span>
        <span v-if="relTime" class="nti-time">{{ relTime }}</span>
      </span>
      <span
        v-if="snippet"
        class="nti-snippet"
        :class="{ 'nti-snippet--clamp2': !!searchQuery }"
        v-html="snippet"
      ></span>
    </span>
  </div>
</template>

<script setup lang="ts">
/**
 * 侧栏笔记条目（批 4 V5）：类型色图标 + 名称 + 相对时间 + 摘要。
 * - 搜索模式（searchQuery 非空）：摘要为命中高亮片段（两行截断），迁自 FolderTree.snippetOf；
 * - 常态：摘要为正文前 42 字（一行截断）。
 * 摘要经 escapeHtml 后才注入（搜索高亮 mark 自行拼接，防正文注入——既有安全约定）。
 */
import { computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import { formatRelativeTime } from '@/components/ui/format'
import { NOTE_TYPES } from '../notebookConfig'
import type { NotebookEntity } from '../types'

const props = defineProps<{
  note: NotebookEntity
  active: boolean
  /** 批 3 F1 搜索词：非空 → 命中高亮摘要（两行）；空 → 常态摘要（一行） */
  searchQuery?: string
}>()

defineEmits<{ select: [id: string]; menu: [event: MouseEvent] }>()

const typeIcon = computed(() => {
  const noteType = props.note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(t => t.value === noteType)?.icon || 'edit'
})

const typeColor = computed(() => {
  const noteType = props.note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(t => t.value === noteType)?.color || 'var(--accent)'
})

/** 相对更新时间（无效/缺失 → 空串不渲染） */
const relTime = computed(() => {
  const ts = props.note.updatedAt ? new Date(props.note.updatedAt).getTime() : NaN
  return Number.isFinite(ts) ? formatRelativeTime(ts) : ''
})

function plainTextOf(note: NotebookEntity): string {
  return (note.properties?.content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const snippet = computed(() => {
  const text = plainTextOf(props.note)
  if (!text) return ''
  const q = (props.searchQuery || '').replace(/#\S+/g, '').trim()
  if (q) {
    // 搜索命中高亮（批 3 F1，迁自 FolderTree）
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return ''
    const pad = 28
    const start = Math.max(0, idx - pad)
    const end = Math.min(text.length, idx + q.length + pad)
    const body = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
    const esc = escapeHtml(body)
    return esc.replace(new RegExp(escapeRegExp(q), 'gi'), (m) => `<mark>${m}</mark>`)
  }
  // 常态摘要（批 4 V5）：前 42 字
  const LIMIT = 42
  return escapeHtml(text.slice(0, LIMIT)) + (text.length > LIMIT ? '…' : '')
})
</script>

<style scoped>
.nti {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px 5px 10px;
  border-radius: var(--radius-xs); cursor: pointer; font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  transition: background 0.1s, color 0.1s;
}
.nti:hover { background: var(--color-bg-hover); }
.nti.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); }
.nti.active .nti-name { color: var(--color-primary); }
.nti-icon { display: flex; flex-shrink: 0; }
.nti-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.nti-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.nti-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nti-time { flex-shrink: 0; font-size: var(--font-size-2xs); color: var(--color-text-tertiary); }
.nti-snippet {
  font-size: var(--font-size-2xs); color: var(--color-text-tertiary);
  line-height: 1.4; overflow: hidden; display: -webkit-box;
  -webkit-line-clamp: 1; -webkit-box-orient: vertical;
}
.nti-snippet--clamp2 { -webkit-line-clamp: 2; }
.nti-snippet :deep(mark) {
  background: color-mix(in srgb, var(--color-primary) 25%, transparent);
  color: var(--color-primary); padding: 0 1px; border-radius: 2px;
}
</style>
