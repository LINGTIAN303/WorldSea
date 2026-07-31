/**
 * Companion Mode 触发器
 *
 * 包含触发方法选择、概率计算、运气状态管理、
 * 句子结束检测、暂停检测器、字符计数检测器等。
 */
import type { TriggerMethod, SceneConfig } from './scene'

const ALL_METHODS: TriggerMethod[] = ['immediate', 'pause', 'sentence', 'charCount']

export function selectTriggerMethod(scene: SceneConfig): TriggerMethod {
  const recommended = scene.recommendedMethod
  const others = ALL_METHODS.filter(m => m !== recommended)
  const otherWeight = 0.4 / others.length
  const roll = Math.random()

  if (roll < 0.6) return recommended

  let cumulative = 0.6
  for (const method of others) {
    cumulative += otherWeight
    if (roll < cumulative) return method
  }
  return others[others.length - 1]
}

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

export function getLuckLabel(coefficient: number): string {
  if (coefficient > 1.2) return '活跃期'
  if (coefficient < 0.8) return '沉默期'
  return '正常期'
}

const SENTENCE_ENDINGS = /[。！？.!?\n]/

export function detectSentenceEnd(text: string): boolean {
  return SENTENCE_ENDINGS.test(text)
}

export class PauseDetector {
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly thresholdMs: number
  private readonly callback: () => void

  constructor(thresholdMs: number, callback: () => void) {
    this.thresholdMs = thresholdMs
    this.callback = callback
  }

  reset() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.callback()
    }, this.thresholdMs)
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export class CharCountDetector {
  private charCount = 0
  private readonly threshold: number
  private readonly callback: () => void

  constructor(threshold: number, callback: () => void) {
    this.threshold = threshold
    this.callback = callback
  }

  feed(text: string) {
    this.charCount += text.length
    if (this.charCount >= this.threshold) {
      this.charCount = 0
      this.callback()
    }
  }

  reset() {
    this.charCount = 0
  }
}
