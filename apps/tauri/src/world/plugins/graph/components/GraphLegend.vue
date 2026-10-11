<template>
  <div v-if="visible" class="gg-legend">
    <div class="gg-legend-title">节点类型</div>
    <div v-for="t in types" :key="t.type" class="gg-legend-item">
      <span class="gg-legend-dot" :style="{ background: t.color }"></span>
      <WsIcon v-if="t.icon" :name="t.icon" size="xs" /> {{ t.label }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'

defineProps<{
  visible: boolean
  types: { type: string; label: string; icon: string; color: string }[]
}>()
</script>

<style scoped>
.gg-legend { position: fixed; bottom: 12px; right: 12px; z-index: var(--z-dropdown); background: var(--g-panel-bg, rgba(10,14,20,0.92)); border: 1px solid var(--g-panel-border, rgba(255,255,255,0.08)); border-radius: var(--radius-mid); padding: 10px 14px; font-size: var(--font-size-xs); color: var(--g-text, #ccc); min-width: 100px; backdrop-filter: blur(8px); }
.gg-legend-title { color: #7c4dff; margin-bottom: 4px; font-size: var(--font-size-xs); font-weight: bold; }
.gg-legend-item { display: flex; align-items: center; gap: 6px; margin: 2px 0; }
.gg-legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
</style>
