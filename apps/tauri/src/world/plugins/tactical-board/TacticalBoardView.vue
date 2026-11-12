<template>
  <div class="tb-view">
    <Toolbar
      v-model:gridType="gridType"
      v-model:gridSize="gridSize"
      v-model:terrainBrush="terrainBrush"
      v-model:deployTeam="deployTeam"
      :gridTypeOptions="gridTypeOptions"
      :gridSizeOptions="gridSizeOptions"
      :terrainOptions="terrainOptions"
      :teamOptions="teamOptions"
      :battlePhase="battlePhase"
      :currentUnit="currentUnit"
      :aiUnitActive="aiUnitActive"
      :actionState="actionState"
      :actionHint="actionHint"
      :victoryLabel="victoryLabel"
      :phaseLabel="phaseLabel"
      :awarenessMode="awareness.mode.value"
      :unitsCount="units.length"
      @rebuildBoard="rebuildBoard"
      @startBattle="onStartBattle"
      @cancelAction="cancelAction"
      @endTurn="endTurn"
      @resetBattle="resetBattle"
      @toggleAwareness="onToggleAwareness"
    />

    <div class="tb-main">
      <div class="tb-canvas-area">
        <BoardCanvas
          v-if="engineReady"
          :gridType="gridType as 'square' | 'hex'"
          :gridWidth="Number(gridSize)"
          :gridHeight="Number(gridSize)"
          :terrain="terrain"
          :units="units"
          :highlights="activeHighlights"
          :selectedCell="selectedCell"
          :awarenessCells="awareness.cells.value"
          :awarenessMode="awareness.mode.value"
          :animationProvider="animProvider"
          @cellClick="onCellClick"
          @cellRightClick="onCellRightClick"
          @cellHover="onCellHover"
        />
        <WsLoadingOverlay
          :show="engineLoading && !engineNoticeDismissed"
          scope="panel"
          title="正在准备战术棋盘"
          success-title="棋盘已就绪"
          error-title="棋盘初始化失败"
          :stages="ENGINE_LOAD_STAGES"
          :current="engineStage"
          :status="engineStatus"
          :error="engineError ?? engineTaskError ?? ''"
          error-text="无法创建战术引擎"
          @retry="rebuildBoard"
          @close="engineNoticeDismissed = true"
        />
        <div v-if="engineNoticeDismissed && !engineReady" class="tb-loading">
          <WsIcon name="warning" size="sm" />
          <span>{{ engineError || '棋盘未初始化' }}</span>
          <button class="tb-btn tb-btn-sm" @click="rebuildBoard">重试</button>
        </div>
      </div>

      <!-- 单位详情：装哪种容器由载体注册表决定（dock 内解析），分栏时它就站在画布右边 -->
      <UnitDetailDock :unit="selectedUnitDetail" :disabled="!!actionState" detail-carrier="column"
        :showActions="battlePhase === 'battle' && isCurrentUnitSelected && !aiUnitActive"
        :showDeployActions="battlePhase === 'deployment' && !!selectedUnitDetail"
        @close="selectedCell = null" @move="beginMoveAction" @attack="beginAttackAction"
        @wait="waitAction" @remove="removeSelectedUnit" />

      <div class="tb-sidebar">
        <div class="tb-panel" v-if="hoveredInfo">
          <div class="tb-panel-title">格子信息</div>
          <div class="tb-panel-row"><span class="tb-label">坐标</span><span>{{ hoveredInfo.coord }}</span></div>
          <div class="tb-panel-row"><span class="tb-label">地形</span><span>{{ hoveredInfo.terrainLabel }}</span></div>
          <div class="tb-panel-row" v-if="hoveredInfo.unit"><span class="tb-label">单位</span><span>{{ hoveredInfo.unit.name }}</span></div>
          <div class="tb-panel-row" v-if="hoveredInfo.unit"><span class="tb-label">HP</span><span>{{ hoveredInfo.unit.hp }}/{{ hoveredInfo.unit.max_hp }}</span></div>
        </div>

        <DeployPanel v-if="battlePhase === 'deployment'"
          :entities="[...es.list()]"
          :placedIds="placedEntityIds"
          @selectEntity="onDeployEntity"
          @quickDeploy="onQuickDeploy"
          @save="onSaveBoard"
          @load="onLoadBoard"
        />

        <div class="tb-panel" v-if="battlePhase !== 'deployment' && combatStatsSummary">
          <div class="tb-panel-title">战斗统计</div>
          <div class="tb-panel-row"><span class="tb-label">攻击次数</span><span>{{ combatStatsSummary.totalAttacks }}</span></div>
          <div class="tb-panel-row"><span class="tb-label">总伤害</span><span>{{ combatStatsSummary.totalDamage }}</span></div>
          <div class="tb-panel-row"><span class="tb-label">暴击次数</span><span>{{ combatStatsSummary.totalCriticals }}</span></div>
          <button class="tb-btn tb-btn-sm" @click="onSaveBoard" style="margin-top:6px;width:100%">保存棋盘</button>
        </div>

        <AIControl v-if="battlePhase === 'battle'"
          :isRunning="ai.aiRunning.value"
          :currentSpeed="ai.aiSpeed.value"
          :speeds="ai.AI_SPEEDS"
          :stepCount="ai.aiStepCount.value"
          :canAct="battlePhase === 'battle'"
          :allyAI="ai.isAIControlled('ally')"
          :enemyAI="ai.isAIControlled('enemy')"
          :neutralAI="ai.isAIControlled('neutral')"
          @toggleAI="ai.toggleAI"
          @setSpeed="ai.setAISpeed"
          @singleStep="ai.runAISingleStep"
          @toggleAuto="onToggleAutoAI"
          @disableAll="ai.disableAllAI"
        />

        <AwarenessPanel
          :currentMode="awareness.mode.value"
          :modes="awareness.awarenessModes"
          @toggleMode="onToggleAwareness"
          @refresh="awareness.refresh"
        />

        <div class="tb-panel">
          <div class="tb-panel-title">单位列表 ({{ units.length }})</div>
          <div class="tb-unit-list">
            <div v-for="u in units" :key="u.id" class="tb-unit-item"
              :class="['tb-team-border-' + u.team, { 'tb-current': battlePhase === 'battle' && currentUnit && u.x === currentUnit.x && u.y === currentUnit.y, 'tb-acted': u.acted }]"
              @click="selectUnitAt(u.x, u.y)">
              <span class="tb-unit-dot" :class="'tb-team-bg-' + u.team"></span>
              <span class="tb-unit-name">{{ u.name }}</span>
              <span class="tb-unit-hp">{{ u.hp }}/{{ u.max_hp }}</span>
            </div>
            <WsEmpty v-if="units.length === 0" preset="no-data" description="暂无单位，点击棋盘放置" />
          </div>
        </div>

        <div class="tb-log-panel">
          <BattleLog :log="battleLog" />
        </div>
      </div>
    </div>

    <TacticalStatusBar
      :turn="currentTurn"
      :unitCount="units.length"
      :gridLabel="`${gridType === 'hex' ? '六边形' : '方形'} ${gridSize}×${gridSize}`"
      :hint="statusHint"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { entitiesSvc } from './serviceAccess'
