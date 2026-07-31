<template>
  <div class="tb-toolbar">
    <div class="tb-toolbar-group">
      <span class="tb-toolbar-label">网格</span>
      <CustomDropdown v-model="gridTypeModel" :options="gridTypeOptions" @update:modelValue="$emit('rebuildBoard')" />
    </div>
    <div class="tb-toolbar-group">
      <span class="tb-toolbar-label">规格</span>
      <CustomDropdown v-model="gridSizeModel" :options="gridSizeOptions" @update:modelValue="$emit('rebuildBoard')" />
    </div>
    <div class="tb-toolbar-sep"></div>
    <template v-if="battlePhase === 'deployment'">
      <div class="tb-toolbar-group">
        <span class="tb-toolbar-label">地形笔</span>
        <CustomDropdown v-model="terrainBrushModel" :options="terrainOptions" />
      </div>
      <div class="tb-toolbar-group">
        <span class="tb-toolbar-label">阵营</span>
        <CustomDropdown v-model="deployTeamModel" :options="teamOptions" />
      </div>
      <div class="tb-toolbar-sep"></div>
      <button class="tb-btn tb-btn-start" @click="$emit('startBattle')" :disabled="unitsCount === 0">
        <WsIcon name="sword" size="xs" /> 开始战斗
      </button>
    </template>
    <template v-else-if="battlePhase === 'battle'">
      <span class="tb-current-info" v-if="currentUnit">
        <span class="tb-current-dot" :class="'tb-team-bg-' + currentUnit.team"></span>
        {{ currentUnit.name }} 的回合
        <span v-if="aiUnitActive" class="tb-ai-badge">AI</span>
      </span>
      <span class="tb-action-hint" v-if="actionState">
        {{ actionHint }}
      </span>
      <button class="tb-btn" @click="$emit('cancelAction')" v-if="actionState">取消</button>
      <button class="tb-btn tb-btn-end" @click="$emit('endTurn')">结束回合</button>
    </template>
    <template v-else>
      <span class="tb-victory-text"><WsIcon name="star" size="xs" /> {{ victoryLabel }} 获胜！</span>
      <button class="tb-btn" @click="$emit('resetBattle')">重新部署</button>
    </template>
    <div class="tb-toolbar-spacer"></div>
    <button class="tb-btn" :class="{ active: awarenessMode === 'influence' }"
      @click="$emit('toggleAwareness', 'influence')" title="势力范围">
      <WsIcon name="target" size="xs" /> 势力
    </button>
    <button class="tb-btn" :class="{ active: awarenessMode === 'threat' }"
      @click="$emit('toggleAwareness', 'threat')" title="威胁区域">
      <WsIcon name="warning" size="xs" /> 威胁
    </button>
    <button class="tb-btn" :class="{ active: awarenessMode === 'supply' }"
      @click="$emit('toggleAwareness', 'supply')" title="补给线">
      <WsIcon name="arrow-left-right" size="xs" /> 补给
    </button>
    <span class="tb-phase" :class="'tb-phase-' + battlePhase">{{ phaseLabel }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import WsIcon from '../../../../ui/WsIcon.vue'
import { CustomDropdown } from '@worldsmith/plugin-sdk'
import type { AwarenessMode } from '../composables/useAwareness'
import type { WasmBattleUnit } from '../composables/useTacticalEngine'
import type { BattlePhase, ActionState } from '../composables/useBattleManager'

// 选项类型：下拉菜单项
interface DropdownOption {
  value: string
  label: string
}

const props = defineProps<{
  // 双向绑定（通过 v-model + computed 中转）
  gridType: string
  gridSize: string
  terrainBrush: string
  deployTeam: string
  // 只读状态
  battlePhase: BattlePhase
  currentUnit: WasmBattleUnit | null
  aiUnitActive: boolean
  actionState: ActionState | null
  actionHint: string
  victoryLabel: string
  phaseLabel: string
  awarenessMode: AwarenessMode
  unitsCount: number
  // 静态选项
  gridTypeOptions: DropdownOption[]
  gridSizeOptions: DropdownOption[]
  terrainOptions: DropdownOption[]
  teamOptions: DropdownOption[]
}>()

const emit = defineEmits<{
  (e: 'update:gridType', value: string): void
  (e: 'update:gridSize', value: string): void
  (e: 'update:terrainBrush', value: string): void
  (e: 'update:deployTeam', value: string): void
  (e: 'rebuildBoard'): void
  (e: 'startBattle'): void
  (e: 'cancelAction'): void
  (e: 'endTurn'): void
  (e: 'resetBattle'): void
  (e: 'toggleAwareness', mode: AwarenessMode): void
}>()

// v-model 中转：父组件通过 v-model:gridType 等绑定
const gridTypeModel = computed({
  get: () => props.gridType,
  set: (v: string) => emit('update:gridType', v),
})
const gridSizeModel = computed({
  get: () => props.gridSize,
  set: (v: string) => emit('update:gridSize', v),
})
const terrainBrushModel = computed({
  get: () => props.terrainBrush,
  set: (v: string) => emit('update:terrainBrush', v),
})
const deployTeamModel = computed({
  get: () => props.deployTeam,
  set: (v: string) => emit('update:deployTeam', v),
})
</script>

<style scoped>
.tb-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 16px;
  background: var(--color-bg-surface);
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tb-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tb-toolbar-label {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  white-space: nowrap;
}

.tb-toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--color-border);
  margin: 0 4px;
}

.tb-toolbar-spacer {
  flex: 1;
}

.tb-phase {
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
}

.tb-phase-deployment {
  color: var(--color-text-secondary);
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
}

.tb-phase-battle {
  color: var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 10%, transparent);
}

.tb-phase-victory {
  color: var(--color-success);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s, transform 0.15s, opacity 0.15s, filter 0.15s;
  white-space: nowrap;
}

.tb-btn:hover:not(:disabled) { background: var(--color-bg-hover); border-color: var(--color-text-secondary); }
.tb-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.tb-btn.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, transparent);
}

.tb-btn-start {
  border-color: var(--color-success);
  color: var(--color-success);
}

.tb-btn-start:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-success) 15%, transparent);
}

.tb-btn-end {
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.tb-btn-end:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-warning) 15%, transparent);
}

.tb-current-info {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
}

.tb-current-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.tb-team-bg-ally { background: var(--color-primary); }
.tb-team-bg-enemy { background: var(--color-danger); }
.tb-team-bg-neutral { background: var(--color-text-secondary); }

.tb-action-hint {
  font-size: var(--font-size-xs);
  color: var(--color-warning);
}

.tb-ai-badge {
  font-size: var(--text-micro-font-size);
  font-weight: var(--font-weight-bold);
  color: var(--color-primary-hover);
  background: color-mix(in srgb, var(--color-primary-hover) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary-hover) 30%, transparent);
  border-radius: 3px;
  padding: 0 4px;
  margin-left: 2px;
  vertical-align: middle;
}

.tb-victory-text {
  font-size: var(--font-size-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-success);
}
</style>
