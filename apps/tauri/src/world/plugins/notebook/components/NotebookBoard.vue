<template>
  <div class="nb-board">
    <!-- 空态（批 4 V7）：搜索无结果 / 一篇都没有 分流；后者带引导动作 -->
    <WsEmpty v-if="notes.length === 0 && searching" preset="no-result" title="没有匹配的笔记" />
    <WsEmpty
      v-else-if="notes.length === 0"
      title="创建你的第一篇笔记"
      description="看板按笔记类型分列，拖拽卡片即可切换类型"
    >
      <template #icon><WsIcon name="notebook" size="xl" /></template>
      <template #action>
        <button class="nb-empty-btn" @click="$emit('create')">+ 新建笔记</button>
      </template>
    </WsEmpty>
    <div v-else class="nb-board-columns">
      <div v-for="col in columns" :key="col.type" class="nb-board-col">
        <div class="nb-col-header">
          <WsIcon :name="col.icon" size="xs" />
          <span class="nb-col-name">{{ col.label }}</span>
          <span class="nb-col-count">{{ col.items.length }}</span>
        </div>
        <draggable
          :list="col.items"
          item-key="id"
          group="notes"
          ghost-class="nb-card-ghost"
          drag-class="nb-card-drag"
          class="nb-col-list"
          @change="onColChange(col.type, $event)"
        >
          <template #item="{ element }">
            <div
              class="nb-board-card"
              :style="{ '--nb-card-accent': typeColor(element) }"
              role="button"
              tabindex="0"
              :aria-label="`打开笔记 ${element.name}`"
              @click="$emit('select', element.id)"
              @keydown.enter.prevent="$emit('select', element.id)"
              @keydown.space.prevent="$emit('select', element.id)"
            >
              <img v-if="coverOf(element)" class="nb-bc-cover" :src="coverOf(element)" alt="" />
              <div class="nb-bc-content">
                <div class="nb-bc-head">
                  <span class="nb-bc-icon"><WsIcon :name="getNoteIcon(element)" size="sm" /></span>
                  <span class="nb-bc-name">{{ element.name }}</span>
                </div>
                <div v-if="notePreview(element)" class="nb-bc-preview">{{ notePreview(element) }}</div>
                <div class="nb-bc-foot">
                  <div v-if="element.tags?.length" class="nb-bc-tags">
                    <span v-for="tag in element.tags.slice(0, 3)" :key="tag" class="nb-bc-tag">{{ tag }}</span>
                  </div>
                  <span v-if="relTime(element)" class="nb-bc-time">{{ relTime(element) }}</span>
                </div>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import draggable from 'vuedraggable'
import { useEntityStore } from '@worldsea/entity-core'
import { WsEmpty, WsIcon } from '@worldsea/ui-kit'
import { formatRelativeTime } from '@/components/ui/format'
import { NOTE_TYPES } from '../notebookConfig'
import type { NotebookEntity } from '../types'

interface BoardColumn {
  type: string
  label: string
  icon: string
  items: NotebookEntity[]
}

const props = defineProps<{ notes: NotebookEntity[]; searching?: boolean }>()
const emit = defineEmits<{ select: [id: string]; create: [] }>()

const entityStore = useEntityStore()
const columns = ref<BoardColumn[]>([])

watch(() => props.notes, (notes) => {
  columns.value = NOTE_TYPES.map(nt => ({
    type: nt.value,
    label: nt.label,
    icon: nt.icon,
    items: notes.filter(n => (n.properties?.noteType || 'markdown') === nt.value),
  })).filter(col => col.items.length > 0)
}, { immediate: true })

function getNoteIcon(note: NotebookEntity): string {
  const noteType = note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(t => t.value === noteType)?.icon || 'edit'
}

/** 正文以 TipTap HTML 存储，卡片预览需先剥标签再截断，否则会漏出 <p>/<strong> 等标签文本 */
function notePreview(note: NotebookEntity): string {
  return (note.properties?.content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/** 类型色（批 4 V6）：与侧栏条目同源（NOTE_TYPES.color 单源），经 CSS 变量 --nb-card-accent 下发 */
function typeColor(note: NotebookEntity): string {
  const noteType = note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(t => t.value === noteType)?.color || 'var(--color-primary)'
}

/** 封面（批 4 V6）：真源 = visual trait 顶层 coverImage（store 已归一）；旧数据 properties.cover 回退（与书籍同口径） */
function coverOf(note: NotebookEntity): string {
  return note.coverImage || ((note.properties as Record<string, unknown>)?.cover as string) || ''
}

/** 相对更新时间（批 4 V6）：无效/缺失 → 空串（不渲染） */
function relTime(note: NotebookEntity): string {
  const ts = note.updatedAt ? new Date(note.updatedAt).getTime() : NaN
  return Number.isFinite(ts) ? formatRelativeTime(ts) : ''
}

function onColChange(colType: string, evt: any) {
  if (!evt.added) return
  const note = evt.added.element as NotebookEntity
  if (!note || note.properties?.noteType === colType) return
  entityStore.update(note.id, {
    properties: { ...note.properties, noteType: colType },
  })
}
</script>

<style scoped>
.nb-board { padding: 16px; overflow: auto; height: 100%; display: flex; flex-direction: column; }
/* 空态引导按钮（批 4 V7）：与 NotebookView 空态同款口径 */
.nb-empty-btn { padding: 6px 16px; border-radius: var(--radius-xs); border: 1px solid var(--color-primary); background: transparent; color: var(--color-primary); font-size: var(--font-size-sm); cursor: pointer; transition: background 0.15s; }
.nb-empty-btn:hover { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.nb-board-columns { flex: 1; min-height: 0; display: flex; gap: 16px; }
.nb-board-col { min-width: 240px; max-width: 320px; flex: 1; display: flex; flex-direction: column; background: var(--color-bg-surface); border-radius: var(--radius-mid); border: 1px solid var(--color-border-subtle); }
.nb-col-header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
.nb-col-count { margin-left: auto; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.nb-col-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }
/* 卡片（批 4 V6）：顶部类型色条（--nb-card-accent）+ 可选封面 + 头部信息行 + 摘要 + 底栏（标签/时间） */
.nb-board-card { position: relative; overflow: hidden; background: var(--color-bg-elevated); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-mid); cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.nb-board-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--nb-card-accent, var(--color-primary)); z-index: 1; }
.nb-board-card:hover { border-color: var(--color-primary); transform: translateY(-1px); }
.nb-bc-cover { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; }
.nb-bc-content { padding: 10px 12px 12px; }
.nb-bc-head { display: flex; align-items: center; gap: 6px; }
.nb-bc-icon { display: flex; flex-shrink: 0; color: var(--nb-card-accent, var(--color-primary)); }
.nb-bc-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nb-bc-preview { font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.4; margin-top: 4px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.nb-bc-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.nb-bc-tags { display: flex; gap: 4px; flex-wrap: wrap; min-width: 0; }
.nb-bc-tag { font-size: var(--font-size-xs); padding: 1px 6px; border-radius: var(--radius-2xs); background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.nb-bc-time { margin-left: auto; flex-shrink: 0; font-size: var(--font-size-2xs); color: var(--color-text-tertiary); }
.nb-card-ghost { opacity: 0.3; }
.nb-card-drag { opacity: 0.8; }
</style>
