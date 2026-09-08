<template>
  <div class="block-comparison">
    <div class="block-toggle" role="button" tabindex="0" :aria-expanded="expanded" @click="expanded = !expanded" @keydown.enter.prevent="expanded = !expanded" @keydown.space.prevent="expanded = !expanded">
      <WsIcon name="relation" size="xs" class="block-icon" />
      <span class="block-title">对比: {{ block.left.label }} vs {{ block.right.label }}</span>
      <span class="block-arrow"><WsIcon :name="expanded ? 'chevron-down' : 'chevron-right'" size="xs" /><span>{{ expanded ? '点击收起' : '点击展开' }}</span></span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div class="cmp-header">
          <span class="cmp-name">{{ block.left.label }}</span>
          <span class="cmp-vs">VS</span>
          <span class="cmp-name">{{ block.right.label }}</span>
        </div>
        <div v-for="key in allKeys" :key="key" class="cmp-row" :class="{ diff: block.left.items[key] !== block.right.items[key] }">
          <span class="cmp-val">{{ block.left.items[key] ?? '-' }}</span>
          <span class="cmp-key">{{ key }}</span>
          <span class="cmp-val">{{ block.right.items[key] ?? '-' }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsIcon } from '@worldsea/ui-kit'
import type { ComparisonBlock } from '@worldsea/agent-runtime'

const props = defineProps<{ block: ComparisonBlock }>()
const expanded = ref(false)
const allKeys = computed(() => {
  const leftItems = props.block.left.items || {}
  const rightItems = props.block.right.items || {}
  const keys = new Set([...Object.keys(leftItems), ...Object.keys(rightItems)])
  return [...keys]
})
</script>

<style scoped>
.block-comparison { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: color-mix(in srgb, var(--agent-accent, #b388ff) 8%, transparent); border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 20%, transparent);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: color-mix(in srgb, var(--agent-accent, #b388ff) 50%, transparent); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 10px 12px; margin-top: 4px;
  background: color-mix(in srgb, var(--bg-app) 15%, transparent); border: 1px solid color-mix(in srgb, var(--agent-accent, #b388ff) 20%, transparent);
  border-radius: 8px;
}
.cmp-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.cmp-name { font-size: 13px; font-weight: 600; color: var(--agent-text, #e0e0e0); flex: 1; text-align: center; }
.cmp-vs { font-size: 11px; color: var(--agent-text-tertiary, #888); font-weight: 700; }
.cmp-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid var(--agent-border); font-size: 12px; }
.cmp-row.diff { background: color-mix(in srgb, var(--agent-accent, #b388ff) 6%, transparent); border-radius: 3px; }
.cmp-val { flex: 1; text-align: center; color: var(--agent-text, #e0e0e0); }
.cmp-key { flex: 0 0 auto; padding: 0 8px; color: var(--agent-text-tertiary, #888); font-size: 11px; }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
