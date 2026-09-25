<template>
  <div class="ac-panel">
    <div class="ac-title">AI 控制</div>
    <div class="ac-teams">
      <div v-for="t in teamList" :key="t.team" class="ac-team-row">
        <span class="ac-team-dot" :class="'ac-team-' + t.team"></span>
        <span class="ac-team-name">{{ t.label }}</span>
        <button class="ac-toggle" :class="{ active: t.aiEnabled }" @click="$emit('toggleAI', t.team)">
          {{ t.aiEnabled ? 'AI 接管中' : '手动控制' }}
        </button>
      </div>
    </div>
    <div class="ac-speed">
      <span class="ac-speed-label">速度</span>
      <div class="ac-speed-btns">
        <button v-for="s in speeds" :key="s.value" class="ac-speed-btn"
          :class="{ active: currentSpeed === s.value }"
          @click="$emit('setSpeed', s.value)">
          {{ s.label }}
        </button>
      </div>
    </div>
    <div class="ac-actions">
      <button class="ac-btn ac-btn-step" @click="$emit('singleStep')" :disabled="!canAct">
        单步执行
      </button>
      <button class="ac-btn ac-btn-auto" @click="$emit('toggleAuto')" :disabled="!canAct"
        :class="{ running: isRunning }">
        {{ isRunning ? '\u25a0 停止' : '\u25b6 自动' }}
      </button>
      <button class="ac-btn ac-btn-disable" @click="$emit('disableAll')">
        全部手动
      </button>
    </div>
    <div class="ac-info" v-if="isRunning">
      AI 运行中... 已执行 {{ stepCount }} 步
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  isRunning: boolean
  currentSpeed: number
  speeds: { value: number; label: string }[]
  stepCount: number
  canAct: boolean
  allyAI: boolean
  enemyAI: boolean
  neutralAI: boolean
}>()

defineEmits<{
  (e: 'toggleAI', team: string): void
  (e: 'setSpeed', speed: number): void
  (e: 'singleStep'): void
  (e: 'toggleAuto'): void
  (e: 'disableAll'): void
}>()

const teamList = computed(() => [
  { team: 'ally', label: '友方', aiEnabled: props.allyAI },
  { team: 'enemy', label: '敌方', aiEnabled: props.enemyAI },
  { team: 'neutral', label: '中立', aiEnabled: props.neutralAI },
])
</script>

<style scoped>
.ac-panel {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.ac-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.ac-teams {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.ac-team-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
}

.ac-team-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.ac-team-ally { background: var(--color-info); }
.ac-team-enemy { background: var(--color-danger); }
.ac-team-neutral { background: var(--color-text-tertiary); }

.ac-team-name {
  flex: 1;
  color: var(--color-text-primary);
}

.ac-toggle {
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xs);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  white-space: nowrap;
}

.ac-toggle:hover {
  border-color: var(--color-text-secondary);
}

.ac-toggle.active {
  border-color: var(--color-primary-hover);
  color: var(--color-primary-hover);
  background: color-mix(in srgb, var(--color-primary-hover) 10%, transparent);
}

.ac-speed {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.ac-speed-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.ac-speed-btns {
  display: flex;
  gap: 3px;
}

.ac-speed-btn {
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-2xs);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.ac-speed-btn:hover {
  border-color: var(--color-text-secondary);
}

.ac-speed-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.ac-actions {
  display: flex;
  gap: 4px;
}

.ac-btn {
  flex: 1;
  padding: 4px 4px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xs);
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  text-align: center;
}

.ac-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.ac-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ac-btn-step {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.ac-btn-step:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.ac-btn-auto {
  border-color: var(--color-success);
  color: var(--color-success);
}

.ac-btn-auto:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
}

.ac-btn-auto.running {
  border-color: var(--color-danger);
  color: var(--color-danger);
}

.ac-btn-auto.running:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-danger) 15%, transparent);
}

.ac-btn-disable {
  border-color: var(--color-text-secondary);
  color: var(--color-text-secondary);
}

.ac-btn-disable:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-text-secondary) 15%, transparent);
}

.ac-info {
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-primary-hover);
  text-align: center;
}
</style>
