<template>
  <div class="auto-fill-renderer">
    <div class="af-header">
      <span class="af-icon"><WsIcon name="magic" size="sm" /></span>
      <span class="af-title">{{ config.title || '自动填充' }}</span>
    </div>
    <div class="af-body">
      <div v-for="f in fillFields" :key="f.key" class="af-field">
        <label class="af-label">{{ f.label }}</label>
        <div class="af-value-row">
          <span class="af-value">{{ filledData[f.key] ?? '—' }}</span>
          <button class="af-fill-btn" @click="requestFill(f.key)">填充</button>
        </div>
      </div>
      <button class="af-fill-all" @click="requestFillAll">全部填充</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, onBeforeUnmount, inject } from 'vue'
import type { ModuleRuntimeContext } from '../ModuleRuntimeContext'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()
const ctx = inject<ModuleRuntimeContext | null>('moduleRuntimeContext', null)

const fillFields = computed(() => {
  const types = ctx?.manifest.entityTypes || []
  const et = types.find(t => t.name === props.config.entityType)
  if (!et) return []
  const show = props.config.fillFields as string[] | undefined
  if (show && show.length > 0) return et.fields.filter(f => show.includes(f.key))
  return et.fields.slice(0, 5)
})

const filledData = reactive<Record<string, unknown>>({})

function requestFill(fieldKey: string) {
  ctx?.emit('ai:autofill', {
    componentId: props.componentId,
    entityType: props.config.entityType,
    fieldKey,
    context: ctx?.selectedEntity.value ? { entity: ctx.selectedEntity.value } : {},
  })
}

function requestFillAll() {
  for (const f of fillFields.value) {
    requestFill(f.key)
  }
}

function handleAutoFillResult(payload: unknown) {
  const p = payload as { componentId?: string; fieldKey: string; value: unknown }
  if (p.componentId && p.componentId !== props.componentId) return
  filledData[p.fieldKey] = p.value
}

ctx?.on('ai:autofill-result', handleAutoFillResult)

onBeforeUnmount(() => {
  ctx?.off('ai:autofill-result', handleAutoFillResult)
})
</script>

<style scoped>
.auto-fill-renderer { border: 1px solid var(--border-color); border-radius: var(--radius-mid); overflow: hidden; background: var(--bg); }
.af-header { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); }
.af-icon { font-size: var(--font-size-lg); }
.af-title { font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); color: var(--text-color); }
.af-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.af-field { display: flex; flex-direction: column; gap: 3px; }
.af-label { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.af-value-row { display: flex; align-items: center; gap: 6px; }
.af-value { flex: 1; font-size: var(--font-size-sm); color: var(--text-color); padding: 4px 8px; background: var(--bg-secondary); border-radius: var(--radius-xs); min-height: 20px; }
.af-fill-btn { padding: 3px 8px; border: 1px solid var(--primary); border-radius: var(--radius-xs); background: transparent; color: var(--primary); font-size: var(--font-size-xs); cursor: pointer; }
.af-fill-btn:hover { background: var(--accent-soft, rgba(79, 70, 229, 0.08)); }
.af-fill-all { padding: 6px 12px; background: var(--primary); color: var(--on-accent); border: none; border-radius: var(--radius-sm); font-size: var(--font-size-sm); cursor: pointer; margin-top: 4px; }
.af-fill-all:hover { opacity: 0.9; }
</style>
