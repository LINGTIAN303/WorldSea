<template>
  <div
    v-if="visible && node"
    class="mm-node-tooltip"
    :style="positionStyle"
  >
    <div class="mm-nt-header">
      <span class="mm-nt-type-dot" :style="{ background: typeColor }"></span>
      <span class="mm-nt-name">{{ node.name }}</span>
    </div>
    <div class="mm-nt-meta">
      <span class="mm-nt-type">{{ typeLabel }}</span>
      <span v-if="node.tags?.length" class="mm-nt-tags">
        <span v-for="t in node.tags.slice(0, 3)" :key="t" class="mm-nt-tag">{{ t }}</span>
        <span v-if="node.tags.length > 3" class="mm-nt-tag-more">+{{ node.tags.length - 3 }}</span>
      </span>
    </div>
    <div v-if="node.description" class="mm-nt-desc">{{ truncate }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { typeLabel as makeTypeLabel } from '../mindmapConfig'
import type { CanvasNode } from '../composables/canvasTypes'

const props = defineProps<{
  visible: boolean
  node: CanvasNode | null
  x: number
  y: number
}>()

const typeColor = computed(() => props.node?.customColor || props.node?.color || 'var(--primary)')
const typeLabel = computed(() => makeTypeLabel(props.node?.type || ''))
const truncate = computed(() => {
  const d = props.node?.description || ''
  return d.length > 80 ? d.slice(0, 78) + '…' : d
})

const positionStyle = computed(() => {
  // 默认右上偏移 12px，避免遮挡鼠标
  const offsetX = 12
  const offsetY = -8
  return {
    left: (props.x + offsetX) + 'px',
    top: (props.y + offsetY) + 'px',
  }
})
</script>

<style scoped>
.mm-node-tooltip {
  position: fixed;
  z-index: 200;
  pointer-events: none;
  min-width: 180px;
  max-width: 280px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 8px 10px;
  font-size: var(--font-size-xs);
  animation: mm-nt-fade-in 120ms ease-out;
}
@keyframes mm-nt-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
.mm-nt-header {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 4px;
}
.mm-nt-type-dot {
  width: 8px; height: 8px; border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px var(--card-bg), 0 0 0 3px var(--border-color);
}
.mm-nt-name {
  font-weight: var(--font-weight-semibold);
  font-size: var(--font-size-sm);
  color: var(--text-color);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mm-nt-meta {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 4px;
}
.mm-nt-type {
  color: var(--text-tertiary);
  font-size: var(--font-size-xs);
  padding: 1px 5px;
  background: var(--color-bg-elevated);
  border-radius: 3px;
}
.mm-nt-tags { display: flex; gap: 3px; flex-wrap: wrap; }
.mm-nt-tag {
  color: var(--primary);
  background: var(--color-primary-subtle, var(--color-bg-elevated));
  padding: 1px 5px;
  border-radius: 3px;
  font-size: var(--font-size-xs);
}
.mm-nt-tag-more {
  color: var(--text-tertiary);
  padding: 1px 3px;
  font-size: var(--font-size-xs);
}
.mm-nt-desc {
  color: var(--text-secondary);
  line-height: 1.4;
  border-top: 1px solid var(--border-color);
  padding-top: 4px;
  margin-top: 4px;
}

/* ── 减弱动态偏好（prefers-reduced-motion）：停用提示浮现位移动画 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .mm-node-tooltip {
    animation: none;
  }
}
</style>
