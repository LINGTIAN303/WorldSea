/**
 * useBoardSnap —— 拖动吸附（辅助线 / 网格 / 关闭）
 *
 * 这是「半自由」在实现层的落点：容器本身可自由摆放，但拖动时给出对齐辅助线并在 6px 内吸附，
 * 让自由摆放不至于变成杂乱（编辑器交互规格 §一）。
 * 吸附算法在 boardGeometry（纯函数、有单测），本模块只负责按白板配置选模式并暴露辅助线。
 */
import { ref } from 'vue'
import { snapToGrid, snapToGuides, type Point, type Rect } from '../boardGeometry'

export type SnapMode = 'guides' | 'grid' | 'off'

/** 网格吸附尺寸（snap === 'grid' 时生效） */
export const GRID_SIZE = 20

export function parseSnapMode(raw: unknown): SnapMode {
  return raw === 'grid' || raw === 'off' ? raw : 'guides'
}

export function useBoardSnap(opts: {
  getMode: () => SnapMode
  getZoom: () => number
}) {
  /** 当前命中的辅助线（世界坐标），供画布渲染 */
  const verticalGuides = ref<number[]>([])
  const horizontalGuides = ref<number[]>([])

  function clearGuides(): void {
    verticalGuides.value = []
    horizontalGuides.value = []
  }

  /**
   * 拖动中求解落点：rawPos 为未吸附的目标位置（世界坐标），moving 为未吸附时的矩形，
   * others 为其他容器的矩形（世界坐标）。
   */
  function resolve(moving: Rect, others: Rect[], rawPos: Point): Point {
    const mode = opts.getMode()
    clearGuides()
    if (mode === 'off') return { ...rawPos }

    if (mode === 'grid') {
      const shifted = snapToGrid({ x: moving.x, y: moving.y }, GRID_SIZE)
      return { x: rawPos.x + (shifted.x - moving.x), y: rawPos.y + (shifted.y - moving.y) }
    }

    const res = snapToGuides(moving, others, opts.getZoom())
    verticalGuides.value = res.verticalGuides
    horizontalGuides.value = res.horizontalGuides
    return { x: rawPos.x + res.dx, y: rawPos.y + res.dy }
  }

  return { verticalGuides, horizontalGuides, resolve, clearGuides, GRID_SIZE }
}
