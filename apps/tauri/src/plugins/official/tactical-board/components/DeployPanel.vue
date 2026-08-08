<template>
  <div class="dp-panel">
    <div class="dp-title">部署单位</div>
    <div class="dp-team-select">
      <button v-for="t in teams" :key="t.value" class="dp-team-btn"
        :class="{ active: selectedTeam === t.value, ['dp-team-' + t.value]: true }"
        @click="selectedTeam = t.value">
        {{ t.label }}
      </button>
    </div>
    <div class="dp-stats">
      <div class="dp-stat-row">
        <label>HP</label>
        <input type="number" v-model.number="stats.hp" min="1" max="9999" />
      </div>
      <div class="dp-stat-row">
        <label>攻击</label>
        <input type="number" v-model.number="stats.attack" min="0" max="999" />
      </div>
      <div class="dp-stat-row">
        <label>防御</label>
        <input type="number" v-model.number="stats.defense" min="0" max="999" />
      </div>
      <div class="dp-stat-row">
        <label>速度</label>
        <input type="number" v-model.number="stats.speed" min="1" max="99" />
      </div>
      <div class="dp-stat-row">
        <label>移动</label>
        <input type="number" v-model.number="stats.moveRange" min="1" max="20" />
      </div>
      <div class="dp-stat-row">
        <label>射程</label>
        <input type="number" v-model.number="stats.attackRange" min="1" max="20" />
      </div>
    </div>
    <div class="dp-entity-list">
      <div class="dp-entity-header">可用实体</div>
      <div v-for="e in availableEntities" :key="e.id" class="dp-entity-item"
        :class="{ 'dp-placed': placedIds.has(e.id) }"
        @click="onSelectEntity(e)">
        <span class="dp-entity-name">{{ e.name }}</span>
        <span class="dp-entity-type">{{ e.type }}</span>
        <span v-if="placedIds.has(e.id)" class="dp-placed-badge">已部署</span>
      </div>
      <WsEmpty v-if="availableEntities.length === 0" preset="no-data" title="暂无可用实体" />
    </div>
    <div class="dp-actions">
      <button class="dp-btn dp-btn-quick" @click="$emit('quickDeploy', selectedTeam, stats)">
        <WsIcon name="zap" size="xs" /> 快速部署
      </button>
    </div>
    <div class="dp-save">
      <button class="dp-btn dp-btn-save" @click="$emit('save')">
        <WsIcon name="arrow-down" size="xs" /> 保存棋盘
      </button>
      <button class="dp-btn dp-btn-load" @click="$emit('load')">
        <WsIcon name="arrow-up" size="xs" /> 加载棋盘
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { WsEmpty } from '@worldsmith/ui-kit'
import { WsIcon } from '@worldsmith/ui-kit'
import type { Entity } from '@worldsmith/entity-core'

const props = defineProps<{
  entities: Entity[]
  placedIds: Set<string>
}>()

const emit = defineEmits<{
  (e: 'selectEntity', entity: Entity, team: string, stats: DeployStats): void
  (e: 'quickDeploy', team: string, stats: DeployStats): void
  (e: 'save'): void
  (e: 'load'): void
}>()

export interface DeployStats {
  hp: number
  attack: number
  defense: number
  speed: number
  moveRange: number
  attackRange: number
}

const selectedTeam = ref('ally')
const stats = ref<DeployStats>({
  hp: 100,
  attack: 10,
  defense: 5,
  speed: 5,
  moveRange: 3,
  attackRange: 1,
})

const teams = [
  { value: 'ally', label: '友方' },
  { value: 'enemy', label: '敌方' },
  { value: 'neutral', label: '中立' },
]

const availableEntities = computed(() => {
  return (props.entities || []).filter(e => e.type !== 'tactical-board')
})

function onSelectEntity(entity: Entity) {
  emit('selectEntity', entity, selectedTeam.value, { ...stats.value })
}
</script>

<style scoped>
.dp-panel {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border);
}

.dp-title {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.dp-team-select {
  display: flex;
  gap: 3px;
  margin-bottom: 8px;
}

.dp-team-btn {
  flex: 1;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
}

.dp-team-btn:hover { border-color: var(--color-text-secondary); }

.dp-team-btn.active.dp-team-ally { border-color: var(--color-primary); color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
.dp-team-btn.active.dp-team-enemy { border-color: var(--color-danger); color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 8%, transparent); }
.dp-team-btn.active.dp-team-neutral { border-color: var(--color-text-secondary); color: var(--color-text-secondary); background: color-mix(in srgb, var(--color-text-secondary) 8%, transparent); }

.dp-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
  margin-bottom: 8px;
}

.dp-stat-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
}

.dp-stat-row label {
  color: var(--color-text-secondary);
  min-width: 28px;
}

.dp-stat-row input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--color-border);
  border-radius: 3px;
  background: var(--color-bg-base);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  outline: none;
}

.dp-stat-row input:focus {
  border-color: var(--color-primary);
}

.dp-entity-header {
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}

.dp-entity-list {
  max-height: 140px;
  overflow-y: auto;
  margin-bottom: 8px;
}

.dp-entity-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: var(--font-size-xs);
  transition: background 0.1s;
}

.dp-entity-item:hover {
  background: var(--color-bg-elevated);
}

.dp-entity-item.dp-placed {
  opacity: 0.5;
}

.dp-entity-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
}

.dp-entity-type {
  font-size: var(--text-micro-font-size);
  color: var(--color-text-tertiary);
}

.dp-placed-badge {
  font-size: var(--text-micro-font-size);
  color: var(--color-success);
  white-space: nowrap;
}

.dp-actions {
  margin-bottom: 6px;
}

.dp-save {
  display: flex;
  gap: 4px;
}

.dp-btn {
  width: 100%;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-xs);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  text-align: center;
}

.dp-btn:hover {
  background: var(--color-bg-hover);
}

.dp-btn-quick {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.dp-btn-quick:hover {
  background: color-mix(in srgb, var(--color-primary) 15%, transparent);
}

.dp-btn-save {
  border-color: var(--color-success);
  color: var(--color-success);
}

.dp-btn-save:hover {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
}

.dp-btn-load {
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.dp-btn-load:hover {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}
</style>