import { WsEmpty, WsIcon, WsLoadingOverlay, useAsyncTask, type LoadingStage, type LoadingStatus } from '@worldsea/ui-kit'
import BoardCanvas from './components/BoardCanvas.vue'
import UnitDetailDock from './components/UnitDetailDock.vue'
import BattleLog from './components/BattleLog.vue'
import AIControl from './components/AIControl.vue'
import AwarenessPanel from './components/AwarenessPanel.vue'
import DeployPanel from './components/DeployPanel.vue'
import TacticalStatusBar from './components/TacticalStatusBar.vue'
import Toolbar from './components/Toolbar.vue'
import { useTacticalEngine, type WasmBattleUnit } from './composables/useTacticalEngine'
import { useBattleManager } from './composables/useBattleManager'
import { useAIController } from './composables/useAIController'
import { useAwareness, type AwarenessMode } from './composables/useAwareness'
import { useBoardPersistence } from './composables/useBoardPersistence'
import type { UnitRenderData, HighlightCell } from './composables/boardDraw'
import { useBoardAnimation } from './composables/useBoardAnimation'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'

const es = entitiesSvc()
const { engine, loading, error: engineError, createEngine } = useTacticalEngine()

const ENGINE_LOAD_STAGES: LoadingStage[] = [
  { short: '引擎', full: '载入战术引擎' },
  { short: '棋盘', full: '布置棋盘与地形' },
]
const { visible: engineLoading, status: engineLoadStatus, error: engineTaskError, run: runEngineLoad } = useAsyncTask({ successHold: 0 })
const engineStage = ref(0)
const engineNoticeDismissed = ref(false)
const engineStatus = computed<LoadingStatus>(() => {
  if (engineLoadStatus.value === 'error') return 'error'
  if (engineLoadStatus.value === 'success' || engineLoadStatus.value === 'empty') return 'success'
  return 'loading'
})

