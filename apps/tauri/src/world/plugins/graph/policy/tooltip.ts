/**
 * 悬浮提示定位（2026-10-26 重构）。
 *
 * 坐标空间 = 图谱视图容器（absolute 挂 `.graph-view`）。指针右下 14px；
 * 近右/下缘翻到另一侧；左上保底 8px。
 */
export const TOOLTIP_W = 260
export const TOOLTIP_H = 60

export function tooltipPosition(
  x: number,
  y: number,
  viewportW: number,
  viewportH: number,
  w: number = TOOLTIP_W,
  h: number = TOOLTIP_H,
): { x: number; y: number } {
  const px = x + 14 + w > viewportW ? x - w - 14 : x + 14
  const py = y + 14 + h > viewportH ? y - h - 14 : y + 14
  return { x: Math.max(8, px), y: Math.max(8, py) }
}
