/**
 * sectionArrange —— 区内容器的排列算法（纯函数）
 *
 * 【为什么要它】区（Section）承担「组间约束」：区一旦设了排布方式，容器就不再完全自由——
 * 调整区尺寸时按 gap 重排（编辑器交互规格 §二）。四个模式里 `free` 保持容器相对位置不变，
 * 其余三种（vertical / horizontal / grid）是真正的排布。
 *
 * 【为什么是纯函数】jsdom 拿不到真实尺寸，拖拽类交互无法单测；把排布算成「输入容器集合 + 区矩形，
 * 输出目标坐标」后，算法可被单测覆盖，组件只做渲染与事件（施工分解 §四的倒推要求）。
 */
import type { Point, Rect } from './boardGeometry'
import type { SectionArrange } from './layoutSchema'

/** 区标题栏高度占位（内容从标题栏下方开始） */
export const SECTION_HEADER = 26
/** 容器距区边框的内边距 */
export const SECTION_PADDING = 16
/** 容器之间的默认间距 */
export const SECTION_GAP = 12

/** 参与排布的容器（只用到位置与尺寸） */
export interface ArrangeItem {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 排布结果：只给目标位置，尺寸不变 */
export interface ArrangeResult {
  id: string
  x: number
  y: number
}

export interface ArrangeOptions {
  gap?: number
  padding?: number
  header?: number
}

/** 区内容区的左上角（标题栏 + 内边距之后） */
export function contentOrigin(rect: Rect, opts: ArrangeOptions = {}): Point {
  const padding = opts.padding ?? SECTION_PADDING
  const header = opts.header ?? SECTION_HEADER
  return { x: rect.x + padding, y: rect.y + header + padding }
}

/**
 * 计算区内容器目标坐标。
 * · free：原样返回（保持相对位置——这是「调整尺寸不重排」的语义）
 * · vertical：按当前 y 排序，自上而下堆叠，左边界对齐
 * · horizontal：按当前 x 排序，自左而右排列，上边界对齐
 * · grid：等列宽（取最宽容器）逐行填充，行高取该行最高容器
 */
export function arrangeSection(
  items: ArrangeItem[],
  rect: Rect,
  arrange: SectionArrange,
  opts: ArrangeOptions = {},
): ArrangeResult[] {
  const gap = opts.gap ?? SECTION_GAP
  const origin = contentOrigin(rect, opts)

  if (!items.length) return []
  if (arrange === 'free') {
    return items.map(i => ({ id: i.id, x: i.x, y: i.y }))
  }

  if (arrange === 'vertical') {
    const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
    let cursor = origin.y
    return ordered.map(i => {
      const at = { id: i.id, x: origin.x, y: Math.round(cursor) }
      cursor += i.h + gap
      return at
    })
  }

  if (arrange === 'horizontal') {
    const ordered = [...items].sort((a, b) => a.x - b.x || a.y - b.y)
    let cursor = origin.x
    return ordered.map(i => {
      const at = { id: i.id, x: Math.round(cursor), y: origin.y }
      cursor += i.w + gap
      return at
    })
  }

  // grid：等列宽 + 逐行填充
  const colW = items.reduce((max, i) => Math.max(max, i.w), 0)
  const availW = Math.max(colW, rect.w - (opts.padding ?? SECTION_PADDING) * 2)
  const cols = Math.max(1, Math.floor((availW + gap) / (colW + gap)))
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x)

  const results: ArrangeResult[] = []
  let rowY = origin.y
  for (let start = 0; start < ordered.length; start += cols) {
    const row = ordered.slice(start, start + cols)
    const rowH = row.reduce((max, i) => Math.max(max, i.h), 0)
    row.forEach((i, idx) => {
      results.push({ id: i.id, x: Math.round(origin.x + idx * (colW + gap)), y: Math.round(rowY) })
    })
    rowY += rowH + gap
  }
  return results
}

/** 区调整尺寸时是否需要重排容器（free 保持相对位置，其余重排） */
export function shouldRearrangeOnResize(arrange: SectionArrange): boolean {
  return arrange !== 'free'
}

/**
 * 区内容器的顶部下限（2026-10-24 · 13-C）：
 * 归属区的容器不得盖住标题栏（否则改名/拖动热区被遮）。
 * 只调 y，不调 x 与尺寸；无区归属时原样返回。
 */
export function clampContainerTop(
  rect: Rect,
  sectionRect: Rect | null | undefined,
  header: number = SECTION_HEADER,
): number {
  if (!sectionRect) return rect.y
  return Math.max(rect.y, sectionRect.y + header)
}
