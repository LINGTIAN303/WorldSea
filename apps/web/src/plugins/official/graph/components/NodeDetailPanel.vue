<template>
  <Transition name="ws-slide-right">
    <div v-if="visible && node" class="gg-detail">
      <div class="gg-detail-header">
        <span class="gg-detail-icon">{{ node.icon }}</span>
        <span class="gg-detail-name">{{ node.name }}</span>
        <button class="gg-detail-close" @click="$emit('close')">✕</button>
      </div>
      <div class="gg-detail-body">
        <div class="gg-detail-row"><span class="gg-detail-label">类型</span><span class="gg-detail-value">{{ node.label }}</span></div>
        <div class="gg-detail-row"><span class="gg-detail-label">关系数</span><span class="gg-detail-value">{{ node.degree }}</span></div>
        <div v-if="node.tags.length" class="gg-detail-row"><span class="gg-detail-label">标签</span><span class="gg-detail-value">{{ node.tags.join(', ') }}</span></div>
        <div v-if="node.description" class="gg-detail-desc">{{ node.description }}</div>
        <button class="gg-detail-nav" @click="$emit('navigate', node)">打开详情</button>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { type GraphNode } from '@worldsmith/ui-kit'

defineProps<{
  visible: boolean
  node: GraphNode | null
}>()

defineEmits<{
  close: []
  navigate: [node: GraphNode]
}>()
</script>

<style scoped>
.gg-detail { position: absolute; right: 0; top: 0; bottom: 0; width: 240px; background: var(--color-bg-surface); border-left: 1px solid var(--color-border); padding: 16px; overflow-y: auto; z-index: 100; backdrop-filter: blur(8px); }
.gg-detail-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.gg-detail-icon { font-size: var(--font-size-xl); }
.gg-detail-name { flex: 1; font-size: var(--font-size-base); font-weight: bold; color: var(--color-text-primary); }
.gg-detail-close { border: none; background: none; color: var(--color-text-secondary); cursor: pointer; font-size: var(--font-size-base); }
.gg-detail-body { font-size: var(--font-size-sm); }
.gg-detail-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--color-border); }
.gg-detail-label { color: var(--color-text-secondary); }
.gg-detail-value { color: var(--color-text-primary); }
.gg-detail-desc { margin-top: 8px; font-size: var(--font-size-xs); color: var(--color-text-tertiary); line-height: 1.5; }
.gg-detail-nav { margin-top: 12px; width: 100%; padding: 6px; border: 1px solid var(--color-primary); border-radius: 4px; background: var(--color-primary-subtle); color: var(--color-primary); cursor: pointer; font-size: var(--font-size-sm); }
.gg-detail-nav:hover { background: var(--color-primary-subtle); }

</style>
