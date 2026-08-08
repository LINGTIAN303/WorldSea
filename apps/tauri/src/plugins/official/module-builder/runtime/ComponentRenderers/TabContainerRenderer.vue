<template>
  <div class="tab-container-renderer">
    <div class="tc-tabs">
      <button v-for="(tab, idx) in tabs" :key="idx"
        class="tc-tab" :class="{ active: activeTab === idx }"
        @click="activeTab = idx">
        {{ tab.label }}
      </button>
    </div>
    <div class="tc-content">
      <div class="tc-hint">当前标签: {{ tabs[activeTab]?.label || '—' }}（子组件在展开区域中显示）</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{ config: Record<string, unknown>; componentId: string }>()

const tabs = computed(() => {
  const raw = props.config.tabs
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map(label => ({ label: String(label) }))
  }
  const text = (props.config.tabsText as string) || ''
  if (text) {
    return text.split(',').map(s => s.trim()).filter(Boolean).map(label => ({ label }))
  }
  return [{ label: '标签1' }]
})

const activeTab = ref(0)
</script>

<style scoped>
.tab-container-renderer { display: flex; flex-direction: column; width: 100%; height: 100%; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; background: var(--bg); }
.tc-tabs { display: flex; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
.tc-tab { padding: 8px 16px; border: none; background: transparent; font-size: var(--font-size-sm); cursor: pointer; color: var(--text-secondary); border-bottom: 2px solid transparent; }
.tc-tab:hover { color: var(--text-color); }
.tc-tab.active { color: var(--primary); border-bottom-color: var(--primary); }
.tc-content { flex: 1; padding: 8px; overflow: auto; }
.tc-hint { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>
