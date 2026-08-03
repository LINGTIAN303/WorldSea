<template>
  <div class="block-stat">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon">📊</span>
      <span class="block-title">统计: {{ block.title || '概览' }}</span>
      <span class="block-meta">{{ block.items.length }}项</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div class="stat-grid">
          <div v-for="item in block.items" :key="item.label" class="stat-item">
            <span v-if="item.icon" class="stat-icon">{{ item.icon }}</span>
            <span class="stat-value">{{ item.value }}</span>
            <span class="stat-label">{{ item.label }}</span>
            <span v-if="item.trend" class="stat-trend" :class="item.trend">{{ trendIcon(item.trend) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { StatBlock } from '@agent/index'

defineProps<{ block: StatBlock }>()
const expanded = ref(false)
function trendIcon(t: string): string { return t === 'up' ? '↑' : t === 'down' ? '↓' : '→' }
</script>

<style scoped>
.block-stat { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-meta { color: var(--agent-text-tertiary, #888); }
.block-arrow { color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 10px 12px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px;
}
.stat-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.stat-item {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 8px 14px; border-radius: 8px; background: rgba(255,255,255,0.04);
  min-width: 70px;
}
.stat-icon { font-size: 16px; }
.stat-value { font-size: 20px; font-weight: 700; color: var(--agent-text, #e0e0e0); }
.stat-label { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.stat-trend { font-size: 12px; }
.stat-trend.up { color: #22c55e; }
.stat-trend.down { color: #ef4444; }
.stat-trend.flat { color: var(--agent-text-tertiary, #888); }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
