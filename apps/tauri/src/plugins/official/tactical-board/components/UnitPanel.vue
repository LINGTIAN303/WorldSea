<template>
  <div class="up-panel" v-if="unit">
    <div class="up-title">
      <span class="up-dot" :class="'up-team-' + unit.team"></span>
      {{ unit.name }}
    </div>
    <div class="up-section">
      <div class="up-row">
        <span class="up-label">阵营</span>
        <span :class="'up-team-text-' + unit.team">{{ teamLabel }}</span>
      </div>
      <div class="up-row">
        <span class="up-label">HP</span>
        <div class="up-bar-wrap">
          <div class="up-bar" :style="{ width: hpPct + '%' }" :class="hpClass"></div>
          <span class="up-bar-text">{{ unit.hp }}/{{ unit.max_hp }}</span>
        </div>
      </div>
      <div class="up-row" v-if="unit.max_mp > 0">
        <span class="up-label">MP</span>
        <div class="up-bar-wrap">
          <div class="up-bar up-bar-mp" :style="{ width: mpPct + '%' }"></div>
          <span class="up-bar-text">{{ unit.mp }}/{{ unit.max_mp }}</span>
        </div>
      </div>
    </div>
    <div class="up-section up-stats">
      <div class="up-stat"><span class="up-stat-val">{{ unit.attack }}</span><span class="up-stat-label">攻击</span></div>
      <div class="up-stat"><span class="up-stat-val">{{ unit.defense }}</span><span class="up-stat-label">防御</span></div>
      <div class="up-stat"><span class="up-stat-val">{{ unit.speed }}</span><span class="up-stat-label">速度</span></div>
      <div class="up-stat"><span class="up-stat-val">{{ unit.move_range }}</span><span class="up-stat-label">移动</span></div>
      <div class="up-stat"><span class="up-stat-val">{{ unit.attack_range }}</span><span class="up-stat-label">射程</span></div>
    </div>
    <div class="up-actions" v-if="showActions">
      <button class="up-btn up-btn-move" @click="$emit('move')" :disabled="disabled">移动</button>
      <button class="up-btn up-btn-attack" @click="$emit('attack')" :disabled="disabled">攻击</button>
      <button class="up-btn up-btn-wait" @click="$emit('wait')" :disabled="disabled">待机</button>
    </div>
    <div class="up-actions" v-if="showDeployActions">
      <button class="up-btn up-btn-remove" @click="$emit('remove')">移除</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { WasmBattleUnit } from '../composables/useTacticalEngine'

const props = defineProps<{
  unit: WasmBattleUnit | null
  showActions: boolean
  showDeployActions: boolean
  disabled: boolean
}>()

defineEmits<{
  (e: 'move'): void
  (e: 'attack'): void
  (e: 'wait'): void
  (e: 'remove'): void
}>()

const teamLabel = computed(() => {
  if (!props.unit) return ''
  return props.unit.team === 'ally' ? '友方' : props.unit.team === 'enemy' ? '敌方' : '中立'
})

const hpPct = computed(() => {
  if (!props.unit || props.unit.max_hp <= 0) return 0
  return Math.max(0, Math.min(100, (props.unit.hp / props.unit.max_hp) * 100))
})

const mpPct = computed(() => {
  if (!props.unit || props.unit.max_mp <= 0) return 0
  return Math.max(0, Math.min(100, (props.unit.mp / props.unit.max_mp) * 100))
})

const hpClass = computed(() => {
  if (hpPct.value > 60) return 'up-bar-hp-high'
  if (hpPct.value > 30) return 'up-bar-hp-mid'
  return 'up-bar-hp-low'
})
</script>

<style scoped>
.up-panel {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.up-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  margin-bottom: 8px;
}

.up-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.up-team-ally { background: var(--color-primary); }
.up-team-enemy { background: var(--color-danger); }
.up-team-neutral { background: var(--color-text-secondary); }

.up-team-text-ally { color: var(--color-primary); }
.up-team-text-enemy { color: var(--color-danger); }
.up-team-text-neutral { color: var(--color-text-secondary); }

.up-section {
  margin-bottom: 8px;
}

.up-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  font-size: var(--font-size-sm);
}

.up-label {
  color: var(--color-text-secondary);
  min-width: 28px;
}

.up-bar-wrap {
  flex: 1;
  height: 14px;
  background: color-mix(in srgb, var(--color-text-primary) 5%, transparent);
  border-radius: 3px;
  position: relative;
  overflow: hidden;
}

.up-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.up-bar-hp-high { background: var(--color-success); }
.up-bar-hp-mid { background: var(--color-warning); }
.up-bar-hp-low { background: var(--color-danger); }
.up-bar-mp { background: var(--color-primary); }

.up-bar-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--font-size-xs);
  color: #fff;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
}

.up-stats {
  display: flex;
  gap: 4px;
}

.up-stat {
  flex: 1;
  text-align: center;
  background: color-mix(in srgb, var(--color-text-primary) 3%, transparent);
  border-radius: 4px;
  padding: 4px 2px;
}

.up-stat-val {
  display: block;
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
}

.up-stat-label {
  display: block;
  font-size: var(--text-micro-font-size);
  color: var(--color-text-secondary);
  margin-top: 1px;
}

.up-actions {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}

.up-btn {
  flex: 1;
  padding: 5px 4px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  text-align: center;
}

.up-btn:hover:not(:disabled) {
  background: var(--color-bg-hover);
}

.up-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.up-btn-move { border-color: var(--color-primary); color: var(--color-primary); }
.up-btn-move:hover:not(:disabled) { background: color-mix(in srgb, var(--color-primary) 15%, transparent); }
.up-btn-attack { border-color: var(--color-danger); color: var(--color-danger); }
.up-btn-attack:hover:not(:disabled) { background: color-mix(in srgb, var(--color-danger) 15%, transparent); }
.up-btn-wait { border-color: var(--color-text-secondary); color: var(--color-text-secondary); }
.up-btn-wait:hover:not(:disabled) { background: color-mix(in srgb, var(--color-text-secondary) 15%, transparent); }
.up-btn-remove { border-color: var(--color-danger); color: var(--color-danger); }
.up-btn-remove:hover:not(:disabled) { background: color-mix(in srgb, var(--color-danger) 15%, transparent); }
</style>
