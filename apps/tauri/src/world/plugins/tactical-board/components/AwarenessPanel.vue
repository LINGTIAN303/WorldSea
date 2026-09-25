<template>
  <div class="aw-panel">
    <div class="aw-title">态势感知</div>
    <div class="aw-modes">
      <button v-for="m in modes" :key="m.value" class="aw-mode-btn"
        :class="{ active: currentMode === m.value }"
        @click="$emit('toggleMode', m.value)">
        <span class="aw-mode-icon"><WsIcon :name="m.icon" size="sm" /></span>
        <span class="aw-mode-label">{{ m.label }}</span>
      </button>
    </div>
    <div class="aw-legend" v-if="currentMode !== 'none'">
      <template v-if="currentMode === 'influence'">
        <div class="aw-legend-item"><span class="aw-legend-dot aw-dot-ally"></span>友方控制</div>
        <div class="aw-legend-item"><span class="aw-legend-dot aw-dot-enemy"></span>敌方控制</div>
        <div class="aw-legend-item"><span class="aw-legend-dot aw-dot-neutral"></span>中立区域</div>
      </template>
      <template v-if="currentMode === 'threat'">
        <div class="aw-legend-item"><span class="aw-legend-bar aw-bar-threat"></span>威胁等级</div>
        <div class="aw-legend-item aw-legend-hint">数值越高越危险</div>
      </template>
      <template v-if="currentMode === 'supply'">
        <div class="aw-legend-item"><span class="aw-legend-dot aw-dot-supply"></span>补给线</div>
        <div class="aw-legend-item"><span class="aw-legend-dot aw-dot-isolated"></span>孤立单位</div>
      </template>
    </div>
    <button class="aw-refresh" @click="$emit('refresh')" v-if="currentMode !== 'none'">
      <WsIcon name="refresh" size="xs" /> 刷新数据
    </button>
  </div>
</template>

<script setup lang="ts">
import { WsIcon } from '@worldsea/ui-kit'
import type { AwarenessMode } from '../composables/useAwareness'

defineProps<{
  currentMode: AwarenessMode
  modes: { value: AwarenessMode; label: string; icon: string }[]
}>()

defineEmits<{
  (e: 'toggleMode', mode: AwarenessMode): void
  (e: 'refresh'): void
}>()
</script>

<style scoped>
.aw-panel {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.aw-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.aw-modes {
  display: flex;
  gap: 3px;
  margin-bottom: 8px;
}

.aw-mode-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 2px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  font-size: var(--font-size-xs);
}

.aw-mode-btn:hover {
  border-color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
}

.aw-mode-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.aw-mode-icon {
  font-size: var(--font-size-base);
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.aw-mode-label {
  white-space: nowrap;
}

.aw-legend {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--color-text-primary) 2%, transparent);
  border-radius: var(--radius-xs);
  margin-bottom: 6px;
}

.aw-legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-text-primary);
}

.aw-legend-hint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.aw-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.aw-dot-ally { background: color-mix(in srgb, var(--color-primary) 50%, transparent); }
.aw-dot-enemy { background: color-mix(in srgb, var(--color-danger) 50%, transparent); }
.aw-dot-neutral { background: color-mix(in srgb, var(--color-text-secondary) 50%, transparent); }
.aw-dot-supply { background: color-mix(in srgb, var(--color-success) 50%, transparent); }
.aw-dot-isolated { background: color-mix(in srgb, var(--color-warning) 50%, transparent); border: 1px dashed color-mix(in srgb, var(--color-warning) 70%, transparent); }

.aw-legend-bar {
  width: 40px;
  height: 8px;
  border-radius: 2px;
  background: linear-gradient(to right, color-mix(in srgb, var(--color-danger) 10%, transparent), color-mix(in srgb, var(--color-danger) 60%, transparent));
}

.aw-refresh {
  width: 100%;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.aw-refresh:hover {
  border-color: var(--color-text-secondary);
  color: var(--color-text-primary);
}
</style>
