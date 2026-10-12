/**
 * 分栏滚动同步（批 4 V8/I10）：标题锚点映射。
 *
 * 编辑区与预览区内容同源（同一 HTML 的两种渲染），标题顺序一一对应。
 * 以标题锚点把滚动空间分段（首尾接 0 与最大滚动位），段内线性插值；
 * 无标题时退化为整段比例映射。纯函数，独立可测（DOM 接线在 NotebookTipTapEditor）。
 */

/** 标题选择器（编辑器与预览两侧同口径） */
export const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6'

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

/**
 * 把 from 侧 scrollTop 映射为 to 侧 scrollTop。
 *
 * @param fromAnchors from 侧各标题相对内容顶部的偏移（升序；与 toAnchors 按标题顺序对应）
 * @param toAnchors   to 侧对应标题偏移（升序）
 * @param fromMax     from 侧最大滚动位（scrollHeight - clientHeight）
 * @param toMax       to 侧最大滚动位
 * @param y           from 侧当前 scrollTop
 */
export function mapScrollTop(
  fromAnchors: number[],
  toAnchors: number[],
  fromMax: number,
  toMax: number,
  y: number,
): number {
  const fMax = Math.max(0, fromMax)
  const tMax = Math.max(0, toMax)
  const n = Math.min(fromAnchors.length, toAnchors.length)
  if (n === 0 || fMax <= 0) {
    // 无锚点（或 from 侧不可滚）：纯比例；from 侧不可滚 → 0
    if (fMax <= 0) return 0
    return clamp((y / fMax) * tMax, 0, tMax)
  }
  // 构造点列 [0, ...anchors, max]：clamp 到滚动空间并强制单调不减（防御越界/乱序锚点）
  const fromPts: number[] = [0]
  const toPts: number[] = [0]
  for (let i = 0; i < n; i++) {
    fromPts.push(clamp(fromAnchors[i], 0, fMax))
    toPts.push(clamp(toAnchors[i], 0, tMax))
  }
  fromPts.push(fMax)
  toPts.push(tMax)
  for (let i = 1; i < fromPts.length; i++) fromPts[i] = Math.max(fromPts[i], fromPts[i - 1])
  for (let i = 1; i < toPts.length; i++) toPts[i] = Math.max(toPts[i], toPts[i - 1])
  const yy = clamp(y, 0, fMax)
  // 定位区间 [i, i+1]
  let i = 0
  while (i < fromPts.length - 2 && fromPts[i + 1] <= yy) i++
  const a0 = fromPts[i]
  const a1 = fromPts[i + 1]
  const b0 = toPts[i]
  const b1 = toPts[i + 1]
  if (a1 <= a0) return clamp(b0, 0, tMax)
  const t = (yy - a0) / (a1 - a0)
  return clamp(b0 + t * (b1 - b0), 0, tMax)
}

/**
 * 收集容器内标题相对「内容顶部」的偏移（升序）。
 * 用 rect 差值而非 offsetTop：跨 offsetParent 安全（编辑器/预览内嵌套层级不同）。
 */
export function collectHeadingOffsets(
  container: HTMLElement,
  selector: string = HEADING_SELECTOR,
): number[] {
  const els = Array.from(container.querySelectorAll<HTMLElement>(selector))
  const base = container.getBoundingClientRect().top - container.scrollTop
  return els
    .map(el => el.getBoundingClientRect().top - base)
    .sort((a, b) => a - b)
}
