<template>
  <div class="block-list">
    <div class="block-toggle" role="button" tabindex="0" :aria-expanded="expanded" @click="expanded = !expanded" @keydown.enter.prevent="expanded = !expanded" @keydown.space.prevent="expanded = !expanded">
      <span class="block-icon"><WsIcon name="clipboard-list" size="xs" /></span>
      <span class="block-title">列表: {{ block.title || '项目' }}</span>
      <span class="block-meta">{{ block.items.length }}项</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div v-for="(item, i) in block.items" :key="i" class="list-item">
          <span v-if="item.icon" class="list-icon">{{ item.icon }}</span>
          <div class="list-info">
            <span class="list-label">{{ item.label }}</span>
            <span v-if="item.description" class="list-desc">{{ item.description }}</span>
          </div>
          <span v-if="item.value" class="list-value">{{ item.value }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ListBlock } from '@worldsmith/agent-runtime'
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{ block: ListBlock }>()
const expanded = ref(false)
</script>

<style scoped>
.block-list { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 8%, transparent); border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 20%, transparent);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: color-mix(in srgb, var(--agent-accent, #b388ff) 50%, transparent); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-meta { color: var(--agent-text-tertiary, #888); }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 8px 10px; margin-top: 4px;
  background: color-mix(in srgb, var(--bg-app) 15%, transparent); border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 20%, transparent);
  border-radius: 8px;
}
.list-item {
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px; border-radius: 4px;
  transition: background 0.1s;
}
.list-item:hover { background: color-mix(in srgb, var(--bg-surface) 4%, transparent); }
.list-icon { font-size: 14px; flex-shrink: 0; }
.list-info { display: flex; flex-direction: column; gap: 1px; flex: 1; }
.list-label { font-size: 13px; color: var(--agent-text, #e0e0e0); }
.list-desc { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.list-value { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
