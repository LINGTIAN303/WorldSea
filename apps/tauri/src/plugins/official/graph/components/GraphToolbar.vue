<template>
  <div class="gg-toolbar">
    <select class="gg-select" :value="layout" @change="$emit('update:layout', ($event.target as HTMLSelectElement).value)">
      <option v-for="opt in layoutOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
    </select>
    <div class="gg-filters">
      <span class="gg-flabel">实体：</span>
      <button v-for="t in entityTypes" :key="t.type" class="gg-type-btn"
        :class="{ on: enabledTypes.has(t.type) }"
        :style="{ borderColor: t.color }"
        @click="$emit('toggle-type', t.type)">
        <WsIcon v-if="t.icon" :name="t.icon" size="xs" /> {{ t.label }}
      </button>
    </div>
    <div class="gg-actions">
      <button class="gg-btn" :class="{ active: clusteringOn }" @click="$emit('toggle-clustering')" title="智能聚类">◉</button>
      <button class="gg-btn" @click="$emit('open-path-search')" title="路径搜索">⇢</button>
      <button class="gg-btn" @click="$emit('open-timeline')" title="时间轴过滤"><WsIcon name="timeline" size="xs" /></button>
    </div>
    <div class="gg-zoom">
      <button class="gg-btn" @click="$emit('zoom-in')" aria-label="放大">＋</button>
      <span class="gg-zlv">{{ zoomPct }}%</span>
      <button class="gg-btn" @click="$emit('zoom-out')" aria-label="缩小">−</button>
      <button class="gg-btn" @click="$emit('fit')" aria-label="适应画面">⊡</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TypeInfo } from '@worldsmith/entity-core'
import { WsIcon } from '@worldsmith/ui-kit'

defineProps<{
  layout: string
  layoutOptions: { value: string; label: string }[]
  entityTypes: (TypeInfo & { color: string })[]
  enabledTypes: Set<string>
  zoomPct: number
  clusteringOn: boolean
}>()

defineEmits<{
  'update:layout': [value: string]
  'toggle-type': [type: string]
  'toggle-clustering': []
  'open-path-search': []
  'open-timeline': []
  'zoom-in': []
  'zoom-out': []
  'fit': []
}>()
</script>

<style scoped>
.gg-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--color-border); background: var(--color-bg-surface); flex-shrink: 0; flex-wrap: wrap; }
.gg-select { padding: 5px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-primary); font-size: var(--font-size-sm); }
.gg-filters { display: flex; align-items: center; gap: 3px; flex-wrap: wrap; }
.gg-flabel { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
.gg-type-btn { font-size: var(--font-size-xs); padding: 3px 8px; border: 2px solid var(--color-border); background: var(--color-bg-elevated); border-radius: var(--radius-2xl); cursor: pointer; opacity: 0.4; transition: opacity 0.15s; color: var(--color-text-primary); }
.gg-type-btn.on { opacity: 1; background: var(--color-bg-hover); }
.gg-type-btn:hover { opacity: 0.75; }
.gg-actions { display: flex; gap: 4px; }
.gg-btn { width: 28px; height: 28px; border: 1px solid var(--color-border); background: var(--color-bg-elevated); border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-size-base); display: flex; align-items: center; justify-content: center; color: var(--color-primary); transition: background 0.15s; }
.gg-btn:hover { background: var(--color-bg-hover); }
.gg-btn.active { background: var(--color-primary-subtle); border-color: var(--color-primary); }
.gg-zoom { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.gg-zlv { font-size: var(--font-size-xs); color: var(--color-text-secondary); width: 40px; text-align: center; }
</style>
