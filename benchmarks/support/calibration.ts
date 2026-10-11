/**
 * 性能门禁校准（C1，对齐 dsh `benchmarks/support/calibration.ts`）
 *
 * 预算为源码常量：环境变量不可覆盖（未读任何 process.env）。CI 预算 =
 * 实测参考期望 × CI_TIME_SCALE（环境波动宏观系数）× PERFORMANCE_BUDGET_HEADROOM（批次内抖动余量），
 * 向上取整——校准公式与 dsh 完全一致，避免本机与 CI 机器差异导致脆断。
 *
 * ⚠️ 修改语义：这些常量是**门禁**。同一批基准改一个就可能导致「回归即红」失效，
 * 必须在本机同步跑 `pnpm bench:gate` 校准后一起提交，并在提交说明记录新参考值。
 */
export const CI_TIME_SCALE = 2
export const PERFORMANCE_BUDGET_HEADROOM = 1.25

/** 参考期望 → CI 预算（毫秒，整数），dsh 同款公式 */
export function ciTimeBudget(expectedMs: number): number {
  return Math.ceil(expectedMs * CI_TIME_SCALE * PERFORMANCE_BUDGET_HEADROOM)
}