/**
 * virtualWindow —— 虚拟滚动的可见窗口计算（2026-10-25 · 表格式虚拟滚动）
 *
 * 纯函数：给定总行数、滚动位置、视口高度、固定行高与 overscan，
 * 返回需要渲染的 [start, end) 半开区间。
 *
 * 边界约定：
 * - 空表 → { start: 0, end: 0 }；
 * - scrollTop 超出末尾（数据变少后的陈旧值）→ 停在最后一行；
 * - 所有非有限值都回退到安全默认，避免 NaN 传入 slice。
 */
export interface VirtualWindow {
  start: number
  end: number
}

export function computeVirtualWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 4,
): VirtualWindow {
  if (!Number.isFinite(total) || total <= 0) return { start: 0, end: 0 }
  const h = Math.max(1, Number.isFinite(rowHeight) ? rowHeight : 30)
  const vh = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 360)
  const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0)
  const pad = Math.max(0, Math.floor(Number.isFinite(overscan) ? overscan : 4))

  const first = Math.floor(top / h)
  const visible = Math.ceil(vh / h)
  const start = Math.max(0, Math.min(total - 1, first - pad))
  const end = Math.min(total, first + visible + pad)
  return { start, end: Math.max(start, end) }
}
