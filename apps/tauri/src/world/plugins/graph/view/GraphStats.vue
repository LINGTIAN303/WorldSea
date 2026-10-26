<template>
  <div class="g-stats" aria-label="图谱统计">
    <span class="g-stat"><b>{{ stats.entities }}</b> 实体</span>
    <span class="g-stat"><b>{{ stats.relations }}</b> 关系</span>
    <span class="g-stat g-stat--warn"><b>{{ stats.isolated }}</b> 未连接</span>
    <span class="g-stat"><b>{{ stats.types }}</b> 类型</span>
    <span class="g-stat-ratio" :title="`已连接实体 ${stats.connected} / ${stats.entities}`">
      <span class="g-stat-ratio-bar"><i :style="{ width: ratioWidth }"></i></span>
      <span class="g-stat-ratio-text">{{ ratioText }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { OverviewStats } from '../model/types'

const props = defineProps<{ stats: OverviewStats }>()

const ratioText = computed(() => `${(props.stats.connectedRatio * 100).toFixed(1)}% 已连接`)
const ratioWidth = computed(() => `${Math.max(2, props.stats.connectedRatio * 100)}%`)
</script>

<style scoped>
.g-stats {
  position: absolute; left: 12px; bottom: 12px; z-index: 5;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 6px 10px; border: 1px solid var(--g-panel-border, rgba(255,255,255,0.1));
  border-radius: var(--radius-2xl); background: var(--g-panel-bg, rgba(8,12,20,0.92));
  backdrop-filter: blur(10px); font-size: var(--font-size-xs); color: var(--g-text-dim, #94a3b8);
}
.g-stat b { color: var(--g-text-strong, #e2e8f0); font-weight: var(--font-weight-semibold); }
.g-stat--warn b { color: #d9a05b; }
.g-stat-ratio { display: flex; align-items: center; gap: 6px; }
.g-stat-ratio-bar { display: inline-block; width: 60px; height: 4px; border-radius: 2px; background: var(--g-hover, rgba(255,255,255,0.1)); overflow: hidden; }
.g-stat-ratio-bar i { display: block; height: 100%; border-radius: 2px; background: var(--g-accent, #6ea8fe); }
.g-stat-ratio-text { white-space: nowrap; }
</style>