const gridType = ref('square')
const gridTypeOptions = [
  { value: 'square', label: '方形网格' },
  { value: 'hex', label: '六边形网格' },
]

const gridSize = ref('12')
const gridSizeOptions = Array.from({ length: 26 }, (_, i) => {
  const s = i + 5
  return { value: String(s), label: `${s}×${s}` }
})

const terrainBrush = ref('none')
const terrainOptions = [
  { value: 'none', label: '无（选择模式）' },
  { value: 'plain', label: '平原' },
  { value: 'forest', label: '森林' },
  { value: 'mountain', label: '山地' },
  { value: 'water', label: '水域' },
  { value: 'desert', label: '沙漠' },
  { value: 'wall', label: '城墙' },
]

const deployTeam = ref('ally')
const teamOptions = [
  { value: 'ally', label: '友方 (蓝)' },
  { value: 'enemy', label: '敌方 (红)' },
  { value: 'neutral', label: '中立 (灰)' },
]

const terrain = ref<string[][]>([])
const units = ref<UnitRenderData[]>([])
const selectedCell = ref<{ x: number; y: number } | null>(null)
const hoveredCell = ref<{ x: number; y: number } | null>(null)

const engineReady = computed(() => !!engine.value && !loading.value)

const anim = useBoardAnimation()

// Expose animation provider for BoardCanvas
const animProvider = computed(() => ({
  tick: anim.tick,
  getOverride: anim.getOverride,
  floatingNumbers: anim.floatingNumbers,
}))

function refreshUnits() {
  if (!engine.value) return
  try {
    const raw = engine.value.get_all_units() as WasmBattleUnit[]
    units.value = (raw || []).map(u => ({
      id: u.id, name: u.name, team: u.team,
      hp: u.hp, max_hp: u.max_hp, acted: u.acted,
      x: u.x, y: u.y,
    }))
  } catch (e) {
    console.warn('[TacticalBoard] get_all_units failed', e)
  }
  awareness.refresh()
}

const battle = useBattleManager(engine, units, refreshUnits, anim)

const ai = useAIController(
  engine,
  computed(() => battle.phase.value),
  computed(() => battle.currentUnit.value),
  battle.addLog,
  refreshUnits,
  battle.beginMoveAction,
  battle.beginAttackAction,
  battle.executeAction,
  battle.waitAction,
)

const awareness = useAwareness(engine)

const persistence = useBoardPersistence(
  engine,
  gridType,
  gridSize,
  terrain,
  computed(() => battle.phase.value),
  computed(() => battle.currentTurn.value),
)

