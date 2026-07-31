/**
 * 概率引擎 — 从 companionModeTrigger 提取的共享工具
 *
 * 提供概率计算、运气状态管理等通用功能，
 * 供陪伴模式和群聊发言欲望系统共用。
 */

export interface ProbabilityResult {
  shouldTrigger: boolean
  finalProbability: number
  factors: {
    base: number
    scene: number
    intimacy: number
    decay: number
    luck: number
  }
}

export function calculateProbability(
  baseProbability: number,
  editDurationSeconds: number,
  memoryCount: number,
  secondsSinceLastPopup: number,
  luckCoefficient: number,
  isImmediateScene: boolean,
): ProbabilityResult {
  const sceneFactor = isImmediateScene ? 1.0 : Math.min(1.0, editDurationSeconds / 60)
  const intimacy = Math.min(1.5, 1.0 + memoryCount * 0.1)
  const decay = Math.max(0.3, 1.0 - (secondsSinceLastPopup / 30) * 0.7)
  const luck = luckCoefficient

  const finalProbability = baseProbability * sceneFactor * intimacy * decay * luck

  return {
    shouldTrigger: Math.random() < finalProbability,
    finalProbability,
    factors: {
      base: baseProbability,
      scene: sceneFactor,
      intimacy,
      decay,
      luck,
    },
  }
}

export interface LuckState {
  coefficient: number
  lastResetAt: number
  operationCount: number
}

export function createLuckState(): LuckState {
  return {
    coefficient: 1.0,
    lastResetAt: Date.now(),
    operationCount: 0,
  }
}

export function updateLuck(
  state: LuckState,
  resetMinutes: number,
  resetOps: number,
): LuckState {
  const now = Date.now()
  const elapsed = (now - state.lastResetAt) / 1000 / 60
  const opsExceeded = state.operationCount >= resetOps
  const timeExceeded = elapsed >= resetMinutes

  if (timeExceeded || opsExceeded) {
    return {
      coefficient: Math.min(1.5, Math.max(0.5, 0.5 + Math.random())),
      lastResetAt: now,
      operationCount: 0,
    }
  }

  return {
    ...state,
    operationCount: state.operationCount + 1,
  }
}
