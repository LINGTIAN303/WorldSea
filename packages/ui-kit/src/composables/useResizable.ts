import { ref, computed, onBeforeUnmount, type Ref } from 'vue'

const STORAGE_PREFIX = 'worldsea_panel_width_'

const EVENT_RESET = 'worldsea:panel-width-reset'
const EVENT_RESET_ALL = 'worldsea:panel-width-reset-all'

export interface ResizableOptions {
  panelId: string
  defaultWidth: number
  minWidth?: number
  maxWidth?: number
  side?: 'left' | 'right'
}

function loadWidth(panelId: string, defaultWidth: number): number {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + panelId)
    if (raw) {
      const val = Number(raw)
      if (Number.isFinite(val) && val > 0) return val
    }
  } catch { /* ignore */ }
  return defaultWidth
}

function saveWidth(panelId: string, width: number) {
  try {
    localStorage.setItem(STORAGE_PREFIX + panelId, String(Math.round(width)))
  } catch { /* ignore */ }
}

export function useResizable(options: ResizableOptions & { sideRef?: Ref<'left' | 'right'> }) {
  const {
    panelId,
    defaultWidth,
    minWidth = 200,
    side = 'right',
  } = options

  const effectiveSide = computed(() => options.sideRef?.value || side)

  const width = ref(loadWidth(panelId, defaultWidth))
  const isResizing = ref(false)

  let startX = 0
  let startWidth = 0
  /** 拖动期间锁定的上界：`window.innerWidth` 每次读都可能触发一次布局，不该挪进 move 里 */
  let dragMaxWidth = 0
  /** 一帧只落一次宽度：mousemove 可到 100Hz+，而每次写入都带动一次重排 */
  let pendingClientX = 0
  let rafId = 0

  function onResizeStart(e: MouseEvent) {
    isResizing.value = true
    startX = e.clientX
    startWidth = width.value
    dragMaxWidth = options.maxWidth || Math.round(window.innerWidth * 0.8)
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeEnd)
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function applyWidth(clientX: number) {
    const dx = clientX - startX
    const raw = effectiveSide.value === 'left' ? startWidth - dx : startWidth + dx
    width.value = Math.max(minWidth, Math.min(raw, dragMaxWidth))
  }

  function flushPending() {
    if (!rafId) return
    cancelAnimationFrame(rafId)
    rafId = 0
    applyWidth(pendingClientX)
  }

  function onResizeMove(e: MouseEvent) {
    if (!isResizing.value) return
    pendingClientX = e.clientX
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = 0
        applyWidth(pendingClientX)
      })
    }
  }

  function onResizeEnd() {
    if (!isResizing.value) return
    isResizing.value = false
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    // 末次移动可能还压在帧队列里：先落地再存，否则存下的是旧宽度
    flushPending()
    saveWidth(panelId, width.value)
  }

  function resetWidth() {
    width.value = defaultWidth
    try {
      localStorage.removeItem(STORAGE_PREFIX + panelId)
    } catch { /* ignore */ }
  }

  function onExternalReset(e: Event) {
    const detail = (e as CustomEvent).detail
    if (detail && detail.panelId === panelId) {
      width.value = defaultWidth
    }
  }

  function onExternalResetAll() {
    width.value = defaultWidth
  }

  window.addEventListener(EVENT_RESET, onExternalReset)
  window.addEventListener(EVENT_RESET_ALL, onExternalResetAll)

  onBeforeUnmount(() => {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeEnd)
    // 卸载时若还压着一帧，取消它：否则那一帧会在组件销毁后仍去写已无人观察的 ref
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    window.removeEventListener(EVENT_RESET, onExternalReset)
    window.removeEventListener(EVENT_RESET_ALL, onExternalResetAll)
  })

  return {
    width,
    isResizing,
    onResizeStart,
    resetWidth,
  }
}

export function getAllPanelWidths(): { panelId: string; width: number }[] {
  const result: { panelId: string; width: number }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const panelId = key.slice(STORAGE_PREFIX.length)
        const raw = localStorage.getItem(key)
        if (raw) {
          const val = Number(raw)
          if (Number.isFinite(val) && val > 0) {
            result.push({ panelId, width: val })
          }
        }
      }
    }
  } catch { /* ignore */ }
  return result
}

export function resetPanelWidth(panelId: string) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + panelId)
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT_RESET, { detail: { panelId } }))
}

export function resetAllPanelWidths() {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT_RESET_ALL))
}

export const PANEL_LABELS: Record<string, string> = {
  'detail-default': '详情面板（默认）',
  'detail-character': '人物志详情',
  'detail-region': '区域详情',
  'detail-item': '道具详情',
  'detail-organization': '势力详情',
  'detail-info': '信息面板',
  'detail-concept': '概念详情',
  'modal-entity-form': '实体表单',
  'modal-settings': '设置',
  'modal-import-export': '导入/导出',
  'modal-batch-edit': '批量编辑',
  'modal-global-search': '全局搜索',
  'modal-version-history': '版本历史',
  'modal-template-manager': '模板管理',
  'modal-doc-export': '文档导出',
  'modal-undo-history': '撤销历史',
  'modal-shortcut-help': '快捷键帮助',
  'modal-welcome': '欢迎引导',
  'modal-color-picker': '颜色选择器',
  'floating-relation-edit': '关系编辑浮层',
  'floating-graph-info': '图谱信息浮层',
}
