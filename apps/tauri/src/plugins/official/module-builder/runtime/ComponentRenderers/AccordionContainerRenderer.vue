<template>
  <div class="accordion-container-renderer">
    <div v-for="(section, idx) in sections" :key="idx" class="ac-section">
      <button class="ac-header" @click="toggleSection(idx)">
        <span class="ac-arrow"><WsIcon :name="openSections.has(idx) ? 'chevron-down' : 'chevron-right'" size="xs" /></span>
        <span class="ac-title">{{ section.label }}</span>
      </button>
      <div v-if="openSections.has(idx)" class="ac-body">
        <div class="ac-hint">折叠区「{{ section.label }}」内容在展开区域中显示</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import { WsIcon } from '@worldsmith/ui-kit'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()

const sections = computed(() => {
  const raw = props.config.sections
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(label => ({ label: String(label) }))
  }
  const text = (props.config.sectionsText as string) || ''
  if (text) {
    return text.split(',').map(s => s.trim()).filter(Boolean).map(label => ({ label }))
  }
  return [{ label: '区域1' }]
})

const openSections = reactive(new Set<number>([0]))

function toggleSection(idx: number) {
  if (openSections.has(idx)) openSections.delete(idx)
  else openSections.add(idx)
}
</script>

<style scoped>
.accordion-container-renderer { display: flex; flex-direction: column; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg); }
.ac-section { border-bottom: 1px solid var(--border-color); }
.ac-section:last-child { border-bottom: none; }
.ac-header { display: flex; align-items: center; gap: 6px; width: 100%; padding: 10px 12px; border: none; background: var(--bg-secondary); cursor: pointer; font-size: var(--font-size-sm); color: var(--text-color); text-align: left; }
.ac-header:hover { background: var(--hover-bg); }
.ac-arrow { font-size: var(--font-size-xs); color: var(--text-tertiary); }
.ac-title { flex: 1; font-weight: var(--font-weight-medium); }
.ac-body { padding: 8px 12px; }
.ac-hint { display: flex; align-items: center; justify-content: center; min-height: 40px; color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>
