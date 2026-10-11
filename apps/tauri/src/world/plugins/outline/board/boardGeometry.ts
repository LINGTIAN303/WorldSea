/**
 * boardGeometry —— 白板几何与吸附（纯函数）
 *
 * 【为什么必须纯函数】jsdom 的 getBoundingClientRect 恒返回 0，拖拽/缩放类交互在单测里
 * 拿不到真实尺寸；把「坐标换算 + 吸附 + 适配」全部抽成纯函数后，核心算法可被单测覆盖，
 * 组件只负责事件绑定与渲染。详见 docs/plans/2026-09-16-大纲白板-施工分解.md §四。
 */

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 视口（与白板实体 properties.viewport 一致） */
export interface Viewport {
  zoom: number
  panX: number
  panY: number
}

/** 默认视口 */
export function createDefaultViewport(): Viewport {
  return { zoom: 1, panX: 0, panY: 0 }
}

/**
 * 解析视口字段（容错：空值/坏 JSON/字段缺失都回退默认；zoom 夹在合法范围）。
 * 与布局体解析同一条纪律：坏数据不炸视图。
 */
export function parseViewport(raw: unknown): Viewport {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return createDefaultViewport()
    try {
      obj = JSON.parse(text)
    } catch {
      return createDefaultViewport()
    }
  }
  if (!obj || typeof obj !== 'object') return createDefaultViewport()
  const o = obj as Record<string, unknown>
  const zoomRaw = Number(o.zoom)
  const panX = Number(o.panX)
  const panY = Number(o.panY)
  return {
    zoom: Number.isFinite(zoomRaw) ? clampZoom(zoomRaw) : 1,
    panX: Number.isFinite(panX) ? panX : 0,
    panY: Number.isFinite(panY) ? panY : 0,
  }
}

/** 视口是否已被用户/系统实际保存过（用于「首次进入适配」判定） */
export function hasSavedViewport(raw: unknown): boolean {
  if (typeof raw !== 'string') return !!raw && typeof raw === 'object'
  const text = raw.trim()
  if (!text) return false
  try {
    const obj = JSON.parse(text) as unknown
    return !!obj && typeof obj === 'object'
  } catch {
    return false
  }
}

export function serializeViewport(vp: Viewport): string {
  return JSON.stringify({ zoom: clampZoom(vp.zoom), panX: vp.panX, panY: vp.panY })
}

/** 缩放范围：白板以文字内容为主，过大过小都无意义（编辑器交互规格 §一） */
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 2.5

/** 吸附阈值（像素，屏幕坐标系下的手感阈值） */
export const SNAP_THRESHOLD = 6

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
}

/** 世界坐标 → 屏幕坐标 */
export function worldToScreen(p: Point, vp: Viewport): Point {
  return { x: p.x * vp.zoom + vp.panX, y: p.y * vp.zoom + vp.panY }
}

/** 屏幕坐标 → 世界坐标 */
export function screenToWorld(p: Point, vp: Viewport): Point {
  const zoom = vp.zoom || 1
  return { x: (p.x - vp.panX) / zoom, y: (p.y - vp.panY) / zoom }
}

/**
 * 以 anchor（屏幕坐标，通常是指针位置）为不动点缩放。
 * 性质：anchor 处的世界坐标在缩放前后保持映射到同一屏幕点。
 */
export function zoomAt(vp: Viewport, nextZoom: number, anchor: Point): Viewport {
  const zoom = clampZoom(nextZoom)
  const world = screenToWorld(anchor, vp)
  return {
    zoom,
    panX: anchor.x - world.x * zoom,
    panY: anchor.y - world.y * zoom,
  }
}

/** 滚轮增量 → 目标缩放（与项目既有画布一致：1.1 / 0.9 步进）。 */
export function zoomStepFromWheel(current: number, deltaY: number): number {
  const factor = deltaY < 0 ? 1.1 : 0.9
  return clampZoom(current * factor)
}

/** 矩形的六条对齐线候选（竖：左/中/右；横：上/中/下） */
export function guideLinesOf(r: Rect): { vertical: number[]; horizontal: number[] } {
  return {
    vertical: [r.x, r.x + r.w / 2, r.x + r.w],
    horizontal: [r.y, r.y + r.h / 2, r.y + r.h],
  }
}

export interface SnapResult {
  /** 需要施加的位移（世界坐标，含吸附后的偏移量） */
  dx: number
  dy: number
  /** 命中的对齐线（世界坐标 x），用于渲染辅助线 */
  verticalGuides: number[]
  /** 命中的对齐线（世界坐标 y） */
  horizontalGuides: number[]
}

/**
 * 辅助线吸附：把 moving 矩形与 others 的六条线两两比较，取阈值内**最近**的一组偏移。
 * threshold 单位为屏幕像素，内部按 zoom 换算到世界坐标（保证不同缩放下手感一致）。
 */
