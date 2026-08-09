<template>
  <div class="plan-panel">
    <div class="panel-header">
      <h3 class="panel-title">任务计划</h3>
      <button class="panel-close-btn" @click="emit('close')" title="关闭"><WsIcon name="close" :size="14" :stroke-width="1.7" /></button>
    </div>
    <div class="panel-body">
      <div class="plan-scroll-area">
        <div class="section-header" role="button" tabindex="0" :aria-expanded="planExpanded" @click="planExpanded = !planExpanded" @keydown.enter.prevent="planExpanded = !planExpanded" @keydown.space.prevent="planExpanded = !planExpanded">
          <span class="section-label">计划</span>
          <span v-if="planProgress.total > 0" class="section-meta">{{ planProgress.completed }}/{{ planProgress.total }}</span>
          <WsIcon name="chevron-down" :size="13" class="section-chevron" :class="{ collapsed: !planExpanded }" :stroke-width="1.7" />
        </div>
        <div v-show="planExpanded">
          <div v-if="!planStore.hasPlan.value" class="panel-empty">暂无任务计划</div>
          <div
            v-for="(item, idx) in planStore.items.value"
            :key="item.id"
            class="plan-item"
            :class="[`plan-${item.status}`]"
          >
            <span class="item-step" :class="`step-${item.status}`">
              <WsIcon v-if="item.status === 'completed'" name="check" :size="12" :stroke-width="1.7" />
              <WsIcon v-else-if="item.status === 'skipped'" name="chevron-right" :size="12" :stroke-width="1.7" />
              <template v-else>{{ idx + 1 }}</template>
            </span>
            <div class="item-content">
              <span class="item-title" :class="{ 'item-done': item.status === 'completed' || item.status === 'skipped' }">{{ item.title }}</span>
              <span v-if="item.description" class="item-desc">{{ item.description }}</span>
            </div>
          </div>
          <div v-if="planProgress.total > 0" class="plan-mini-bar">
            <div class="plan-mini-fill" :style="{ width: planProgress.pct + '%' }"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { usePlanStore } from '@worldsmith/shared-composables/agent/usePlanStore'
import { WsIcon } from '@worldsmith/ui-kit'

const emit = defineEmits<{ close: [] }>()

const planStore = usePlanStore()

const planProgress = planStore.progress
const planExpanded = ref(true)
</script>

<style scoped>
.plan-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  contain: layout paint style;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.panel-title {
  font-size: var(--fs-md);
  font-weight: 600;
  margin: 0;
}

.panel-close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.panel-close-btn:hover {
  background: var(--bg-muted);
  color: var(--text-primary);
}

.panel-close-btn:active:not(:disabled) {
  transform: scale(var(--press-scale));
}

.panel-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
}

.plan-scroll-area {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  contain: layout paint style;
}

.panel-empty {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  text-align: center;
  padding: 16px 0;
}

/* --- Section Header --- */

.section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}

.section-header:hover .section-label {
  color: var(--text-primary);
}

.section-label {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
  transition: color 0.15s;
}

.section-meta {
  font-size: var(--fs-xs);
  color: var(--accent);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.section-chevron {
  color: var(--text-muted);
  transition: transform 0.2s;
  margin-left: auto;
}

.section-chevron.collapsed {
  transform: rotate(-90deg);
}

/* --- Plan Item --- */

.plan-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 6px 8px;
  margin-bottom: 3px;
  border-radius: var(--radius-sm);
  background: var(--bg-muted);
  transition: background 0.15s, opacity 0.2s;
}

.plan-item.plan-in_progress {
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
}

.plan-item.plan-completed,
.plan-item.plan-skipped {
  opacity: 0.5;
}

.item-step {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-2xs);
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
  transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
}

.step-pending {
  background: var(--bg-surface);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.step-in_progress {
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
  animation: step-pulse 2s ease-in-out infinite;
}

@keyframes step-pulse {
  0%, 100% { box-shadow: 0 0 0 3px var(--accent-soft); }
  50% { box-shadow: 0 0 0 5px var(--accent-soft); }
}

.step-completed {
  background: var(--success);
  color: var(--on-accent);
}

.step-skipped {
  background: var(--bg-surface);
  color: var(--text-muted);
}

.item-content { flex: 1; min-width: 0; }

.item-title {
  font-size: var(--fs-sm);
  color: var(--text-primary);
  line-height: 1.4;
}

.item-title.item-done {
  text-decoration: line-through;
  color: var(--text-muted);
}

.item-desc {
  display: block;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  margin-top: 1px;
  line-height: 1.3;
}

.plan-mini-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--border);
  overflow: hidden;
  margin-top: 6px;
}

.plan-mini-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.3s ease;
}

/* ── 减弱动态偏好（prefers-reduced-motion）：停用 step 脉冲与按压缩放手势 ──
   与 TuiButton/TuiModal/TuiDrawer/AgentWorkspace 同一可访问性语言：仅保留静态状态。 */
@media (prefers-reduced-motion: reduce) {
  .step-in_progress {
    animation: none;
  }
  .section-chevron {
    transition: none;
  }
  .panel-close-btn:active:not(:disabled) {
    transform: none;
  }
}
</style>
