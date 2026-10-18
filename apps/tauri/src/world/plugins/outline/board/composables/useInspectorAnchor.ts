import { computed, ref, watch } from 'vue'
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
/** 悬浮位置按**白板**分别记忆（2026-10-18 用户拍板：各白板互不干扰） */
const POS_KEY_PREFIX = 'ws-outline-inspector-pos'

interface PanelPos {
  x: number
  y: number
}

function posKey(boardId: string): string {
  return `${POS_KEY_PREFIX}:${boardId || 'default'}`
}

function readPos(boardId: string): PanelPos {
  try {
    const raw = localStorage.getItem(posKey(boardId))
    if (raw) {
      const p = JSON.parse(raw) as Partial<PanelPos>
      if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
    }
  } catch {
    /* 损坏值忽略，回落默认 */
  }
  // 未拖拽过：左上偏下，避开视图工具条
  return { x: 24, y: 72 }
}

/**
 * 容器编辑面板的定位与拖拽（2026-10-18）。
 *
 * - `follow`（默认）：贴选中卡片**左侧**、顶部平行；左侧空间不足时贴卡片右侧。
 * - `fixed`：固定**左上角**（右侧有节点侧边栏，放右会被覆盖）。
 * - `free`（悬浮）：可拖拽到视口内任意位置，**位置按白板分别记忆**；此模式下点击画布空白
 *   **不关闭面板**（由 `useInspectorTarget` 的「最后编辑容器」记忆配合）。
 *
 * 坐标换算依据 BoardCanvas 世界层变换：`translate(panX, panY) scale(zoom)`、`transform-origin: 0 0`
 * ⇒ 屏幕坐标 = 世界坐标 × zoom + pan。
 */
export function useInspectorAnchor(
  container: () => BoardContainer | null,
  viewport: () => BoardViewportLike | undefined,
  boardId: () => string,
) {
  const { inspectorMode } = useOutlineBoardPrefs()
  const freePos = ref<PanelPos>(readPos(boardId()))

  // 切换白板 → 换成该白板自己的位置（各白板互不干扰）
  watch(boardId, (id) => {
    freePos.value = readPos(id)
  })

  watch(freePos, (p) => {
    try {
      localStorage.setItem(posKey(boardId()), JSON.stringify(p))
    } catch {
      /* 存储不可用：仅本会话生效 */
    }
  })

  const panelStyle = computed(() => {
    const mode = inspectorMode.value
    if (mode === 'fixed') return {} // CSS 默认 left/top（左上角）
    if (mode === 'free') {
      return {
        left: `${Math.round(freePos.value.x)}px`,
        top: `${Math.round(freePos.value.y)}px`,
        right: 'auto',
      }
    }
    const c = container()
    const vp = viewport()
    if (!c || !vp) return {}
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

  /**
   * 头部按下：仅 `free` 模式进入拖拽，位移钳制在画布视口内。
   * 非 free 模式直接返回（不阻断头部按钮的点击）。
   */
  function onHeaderPointerDown(e: PointerEvent): void {
    if (inspectorMode.value !== 'free') return
    const head = e.currentTarget as HTMLElement | null
    const el = head?.parentElement // .bi
    const host = el?.parentElement // 画布视口（.bv-editor）
    if (!el || !host) return
    e.preventDefault()

    const startX = e.clientX
    const startY = e.clientY
    const start = { ...freePos.value }
    // 预留头部高度，避免拖到视口底部后无法再拖回
    const maxX = Math.max(0, host.clientWidth - el.offsetWidth)
    const maxY = Math.max(0, host.clientHeight - 48)

    const move = (ev: PointerEvent) => {
      freePos.value = {
        x: Math.min(maxX, Math.max(0, start.x + (ev.clientX - startX))),
        y: Math.min(maxY, Math.max(0, start.y + (ev.clientY - startY))),
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { panelStyle, onHeaderPointerDown, inspectorMode }
}
