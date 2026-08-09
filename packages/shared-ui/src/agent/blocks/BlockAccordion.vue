<template>
  <div class="block-accordion">
    <div class="block-toggle" role="button" tabindex="0" :aria-expanded="expanded" @click="expanded = !expanded" @keydown.enter.prevent="expanded = !expanded" @keydown.space.prevent="expanded = !expanded">
      <span class="block-icon"><WsIcon name="document" size="xs" /></span>
      <span class="block-title">{{ block.title || '详情' }}</span>
      <span class="block-meta">{{ block.sections.length }}段</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <details v-for="(sec, i) in block.sections" :key="i" class="acc-section">
          <summary class="acc-summary">{{ sec.title }}</summary>
          <div class="acc-body">{{ sec.content }}</div>
        </details>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { AccordionBlock } from '@worldsmith/agent-runtime'
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{ block: AccordionBlock }>()
const expanded = ref(false)
</script>

<style scoped>
.block-accordion { margin: 4px 0; }
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
  background: rgba(0,0,0,0.15); border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 20%, transparent);
  border-radius: 8px;
}
.acc-section { border-bottom: 1px solid rgba(255,255,255,0.06); }
.acc-section:last-child { border-bottom: none; }
.acc-summary {
  cursor: pointer; padding: 6px 8px; font-size: 13px;
  color: var(--agent-text, #e0e0e0); font-weight: 500;
  list-style: none;
}
.acc-summary::before { content: '▸ '; color: var(--agent-accent, #b388ff); }
.acc-section[open] .acc-summary::before { content: '▾ '; }
.acc-body {
  padding: 4px 8px 8px; font-size: 12px;
  color: var(--agent-text-secondary, #aaa); line-height: 1.5; white-space: pre-wrap;
}
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
