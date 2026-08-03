<template>
  <Transition name="ws-slide-right">
    <div v-if="visible && clusters.length" class="gg-cluster">
      <div class="gg-cluster-header">
        <span class="gg-cluster-title">社区聚类</span>
        <button class="gg-cluster-close" @click="$emit('close')">✕</button>
      </div>
      <div class="gg-cluster-body">
        <div
          v-for="c in clusters"
          :key="c.id"
          class="gg-cluster-item"
          :class="{ active: hoveredCluster === c.id }"
          @mouseenter="hoveredCluster = c.id"
          @mouseleave="hoveredCluster = null"
          @click="$emit('focusCluster', c)"
        >
          <span class="gg-cluster-dot" :style="{ background: c.color }"></span>
          <span class="gg-cluster-label">{{ c.label }}</span>
          <span class="gg-cluster-count">{{ c.size }}</span>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { ClusterInfo } from '../composables/useGraphClustering'

defineProps<{
  visible: boolean
  clusters: ClusterInfo[]
}>()

defineEmits<{
  close: []
  focusCluster: [cluster: ClusterInfo]
}>()

const hoveredCluster = ref<string | null>(null)
</script>

<style scoped>
.gg-cluster {
  position: absolute;
  top: 60px;
  right: 12px;
  width: 220px;
  max-height: 400px;
  background: rgba(10, 14, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  backdrop-filter: blur(12px);
  z-index: 20;
  overflow: hidden;
}
.gg-cluster-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.gg-cluster-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  color: #e0e0e0;
}
.gg-cluster-close {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: var(--font-size-base);
  padding: 2px 4px;
  border-radius: 4px;
}
.gg-cluster-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
.gg-cluster-body {
  padding: 6px 0;
  max-height: 340px;
  overflow-y: auto;
}
.gg-cluster-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.gg-cluster-item:hover, .gg-cluster-item.active {
  background: rgba(255, 255, 255, 0.05);
}
.gg-cluster-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.gg-cluster-label {
  flex: 1;
  font-size: var(--font-size-sm);
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-cluster-count {
  font-size: var(--font-size-xs);
  color: #888;
  background: rgba(255,255,255,0.06);
  padding: 1px 6px;
  border-radius: 8px;
}

</style>
