<template>
  <div :class="['note-card', variant]" @click="$emit('click', note.id)">
    <div class="nc-type-icon"><WsIcon :name="typeIcon" size="sm" /></div>
    <div class="nc-content">
      <div class="nc-name">{{ note.name }}</div>
      <div v-if="variant === 'card'" class="nc-preview">{{ preview }}</div>
    </div>
    <div v-if="variant === 'card' && note.tags?.length" class="nc-tags">
      <span v-for="tag in note.tags.slice(0, 2)" :key="tag" class="nc-tag">{{ tag }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import { NOTE_TYPES } from '../notebookConfig'
import type { NotebookEntity } from '../types'

const props = defineProps<{
  note: NotebookEntity
  variant?: 'card' | 'list'
}>()
defineEmits<{ click: [id: string] }>()

const typeIcon = computed(() => {
  const t = props.note.properties?.noteType || 'markdown'
  return NOTE_TYPES.find(n => n.value === t)?.icon || 'edit'
})

const preview = computed(() =>
  (props.note.properties?.content || '').replace(/<[^>]*>/g, '').slice(0, 60)
)
</script>

<style scoped>
.note-card { display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s; }
.note-card.card { padding: 10px 12px; border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); }
.note-card.card:hover { border-color: var(--color-primary); }
.note-card.list { padding: 5px 8px; border-radius: var(--radius-xs); }
.note-card.list:hover { background: var(--color-bg-hover); }
.note-card.list.active { background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
.nc-type-icon { font-size: var(--font-size-xl); flex-shrink: 0; }
.nc-content { flex: 1; min-width: 0; }
.nc-name { font-size: var(--font-size-sm); font-weight: var(--font-weight-medium); color: var(--color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nc-preview { font-size: var(--font-size-xs); color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.nc-tags { display: flex; gap: 3px; flex-shrink: 0; }
.nc-tag { font-size: var(--text-micro-font-size); padding: 1px 5px; border-radius: var(--radius-2xs); background: color-mix(in srgb, var(--color-primary) 15%, transparent); color: var(--color-primary); }
</style>
