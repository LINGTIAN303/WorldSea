<template>
  <div class="setup-row">
    <div class="setup-field flex-1">
      <label class="field-label">最大轮次</label>
      <input :value="maxRounds" @input="onMaxRounds" type="number" class="field-input" min="1" max="50" />
    </div>
    <div class="setup-field flex-1">
      <label class="field-label">费用上限 (USD)</label>
      <input :value="maxCostUsd" @input="onMaxCostUsd" type="number" class="field-input" min="0.1" step="0.1" />
    </div>
  </div>
  <div class="setup-row">
    <div class="setup-field flex-1">
      <label class="field-label">并行发言数 <span class="field-hint">(1-3)</span></label>
      <div class="slider-row">
        <input :value="parallelCount" @input="onParallelCount" type="range" min="1" max="3" step="1" class="slider-input" />
        <span class="slider-value">{{ parallelCount }}</span>
      </div>
    </div>
    <div class="setup-field flex-1">
      <label class="field-label">自动降级</label>
      <div class="toggle-row" @click="emit('update:autoDegradation', !autoDegradation)">
        <div class="toggle-track" :class="{ active: autoDegradation }">
          <div class="toggle-thumb"></div>
        </div>
        <span class="toggle-label">{{ autoDegradation ? '开启' : '关闭' }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  maxRounds: number
  maxCostUsd: number
  parallelCount: number
  autoDegradation: boolean
}>()

const emit = defineEmits<{
  'update:maxRounds': [value: number]
  'update:maxCostUsd': [value: number]
  'update:parallelCount': [value: number]
  'update:autoDegradation': [value: boolean]
}>()

// 使用原生 input + 手动 emit 替代 v-model.number，避免直接修改 props
function onMaxRounds(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isNaN(v)) emit('update:maxRounds', v)
}

function onMaxCostUsd(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isNaN(v)) emit('update:maxCostUsd', v)
}

function onParallelCount(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isNaN(v)) emit('update:parallelCount', v)
}
</script>

<style scoped>
.setup-field {
}

.setup-field.flex-1 {
  flex: 1;
}

.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  color: var(--color-text-secondary);
}

.field-hint {
  color: var(--color-text-tertiary);
  font-weight: 400;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  font-size: var(--font-size-sm);
  font-family: inherit;
  background: var(--color-surface-elevated);
  color: var(--color-text);
  outline: none;
  resize: vertical;
}

.field-input:focus {
  border-color: var(--color-primary);
}

.setup-row {
  display: flex;
  gap: 16px;
}

.setup-row + .setup-row {
  margin-top: 16px;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slider-input {
  flex: 1;
  accent-color: var(--color-primary);
  height: 4px;
}

.slider-value {
  font-size: var(--font-size-sm);
  font-weight: 700;
  color: var(--color-primary);
  min-width: 16px;
  text-align: center;
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 0;
}

.toggle-track {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--color-border);
  position: relative;
  transition: background 0.2s;
}

.toggle-track.active {
  background: var(--color-primary);
}

.toggle-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: left 0.2s;
}

.toggle-track.active .toggle-thumb {
  left: 18px;
}

.toggle-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}
</style>
