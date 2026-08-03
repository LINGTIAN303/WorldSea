import { ref, shallowRef } from 'vue'
import { TacticalEngineJS } from './TacticalEngineJS'

export interface WasmPosition {
  x: number
  y: number
}

export interface WasmCombatResult {
  damage: number
  attacker_id: string
  defender_id: string
  defender_hp_remaining: number
  defender_dead: boolean
  critical: boolean
}

export interface WasmAiAction {
  unit_id: string
  action_type: string
  move_to: WasmPosition | null
  target: WasmPosition | null
  skill_id: string | null
}

export interface WasmBattleUnit {
  id: string
  name: string
  team: string
  hp: number
  max_hp: number
  mp: number
  max_mp: number
  attack: number
  defense: number
  speed: number
  move_range: number
  attack_range: number
  x: number
  y: number
  acted: boolean
}

export interface GameEvent {
  kind: string
  unit_id?: string
  target_id?: string
  data?: Record<string, any>
}

export interface TacticalEngineAPI {
  place_unit(
    id: string, name: string, team: string,
    x: number, y: number,
    hp: number, max_hp: number, mp: number, max_mp: number,
    attack: number, defense: number, speed: number,
    move_range: number, attack_range: number,
  ): void
  remove_unit(x: number, y: number): void
  move_unit(fx: number, fy: number, tx: number, ty: number): void
  get_movable_range(x: number, y: number): WasmPosition[]
  get_attack_range(x: number, y: number): WasmPosition[]
  execute_attack(ax: number, ay: number, tx: number, ty: number): WasmCombatResult
  set_terrain(x: number, y: number, terrain_type: string): void
  get_unit_at(x: number, y: number): WasmBattleUnit | null
  get_all_units(): WasmBattleUnit[]
  get_board_info(): { gridType: string; width: number; height: number }
  next_turn(): void
  get_turn(): number
  get_phase(): string
  start_battle(): void
  check_victory(): string
  ai_decide(team: string): WasmAiAction
  calculate_awareness(): { cells: any[] }
  drain_events(): GameEvent[]
}

let wasmModule: typeof import('@worldsmith/tactical-engine') | null = null
let wasmLoadAttempted = false

async function tryLoadWasm(): Promise<typeof import('@worldsmith/tactical-engine') | null> {
  if (wasmModule) return wasmModule
  if (wasmLoadAttempted) return null
  wasmLoadAttempted = true
  try {
    wasmModule = await import('@worldsmith/tactical-engine')
    console.log('[TacticalEngine] WASM 引擎加载成功')
    return wasmModule
  } catch (e) {
    console.warn('[TacticalEngine] WASM 引擎不可用，使用 JS 降级引擎:', e)
    return null
  }
}

export function useTacticalEngine() {
  const engine = shallowRef<TacticalEngineAPI | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const engineType = ref<'wasm' | 'js' | null>(null)

  async function createEngine(gridType: string, width: number, height: number) {
    loading.value = true
    error.value = null

    try {
      const mod = await tryLoadWasm()
      if (mod) {
        engine.value = new mod.TacticalEngine(gridType, width, height) as unknown as TacticalEngineAPI
        engineType.value = 'wasm'
      } else {
        engine.value = new TacticalEngineJS(gridType, width, height) as unknown as TacticalEngineAPI
        engineType.value = 'js'
      }
    } catch (err) {
      error.value = `引擎创建失败: ${err instanceof Error ? err.message : String(err)}`
      try {
        engine.value = new TacticalEngineJS(gridType, width, height) as unknown as TacticalEngineAPI
        engineType.value = 'js'
        error.value = null
      } catch (fallbackErr) {
        error.value = `引擎创建失败(含降级): ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`
      }
    } finally {
      loading.value = false
    }

    return engine.value
  }

  return {
    engine,
    loading,
    error,
    engineType,
    createEngine,
  }
}
