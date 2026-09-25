/**
 * thumbnail —— 白板缩略图（结构示意图 + 落盘编码）
 *
 * 【为什么不是截图】白板是 **DOM 绝对定位** 画布（编辑器交互规格 §0.2），拿不到 drawing 芽那种
 * 「canvas → drawImage(canvas)」的现成画布对象；真实渲染截图需要 html2canvas 一类**新增依赖**。
 * 本模块改为**按布局体数据绘制结构示意图**：区画虚线框、容器画实心框——缩略图的用途是
 * 「一眼认出是哪块板」，展示区的划分与容器的分布已经足够，且**不依赖真实 DOM 渲染**
 * （退出编辑器时也能生成），零新增依赖。
 *
 * 【纯函数边界】`computeThumbnailGeometry` 把「布局体 → 缩略图坐标系矩形」算清楚（可单测）；
 * `renderBoardThumbnail` 只做 canvas 绘制与编码，**无 canvas 环境（jsdom）或任何异常都返回 ''**，
 * 不让缩略图生成失败影响退出流程。
 */
import type { Rect } from './boardGeometry'
import { rectOfContainer, type OutlineBoardLayout } from './layoutSchema'

/** 缩略图尺寸（与 drawing 芽一致：120×90） */
export const THUMB_SIZE = { w: 120, h: 90 }
/** 缩略图内边距（像素） */
export const THUMB_PADDING = 6

export interface ThumbnailGeometry {
  sections: Rect[]
  containers: Rect[]
}

/**
 * 计算缩略图几何：把布局体（世界坐标）等比缩放并居中到缩略图内。
 * · 包围盒取「区 ∪ 容器」的并集（与「适配全部」同口径）
 * · 无内容（空板）→ 返回两组空数组（调用方据此画空底色）
 * · 只有单向尺寸时按比例缩放，不拉伸变形
 */
export function computeThumbnailGeometry(
  layout: OutlineBoardLayout,
  size: { w: number; h: number } = THUMB_SIZE,
  padding: number = THUMB_PADDING,
): ThumbnailGeometry {
  const worldRects: Rect[] = [
    ...layout.sections.map(s => ({ ...s.rect })),
    ...layout.containers.map(c => rectOfContainer(c)),
  ]
  if (!worldRects.length) return { sections: [], containers: [] }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of worldRects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  const worldW = Math.max(1, maxX - minX)
  const worldH = Math.max(1, maxY - minY)

  const availW = Math.max(1, size.w - padding * 2)
  const availH = Math.max(1, size.h - padding * 2)
  const scale = Math.min(availW / worldW, availH / worldH)

  // 居中偏移：内容缩放后的实际尺寸与可用区域差值的一半
  const offsetX = padding + (availW - worldW * scale) / 2
  const offsetY = padding + (availH - worldH * scale) / 2

  const project = (r: Rect): Rect => ({
    x: offsetX + (r.x - minX) * scale,
    y: offsetY + (r.y - minY) * scale,
    w: Math.max(1, r.w * scale),
    h: Math.max(1, r.h * scale),
  })

  return {
    sections: layout.sections.map(s => project(s.rect)),
    containers: layout.containers.map(c => project(rectOfContainer(c))),
  }
}

export interface ThumbnailRenderOptions {
  size?: { w: number; h: number }
  padding?: number
  /** 底色（与画布一致；缺省透明） */
  background?: string
}

/** 取 CSS 变量的实际值（canvas 不认识 var()，必须先解析） */
function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  } catch {
    return fallback
  }
}

/**
 * 渲染缩略图并返回 dataURL。
 * 任何异常（无 document / 无 2d context / toDataURL 被拒）都返回空串——缩略图是**锦上添花**，
 * 不允许它拖垮退出流程。
 */
export function renderBoardThumbnail(
  layout: OutlineBoardLayout,
  opts: ThumbnailRenderOptions = {},
): string {
  const size = opts.size ?? THUMB_SIZE
  try {
    if (typeof document === 'undefined') return ''
    const canvas = document.createElement('canvas')
    canvas.width = size.w
    canvas.height = size.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    // 底色：默认用容器背景色系，保证深色主题下缩略图不是一片白
    ctx.fillStyle = opts.background ?? cssVar('--bg-secondary', '#1e1e1e')
    ctx.fillRect(0, 0, size.w, size.h)

    const geo = computeThumbnailGeometry(layout, size, opts.padding ?? THUMB_PADDING)
    const sectionColor = cssVar('--border-color', '#555555')
    const containerColor = cssVar('--primary', '#4a9eff')

    // 区：虚线框（与画布上「区是弱色的」一致）
    ctx.setLineDash([3, 2])
    ctx.strokeStyle = sectionColor
    ctx.lineWidth = 1
    for (const r of geo.sections) {
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(1, r.w - 1), Math.max(1, r.h - 1))
    }

    // 容器：实心块（缩略图尺度下画描边会糊成一团，块状更易辨认分布）
    ctx.setLineDash([])
    ctx.fillStyle = containerColor
    ctx.globalAlpha = 0.75
    for (const r of geo.containers) {
      ctx.fillRect(r.x, r.y, Math.max(2, r.w), Math.max(2, r.h))
    }
    ctx.globalAlpha = 1

    return canvas.toDataURL('image/jpeg', 0.6)
  } catch {
    return ''
  }
}