const battlePhase = computed(() => battle.phase.value)
const currentTurn = computed(() => battle.currentTurn.value)
const currentUnit = computed(() => battle.currentUnit.value)
const actionState = computed(() => battle.actionState.value)
const battleLog = computed(() => battle.battleLog.value)

// Stats are now tracked via engine events in useBattleManager, no regex parsing needed

const TERRAIN_LABELS: Record<string, string> = {
  plain: '平原', forest: '森林', mountain: '山地',
  water: '水域', desert: '沙漠', wall: '城墙',
}

const phaseLabel = computed(() => {
  if (battlePhase.value === 'deployment') return '部署阶段'
  if (battlePhase.value === 'victory') return '战斗结束'
  return '战斗阶段'
})

const victoryLabel = computed(() => {
  const t = battle.victoryTeam.value
  return t === 'ally' ? '友方' : t === 'enemy' ? '敌方' : '中立'
})

const actionHint = computed(() => {
  if (!actionState.value) return ''
  if (actionState.value.type === 'move') return '点击蓝色区域移动'
  if (actionState.value.type === 'attack') return '点击红色区域攻击'
  if (actionState.value.type === 'skill') return '选择技能目标'
  return ''
})

const statusHint = computed(() => {
  if (battlePhase.value === 'deployment') return '左键放置 | 右键移除 | 拖拽平移 | 滚轮缩放'
  if (battlePhase.value === 'victory') return '战斗已结束'
  return '选择行动 | 拖拽平移 | 滚轮缩放'
})

const isCurrentUnitSelected = computed(() => {
  if (!currentUnit.value || !selectedCell.value) return false
  return currentUnit.value.x === selectedCell.value.x && currentUnit.value.y === selectedCell.value.y
})

const aiUnitActive = computed(() => {
  if (!currentUnit.value) return false
  return ai.isAIControlled(currentUnit.value.team)
})

const placedEntityIds = computed(() => new Set(units.value.map(u => u.id)))

const combatStatsSummary = computed(() => persistence.combatStats.value)

const selectedUnitDetail = computed<WasmBattleUnit | null>(() => {
  if (!selectedCell.value || !engine.value) return null
  try {
    return engine.value.get_unit_at(selectedCell.value.x, selectedCell.value.y) as WasmBattleUnit | null
  } catch { return null }
})

const hoveredInfo = computed(() => {
  if (!hoveredCell.value) return null
  const { x, y } = hoveredCell.value
  const size = Number(gridSize.value)
  if (x < 0 || x >= size || y < 0 || y >= size) return null
  const t = terrain.value[y]?.[x] || 'plain'
  const unit = units.value.find(u => u.x === x && u.y === y)
  return {
    coord: `${String.fromCharCode(65 + x)}${y + 1}`,
    terrainLabel: TERRAIN_LABELS[t] || t,
    unit: unit || null,
  }
})

const activeHighlights = computed<HighlightCell[]>(() => {
  if (battlePhase.value === 'battle' && actionState.value) {
    return battle.currentHighlights.value
  }
  return []
})

function initTerrain(w: number, h: number) {
  terrain.value = Array.from({ length: h }, () => Array(w).fill('plain'))
}

async function rebuildBoard() {
  const size = Number(gridSize.value)
  initTerrain(size, size)
  units.value = []
  selectedCell.value = null
  battle.resetBattle()
  engineNoticeDismissed.value = false

  try {
    await runEngineLoad(async () => {
      engineStage.value = 0
      await createEngine(gridType.value, size, size)
      engineStage.value = 1
      syncTerrainToEngine()
      if (!engine.value) throw new Error(engineError.value || '引擎创建失败')
    })
  } catch (e) {
    console.error('[TacticalBoard] rebuild failed', e)
  }
}

