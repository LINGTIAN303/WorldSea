<template>
  <div class="nb-board">
    <div v-if="notes.length === 0" class="nb-board-empty">
      <WsIcon name="dashboard" size="xl" />
      <div class="nb-be-text">暂无笔记</div>
    </div>
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
              @click="$emit('select', element.id)"
            >
              <div class="nb-bc-icon"><WsIcon :name="getNoteIcon(element)" size="sm" /></div>
              <div class="nb-bc-name">{{ element.name }}</div>
              <div class="nb-bc-preview">{{ (element.properties?.content || '').slice(0, 80) }}</div>
              <div v-if="element.tags?.length" class="nb-bc-tags">
                <span v-for="tag in element.tags.slice(0, 3)" :key="tag" class="nb-bc-tag">{{ tag }}</span>
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
import { useEntityStore } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'
import { NOTE_TYPES } from '../notebookConfig'
import type { NotebookEntity } from '../types'

interface BoardColumn {
  type: string
  label: string
  icon: string
  items: NotebookEntity[]
}

const props = defineProps<{ notes: NotebookEntity[] }>()
const emit = defineEmits<{ select: [id: string] }>()

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
.nb-board { padding: 16px; overflow: auto; height: 100%; }
.nb-board-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--color-text-tertiary); gap: 8px; }
.nb-be-text { font-size: var(--font-size-sm); }
.nb-board-columns { display: flex; gap: 16px; height: 100%; }
.nb-board-col { min-width: 240px; max-width: 320px; flex: 1; display: flex; flex-direction: column; background: var(--color-bg-surface); border-radius: 8px; border: 1px solid var(--color-border-subtle); }
.nb-col-header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--color-border-subtle); color: var(--color-text-secondary); font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); }
.nb-col-count { margin-left: auto; font-size: var(--font-size-xs); color: var(--color-text-tertiary); }
.nb-col-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 8px; min-height: 60px; }
.nb-board-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border-subtle); border-radius: 8px; padding: 12px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.nb-board-card:hover { border-color: var(--color-primary); transform: translateY(-1px); }
.nb-bc-icon { font-size: var(--font-size-xl); margin-bottom: 6px; }
.nb-bc-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); margin-bottom: 4px; }
.nb-bc-preview { font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.4; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.nb-bc-tags { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.nb-bc-tag { font-size: var(--font-size-xs); padding: 1px 6px; border-radius: 3px; background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.nb-card-ghost { opacity: 0.3; }
.nb-card-drag { opacity: 0.8; }
</style>
