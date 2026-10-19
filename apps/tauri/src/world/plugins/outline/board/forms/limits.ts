/**
 * forms/limits —— 配置里的「数量上限」归一化（2026-10-19 信息密度增强）
 *
 * 约定：`'all'`（以及空值 / 非正数 / 非法值）→ Infinity；数字字符串 → 正整数。
 * 组件统一用它把 select 的字符串值转成可切片的数字，避免各处各写一份。
 */
export function normalizeLimit(raw: unknown): number {
  if (raw === 'all' || raw === undefined || raw === null || raw === '') {
    return Number.POSITIVE_INFINITY
  }
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : Number.POSITIVE_INFINITY
}
