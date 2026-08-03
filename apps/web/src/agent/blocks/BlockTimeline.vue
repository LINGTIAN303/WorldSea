<template>
  <div class="block-timeline">
    <div class="block-toggle" @click="expanded = !expanded">
      <span class="block-icon">📅</span>
      <span class="block-title">时间线: {{ block.title || '事件' }}</span>
      <span class="block-meta">{{ block.events.length }}个事件</span>
      <span class="block-arrow">{{ expanded ? '▾ 点击收起' : '▸ 点击展开' }}</span>
    </div>
    <Transition name="block-expand">
      <div v-if="expanded" class="block-content">
        <div v-for="(evt, i) in block.events" :key="i" class="tl-event">
          <div class="tl-dot"></div>
          <div class="tl-line" v-if="i < block.events.length - 1"></div>
          <div class="tl-body">
            <span class="tl-time">{{ evt.time }}</span>
            <span class="tl-label">{{ evt.label }}</span>
            <span v-if="evt.description" class="tl-desc">{{ evt.description }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { TimelineBlock } from '@agent/index'

defineProps<{ block: TimelineBlock }>()
const expanded = ref(false)
</script>

<style scoped>
.block-timeline { margin: 4px 0; }
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
.tl-event { display: flex; position: relative; padding-left: 20px; padding-bottom: 12px; }
.tl-event:last-child { padding-bottom: 0; }
.tl-dot {
  position: absolute; left: 0; top: 4px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--agent-primary, #6c5ce7); border: 2px solid var(--agent-accent, #b388ff);
}
.tl-line {
  position: absolute; left: 3px; top: 14px; bottom: 0;
  width: 2px; background: rgba(108,92,231,0.3);
}
.tl-body { display: flex; flex-direction: column; gap: 1px; }
.tl-time { font-size: 11px; color: var(--agent-accent, #b388ff); font-weight: 500; }
.tl-label { font-size: 13px; color: var(--agent-text, #e0e0e0); }
.tl-desc { font-size: 11px; color: var(--agent-text-tertiary, #888); }
.block-expand-enter-active, .block-expand-leave-active { transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease, opacity 0.2s ease, filter 0.2s ease; overflow: hidden; }
.block-expand-enter-from, .block-expand-leave-to { opacity: 0; }
</style>