export function snapToGuides(
  moving: Rect,
  others: Rect[],
  zoom = 1,
  threshold: number = SNAP_THRESHOLD,
): SnapResult {
  const worldThreshold = threshold / (zoom || 1)
  const mv = guideLinesOf(moving)
  const empty: SnapResult = { dx: 0, dy: 0, verticalGuides: [], horizontalGuides: [] }
  if (!others.length) return empty

  let bestX = { delta: 0, dist: Infinity, line: 0 }
  let bestY = { delta: 0, dist: Infinity, line: 0 }

  for (const other of others) {
    const og = guideLinesOf(other)
    for (const mvLine of mv.vertical) {
      for (const oLine of og.vertical) {
        const dist = Math.abs(oLine - mvLine)
        if (dist <= worldThreshold && dist < bestX.dist) {
          bestX = { delta: oLine - mvLine, dist, line: oLine }
        }
      }
    }
    for (const mvLine of mv.horizontal) {
      for (const oLine of og.horizontal) {
        const dist = Math.abs(oLine - mvLine)
        if (dist <= worldThreshold && dist < bestY.dist) {
          bestY = { delta: oLine - mvLine, dist, line: oLine }
        }
      }
    }
  }

  return {
    dx: Number.isFinite(bestX.dist) ? bestX.delta : 0,
    dy: Number.isFinite(bestY.dist) ? bestY.delta : 0,
    verticalGuides: Number.isFinite(bestX.dist) ? [bestX.line] : [],
    horizontalGuides: Number.isFinite(bestY.dist) ? [bestY.line] : [],
  }
}

/** 网格吸附（snap='grid' 模式）：就近取整到 gridSize 的倍数 */
export function snapToGrid(p: Point, gridSize: number): Point {
  if (!gridSize || gridSize <= 0) return { ...p }
  return {
    x: Math.round(p.x / gridSize) * gridSize,
    y: Math.round(p.y / gridSize) * gridSize,
  }
}

/** 两个矩形是否相交（用于「落到已有容器上」的判定） */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** 点是否落在矩形内（用于命中测试） */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/** 内容包围盒（空数组返回 null），用于「适配全部」 */
export function contentBounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * 适配全部：给定内容包围盒与视口像素尺寸，算出使其居中且留 padding 的视口状态。
 * 内容为空时返回初始视口（zoom=1，不偏移）。
 */
export function fitViewport(
  bounds: Rect | null,
  viewportSize: { w: number; h: number },
  padding = 40,
): Viewport {
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return { zoom: 1, panX: 0, panY: 0 }
  const availW = Math.max(1, viewportSize.w - padding * 2)
  const availH = Math.max(1, viewportSize.h - padding * 2)
  const zoom = clampZoom(Math.min(availW / bounds.w, availH / bounds.h))
  const centerWorld = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  return {
    zoom,
    panX: viewportSize.w / 2 - centerWorld.x * zoom,
    panY: viewportSize.h / 2 - centerWorld.y * zoom,
  }
}

/** 矩形中心点（区归属判定、定位容器都用它） */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
}

/** 平移矩形（区整体移动时的基础运算） */
export function shiftRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
}

/**
 * 由两个角点构造矩形（「画区」时从按下点拖到当前点）。
 * 支持反向拖拽（从右下拖到左上也算），并按最小尺寸放大到可操作范围。
 */
export function normalizeRect(
  a: Point,
  b: Point,
  minSize = { w: 80, h: 60 },
): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.max(minSize.w, Math.abs(b.x - a.x))),
    h: Math.round(Math.max(minSize.h, Math.abs(b.y - a.y))),
  }
}

/**
 * 命中测试：返回**最上层**命中的索引（-1 表示未命中）。
 * 取「最后一个命中」是因为渲染顺序即层级顺序——后绘制的在上层（区在容器下层，故只会用于区）。
 */
export function hitTestRects(p: Point, rects: Rect[]): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    if (pointInRect(p, rects[i])) return i
  }
  return -1
}

/** 尺寸手柄的四个角（右下角为主手柄，其余为后续扩展预留） */
export type ResizeHandle = 'se' | 'sw' | 'ne' | 'nw'

/**
 * 按手柄拖动结果计算新矩形（容器右下角手柄、区调整尺寸共用）。
 * 只有被拖动的边会变化，对边保持不动；最小尺寸钳制保证不为负。
 *
 * 例：拖右下角（'se'）时 left/top 不变，仅 width/height 变化。
 */
export function resizeRectFromHandle(
  start: Rect,
  handle: ResizeHandle,
  pointer: Point,
  minSize = { w: 120, h: 48 },
): Rect {
  let { x, y, w, h } = start
  const right = start.x + start.w
  const bottom = start.y + start.h

  if (handle === 'se' || handle === 'ne') {
    w = Math.max(minSize.w, pointer.x - start.x)
  }
  if (handle === 'sw' || handle === 'nw') {
    const nextW = Math.max(minSize.w, right - pointer.x)
    w = nextW
    x = right - nextW
  }
  if (handle === 'se' || handle === 'sw') {
    h = Math.max(minSize.h, pointer.y - start.y)
  }
  if (handle === 'ne' || handle === 'nw') {
    const nextH = Math.max(minSize.h, bottom - pointer.y)
    h = nextH
    y = bottom - nextH
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}
