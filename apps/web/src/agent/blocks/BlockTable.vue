<template>
  <div class="block-table">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon">📊</span>
      <span class="block-title">表格: {{ block.title || '数据' }}</span>
      <span class="block-meta">{{ block.rows.length }}行 × {{ block.columns.length }}列</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <table class="block-table-inner">
          <thead>
            <tr>
              <th v-for="col in block.columns" :key="col.key" :style="col.align ? { textAlign: col.align } : {}">
                {{ col.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in block.rows" :key="ri">
              <td v-for="col in block.columns" :key="col.key">
                {{ row[col.key] ?? '' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { TableBlock } from '@agent/index'

defineProps<{
  block: TableBlock
}>()

const expanded = ref(false)
</script>

<style scoped>
.block-table { margin: 4px 0; }
.block-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 14px; cursor: pointer;
  background: rgba(108,92,231,0.08); border: 1px solid rgba(108,92,231,0.2);
  transition: border-color 0.15s; font-size: 12px;
}
.block-toggle:hover { border-color: rgba(108,92,231,0.5); }
.block-icon { font-size: 13px; }
.block-title { font-size: 12px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.block-meta { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-arrow { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-content {
  padding: 10px 12px; margin-top: 4px;
  background: rgba(0,0,0,0.15); border: 1px solid rgba(108,92,231,0.2);
  border-radius: 8px; overflow-x: auto;
}
.block-table-inner { width: 100%; border-collapse: collapse; font-size: 12px; }
.block-table-inner th {
  padding: 5px 10px; text-align: left; color: var(--agent-text-secondary, #888);
  border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 11px; text-transform: uppercase;
}
.block-table-inner td {
  padding: 5px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);
  color: var(--agent-text, #e0e0e0);
}
.block-expand-enter-active, .block-expand-leave-active {
  transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden;
}
.block-expand-enter-from, .block-expand-leave-to {
  opacity: 0;
}
</style>
