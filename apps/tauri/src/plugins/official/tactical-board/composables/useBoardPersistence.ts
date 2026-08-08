import { ref, type Ref } from 'vue'
import { useEntityStore } from '@worldsmith/entity-core'
import type { TacticalEngineAPI, WasmBattleUnit } from './useTacticalEngine'
import type { BattlePhase } from './useBattleManager'

export interface BoardSaveData {
  gridType: string
  gridSize: number
  terrain: string[][]
  units: WasmBattleUnit[]
  battlePhase: BattlePhase
  currentTurn: number
  combatStats: CombatStats
}

export interface CombatStats {
  totalAttacks: number
  totalDamage: number
  totalCriticals: number
  unitsLost: Record<string, number>
}

export function useBoardPersistence(
  engine: Ref<TacticalEngineAPI | null>,
  gridType: Ref<string>,
  gridSize: Ref<string>,
  terrain: Ref<string[][]>,
  battlePhase: Ref<BattlePhase>,
  currentTurn: Ref<number>,
) {
  const es = useEntityStore()
  const combatStats = ref<CombatStats>({
    totalAttacks: 0,
    totalDamage: 0,
    totalCriticals: 0,
    unitsLost: {},
  })

  function recordAttack(damage: number, critical: boolean, deadTeam: string | null) {
    combatStats.value.totalAttacks++
    combatStats.value.totalDamage += damage
    if (critical) combatStats.value.totalCriticals++
    if (deadTeam) {
      combatStats.value.unitsLost[deadTeam] = (combatStats.value.unitsLost[deadTeam] || 0) + 1
    }
  }

  function collectSaveData(): BoardSaveData {
    const units: WasmBattleUnit[] = []
    if (engine.value) {
      try {
        const raw = engine.value.get_all_units() as WasmBattleUnit[]
        units.push(...(raw || []))
      } catch {}
    }

    return {
      gridType: gridType.value,
      gridSize: Number(gridSize.value),
      terrain: terrain.value,
      units,
      battlePhase: battlePhase.value,
      currentTurn: currentTurn.value,
      combatStats: { ...combatStats.value, unitsLost: { ...combatStats.value.unitsLost } },
    }
  }

  async function saveToEntity(entityId: string) {
    const data = collectSaveData()
    const props: Record<string, unknown> = {
      gridType: data.gridType,
      gridSize: String(data.gridSize),
      terrain: JSON.stringify(data.terrain),
      units: JSON.stringify(data.units),
      battleState: JSON.stringify({
        battlePhase: data.battlePhase,
        currentTurn: data.currentTurn,
      }),
      combatStats: JSON.stringify(data.combatStats),
    }
    const existing = es.entities?.find(e => e.id === entityId)
    const existingProps = existing?.properties || {}
    await es.update(entityId, { properties: { ...existingProps, ...props } })
  }

  function loadFromProperties(props: Record<string, unknown>): BoardSaveData | null {
    try {
      const gridTypeVal = (props.gridType as string) || 'square'
      const gridSizeVal = Number(props.gridSize) || 12
      const terrainVal = typeof props.terrain === 'string' ? JSON.parse(props.terrain) : []
      const unitsVal = typeof props.units === 'string' ? JSON.parse(props.units) : []
      const battleStateVal = typeof props.battleState === 'string' ? JSON.parse(props.battleState) : {}
      const combatStatsVal = typeof props.combatStats === 'string' ? JSON.parse(props.combatStats) : {}

      return {
        gridType: gridTypeVal,
        gridSize: gridSizeVal,
        terrain: terrainVal,
        units: unitsVal,
        battlePhase: battleStateVal.battlePhase || 'deployment',
        currentTurn: battleStateVal.currentTurn || 1,
        combatStats: combatStatsVal || { totalAttacks: 0, totalDamage: 0, totalCriticals: 0, unitsLost: {} },
      }
    } catch (e) {
      console.warn('[BoardPersistence] load failed', e)
      return null
    }
  }

  function resetStats() {
    combatStats.value = {
      totalAttacks: 0,
      totalDamage: 0,
      totalCriticals: 0,
      unitsLost: {},
    }
  }

  return {
    combatStats,
    recordAttack,
    collectSaveData,
    saveToEntity,
    loadFromProperties,
    resetStats,
  }
}
