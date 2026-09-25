import { ref, computed, type Ref } from 'vue'
import type { TacticalEngineAPI, WasmBattleUnit } from './useTacticalEngine'
import type { BattlePhase, BattleLogEntry } from './useBattleManager'

export interface AiControlState {
  team: string
  enabled: boolean
  speed: number
}

const AI_SPEEDS = [
  { value: 300, label: '快速' },
  { value: 600, label: '正常' },
  { value: 1200, label: '慢速' },
]

export function useAIController(
  engine: Ref<TacticalEngineAPI | null>,
  battlePhase: Ref<BattlePhase>,
  currentUnit: Ref<WasmBattleUnit | null>,
  addLog: (text: string, type: BattleLogEntry['type']) => void,
  _refreshUnits: () => void,
  beginMoveAction: () => void,
  beginAttackAction: () => void,
  executeAction: (x: number, y: number) => boolean | Promise<boolean>,
  waitAction: () => void,
) {
  const aiTeams = ref<Map<string, AiControlState>>(new Map())
  const aiRunning = ref(false)
  const aiSpeed = ref(600)
  const aiStepCount = ref(0)

  let abortController: AbortController | null = null

  const aiTeamList = computed(() => {
    const result: { team: string; enabled: boolean }[] = []
    for (const [team, state] of aiTeams.value) {
      result.push({ team, enabled: state.enabled })
    }
    return result
  })

  function toggleAI(team: string) {
    const current = aiTeams.value.get(team)
    if (current) {
      current.enabled = !current.enabled
      aiTeams.value = new Map(aiTeams.value)
    }
  }

  function setAISpeed(speed: number) {
    aiSpeed.value = speed
  }

  function isAIControlled(team: string): boolean {
    return aiTeams.value.get(team)?.enabled ?? false
  }

  function shouldAIAct(): boolean {
    if (battlePhase.value !== 'battle') return false
    if (!currentUnit.value) return false
    return isAIControlled(currentUnit.value.team)
  }

  function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }

  async function executeAIAction(): Promise<boolean> {
    if (!engine.value || !currentUnit.value) return false
    const unit = currentUnit.value
    const team = unit.team

    try {
      const action = engine.value.ai_decide(team) as {
        unit_id: string
        action_type: string
        move_to: { x: number; y: number } | null
        target: { x: number; y: number } | null
        skill_id: string | null
      }

      if (!action || action.action_type === 'wait' || !action.unit_id) {
        addLog(`[AI] ${unit.name} 待机`, 'system')
        waitAction()
        return true
      }

      if (action.action_type === 'move' && action.move_to) {
        beginMoveAction()
        const moveTo = action.move_to
        await delay(50, abortController?.signal ?? new AbortController().signal)
        if (!aiRunning.value) return false
        await executeAction(moveTo.x, moveTo.y)
        return true
      }

      if (action.action_type === 'attack' && action.target) {
        beginAttackAction()
        const targetPos = action.target
        await delay(50, abortController?.signal ?? new AbortController().signal)
        if (!aiRunning.value) return false
        await executeAction(targetPos.x, targetPos.y)
        return true
      }

      addLog(`[AI] ${unit.name} 待机`, 'system')
      waitAction()
      return true
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false
      console.warn('[AI] decide failed', e)
      addLog(`[AI] ${unit.name} 待机`, 'system')
      waitAction()
      return false
    }
  }

  async function runAILoop() {
    abortController = new AbortController()
    const signal = abortController.signal

    try {
      while (aiRunning.value && battlePhase.value === 'battle') {
        if (shouldAIAct()) {
          aiStepCount.value++
          await executeAIAction()
          await delay(aiSpeed.value, signal)
        } else {
          // Wait for currentUnit to change instead of blind polling
          await waitForUnitChange(signal)
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        console.warn('[AI] loop error', e)
      }
    }
    aiRunning.value = false
  }

  function waitForUnitChange(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (!aiRunning.value || battlePhase.value !== 'battle') {
          clearInterval(checkInterval)
          resolve()
          return
        }
        if (shouldAIAct()) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 50)
      signal.addEventListener('abort', () => { clearInterval(checkInterval); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
    })
  }

  function startAI() {
    if (aiRunning.value) return
    aiRunning.value = true
    aiStepCount.value = 0
    runAILoop()
  }

  function stopAI() {
    aiRunning.value = false
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  function runAIFullTurn(team: string) {
    if (!engine.value) return
    const state: AiControlState = { team, enabled: true, speed: aiSpeed.value }
    aiTeams.value.set(team, state)
    aiTeams.value = new Map(aiTeams.value)
    addLog(`[AI] ${team === 'ally' ? '友方' : team === 'enemy' ? '敌方' : '中立'} AI 接管`, 'system')
    startAI()
  }

  function runAISingleStep() {
    if (shouldAIAct()) {
      executeAIAction()
    }
  }

  function disableAllAI() {
    stopAI()
    for (const [, state] of aiTeams.value) {
      state.enabled = false
    }
    aiTeams.value = new Map(aiTeams.value)
  }

  function resetAI() {
    stopAI()
    aiTeams.value = new Map()
    aiStepCount.value = 0
  }

  return {
    aiTeams: aiTeamList,
    aiRunning,
    aiSpeed,
    aiStepCount,
    AI_SPEEDS,
    toggleAI,
    setAISpeed,
    isAIControlled,
    shouldAIAct,
    runAIFullTurn,
    runAISingleStep,
    disableAllAI,
    resetAI,
    startAI,
    stopAI,
  }
}
