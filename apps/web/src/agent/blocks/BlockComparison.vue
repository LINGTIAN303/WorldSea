<template>
  <div class="block-comparison">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon">🔀</span>
      <span class="block-title">对比: {{ block.left.label }} vs {{ block.right.label }}</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
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
import type { ComparisonBlock } from '@agent/index'

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
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 10px 12px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px;
}
.cmp-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
.cmp-name { font-size: 13px; font-weight: 600; color: var(--agent-text, #e0e0e0); flex: 1; text-align: center; }
.cmp-vs { font-size: 11px; color: var(--agent-text-tertiary, #888); font-weight: 700; }
.cmp-row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px; }
.cmp-row.diff { background: rgba(108,92,231,0.06); border-radius: 3px; }
.cmp-val { flex: 1; text-align: center; color: var(--agent-text, #e0e0e0); }
.cmp-key { flex: 0 0 auto; padding: 0 8px; color: var(--agent-text-tertiary, #888); font-size: 11px; }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
