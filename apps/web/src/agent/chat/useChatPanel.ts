/**
 * useChatPanel — Agent 聊天面板状态管理（位置 / 大小 / 最小化 / 折叠）
 *
 * 从 AgentChat.vue 拆分而来，负责：
 *   - 面板坐标（panelX/panelY/panelW/panelH）的拖拽与缩放
 *   - 最小化 / 穿透（pin）切换
 *   - 面板状态持久化（agent_panel）
 *   - clampPanelY / clampPanelX / maxPanelH 等边界计算
 *
 * 注意：isPinned 来自 useAgent（全局单例），故作为参数传入而非在此处创建。
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'
import { usePanelDrag, usePanelResize } from '../composables/usePanelDrag'
import { createDebouncedStorage } from '@worldsmith/perf-kit/io'

const agentStorage = createDebouncedStorage({ debounce: 100 })

/** 输入栏高度（面板底部留白） */
const INPUT_BAR_HEIGHT = 80

export interface UseChatPanelOptions {
  /** 穿透模式 ref（来自 useAgent） */
  isPinned: Ref<boolean>
}

export function useChatPanel(options: UseChatPanelOptions) {
  const { isPinned } = options

  const isMinimized = ref(false)
  const sessionDrawerOpen = ref(false)
  const sessions = ref<Array<{ id: string; name: string; updatedAt: string; modelId?: string }>>([])

  const panelX = ref((window.innerWidth - 420) / 2)
  const panelY = ref((window.innerHeight - 500 - 80) / 2)
  const panelW = ref(420)
  const panelH = ref(500)

  function clampPanelY(y: number): number {
    return Math.max(0, Math.min(window.innerHeight - INPUT_BAR_HEIGHT - 36, y))
  }
  function clampPanelX(x: number): number { return x }
  function maxPanelH(): number {
    return window.innerHeight - panelY.value - INPUT_BAR_HEIGHT - 36
  }

  const { onDragStart } = usePanelDrag({
    x: panelX, y: panelY, clampX: clampPanelX, clampY: clampPanelY, onDragEnd: savePanelState,
    excludeSelector: '.header-actions,.header-title'
  })
  const { onResizeStart } = usePanelResize({
    w: panelW, h: panelH, minW: 320, maxW: 800, minH: 200, maxH: maxPanelH, onResizeEnd: savePanelState
  })

  const panelStyle = computed(() => ({
    left: `${panelX.value}px`,
    top: `${panelY.value}px`,
    width: `${panelW.value}px`,
    height: isMinimized.value ? 'auto' : `${panelH.value}px`,
  }))

  function togglePin(): void { isPinned.value = !isPinned.value }

  function toggleMinimize(): void {
    const wasMinimized = isMinimized.value
    isMinimized.value = !wasMinimized

    if (wasMinimized && !isMinimized.value) {
      const midY = window.innerHeight / 2
      if (panelY.value > midY) {
        const newTop = panelY.value - panelH.value
        panelY.value = clampPanelY(Math.max(0, newTop))
      }
    }

    if (!isMinimized.value) {
      panelY.value = clampPanelY(panelY.value)
    }
  }

  function onPanelMouseDown(e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (target.closest('.chat-header') || target.closest('.resize-handle')) return
  }

  function savePanelState(): void {
    try {
      agentStorage.set('agent_panel', {
        x: panelX.value, y: panelY.value, w: panelW.value, h: panelH.value,
      })
    } catch {}
  }

  function loadPanelState(): void {
    try {
      const raw = localStorage.getItem('agent_panel')
      if (raw) {
        const s = JSON.parse(raw)
        panelX.value = s.x ?? window.innerWidth - 440
        panelY.value = s.y ?? 60
        panelW.value = s.w ?? 420
        panelH.value = s.h ?? 500
      }
    } catch {}
  }

  function resetPosition(): void {
    panelW.value = 420
    panelH.value = 500
    panelX.value = (window.innerWidth - panelW.value) / 2
    panelY.value = (window.innerHeight - panelH.value - INPUT_BAR_HEIGHT) / 2
    isMinimized.value = false
    savePanelState()
  }

  return {
    INPUT_BAR_HEIGHT,
    isMinimized,
    sessionDrawerOpen,
    sessions,
    panelX, panelY, panelW, panelH,
    panelStyle,
    onDragStart, onResizeStart,
    togglePin, toggleMinimize, onPanelMouseDown,
    savePanelState, loadPanelState, resetPosition,
    clampPanelY, clampPanelX, maxPanelH,
  }
}

export type UseChatPanelReturn = ReturnType<typeof useChatPanel>

/** 让外部组件（如 settings 浮窗）能读取常量 */
export const CHAT_INPUT_BAR_HEIGHT: number = INPUT_BAR_HEIGHT

/** 面板样式 ComputedRef 类型 */
export type PanelStyle = ComputedRef<{
  left: string
  top: string
  width: string
  height: string
}>
