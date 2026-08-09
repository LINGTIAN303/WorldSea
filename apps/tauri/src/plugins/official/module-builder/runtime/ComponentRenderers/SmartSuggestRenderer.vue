<template>
  <div class="smart-suggest-renderer">
    <div class="ss-header">
      <span class="ss-icon"><WsIcon name="inspiration" size="md" /></span>
      <span class="ss-title">{{ config.title || '智能建议' }}</span>
    </div>
    <div class="ss-body">
      <div v-if="suggestions.length === 0" class="ss-empty">
        <button class="ss-ask-btn" @click="requestSuggestions">获取建议</button>
      </div>
      <div v-else class="ss-list">
        <div v-for="(s, idx) in suggestions" :key="idx" class="ss-item" @click="applySuggestion(s)">
          <span class="ss-item-icon"><WsIcon name="inspiration" size="xs" /></span>
          <div class="ss-item-content">
            <span class="ss-item-text">{{ s.text }}</span>
            <span v-if="s.detail" class="ss-item-detail">{{ s.detail }}</span>
          </div>
          <button class="ss-apply">应用</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, inject } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

interface Suggestion { text: string; detail?: string; action?: string; data?: unknown }
const suggestions = ref<Suggestion[]>([])

function requestSuggestions() {
  ctx?.emit('ai:suggest', {
    componentId: props.componentId,
    entityType: props.config.entityType,
    context: {
      entityCount: ctx?.filteredList.value.length || 0,
      selectedEntity: ctx?.selectedEntity.value,
    },
  })
}

function applySuggestion(s: Suggestion) {
  ctx?.emit('ai:apply-suggestion', { componentId: props.componentId, suggestion: s })
}

function handleSuggestResult(payload: unknown) {
  const p = payload as { componentId?: string; suggestions: Suggestion[] }
  if (p.componentId && p.componentId !== props.componentId) return
  suggestions.value = p.suggestions || []
}

ctx?.on('ai:suggest-result', handleSuggestResult)

onBeforeUnmount(() => {
  ctx?.off('ai:suggest-result', handleSuggestResult)
})
</script>

<style scoped>
.smart-suggest-renderer { border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg); }
.ss-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
.ss-icon { font-size: var(--font-size-lg); }
.ss-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.ss-body { padding: 10px 12px; }
.ss-empty { display: flex; justify-content: center; padding: 12px; }
.ss-ask-btn { padding: 6px 16px; background: var(--primary); color: var(--on-accent); border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; }
.ss-ask-btn:hover { opacity: 0.9; }
.ss-list { display: flex; flex-direction: column; gap: 6px; }
.ss-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); cursor: pointer; transition: background 0.1s, border-color 0.1s, color 0.1s, box-shadow 0.1s, transform 0.1s, opacity 0.1s, filter 0.1s; }
.ss-item:hover { border-color: var(--primary); background: rgba(79, 70, 229, 0.04); }
.ss-item-icon { font-size: var(--font-size-base); flex-shrink: 0; }
.ss-item-content { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ss-item-text { font-size: var(--font-size-sm); color: var(--text-color); }
.ss-item-detail { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.ss-apply { padding: 3px 8px; border: 1px solid var(--primary); border-radius: 4px; background: transparent; color: var(--primary); font-size: var(--font-size-xs); cursor: pointer; flex-shrink: 0; }
.ss-apply:hover { background: rgba(79, 70, 229, 0.08); }
</style>
