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
  border-bottom: 1px solid #21262d;
}

.ac-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: #8b949e;
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

.ac-team-ally { background: #4a9eff; }
.ac-team-enemy { background: #ff4a4a; }
.ac-team-neutral { background: #9a9a9a; }

.ac-team-name {
  flex: 1;
  color: #c9d1d9;
}

.ac-toggle {
  padding: 2px 6px;
  border: 1px solid #30363d;
  border-radius: 3px;
  background: transparent;
  color: #8b949e;
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
  background: rgba(210, 168, 255, 0.1);
}

.ac-speed {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.ac-speed-label {
  font-size: var(--font-size-xs);
  color: #8b949e;
}

.ac-speed-btns {
  display: flex;
  gap: 3px;
}

.ac-speed-btn {
  padding: 2px 6px;
  border: 1px solid #21262d;
  border-radius: 3px;
  background: transparent;
  color: #8b949e;
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.ac-speed-btn:hover {
  border-color: #8b949e;
}

.ac-speed-btn.active {
  border-color: #58a6ff;
  color: #58a6ff;
  background: rgba(88, 166, 255, 0.1);
}

.ac-actions {
  display: flex;
  gap: 4px;
}

.ac-btn {
  flex: 1;
  padding: 4px 4px;
  border: 1px solid #21262d;
  border-radius: 4px;
  background: #21262d;
  color: #c9d1d9;
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
  border-color: #58a6ff;
  color: #58a6ff;
}

.ac-btn-step:hover:not(:disabled) {
  background: rgba(88, 166, 255, 0.15);
}

.ac-btn-auto {
  border-color: #3fb950;
  color: #3fb950;
}

.ac-btn-auto:hover:not(:disabled) {
  background: rgba(63, 185, 80, 0.15);
}

.ac-btn-auto.running {
  border-color: #f85149;
  color: #f85149;
}

.ac-btn-auto.running:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.15);
}

.ac-btn-disable {
  border-color: #8b949e;
  color: #8b949e;
}

.ac-btn-disable:hover:not(:disabled) {
  background: rgba(139, 148, 158, 0.15);
}

.ac-info {
  margin-top: 6px;
  font-size: var(--font-size-xs);
  color: var(--color-primary-hover);
  text-align: center;
}
</style>