function syncTerrainToEngine() {
  if (!engine.value) return
  for (let r = 0; r < terrain.value.length; r++) {
    for (let c = 0; c < terrain.value[r].length; c++) {
      try { engine.value.set_terrain(c, r, terrain.value[r][c]) } catch {}
    }
  }
}

function onCellClick(x: number, y: number, _evt: MouseEvent) {
  if (battlePhase.value === 'deployment') {
    if (terrainBrush.value !== 'none') {
      paintTerrain(x, y)
      return
    }
    selectedCell.value = { x, y }
    const hasUnit = units.value.some(u => u.x === x && u.y === y)
    if (!hasUnit) deployUnit(x, y)
    return
  }

  if (battlePhase.value === 'battle') {
    if (actionState.value) {
      const executed = battle.executeAction(x, y)
      if (!executed) {
        battle.cancelAction()
      }
      return
    }
    selectedCell.value = { x, y }
    return
  }
}

function onCellRightClick(x: number, y: number) {
  if (battlePhase.value === 'deployment') {
    const hasUnit = units.value.some(u => u.x === x && u.y === y)
    if (hasUnit && engine.value) {
      try { engine.value.remove_unit(x, y); refreshUnits() } catch {}
    } else if (terrainBrush.value !== 'none') {
      terrain.value[y][x] = 'plain'
      try { engine.value?.set_terrain(x, y, 'plain') } catch {}
    }
    if (selectedCell.value?.x === x && selectedCell.value?.y === y) selectedCell.value = null
    return
  }

  if (battlePhase.value === 'battle' && actionState.value) {
    battle.cancelAction()
  }
}

function onCellHover(x: number | null, y: number | null) {
  hoveredCell.value = (x !== null && y !== null) ? { x, y } : null
}

function paintTerrain(x: number, y: number) {
  const brush = terrainBrush.value
  if (brush === 'none') return
  if (y >= terrain.value.length || x >= terrain.value[0].length) return
  terrain.value[y][x] = brush
  try { engine.value?.set_terrain(x, y, brush) } catch {}
}

function deployUnit(x: number, y: number) {
  if (!engine.value) return
  const allEntities = es.list() ?? []
  if (allEntities.length === 0) return
  const placed = new Set(units.value.map(u => u.id))
  const available = allEntities.filter(e => !placed.has(e.id))
  if (available.length === 0) return
  const entity = available[0]
  const team = deployTeam.value
  try {
    engine.value.place_unit(entity.id, entity.name, team, x, y, 100, 100, 50, 50, 10, 5, 5, 3, 1)
    refreshUnits()
    selectedCell.value = { x, y }
  } catch (e) {
    console.warn('[TacticalBoard] place_unit failed', e)
  }
}

function removeSelectedUnit() {
  if (!selectedCell.value || !engine.value) return
  try { engine.value.remove_unit(selectedCell.value.x, selectedCell.value.y); refreshUnits() } catch {}
  selectedCell.value = null
}

function selectUnitAt(x: number, y: number) {
  selectedCell.value = { x, y }
}

function onStartBattle() {
  battle.startBattle()
  if (currentUnit.value) {
    selectedCell.value = { x: currentUnit.value.x, y: currentUnit.value.y }
  }
}

function beginMoveAction() { if (!aiUnitActive.value) battle.beginMoveAction() }
function beginAttackAction() { if (!aiUnitActive.value) battle.beginAttackAction() }
function cancelAction() { battle.cancelAction() }
function waitAction() { if (!aiUnitActive.value) battle.waitAction() }
function endTurn() { battle.endTurn() }
function resetBattle() { ai.resetAI(); rebuildBoard() }

function onToggleAutoAI() {
  if (ai.aiRunning.value) {
    ai.stopAI()
  } else {
    const hasAny = ai.isAIControlled('ally') || ai.isAIControlled('enemy') || ai.isAIControlled('neutral')
    if (!hasAny) {
      ai.toggleAI('enemy')
    }
    ai.startAI()
  }
}

