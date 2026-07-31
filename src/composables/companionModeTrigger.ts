/**
 * companionModeTrigger — Companion Mode 触发逻辑（re-export）
 *
 * Phase 2：实现已下沉到 @worldsmith/shared-composables/companion/trigger
 * 本文件保留向后兼容的 re-export。
 */
export {
  type ProbabilityResult,
  type LuckState,
  selectTriggerMethod,
  calculateProbability,
  createLuckState,
  updateLuck,
  getLuckLabel,
  detectSentenceEnd,
  PauseDetector,
  CharCountDetector,
} from '@worldsmith/shared-composables/companion/trigger'
