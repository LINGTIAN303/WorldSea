import { computed } from 'vue'
import { DEFAULT_CONTAINER_SIZE, type BoardContainer } from '../layoutSchema'
import { useOutlineBoardPrefs } from './useOutlineBoardPrefs'

/** 画布视口（与 useBoardLayout 的 viewport 同形） */
export interface BoardViewportLike {
  panX: number
  panY: number
  zoom: number
}

/** 面板宽度：与 BoardInspector 的 `.bi` width 保持一致（改样式时同步） */
const PANEL_W = 248
/** 面板与卡片之间的间距 */
const PANEL_GAP = 10

/**
 * 容器编辑面板的定位（2026-10-18）。
 *
 * 默认**跟随选中卡片**：贴在卡片左侧、顶部与卡片平行；左侧空间不足时贴右侧。
 * 设置里改为「固定右上角」时返回空对象，由 CSS 默认的 right/top 接管。
 *
 * 坐标换算依据 BoardCanvas 的世界层变换：`translate(panX, panY) scale(zoom)`、`transform-origin: 0 0`
 * ⇒ 屏幕坐标 = 世界坐标 × zoom + pan。
 */
export function useInspectorAnchor(
  container: () => BoardContainer | null,
  viewport: () => BoardViewportLike | undefined,
) {
  const { inspectorMode } = useOutlineBoardPrefs()

  const panelStyle = computed(() => {
    const c = container()
    const vp = viewport()
    if (!c || inspectorMode.value === 'fixed' || !vp) return {}
    const cardLeft = c.pos.x * vp.zoom + vp.panX
    const cardTop = c.pos.y * vp.zoom + vp.panY
    const cardW = (c.size?.w ?? DEFAULT_CONTAINER_SIZE.w) * vp.zoom
    // 优先贴卡片左侧；左侧放不下时贴右侧（保证不遮住卡片本身）
    const fitsLeft = cardLeft - PANEL_W - PANEL_GAP >= 8
    const left = fitsLeft ? cardLeft - PANEL_W - PANEL_GAP : cardLeft + cardW + PANEL_GAP
    const top = Math.max(8, Math.round(cardTop))
    return {
      left: `${Math.round(left)}px`,
      top: `${top}px`,
      right: 'auto',
      maxHeight: `calc(100% - ${top + 8}px)`,
    }
  })

  return { panelStyle }
}