function onToggleAwareness(m: AwarenessMode) {
  awareness.toggleMode(m)
}

function onDeployEntity(entity: { id: string; name: string; type?: string }, team: string, stats: { hp: number; attack: number; defense: number; speed: number; moveRange: number; attackRange: number }) {
  if (!engine.value) return
  if (entity.type === 'tactical-board') return
  const size = Number(gridSize.value)
  const positions: { x: number; y: number }[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!units.value.some(u => u.x === x && u.y === y)) {
        positions.push({ x, y })
      }
    }
  }
  if (positions.length === 0) return

  if (team === 'ally') {
    positions.sort((a, b) => a.y - b.y || a.x - b.x)
  } else if (team === 'enemy') {
    positions.sort((a, b) => b.y - a.y || b.x - a.x)
  }

  const pos = positions[0]
  try {
    engine.value.place_unit(
      entity.id, entity.name, team,
      pos.x, pos.y,
      stats.hp, stats.hp, 50, 50,
      stats.attack, stats.defense, stats.speed,
      stats.moveRange, stats.attackRange,
    )
    refreshUnits()
    selectedCell.value = pos
  } catch (e) {
    console.warn('[TacticalBoard] deploy failed', e)
  }
}

function onQuickDeploy(team: string, stats: { hp: number; attack: number; defense: number; speed: number; moveRange: number; attackRange: number }) {
  const allEntities = es.list() ?? []
  const available = allEntities.filter(e => !placedEntityIds.value.has(e.id) && e.type !== 'tactical-board')
  if (available.length === 0) return
  onDeployEntity(available[0], team, stats)
}

async function onSaveBoard() {
  const allEntities = es.list() ?? []
  let boardEntity = allEntities.find(e => e.type === 'tactical-board')
  if (!boardEntity) {
    const id = `tactical-board-${Date.now()}`
    await es.add({
      id,
      type: 'tactical-board',
      name: `战术棋盘 ${gridSize.value}×${gridSize.value}`,
      description: '',
      properties: {},
      tags: ['tactical-board'],
      createdAt: '',
      updatedAt: '',
    })
    await es.reload()
    boardEntity = es.list()?.find(e => e.id === id)
  }
  if (boardEntity) {
    await persistence.saveToEntity(boardEntity.id)
  }
}

async function onLoadBoard() {
  const allEntities = es.list() ?? []
  const boardEntity = allEntities.find(e => e.type === 'tactical-board')
  if (!boardEntity) return

  const data = persistence.loadFromProperties(boardEntity.properties || {})
  if (!data) return

  gridType.value = data.gridType
  gridSize.value = String(data.gridSize)
  terrain.value = data.terrain
  persistence.resetStats()
  if (data.combatStats) {
    persistence.combatStats.value = data.combatStats
  }

  await createEngine(data.gridType, data.gridSize, data.gridSize)
  syncTerrainToEngine()

  for (const u of data.units) {
    try {
      engine.value?.place_unit(
        u.id, u.name, u.team,
        u.x, u.y,
        u.hp, u.max_hp, u.mp, u.max_mp,
        u.attack, u.defense, u.speed,
        u.move_range, u.attack_range,
      )
    } catch (e) {
      console.warn('[TacticalBoard] restore unit failed', e)
    }
  }
  refreshUnits()
  battle.resetBattle()
  if (data.battlePhase === 'battle') {
    battle.startBattle()
  }
}

// --- Keyboard shortcuts ---
useKeyboardShortcuts({
  battlePhase,
  endTurn,
  beginMoveAction,
  beginAttackAction,
  waitAction,
  cancelAction,
  toggleAwareness: onToggleAwareness,
})

onMounted(async () => {
  es.reload()
  await rebuildBoard()
})
</script>

<style scoped src="./tactical-board-view.css"></style>
