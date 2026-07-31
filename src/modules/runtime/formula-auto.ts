/**
 * modules/runtime/formula-auto.ts — Formula 自动重算（re-export）
 *
 * Phase 3：实现已下沉到 @worldsmith/entity-core/core/formula-auto.ts
 * 本文件保留向后兼容的 re-export。
 */
export {
  registerFormulaAutoRecalc,
  unregisterFormulaAutoRecalc,
  getComputedFormulas,
} from '@worldsmith/entity-core'
