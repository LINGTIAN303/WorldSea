/**
 * useBoardViewport —— 视口操作（缩放 / 平移 / 适配）
 *
 * 视口**状态**由 useBoardLayout 托管（与布局共用一处保存入口，避免两条写路径互相覆盖
 * properties）；本模块只负责「操作 → 新视口」的计算与画布像素尺寸的记录。
 */
import { computed, ref } from 'vue'
import {
  contentBounds,
  fitViewport,
  screenToWorld,
  worldToScreen,
  zoomAt,
  zoomStepFromWheel,
  type Point,
  type Rect,
  type Viewport,
} from '../boardGeometry'

export function useBoardViewport(opts: {
  getViewport: () => Viewport
  setViewport: (vp: Viewport) => void
}) {
  /** 画布可视区像素尺寸（组件 ResizeObserver 时写入） */
  const size = ref({ w: 0, h: 0 })

  const viewport = computed<Viewport>(() => opts.getViewport())

  function setSize(w: number, h: number): void {
    size.value = { w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) }
  }

  /** 滚轮缩放：anchor 为画布内相对坐标（指针位置） */
  function zoomByWheel(deltaY: number, anchor: Point): void {
    const vp = opts.getViewport()
    const next = zoomStepFromWheel(vp.zoom, deltaY)
    opts.setViewport(zoomAt(vp, next, anchor))
  }

  /** 缩放到指定倍数（anchor 缺省为可视区中心） */
  function zoomTo(nextZoom: number, anchor?: Point): void {
    const vp = opts.getViewport()
    const a = anchor ?? { x: size.value.w / 2, y: size.value.h / 2 }
    opts.setViewport(zoomAt(vp, nextZoom, a))
  }

  /** 平移（屏幕像素增量） */
  function panBy(dxScreen: number, dyScreen: number): void {
    const vp = opts.getViewport()
    opts.setViewport({ ...vp, panX: vp.panX + dxScreen, panY: vp.panY + dyScreen })
  }

  function resetZoom(): void {
    zoomTo(1)
  }

  /** 适配全部：内容包围盒 + 可视区尺寸 */
  function fitAll(rects: Rect[]): void {
    opts.setViewport(fitViewport(contentBounds(rects), size.value))
  }

  /** 画布内相对坐标 → 世界坐标 */
  function toWorld(p: Point): Point {
    return screenToWorld(p, opts.getViewport())
  }

  /** 世界坐标 → 画布内相对坐标 */
  function toScreen(p: Point): Point {
    return worldToScreen(p, opts.getViewport())
  }

  return { size, viewport, setSize, zoomByWheel, zoomTo, panBy, resetZoom, fitAll, toWorld, toScreen }
}
